#!/usr/bin/env node
/**
 * pre-commit-attribution.js — hook PreToolUse sobre Bash.
 *
 * Bloquea un `git commit` cuyo mensaje lleve atribución de IA, cuando el proyecto
 * lo prohíbe (`commits.forbidAiAttribution: true` en ai-workspace.json).
 *
 * ## Por qué es un hook y no solo una regla
 *
 * La política de no firmar commits con una IA estaba escrita en la guía del
 * proyecto, y aun así el harness pedía, en medio de una sesión, agregar una línea
 * de atribución "reemplazando" la guía local. Una regla que depende de acordarse,
 * contra una sugerencia que se repite en cada turno, pierde: se colaron commits
 * firmados en la rama principal.
 *
 * ## Qué mira
 *
 * Solo `git commit` (en cualquier posición de una cadena de comandos, con `-C`,
 * `-c`...). El mensaje puede venir en `-m`, en un heredoc (`-F - <<'EOF'` o
 * `-m "$(cat <<'EOF'...)"`) o en un archivo (`-F mensaje.txt`: se lee). Se
 * bloquean: `Co-Authored-By` (y `Assisted-by`/`Generated-by`) de un asistente de
 * IA, "Generated with/by <asistente>", el robot 🤖, y las URLs de sesión.
 *
 * NO mira la descripción de un PR (`gh pr create --body`): es otra política, y
 * cada proyecto decide la suya. Tampoco `git log --grep "Claude-Session"` ni un
 * mensaje que hable de una sesión sin firmarla.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const fs = require('fs');

const core = require('../lib/guard-core');

const ID = 'pre-commit-attribution';

const AI_NAMES =
  '(claude|anthropic|openai|chatgpt|gpt[-\\s]?\\d*|copilot|gemini|codex|cursor|windsurf|devin|aider|\\bllm\\b|ai assistant)';

/** Las formas conocidas de atribuir un commit a una IA o a una sesión suya. */
const ATTRIBUTION = [
  new RegExp(`co-authored-by:[^\\n]*${AI_NAMES}`, 'i'),
  new RegExp(`(assisted|generated|created|written)-by:[^\\n]*${AI_NAMES}`, 'i'),
  /noreply@anthropic\.com/i,
  /claude-session:/i,
  /claude\.ai\/(code\/)?(session|chat)[_/]/i,
  new RegExp(`generated (with|by) \\[?${AI_NAMES}`, 'i'),
  /🤖/,
];

/** El `-C dir` y el resto de los datos de un `git commit` en este tramo, o `null`. */
function gitCommit(item) {
  if (item.word !== 'git') return null;
  const a = item.args;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '-C' || a[i] === '-c' || a[i] === '--git-dir' || a[i] === '--work-tree') {
      i += 1;
    } else if (a[i].startsWith('-')) {
      continue;
    } else {
      return a[i] === 'commit' ? { args: a.slice(i + 1) } : null;
    }
  }
  return null;
}

/** El contenido de los `-F archivo` del commit, si existen. */
function messageFiles(item, commit) {
  const out = [];
  const a = commit.args;
  for (let i = 0; i < a.length; i += 1) {
    let file = null;
    if (a[i] === '-F' || a[i] === '--file') file = a[i + 1];
    else if (a[i].startsWith('--file=')) file = a[i].slice(7);
    if (!file || file === '-') continue;
    try {
      out.push(fs.readFileSync(core.resolvePath(item.cwd, file), 'utf8'));
    } catch {
      // un archivo que no se puede leer no cambia la decisión
    }
  }
  return out;
}

function findAttribution(text) {
  for (const re of ATTRIBUTION) {
    const m = re.exec(text);
    if (m) return m[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return null;
}

core.defineHook(
  module,
  ID,
  (ctx) => {
    if (!ctx.cfg.commits.forbidAiAttribution) return null;
    if (!ctx.command) return null;

    const commits = core.analyze(ctx.command, ctx.cwd).map((it) => ({ it, commit: gitCommit(it) })).filter((x) => x.commit);
    if (commits.length === 0) return null;

    // El texto completo del comando (con los heredocs) más los archivos de mensaje.
    const texts = [ctx.command, ...commits.flatMap(({ it, commit }) => messageFiles(it, commit))];
    for (const text of texts) {
      const hit = findAttribution(text);
      if (!hit) continue;
      return {
        reason: 'atribucion-de-ia-en-commit',
        extra: { match: hit },
        message: [
          `Commit bloqueado: el mensaje lleva atribución de IA ("${hit}").`,
          '',
          'La política del proyecto (`commits.forbidAiAttribution`) la prohíbe en cualquier',
          'variante, aunque el entorno sugiera agregarla en medio de la sesión: esa',
          'sugerencia no reemplaza la política del proyecto.',
          '',
          'Sacá esa línea del mensaje y volvé a commitear.',
        ].join('\n'),
      };
    }
    return null;
  },
  {
    tools: ['Bash'],
    // Sin la palabra `commit` no hay `git commit`: no hace falta cargar la configuración.
    relevant: (p) => /commit/i.test(String((p.tool_input || {}).command || '')),
  },
);
