#!/usr/bin/env node
/**
 * worktree-paths.js
 *
 * Qué es un slot y cómo se reconoce uno en una ruta. UNA sola definición.
 *
 * Por qué un módulo: en el sistema del que sale esta pieza la forma de un slot
 * (`worktrees/<slot>/<repo>`) estaba escrita como expresión regular en cuatro
 * lugares distintos —la status line, el hook de dependencias, el de
 * migraciones y el resolvedor de repositorios— y cada uno la mantenía por su
 * cuenta. Cuando cambió el nombre de un slot, tres se actualizaron y el cuarto
 * siguió reconociendo la forma vieja: un hook que "no ve" el slot deja pasar el
 * comando que tenía que bloquear, sin avisar.
 *
 * Layout (el que ya usa `scripts/manage-worktree.js`):
 *
 *   <raíz>/<worktrees.dir>/<slot>/<repo.name>/     un worktree de git por repo
 *   <raíz>/<worktrees.dir>/<slot>/.ai-worktree.json   manifiesto del slot
 *
 * Todo acepta `/` y `\` y rutas absolutas o relativas: los comandos que ve un
 * hook traen lo que el agente haya escrito, y en Windows eso mezcla ambas.
 *
 * Nada acá nombra un repositorio, un slot ni una rama: salen de la
 * configuración (`ai-workspace.json`).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = '.ai-worktree.json';

/** A formato POSIX, sin barra final. */
function posix(p) {
  return String(p).split('\\').join('/').replace(/\/+$/, '');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Los slots declarados: `[{ name, kind }]`. */
function slots(cfg) {
  return cfg.worktrees.slotDefs || cfg.worktrees.slots.map((name) => ({ name, kind: 'implementation' }));
}

function slotKind(cfg, name) {
  const def = slots(cfg).find((s) => s.name === name);
  if (def) return def.kind;
  // Un slot no declarado (creado a mano) se trata como de implementación:
  // el caso más restrictivo para los hooks.
  return /^review/.test(name) ? 'review' : 'implementation';
}

/** Carpeta absoluta de un slot. */
function slotRoot(cfg, slot) {
  return path.join(cfg.root, cfg.worktrees.dir, slot);
}

/** Carpeta absoluta del worktree de un repositorio dentro de un slot. */
function slotRepoDir(cfg, slot, repo) {
  const name = typeof repo === 'string' ? repo : repo.name;
  return path.join(slotRoot(cfg, slot), name);
}

/** `<dir>/<slot>/<repo>` relativo a la raíz, en POSIX. */
function slotRepoRel(cfg, slot, repo) {
  const name = typeof repo === 'string' ? repo : repo.name;
  return `${posix(cfg.worktrees.dir)}/${slot}/${name}`;
}

/**
 * Expresión que reconoce una mención de un slot en un texto cualquiera: un
 * comando, un cwd, una ruta. Captura `[1]` = slot y `[2]` = repositorio.
 *
 * El nombre del slot es genérico (cualquier tramo): un slot abierto a mano con
 * un nombre no declarado sigue siendo un slot, y un hook no puede darse el lujo
 * de no verlo. El repositorio, en cambio, sale de los declarados.
 */
function slotMentionRegex(cfg) {
  const dir = escapeRe(posix(cfg.worktrees.dir)).split('/').join('[\\\\/]');
  const repos = cfg.repos.map((r) => escapeRe(r.name)).join('|') || '[^/\\\\\\s"\']+';
  return new RegExp(`(?:^|[\\\\/\\s"'=:])${dir}[\\\\/]([^\\\\/\\s"']+)[\\\\/](${repos})(?![\\w.-])`);
}

/**
 * Si el texto menciona un slot, devuelve `{ slot, kind, repo, rest }`.
 * `rest` es lo que sigue al repositorio dentro del slot (puede ser vacío).
 */
function parseSlotPath(cfg, text) {
  const s = String(text || '');
  const m = slotMentionRegex(cfg).exec(s);
  if (!m) return null;
  const after = s.slice(m.index + m[0].length);
  const rest = /^[\\/]([^\s"']*)/.exec(after);
  return {
    slot: m[1],
    kind: slotKind(cfg, m[1]),
    repo: m[2],
    rest: rest ? posix(rest[1]) : '',
  };
}

/** ¿El texto menciona algún slot? */
function mentionsSlot(cfg, text) {
  return parseSlotPath(cfg, text) !== null;
}

/**
 * Resuelve el argumento `--repo` de un gate: acepta el nombre lógico
 * (`mi-api`) o la ruta de un slot (`worktrees/review/mi-api`).
 *
 * Devuelve `{ repo, dir, isSlot, slot }`:
 *   repo   el repositorio lógico declarado — el nombre que va en los hallazgos
 *          y en el baseline, y NUNCA la ruta del slot
 *   dir    el directorio absoluto desde el que se lee el código
 *
 * Por qué importa: un gate que arma la ruta como `<raíz>/<repo>` audita lo que
 * esté checkouteado en la principal aunque el revisor esté mirando otro slot,
 * y el resultado sale igual de prolijo. Es el error más caro de esta familia,
 * porque no falla: reporta limpio sobre código que no es el del cambio.
 *
 * @returns {{repo: object, dir: string, isSlot: boolean, slot: string|null}|null}
 *   `null` si no corresponde a ningún repositorio declarado.
 */
function resolveRepo(cfg, arg) {
  if (!arg) return null;
  const byName = cfg.repos.find((r) => r.name === arg);
  if (byName) return { repo: byName, dir: byName.absPath, isSlot: false, slot: null };

  const hit = parseSlotPath(cfg, arg);
  if (!hit) return null;
  const repo = cfg.repos.find((r) => r.name === hit.repo);
  if (!repo) return null;
  return { repo, dir: slotRepoDir(cfg, hit.slot, repo), isSlot: true, slot: hit.slot };
}

/**
 * ¿Esta ruta ABSOLUTA está dentro de un slot? `{ slot, kind, repo }` o `null`.
 *
 * Distinto de `parseSlotPath` a propósito: ese reconoce menciones en texto libre
 * y exige el repositorio después del slot; un cwd puede ser la raíz del slot
 * (`<dir>/<slot>`), que agrupa varios repositorios y no menciona ninguno.
 */
function slotOfPath(cfg, absPath) {
  if (!absPath) return null;
  const rel = posix(path.relative(cfg.root, path.resolve(absPath)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const dir = posix(cfg.worktrees.dir);
  const norm = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  if (norm(rel) !== norm(dir) && !norm(rel).startsWith(`${norm(dir)}/`)) return null;
  const parts = rel.slice(dir.length).split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const repo = parts[1] && cfg.repos.some((r) => r.name === parts[1]) ? parts[1] : null;
  return { slot: parts[0], kind: slotKind(cfg, parts[0]), repo };
}

/** El `--repo` que apunta al mismo repositorio leído desde un slot. */
function repoArgFrom(cfg, repoName, fromSlot) {
  return fromSlot ? slotRepoRel(cfg, fromSlot, repoName) : repoName;
}

/**
 * Busca la raíz del workspace subiendo desde un directorio.
 *
 * Gana el ancestro MÁS EXTERNO que tenga `ai-workspace.json`: en topología
 * single-repo un slot es un checkout completo del repositorio y trae su propio
 * `ai-workspace.json`, así que el primero que se encuentra subiendo sería el
 * del slot — y un hook que corre con esa raíz cree que el workspace es el slot.
 */
function findWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  let found = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'ai-workspace.json'))) found = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

module.exports = {
  MANIFEST_NAME,
  posix,
  slots,
  slotKind,
  slotRoot,
  slotRepoDir,
  slotRepoRel,
  slotMentionRegex,
  parseSlotPath,
  slotOfPath,
  mentionsSlot,
  resolveRepo,
  repoArgFrom,
  findWorkspaceRoot,
};
