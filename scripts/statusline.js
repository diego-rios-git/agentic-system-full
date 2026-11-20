#!/usr/bin/env node
/**
 * statusline.js — status line de Claude Code: en qué slot trabaja la sesión.
 *
 *   ● <slot> │ <repo>: <rama> … │ <modelo> · <effort> │ ctx Nk (P%) │ USD x
 *
 * Por qué existe: con varias sesiones abiertas, cada una en un slot distinto o
 * yendo y viniendo entre un slot y la principal, no se sabía en cuál trabajaba
 * cada una. Y mirar la rama equivocada antes de commitear es el error que esto
 * evita.
 *
 * ## Es una INFERENCIA, no un registro
 *
 * Una sesión abierta en la raíz tiene siempre la raíz como cwd, así que el cwd
 * no alcanza. Orden de decisión:
 *
 *   1. El cwd está dentro de `<worktrees.dir>/<slot>/`: gana. Es lo único cierto.
 *   2. Si no, el ÚLTIMO tool_use de la cola del transcript (últimos 512 KB) cuyo
 *      input mencione un slot (`worktree-paths.parseSlotPath`) o un repositorio
 *      principal.
 *   3. Si no, el último slot detectado en esta sesión (cache en `os.tmpdir()`),
 *      para que no se pierda cuando la acción sale de la cola leída.
 *   4. Si no, la principal.
 *
 * Límites que hay que conocer:
 *   - Una sesión recién abierta muestra `principal` hasta que toca un archivo.
 *   - Un comando que solo MENCIONA un slot (`--from <slot>`) mueve la línea a
 *     ese slot. Suele ser correcto, pero es una mención, no una prueba.
 *   - Una sesión que solo conversa muestra el último lugar donde trabajó.
 *   - Un slot cerrado después de detectado se cae a `principal`.
 *   - Un transcript ausente o ilegible no rompe nada: se usa el cache o la principal.
 *
 * Nunca rompe: cualquier excepción deja `● slot ?` (una status line vacía no
 * avisa que falló).
 *
 * Se registra solo, desde `ai/core/manifest.json` → `statusLine`
 * (`consolidate-skills.js --wrappers`). Nadie edita a mano el settings.json.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TAIL_BYTES = 512 * 1024;

const COLORS = process.env.NO_COLOR
  ? { reset: '', dim: '', bold: '', blue: '', green: '', yellow: '', red: '' }
  : { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };

const PRINCIPAL = 'principal';

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Todos los textos de un input de herramienta (rutas, comandos), ya sin escapar. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Cola de un archivo, como texto. */
function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** `slot` | `principal` | `null` según lo que menciona un texto. El slot gana. */
function slotFromText(cfg, paths, text) {
  const hit = paths.parseSlotPath(cfg, text);
  if (hit) return hit.slot;
  for (const repo of cfg.repos) {
    if (new RegExp(`(^|[\\\\/\\s"'=:])${escapeRe(repo.name)}([\\\\/\\s"']|$)`).test(text)) return PRINCIPAL;
  }
  return null;
}

/** El último slot (o la principal) tocado por una herramienta, recorriendo la cola de atrás hacia adelante. */
function slotFromTranscript(cfg, paths, file) {
  if (!file || !fs.existsSync(file)) return null;
  const lines = readTail(file).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // la primera línea de la cola puede venir cortada
    }
    const content = entry && entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (!block || block.type !== 'tool_use' || !block.input) continue;
      for (const text of strings(block.input)) {
        const slot = slotFromText(cfg, paths, text);
        if (slot) return slot;
      }
    }
  }
  return null;
}

function cacheFile(cfg, sessionId) {
  const safe = String(sessionId).replace(/[^\w.-]/g, '_');
  return path.join(os.tmpdir(), `claude-statusline-${cfg.project.name}`, `${safe}.txt`);
}

function cachedSlot(cfg, sessionId, detected) {
  if (!sessionId) return detected;
  const file = cacheFile(cfg, sessionId);
  try {
    if (detected) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, detected);
      return detected;
    }
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return detected;
  }
}

/**
 * La rama leyendo `HEAD` directamente, sin lanzar `git`.
 *
 * La status line se redibuja a cada rato, y dos `git` por repositorio en cada
 * redibujo eran la mayor parte de su costo. `HEAD` es un archivo de texto
 * estable: `ref: refs/heads/<rama>` o el SHA si está desacoplado. En un worktree
 * (un slot) `.git` es un archivo que apunta al directorio real. Cualquier cosa
 * rara devuelve `undefined` y se le pregunta a `git`.
 */
function branchFromHead(dir) {
  try {
    let gitDir = path.join(dir, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return undefined;
      gitDir = path.resolve(dir, m[1]);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref) return ref[1];
    if (/^[0-9a-f]{40,64}$/i.test(head)) return `detached@${head.slice(0, 7)}`;
    return undefined;
  } catch {
    return undefined;
  }
}

function branchLabel(dir) {
  if (!fs.existsSync(dir)) return null;
  const fast = branchFromHead(dir);
  if (fast !== undefined) return fast;
  const opts = { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const name = execFileSync('git', ['-C', dir, 'branch', '--show-current'], opts).trim();
    if (name) return name;
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], opts).trim();
    return sha ? `detached@${sha}` : null;
  } catch {
    return null;
  }
}

/** Tokens que ocupa la conversación en la ventana y qué porcentaje es. */
function contextUsage(cw) {
  const u = cw && cw.current_usage;
  if (!u) return null;
  const tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const pct = cw.used_percentage;
  return `ctx ${Math.round(tokens / 1000)}k${pct === undefined || pct === null ? '' : ` (${Math.round(pct)}%)`}`;
}

function sameDir(a, b) {
  const n = (p) => path.resolve(p).split('\\').join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

function render(input) {
  const C = COLORS;
  const cwd = (input.workspace && input.workspace.current_dir) || input.cwd || process.cwd();
  const parts = [];

  let cfg = null;
  let paths = null;
  let costColors = { warnAt: 10, alertAt: 20 };
  const rootFound = require('./lib/worktree-paths').findWorkspaceRoot(cwd);
  if (rootFound) {
    const loaded = require('./lib/workspace-config').load({ optional: true });
    // Una raíz distinta de la de este script es otro proyecto: solo se muestra la carpeta.
    if (loaded && sameDir(loaded.root, rootFound)) {
      cfg = loaded;
      paths = require('./lib/worktree-paths');
    }
  }

  if (cfg) {
    const inCwd = paths.slotOfPath(cfg, cwd);
    const detected = inCwd ? inCwd.slot : slotFromTranscript(cfg, paths, input.transcript_path);
    let slot = cachedSlot(cfg, input.session_id, detected) || PRINCIPAL;
    // Un slot ya cerrado deja de ser un lugar donde se trabaja.
    if (slot !== PRINCIPAL && !fs.existsSync(paths.slotRoot(cfg, slot))) slot = PRINCIPAL;

    const kind = slot === PRINCIPAL ? 'principal' : paths.slotKind(cfg, slot);
    const color = kind === 'principal' ? C.blue : kind === 'review' ? C.yellow : C.green;
    parts.push(`${color}${C.bold}● ${slot}${C.reset}`);

    for (const repo of cfg.repos) {
      const dir = slot === PRINCIPAL ? repo.absPath : paths.slotRepoDir(cfg, slot, repo);
      const b = branchLabel(dir);
      if (b) parts.push(`${C.dim}${repo.name}:${C.reset} ${b}`);
    }

    costColors = { warnAt: cfg.statusline.costWarnUsd, alertAt: cfg.statusline.costAlertUsd };
  } else {
    parts.push(path.basename(cwd));
  }

  // El effort llega en el JSON desde la 2.1.x; CLAUDE_EFFORT cubre versiones que no lo mandan.
  const model = input.model && input.model.display_name;
  const effort = (input.effort && input.effort.level) || process.env.CLAUDE_EFFORT;
  if (model) parts.push(`${C.dim}${model}${effort ? ` · ${effort}` : ''}${C.reset}`);

  const ctx = contextUsage(input.context_window);
  if (ctx) parts.push(`${C.dim}${ctx}${C.reset}`);

  const usd = input.cost && input.cost.total_cost_usd;
  if (typeof usd === 'number') {
    const { warnAt, alertAt } = costColors;
    const color = usd >= alertAt ? C.red : usd >= warnAt ? C.yellow : C.green;
    parts.push(`${color}USD ${usd.toFixed(2)}${C.reset}`);
  }

  return parts.join(`${C.dim} │ ${C.reset}`);
}

// Una excepción dejaría la status line vacía sin avisar nada; mejor mostrar algo.
if (require.main === module) {
  try {
    process.stdout.write(render(readStdin()));
  } catch {
    process.stdout.write('● slot ?');
  }
}

module.exports = { render, slotFromText, slotFromTranscript, branchFromHead };
