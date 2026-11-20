#!/usr/bin/env node
/**
 * guard-core.js
 *
 * Lo común de todos los hooks de `scripts/hooks/`. Antes cada hook traía su
 * propia copia de esto —leer stdin, partir el comando, decidir si hay un slot de
 * por medio, escribir el log— y las copias derivaban: uno aprendía a partir por
 * `&` y el otro no, uno resolvía la raíz subiendo hasta el PRIMER
 * `ai-workspace.json` (el del slot, en single-repo) y el otro hasta el último.
 * Un hook que "no ve" lo que el otro sí ve deja pasar el comando que tenía que
 * bloquear, sin avisar.
 *
 * Contrato de un hook (Claude Code PreToolUse; el plugin de OpenCode delega en el
 * mismo script):
 *
 *   stdin   JSON `{ tool_name, cwd, tool_input: { command | file_path, content,
 *           old_string, new_string } }`
 *   exit 0  permitir
 *   exit 2  bloquear; lo que se escribe en stderr vuelve al agente como motivo
 *
 * **Fail-open.** Un error propio del hook (un bug, una configuración rota, un
 * JSON ilegible) permite la acción y deja una línea de diagnóstico en stderr:
 * un guard que se cae y frena todo el trabajo se desactiva a la semana, y el
 * guard desactivado es peor que el que se equivoca de a poco. Lo que sí se
 * bloquea es lo que el hook entendió y decidió.
 *
 * Los hooks ignoran los argumentos que no conocen: el registro les agrega
 * `--ai-managed`.
 *
 * Todo lo que varía por proyecto (repositorios, slots, comandos de base de
 * datos, perfiles de dependencias) sale de `ai-workspace.json`; nada acá nombra
 * un repositorio, un gestor de paquetes ni un ORM.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const wt = require('./worktree-paths');

const LOG_NAME = '.ai-gates-log.jsonl';

// ---------------------------------------------------------------------------
// Entrada, salida, log
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** El JSON de la entrada, o `null` si está vacío o es ilegible (→ el hook permite). */
function parsePayload(raw) {
  if (!raw || !String(raw).trim()) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

function writeErr(text) {
  try {
    fs.writeSync(2, text);
  } catch {
    try {
      process.stderr.write(text);
    } catch {
      // sin dónde escribir: no se puede hacer nada más
    }
  }
}

/** Una línea de diagnóstico que NO bloquea. */
function diag(id, message) {
  writeErr(`[${id}] ${message}\n`);
}

/** Bloquea: el mensaje vuelve al agente y la acción no se ejecuta. */
function block(message) {
  writeErr(String(message).replace(/\n*$/, '\n'));
  process.exit(2);
}

/**
 * Una línea por bloqueo en `.ai-gates-log.jsonl` (gitignoreado). Es informativo:
 * si no se puede escribir, la decisión ya tomada no cambia.
 */
function logBlock(root, entry) {
  try {
    fs.appendFileSync(
      path.join(root, LOG_NAME),
      JSON.stringify({ ts: new Date().toISOString(), decision: 'blocked', ...entry }) + '\n',
    );
  } catch {
    // ver arriba
  }
}

// ---------------------------------------------------------------------------
// Configuración y raíz
// ---------------------------------------------------------------------------

/**
 * Carga la configuración del workspace a partir del directorio de trabajo.
 *
 * La raíz es el ancestro MÁS EXTERNO con `ai-workspace.json`: en single-repo un
 * slot es un checkout completo y trae su propio archivo, así que el primero que
 * se encuentra subiendo sería el del slot.
 *
 * @returns {{cfg: object, root: string}|{error: string}}
 */
function loadContext(payloadCwd) {
  const start = payloadCwd || process.cwd();
  let root = wt.findWorkspaceRoot(start);
  if (!root) {
    // Sin cwd útil: la raíz del proyecto donde vive este script.
    const own = path.resolve(__dirname, '..', '..');
    if (fs.existsSync(path.join(own, 'ai-workspace.json'))) root = own;
  }
  if (!root && !process.env.AI_WORKSPACE_CONFIG) {
    return { error: 'no hay ai-workspace.json desde el directorio de trabajo hacia arriba' };
  }
  // `workspace-config` fija la ruta al cargarse: se define antes del require.
  if (!process.env.AI_WORKSPACE_CONFIG && root) {
    process.env.AI_WORKSPACE_CONFIG = path.join(root, 'ai-workspace.json');
  }
  try {
    const wc = require('./workspace-config');
    const cfg = wc.load();
    return { cfg, root: root || cfg.root };
  } catch (err) {
    return { error: `configuración inválida: ${err.message}` };
  }
}

/** ¿Está habilitado este hook para el proyecto? `hooks.<id>.enabled`. */
function hookEnabled(cfg, id, defaultOn) {
  const own = cfg.hooks && cfg.hooks[id];
  if (own && typeof own.enabled === 'boolean') return own.enabled;
  return defaultOn;
}

/**
 * Ejecuta un hook.
 *
 * @param {string} id
 * @param {(ctx: object) => ({reason: string, message: string, extra?: object}|null)} handler
 *   devuelve `null` para permitir, o el motivo y el mensaje para bloquear.
 * @param {{tools?: string[], needsConfig?: boolean, defaultOn?: boolean}} [opts]
 *   `defaultOn: false` = hook opcional: solo actúa con `hooks.<id>.enabled: true`.
 */
function runHook(id, handler, opts = {}) {
  let verdict = null;
  let ctx = null;
  try {
    const payload = parsePayload(readStdin());
    if (!payload) process.exit(0);

    const tool = payload.tool_name;
    if (opts.tools && tool && !opts.tools.includes(tool)) process.exit(0);

    const loaded = loadContext(payload.cwd);
    if (loaded.error) {
      diag(id, `${loaded.error}; se deja pasar`);
      process.exit(0);
    }
    if (!hookEnabled(loaded.cfg, id, opts.defaultOn !== false)) process.exit(0);

    const input = payload.tool_input || {};
    ctx = {
      payload,
      tool,
      input,
      command: typeof input.command === 'string' ? input.command : '',
      filePath: input.file_path || input.notebook_path || '',
      cwd: payload.cwd || process.cwd(),
      cfg: loaded.cfg,
      root: loaded.root,
    };
    verdict = handler(ctx);
  } catch (err) {
    diag(id, `error propio (${err && err.message}); se deja pasar`);
    process.exit(0);
  }

  if (!verdict) process.exit(0);

  logBlock(ctx.root, {
    hook: id,
    reason: verdict.reason,
    tool: ctx.tool,
    ...(ctx.command ? { command: ctx.command.slice(0, 300) } : {}),
    ...(ctx.filePath ? { file: wt.posix(ctx.filePath).slice(0, 300) } : {}),
    cwd: ctx.cwd,
    ...(verdict.extra || {}),
  });
  block(verdict.message);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

/** Quita los cuerpos de heredoc: lo que hay ahí es texto, no comandos. */
function stripHeredocBodies(command) {
  const out = [];
  let delim = null;
  for (const line of String(command).split('\n')) {
    if (delim) {
      if (line.trim() === delim) delim = null;
      continue;
    }
    out.push(line);
    const m = /(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m) delim = m[2];
  }
  return out.join('\n');
}

/**
 * Parte un comando en tramos por `&&`, `||`, `;`, `|`, `&`, salto de línea,
 * paréntesis y comilla invertida, respetando las comillas.
 *
 * `2>&1` y `&>` no son separadores. Los cuerpos de heredoc se descartan: un
 * mensaje de commit que menciona `npm run migration:run` no es ese comando.
 */
function splitSegments(command) {
  const s = stripHeredocBodies(command);
  const segments = [];
  let cur = '';
  let q = null;
  const push = () => {
    if (cur.trim()) segments.push(cur.trim());
    cur = '';
  };

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      cur += c;
      if (q === '"' && c === '\\' && s[i + 1] === '"') {
        cur += s[i + 1];
        i += 1;
      } else if (c === q) {
        q = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === '\n' || c === ';' || c === '(' || c === ')' || c === '`') {
      push();
    } else if (c === '&') {
      if (s[i + 1] === '&') {
        i += 1;
        push();
      } else if (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>') {
        cur += c;
      } else {
        push();
      }
    } else if (c === '|') {
      if (s[i + 1] === '|' || s[i + 1] === '&') i += 1;
      push();
    } else {
      cur += c;
    }
  }
  push();
  return segments;
}

/** Parte un tramo en tokens, sin las comillas. La `\` es literal (rutas de Windows). */
function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let has = false;
  let q = null;
  for (const c of String(segment)) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

/** `C:\x\npm.CMD` → `npm`. */
function normWord(token) {
  const base = String(token || '')
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop();
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
}

/** Flags que llevan un valor aparte: ese valor no es un subcomando ni un argumento. */
const VALUE_FLAGS = new Set([
  '--prefix', '-c', '--cwd', '--dir', '--directory', '--workspace', '-w', '--filter',
  '--registry', '--cache', '--userconfig', '--project', '--require', '--loader',
  '--import', '--env-file', '--config', '--working-dir',
]);

/**
 * Los argumentos que no son flags ni valores de flags. La lista es corta a
 * propósito: un flag con valor que no está acá deja su valor de más, y eso solo
 * puede sobrar; un flag booleano que SÍ estuviera (`-f`, `-r`, `-D`) se tragaría
 * el subcomando y el comando pasaría sin revisar. `-C`/`-c` (git, make, pnpm)
 * comparten entrada porque se comparan en minúsculas.
 */
function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') continue;
    if (a.startsWith('-') && a.length > 1) {
      if (!a.includes('=') && VALUE_FLAGS.has(a.toLowerCase())) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd']);
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'nice', 'command', 'exec', 'cross-env', 'dotenv', 'call']);
const PYTHONS = new Set(['python', 'python3', 'py']);
const CD_WORDS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const SHELL_CMD_FLAGS = new Set(['-c', '-lc', '-ic', '-command', '-c', '/c', '/k']);

/** Resuelve `p` contra `base` aceptando `/` y `\` aun donde la barra nativa es `/`. */
function resolvePath(base, p) {
  let t = String(p);
  if (path.sep === '/' && !/^[A-Za-z]:/.test(t)) t = t.split('\\').join('/');
  return path.resolve(base || process.cwd(), t);
}

function describe(tokens, text, cwd) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1;
    } else if (WRAPPERS.has(normWord(t))) {
      i += 1;
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1;
    } else {
      break;
    }
  }
  if (i >= tokens.length) return null;

  let word = normWord(tokens[i]);
  let args = tokens.slice(i + 1);
  if (PYTHONS.has(word) && args[0] === '-m' && args[1]) {
    word = normWord(args[1]);
    args = args.slice(2);
  }
  return { word, args, positional: positionals(args), text, cwd };
}

/**
 * Los comandos de un texto, cada uno con el directorio en el que correría:
 * sigue los `cd` encadenados (`cd <slot> && npm ci`, o al revés: `cd <principal>
 * && npm ci` estando la sesión en un slot) y entra en `bash -c "..."`,
 * `cmd /c "..."` y `pwsh -Command "..."` (un nivel de anidado).
 *
 * @returns {{word: string, args: string[], positional: string[], text: string, cwd: string}[]}
 */
function analyze(command, cwd, depth = 0) {
  const out = [];
  let cur = cwd;
  for (const text of splitSegments(command)) {
    const it = describe(tokenize(text), text, cur);
    if (!it) continue;

    if (CD_WORDS.has(it.word)) {
      const target = it.args.find((a) => !a.startsWith('-') && a.toLowerCase() !== '/d');
      if (target && target !== '-') cur = resolvePath(cur, target);
      out.push(it);
      continue;
    }
    out.push(it);

    if (SHELLS.has(it.word) && depth < 2) {
      const at = it.args.findIndex((a) => SHELL_CMD_FLAGS.has(a.toLowerCase()));
      if (at !== -1 && it.args[at + 1]) {
        out.push(...analyze(it.args.slice(at + 1).join(' '), it.cwd, depth + 1));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Todas las menciones de un slot en un texto: `[{ slot, repo }]`. */
function mentionedSlots(cfg, text) {
  const base = wt.slotMentionRegex(cfg);
  const re = new RegExp(base.source, 'g');
  const out = [];
  const s = String(text || '');
  let m;
  while ((m = re.exec(s)) !== null) out.push({ slot: m[1], repo: m[2] });
  return out;
}

/**
 * Si hay un slot en juego: el directorio de trabajo está adentro, o el texto
 * (un tramo del comando) nombra su ruta. Alcanza con cualquiera de los dos.
 *
 * @returns {null | {slot: string, kind: string, repos: object[]}} `repos` son los
 *   repositorios declarados involucrados; si el directorio de trabajo es la
 *   raíz de un slot (sin repositorio), son todos.
 */
function slotContext(cfg, root, cwd, text) {
  const repos = new Map();
  let slot = null;
  const add = (s, name) => {
    slot = slot || s;
    const r = cfg.repos.find((x) => x.name === name);
    if (r) repos.set(r.name, r);
  };

  for (const src of [cwd, text]) {
    for (const m of mentionedSlots(cfg, src)) add(m.slot, m.repo);
  }

  if (!slot) {
    // Un slot nombrado SIN repositorio (`rm -rf <dir>/<slot>`): afecta a todos.
    const dir = wt.posix(cfg.worktrees.dir)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .split('/')
      .join('[\\\\/]');
    const bare = new RegExp(`(?:^|[\\\\/\\s"'=:])${dir}[\\\\/]([^\\\\/\\s"']+)`).exec(String(text || ''));
    if (bare) {
      slot = bare[1];
      for (const r of cfg.repos) repos.set(r.name, r);
    }
  }

  if (!slot && cwd) {
    // La raíz de un slot sin repositorio: `<raíz>/<worktrees.dir>/<slot>`.
    const base = wt.posix(path.resolve(root, cfg.worktrees.dir)).toLowerCase() + '/';
    const here = wt.posix(resolvePath(root, cwd)).toLowerCase();
    if (here.startsWith(base) && here.length > base.length) {
      slot = here.slice(base.length).split('/')[0];
      for (const r of cfg.repos) repos.set(r.name, r);
    }
  }
  if (!slot) return null;
  return { slot, kind: wt.slotKind(cfg, slot), repos: [...repos.values()] };
}

/** ¿Hay un slot en juego? (cwd o texto del comando). */
function slotInPlay(cfg, cwd, command, root) {
  return slotContext(cfg, root || wt.findWorkspaceRoot(cwd) || cfg.root, cwd, command) !== null;
}

module.exports = {
  LOG_NAME,
  readStdin,
  parsePayload,
  diag,
  block,
  logBlock,
  loadContext,
  hookEnabled,
  runHook,
  stripHeredocBodies,
  splitSegments,
  tokenize,
  normWord,
  positionals,
  resolvePath,
  analyze,
  mentionedSlots,
  slotContext,
  slotInPlay,
};
