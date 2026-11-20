#!/usr/bin/env node
/**
 * repo-location.js
 *
 * Dónde se lee el código de un repositorio y con qué nombre se reporta.
 *
 * Un gate recibe `--repo mi-api` o `--repo worktrees/review/mi-api`. Las dos
 * cosas son el MISMO repositorio: mismas reglas, mismo baseline, mismos nombres
 * en los hallazgos. Lo único que cambia es la carpeta de la que se lee el código.
 *
 * Por qué existe: cada gate armaba la ruta como `<raíz>/<repo>`, así que una
 * revisión en un slot auditaba en silencio la rama que estuviera checkouteada en
 * la principal, y el resultado salía igual de prolijo que si hubiera mirado lo
 * correcto. No falla ni avisa: reporta limpio sobre código que no es el del
 * cambio. Es el error más caro de esta familia justamente por eso.
 *
 * Reglas que cada gate tiene que respetar (`gate-cli.js` ya las cumple):
 *   - El código se lee de `dir`.
 *   - Los hallazgos y el baseline usan el nombre LÓGICO. Si la ruta del slot
 *     entrara en la huella, toda la deuda ya congelada saldría como nueva.
 *   - `--write-baseline` desde un slot es un error (exit 2). Congelar ahí
 *     perdonaría para siempre los hallazgos de una rama que todavía no se
 *     mergeó.
 *
 * La definición de "qué es un slot" NO está acá: es `worktree-paths.js`.
 */

'use strict';

const fs = require('fs');

const wt = require('./worktree-paths');

/**
 * Resuelve el valor de `--repo`.
 *
 * @returns {{
 *   repo: object,       repositorio declarado, con `absPath` apuntando a `dir`
 *   name: string,       nombre lógico (el que va en hallazgos y baseline)
 *   dir: string,        carpeta absoluta de la que se lee el código
 *   isSlot: boolean,
 *   slot: string|null,
 *   exists: boolean
 * }|null} `null` si el argumento no corresponde a ningún repositorio declarado
 */
function resolve(cfg, arg) {
  const hit = wt.resolveRepo(cfg, arg);
  if (!hit) return null;

  return {
    // `absPath` apunta al directorio de lectura: así los gates que ya leen
    // `repo.absPath` leen el slot sin tocarlos. `mainAbsPath` conserva el de la
    // principal por si alguno lo necesita.
    repo: { ...hit.repo, absPath: hit.dir, mainAbsPath: hit.repo.absPath },
    name: hit.repo.name,
    dir: hit.dir,
    isSlot: hit.isSlot,
    slot: hit.slot,
    exists: fs.existsSync(hit.dir),
  };
}

/** El `--repo` que apunta al mismo repositorio leído desde un slot. */
function repoArgFrom(cfg, repoName, fromSlot) {
  return wt.repoArgFrom(cfg, repoName, fromSlot);
}

/**
 * `--from` acepta el nombre del slot (`review`) o su carpeta
 * (`worktrees/review`). Devuelve el nombre del slot.
 */
function slotNameFrom(cfg, from) {
  if (!from) return null;
  const s = wt.posix(from);
  const prefix = `${wt.posix(cfg.worktrees.dir)}/`;
  const name = s.startsWith(prefix) ? s.slice(prefix.length) : s;
  return name.split('/')[0] || null;
}

module.exports = { resolve, repoArgFrom, slotNameFrom };
