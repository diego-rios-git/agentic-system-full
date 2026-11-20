#!/usr/bin/env node
/**
 * pre-commit-gates.js — hook PreToolUse sobre Bash. OPCIONAL: se enciende con
 * `hooks.pre-commit-gates.enabled: true` en ai-workspace.json.
 *
 * Antes de un `git commit` corre `scripts/run-gates.js` sobre el repositorio que
 * se commitea (o `--all` si el commit es del workspace) y bloquea si los gates
 * encuentran algo.
 *
 * ## Por qué
 *
 * El procedimiento ya pedía "gates en verde antes del commit" y aun así se
 * salteó: se corrigió un hallazgo de la revisión, se commiteó sin volver a correr
 * los gates, y el arreglo traía el mismo problema que el gate marca. Una regla que
 * depende de acordarse, justo después de una corrección, pierde.
 *
 * ## Qué decide
 *
 *   run-gates sale 0  → el commit pasa.
 *   run-gates sale 1  → hallazgos: BLOQUEA y muestra el resumen.
 *   run-gates sale 2  → algo NO se pudo verificar (un gate caído, un repositorio
 *                       sin clonar, config rota). Un gate que no puede mirar no es
 *                       un gate limpio: NO se deja pasar en silencio. Se bloquea
 *                       UNA vez con el aviso, y el mismo commit reintentado dentro
 *                       de 15 minutos pasa con la advertencia: el agente (y el
 *                       operador) ya saben que ese commit salió sin verificar. Así
 *                       un verificador roto no frena todo el trabajo, pero tampoco
 *                       se lee como "limpio". El estado queda en
 *                       `.ai-gates-unverified.json`.
 *
 * Qué repositorio verifica: el de `git -C <dir> commit`, o el del directorio de
 * trabajo; dentro de un slot, `--repo <repo> --from <slot>`. Si el directorio es
 * el workspace y no un repositorio declarado, `--all`.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const core = require('../lib/guard-core');
const wt = require('../lib/worktree-paths');

const ID = 'pre-commit-gates';
const STATE_NAME = '.ai-gates-unverified.json';
const RETRY_WINDOW_MS = 15 * 60 * 1000;
const RUN_TIMEOUT_MS = 220 * 1000;
const MAX_LINES = 40;

/** El directorio en el que corre un `git commit`, o `null` si el tramo no es uno. */
function commitDir(item) {
  if (item.word !== 'git') return null;
  const a = item.args;
  let dir = item.cwd;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '-C') {
      if (a[i + 1]) dir = core.resolvePath(dir, a[i + 1]);
      i += 1;
    } else if (a[i] === '-c' || a[i] === '--git-dir' || a[i] === '--work-tree') {
      i += 1;
    } else if (a[i].startsWith('-')) {
      continue;
    } else {
      return a[i] === 'commit' ? dir : null;
    }
  }
  return null;
}

/** Los argumentos de `run-gates` para el commit de un directorio, o `null` si no es del workspace. */
function gateArgs(cfg, root, dir) {
  const posix = wt.posix(dir);
  const hit = wt.parseSlotPath(cfg, posix);
  if (hit) return ['--repo', hit.repo, '--from', hit.slot];

  const lower = posix.toLowerCase();
  let best = null;
  for (const r of cfg.repos) {
    const base = wt.posix(path.resolve(root, r.path)).toLowerCase();
    if ((lower === base || lower.startsWith(`${base}/`)) && (!best || base.length > best.len)) best = { name: r.name, len: base.length };
  }
  // En single-repo `path` es "." y todo cae en el único repositorio.
  if (best) return ['--repo', best.name];

  const rootLower = wt.posix(root).toLowerCase();
  if (lower === rootLower || lower.startsWith(`${rootLower}/`)) return ['--all'];
  return null;
}

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STATE_NAME), 'utf8'));
  } catch {
    return null;
  }
}

function tail(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-MAX_LINES)
    .join('\n');
}

core.defineHook(
  module,
  ID,
  (ctx) => {
    const { cfg, root } = ctx;
    if (!ctx.command) return null;

    const targets = new Map();
    for (const it of core.analyze(ctx.command, ctx.cwd)) {
      const dir = commitDir(it);
      if (!dir) continue;
      const args = gateArgs(cfg, root, dir);
      if (args) targets.set(args.join(' '), args);
    }
    if (targets.size === 0) return null;

    const script = [path.join(root, 'scripts', 'run-gates.js'), path.join(__dirname, '..', 'run-gates.js')].find((f) =>
      fs.existsSync(f),
    );

    const findings = [];
    const unverified = [];
    for (const args of targets.values()) {
      const run = script
        ? spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
        : null;
      const label = args.join(' ');
      if (run && run.status === 0) continue;
      if (run && run.status === 1) findings.push(`-- ${label}\n${tail(run.stdout)}`);
      else
        unverified.push(
          `-- ${label}: ${!run ? 'falta scripts/run-gates.js' : run.status === null ? 'se cortó por tiempo' : `salió con ${run.status}`}\n${tail(run && (run.stderr || run.stdout))}`,
        );
    }

    if (findings.length > 0) {
      return {
        reason: 'gates-con-hallazgos',
        message: [
          'Commit bloqueado: los gates tienen hallazgos.',
          '',
          findings.join('\n\n'),
          '',
          'Corregilos y volvé a commitear. Si es un falso positivo, documentalo y congelalo',
          'en el baseline (no lo ignores en silencio).',
        ].join('\n'),
      };
    }

    if (unverified.length > 0) {
      const key = [...targets.keys()].sort().join('|') + '#' + unverified.length;
      const prev = readState(root);
      if (prev && prev.key === key && Date.now() - Date.parse(prev.ts) < RETRY_WINDOW_MS) {
        core.diag(ID, 'AVISO: los gates siguen sin poder verificarse; el commit sale SIN verificar.');
        return null;
      }
      try {
        fs.writeFileSync(path.join(root, STATE_NAME), JSON.stringify({ key, ts: new Date().toISOString() }) + '\n');
      } catch {
        // sin estado no hay reintento: el aviso se repite, que es lo seguro
      }
      return {
        reason: 'gates-sin-verificar',
        message: [
          'Commit en pausa: los gates NO se pudieron verificar (no es lo mismo que "sin hallazgos").',
          '',
          unverified.join('\n\n'),
          '',
          'Avisale al operador que la verificación no corrió. Si decide commitear igual,',
          'repetí el mismo comando (dentro de 15 minutos) y pasa con esta advertencia.',
        ].join('\n'),
      };
    }
    return null;
  },
  {
    tools: ['Bash'],
    defaultOn: false,
    // Sin la palabra `commit` no hay `git commit`: no hace falta cargar la configuración.
    relevant: (p) => /commit/i.test(String((p.tool_input || {}).command || '')),
  },
);
