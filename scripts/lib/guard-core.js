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
 * **Un hook es un módulo.** Se declara con `defineHook(module, id, handler, opts)`:
 * corrido directamente (`node pre-bash-x.js`, el plugin de OpenCode, los tests)
 * se ejecuta solo; requerido por `scripts/hooks/dispatch.js` exporta su handler y
 * el despachador corre todos los de un evento en UN proceso, con la configuración
 * cargada una vez. Cada hook en su propio `node` costaba un arranque por hook en
 * cada acción del agente — cinco por cada comando de shell.
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
const LOG_ROTATED = '.ai-gates-log.1.jsonl';
/** Por encima de esto el log pasa a `.ai-gates-log.1.jsonl` (se pisa el anterior). */
const LOG_MAX_BYTES = 1024 * 1024;

/** La raíz del proyecto donde vive este script: el último recurso para ubicar la raíz. */
const OWN_ROOT = path.resolve(__dirname, '..', '..');

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
 * Agrega una línea a `.ai-gates-log.jsonl` (gitignoreado). Pasado
 * `LOG_MAX_BYTES` lo rota a `.ai-gates-log.1.jsonl`: es un archivo que se escribe
 * en cada edición con gate y nadie limpia a mano. Es informativo: si no se puede
 * escribir, la decisión ya tomada no cambia.
 */
function appendLog(root, entry) {
  try {
    const file = path.join(root, LOG_NAME);
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.size > LOG_MAX_BYTES) fs.renameSync(file, path.join(root, LOG_ROTATED));
    } catch {
      // no existe todavía, o no se pudo rotar: se sigue escribiendo
    }
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // ver arriba
  }
}

/** Una línea por bloqueo. */
function logBlock(root, entry) {
  appendLog(root, { decision: 'blocked', ...entry });
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
    if (fs.existsSync(path.join(OWN_ROOT, 'ai-workspace.json'))) root = OWN_ROOT;
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
 * ¿Vale la pena evaluar este hook para esta entrada? Se decide ANTES de cargar
 * la configuración: es lo que hace barato el caso normal (un `ls`, un `git
 * status`), que no le interesa a ningún hook. Ante la duda —un `relevant` que
 * revienta— el hook corre: el filtro solo puede ahorrar, nunca dejar pasar.
 */
function applies(def, payload) {
  const opts = def.opts || {};
  const tool = payload.tool_name;
  if (opts.tools && tool && !opts.tools.includes(tool)) return false;
  if (typeof opts.relevant !== 'function') return true;
  try {
    return !!opts.relevant(payload);
  } catch {
    return true;
  }
}

/**
 * Qué hace el hook con `ai-workspace.json`:
 *   'required' (por defecto) sin configuración no actúa, y lo avisa;
 *   'optional' la usa si está, y sin ella decide solo (`ctx.cfg` es `null`);
 *   'none'     no la usa: ni siquiera se carga por él.
 */
function configMode(def) {
  const mode = (def.opts || {}).config;
  return mode === 'optional' || mode === 'none' ? mode : 'required';
}

/**
 * Evalúa uno o varios hooks sobre la misma entrada, con la configuración
 * cargada UNA vez. No sale del proceso: devuelve los veredictos.
 *
 * Fail-open por hook: el error de uno se reporta y no afecta a los demás.
 *
 * @param {{id: string, handler: Function, opts?: object}[]} defs
 * @param {object|null} payload
 * @returns {Promise<{id: string, verdict: object, ctx: object}[]>}
 */
async function evaluate(defs, payload) {
  const out = [];
  if (!payload) return out;

  const active = defs.filter((d) => applies(d, payload));
  if (active.length === 0) return out;

  const loaded = active.some((d) => configMode(d) !== 'none') ? loadContext(payload.cwd) : null;
  const cfg = loaded && !loaded.error ? loaded.cfg : null;

  const input = payload.tool_input || {};
  const cwd = payload.cwd || process.cwd();

  for (const def of active) {
    const opts = def.opts || {};
    if (configMode(def) === 'required' && !cfg) {
      diag(def.id, `${loaded.error}; se deja pasar`);
      continue;
    }
    // Sin configuración un hook opcional no puede saber si lo encendieron.
    if (cfg ? !hookEnabled(cfg, def.id, opts.defaultOn !== false) : opts.defaultOn === false) continue;

    const ctx = {
      payload,
      tool: payload.tool_name,
      input,
      command: typeof input.command === 'string' ? input.command : '',
      filePath: input.file_path || input.notebook_path || '',
      cwd,
      cfg,
      root: cfg ? loaded.root : wt.findWorkspaceRoot(cwd) || OWN_ROOT,
    };
    try {
      const verdict = await def.handler(ctx);
      if (verdict) out.push({ id: def.id, verdict, ctx });
    } catch (err) {
      diag(def.id, `error propio (${err && err.message}); se deja pasar`);
    }
  }
  return out;
}

/**
 * Registra los bloqueos y sale: con 2 y todos los mensajes si alguno bloqueó,
 * con 0 si no. Un veredicto con `log: false` lleva su propio registro.
 * `extra`: motivos de bloqueo que llegaron por otro lado (un hook en su propio
 * proceso, que ya registró lo suyo).
 */
function finish(results, extra = []) {
  if (results.length === 0 && extra.length === 0) process.exit(0);
  for (const { id, verdict, ctx } of results) {
    if (verdict.log === false) continue;
    logBlock(ctx.root, {
      hook: id,
      reason: verdict.reason,
      tool: ctx.tool,
      ...(ctx.command ? { command: ctx.command.slice(0, 300) } : {}),
      ...(ctx.filePath ? { file: wt.posix(ctx.filePath).slice(0, 300) } : {}),
      cwd: ctx.cwd,
      ...(verdict.extra || {}),
    });
  }
  const messages = [...results.map((r) => r.verdict.message), ...extra];
  block(messages.map((m) => String(m).replace(/\n*$/, '')).join('\n\n'));
}

/**
 * Ejecuta un hook solo, como proceso propio.
 *
 * @param {string} id
 * @param {(ctx: object) => (object|null|Promise<object|null>)} handler
 *   devuelve `null` para permitir, o `{reason, message, extra?, log?}` para bloquear.
 * @param {{tools?: string[], relevant?: Function, config?: string, defaultOn?: boolean}} [opts]
 *   `defaultOn: false` = hook opcional: solo actúa con `hooks.<id>.enabled: true`.
 *   `relevant(payload)` = filtro barato previo a cargar la configuración.
 *   `config` = 'required' | 'optional' | 'none' (ver `configMode`).
 */
function runHook(id, handler, opts = {}) {
  let payload = null;
  try {
    payload = parsePayload(readStdin());
  } catch {
    payload = null;
  }
  evaluate([{ id, handler, opts }], payload).then(finish, (err) => {
    diag(id, `error propio (${err && err.message}); se deja pasar`);
    process.exit(0);
  });
}

/**
 * Declara un hook. Lo exporta como `module.exports.hook` para el despachador
 * y, si el archivo es el que se ejecutó (`node pre-bash-x.js`), lo corre.
 *
 * `scripts/hooks/dispatch.js` reconoce un hook-módulo porque su fuente llama a
 * `defineHook(`: requerir un script que no lo es lo ejecutaría.
 */
function defineHook(mod, id, handler, opts = {}) {
  const hook = { id, handler, opts };
  mod.exports.hook = hook;
  if (require.main === mod) runHook(id, handler, opts);
  return hook;
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
  LOG_ROTATED,
  LOG_MAX_BYTES,
  readStdin,
  parsePayload,
  diag,
  block,
  appendLog,
  logBlock,
  loadContext,
  hookEnabled,
  applies,
  evaluate,
  finish,
  runHook,
  defineHook,
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
