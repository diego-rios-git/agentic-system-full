#!/usr/bin/env node
/**
 * run-checks.js
 *
 * Corre los checks NO deterministas de una revisión —chequeo de tipos, lint,
 * tests— UNA sola vez por repositorio, con tope de recursos, y emite un bloque
 * compacto para pegar en el prompt de cada subagente.
 *
 * Es el mismo problema que resuelve `run-gates.js`, con los checks caros. Los
 * archivos de cada agente pedían, cada uno, tipos + lint + build + tests, y el
 * orquestador los pedía otra vez. Con 3-5 agentes en paralelo eran 4-7 suites
 * completas a la vez: 60+ procesos y 20-30 GB de memoria peleando por 8 hilos.
 * La máquina entraba en swap y la revisión terminaba siendo más lenta que
 * hacerla a mano.
 *
 * NINGÚN COMANDO ESTÁ FIJO ACÁ. Lo que corre sale de lo que cada repositorio
 * declara en `ai-workspace.json` (ni npm, ni jest, ni tsc, ni dotnet):
 *
 *   typecheckCommand        chequeo de tipos del programa
 *   typecheckTestCommand    el chequeo que SÍ ve los tipos de los tests: muchos
 *                           runners transpilan los specs sin chequear tipos y el
 *                           typecheck normal los excluye, así que un test con la
 *                           firma vieja llega al remoto y rompe la compilación
 *   lintCommand             lint completo
 *   lintRelatedCommand      lint acotado al diff; usa `{files}`
 *   testCommand             suite completa
 *   testRelatedCommand      tests acotados al diff; usa `{files}`
 *
 * `{files}` se reemplaza por los archivos de código que toca la rama (los que el
 * perfil de lenguaje reconoce como fuente), separados por espacio, SIN los
 * borrados: pasarle un archivo inexistente a un runner lo hace fallar entero, y
 * eso se leería como "tests rotos" cuando lo único que pasó es que el cambio
 * borró un archivo.
 *
 * Seis estados, y solo el primero es verde:
 *   OK sin hallazgos     corrió y salió con 0
 *   FALLA                corrió y salió con otro código
 *   NO APLICA            no corresponde (la rama no toca código: no hay tests
 *                        que acotar). Se dice por qué; no desaparece del bloque
 *   NO DECLARADO         el repositorio no declara ese comando. Es SIN VERIFICAR,
 *                        nunca verde: un check que desaparece se lee como "pasó"
 *   NO SE PUDO EJECUTAR  binario ausente, timeout, o un typecheck cuyos únicos
 *                        errores son de artefactos de build (ver abajo)
 *
 * NUNCA se resume con un pipe que oculte el código de salida. El comando se
 * ejecuta entero y se lee su código; el resumen se calcula acá, en proceso. Un
 * `build | tail` salió con 0 con el build roto —el pipe devuelve el código del
 * último comando— y dio verde. Si un comando declarado lleva un pipe, se avisa.
 *
 * Artefactos de build y typecheck. Un chequeo de tipos que lee archivos de build
 * a medio escribir (los que regenera un servidor de desarrollo corriendo en
 * paralelo) falla por SINTAXIS en ellos, y eso aborta el análisis semántico del
 * programa entero: reporta unos pocos errores del artefacto y no llega a mirar
 * el código del repositorio. Una versión de este script degradó esos errores a
 * una nota y dio "OK" mientras enmascaraba seis errores de tipos reales. Por eso:
 *   - si TODOS los errores son de artefactos → NO SE PUDO EJECUTAR (el código no
 *     se verificó), nunca verde;
 *   - si hay un error real mezclado → FALLA.
 * Un repositorio declara qué rutas son artefactos con `artifactPaths` en su
 * entrada de `ai-workspace.json` (fragmentos de ruta, con `/`):
 *
 *   { "name": "mi-app", "typecheckCommand": "npx tsc --noEmit",
 *     "artifactPaths": [".next/", "dist/"] }
 *
 * Tope de recursos (deliberado):
 *   - Los repositorios corren en paralelo CON TOPE (`--max-parallel`, 2 por
 *     defecto; `--serial` los pone de a uno); los checks DENTRO de un repositorio
 *     van en serie. Techo predecible: pocos procesos pesados a la vez.
 *   - A los hijos se les limita el heap de Node (`--max-old-space-size`,
 *     `AI_CHECKS_HEAP_MB`, 1536 por defecto, 0 lo desactiva): un entorno con un
 *     tope enorme a nivel máquina hace que ningún proceso recolecte basura en
 *     serio hasta que es tarde. El tope de workers de cada runner vive en la
 *     configuración del propio runner, para proteger también a quien lo corre a mano.
 *   - NO corre `buildCommand`: en una revisión no dice nada que el chequeo de
 *     tipos no diga, y suele ser el proceso más caro del repositorio.
 *
 * La base es `origin/<baseBranch>` del repositorio, y el diff incluye lo
 * commiteado, lo modificado y lo sin trackear (`lib/review-base.js`): una
 * revisión ocurre antes de commitear.
 *
 * Códigos de salida:
 *   0  todo lo que corrió salió limpio (y algo corrió, o nada era declarable)
 *   1  algún check falló o no se pudo ejecutar, o NADA se verificó porque falta
 *      declarar los comandos
 *   2  repositorio (o slot) ausente, o uso incorrecto
 * Stderr lleva el progreso, una línea por check: redirigido a un archivo, el
 * reporte sale entero al final por stdout, y sin esto una corrida larga es
 * indistinguible de una colgada.
 *
 * Uso:
 *   node scripts/run-checks.js --all
 *   node scripts/run-checks.js --repo mi-api [--scope diff|full] [--base origin/main]
 *   node scripts/run-checks.js --all --from review      # lee el slot
 *   node scripts/run-checks.js --all --serial --json
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const languages = require('./lib/languages');
const repoLocation = require('./lib/repo-location');
const reviewBase = require('./lib/review-base');
const wt = require('./lib/worktree-paths');

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_CHECK_TIMEOUT_MS) || 15 * 60 * 1000;
const FULL_TESTS_TIMEOUT_MS = Number(process.env.AI_CHECK_TIMEOUT_MS) || 45 * 60 * 1000;
const HEAP_MB = process.env.AI_CHECKS_HEAP_MB !== undefined ? Number(process.env.AI_CHECKS_HEAP_MB) : 1536;
const MAX_OUTPUT = 400000;

// ---------------------------------------------------------------------------
// Qué se corre
// ---------------------------------------------------------------------------

const quote = (f) => (/\s/.test(f) ? `"${f}"` : f);

/** Lo que el repositorio declara y esta base no interpreta (`artifactPaths`). */
function artifactPathsOf(cfg, repo) {
  const own = (cfg.raw.repos || []).find((r) => r.name === repo.name) || {};
  return (Array.isArray(own.artifactPaths) ? own.artifactPaths : []).map((p) => String(p).split('\\').join('/').toLowerCase());
}

/**
 * Archivos de código que toca la rama, sin los borrados. `null` si el diff no se
 * pudo leer. Sin perfil de lenguaje no hay forma de saber qué es código: se
 * toman todos los archivos tocados, que es lo conservador (corre de más, no de menos).
 */
function changedCode(diff, profile) {
  if (!diff) return null;
  return [...diff.added, ...diff.modified].filter((f) => profile.empty || profile.isSource(f)).sort();
}

/**
 * La lista de checks de un repositorio. Cada uno trae `command` (o `undeclared`,
 * o `na`). Una sola función decide qué corre, y la prueban los tests por su salida.
 */
function checksFor(repo, { scope, diff, profile, base }) {
  const changed = scope === 'full' ? null : changedCode(diff, profile);
  const narrowed = Array.isArray(changed) && changed.length > 0;
  const noCode = Array.isArray(changed) && changed.length === 0;
  const diffNote = scope !== 'full' && changed === null ? 'no se pudo leer el diff: se corrió completo' : null;

  const files = narrowed ? changed.map(quote).join(' ') : null;
  const out = [];

  const declared = (id, label, command, extra = {}) =>
    out.push(command ? { id, label, command, ...extra } : { id, label, undeclared: id });

  declared('typecheck', 'Chequeo de tipos', repo.typecheckCommand);
  // Solo si el repositorio lo declara: no todo proyecto separa el chequeo de los tests.
  if (repo.typecheckTestCommand) {
    declared('typecheck-tests', 'Chequeo de tipos de los tests', repo.typecheckTestCommand);
  }

  // Lint: acotado al diff si el repositorio declara cómo; si no, el completo.
  if (narrowed && repo.lintRelatedCommand) {
    declared('lint', `Lint (acotado al diff: ${changed.length} archivos)`, repo.lintRelatedCommand.split('{files}').join(files));
  } else if (noCode && repo.lintRelatedCommand) {
    out.push({ id: 'lint', label: 'Lint', na: 'la rama no toca archivos de código' });
  } else if (repo.lintCommand || !repo.lintRelatedCommand) {
    declared('lint', 'Lint', repo.lintCommand, diffNote ? { note: diffNote } : {});
  } else {
    // Solo declara la variante acotada y el diff no se leyó: no hay con qué correrla.
    out.push({ id: 'lint', label: 'Lint', undeclared: 'lintCommand', note: 'solo hay `lintRelatedCommand` y no se pudo leer el diff' });
  }

  // Tests. La rama no toca código: correr la suite entera sería el camino más
  // caro para no aprender nada. Se salta y se dice por qué.
  if (noCode) {
    out.push({
      id: 'tests',
      label: 'Tests',
      na: `la rama no toca archivos de código contra \`${base}\`; \`--scope full\` fuerza la suite entera`,
    });
  } else if (narrowed && repo.testRelatedCommand) {
    declared('tests', `Tests (acotados al diff: ${changed.length} archivos)`, repo.testRelatedCommand.split('{files}').join(files), {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } else if (repo.testCommand) {
    const reason =
      scope === 'full'
        ? null
        : narrowed
          ? 'el repositorio no declara `testRelatedCommand`: se corre la suite completa'
          : diffNote;
    declared('tests', 'Tests (suite completa)', repo.testCommand, { timeoutMs: FULL_TESTS_TIMEOUT_MS, ...(reason ? { note: reason } : {}) });
  } else {
    out.push({ id: 'tests', label: 'Tests', undeclared: 'testCommand' });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

const SHELL_BUILTINS = new Set(['cd', 'echo', 'exit', 'set', 'type', 'call', 'export', 'source', '.', 'true', 'false', 'test', '[']);

/** El primer programa de un comando (sin variables de entorno delante). */
function firstProgram(command) {
  const tokens = String(command).trim().split(/\s+/);
  for (const t of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    return t.replace(/^["']|["']$/g, '');
  }
  return null;
}

/** ¿Existe ese programa? `null` = no se pudo decidir (un builtin, una expresión de shell). */
function programExists(program, cwd) {
  if (!program || SHELL_BUILTINS.has(program) || /[$`(]/.test(program)) return null;

  const hasSep = /[\\/]/.test(program);
  if (hasSep) return fs.existsSync(path.resolve(cwd, program));

  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(cwd, 'node_modules', '.bin'));
  for (const d of dirs) {
    for (const e of ['', ...exts]) {
      if (fs.existsSync(path.join(d, program + e))) return true;
    }
  }
  return false;
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ya terminó */
    }
  }
}

/** ¿El comando lleva un pipe sin comillas? Oculta el código de salida del primero. */
function hasPipe(command) {
  const bare = String(command).replace(/"[^"]*"|'[^']*'/g, '').replace(/\|\|/g, '');
  return /\|/.test(bare);
}

function childEnv() {
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  if (HEAP_MB > 0 && !/max-old-space-size/.test(env.NODE_OPTIONS || '')) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--max-old-space-size=${HEAP_MB}`;
  }
  return env;
}

/**
 * Corre un check. Desenlaces: ok, fail, broken (NO SE PUDO EJECUTAR), na y
 * undeclared. El quinto y el cuarto no se ejecutan; ninguno de los dos es verde.
 */
function runCheck(check, dir, artifacts) {
  return new Promise((resolve) => {
    if (check.na) return resolve({ ...check, status: 'na', seconds: 0 });
    if (check.undeclared) return resolve({ ...check, status: 'undeclared', seconds: 0 });

    const exists = programExists(firstProgram(check.command), dir);
    if (exists === false) {
      return resolve({
        ...check,
        status: 'broken',
        seconds: 0,
        reason: `binario ausente: \`${firstProgram(check.command)}\` (¿faltan instalar las dependencias?)`,
      });
    }

    const started = Date.now();
    let child;
    try {
      child = spawn(check.command, {
        cwd: dir,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv(),
      });
    } catch (err) {
      return resolve({ ...check, status: 'broken', seconds: 0, reason: `no se pudo lanzar: ${err.message}` });
    }

    let output = '';
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      resolve({ ...check, ...r, seconds: Math.round((Date.now() - started) / 1000) });
    };

    // Las dos puntas: varios runners escriben el resumen por stderr.
    const grab = (c) => {
      output += c;
      if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);

    const timeout = check.timeoutMs || DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      killTree(child);
      finish({ status: 'broken', reason: `superó el tope de ${formatDuration(timeout)} y se dio de baja`, output });
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ status: 'broken', reason: `no se pudo lanzar: ${err.message}`, output });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ ...verdict(check, output, code, artifacts), exitCode: code, output });
    });
  });
}

function formatDuration(ms) {
  return ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`;
}

/** El shell no encontró el programa: no es que el check falle, es que no corrió. */
function shellMissing(output, code) {
  if (code === 127 || code === 9009) return true;
  const short = output.split(/\r?\n/).filter((l) => l.trim()).length <= 4;
  return short && /is not recognized as an internal or external command|command not found|not found$/im.test(output);
}

/**
 * Veredicto de un check terminado.
 *
 * Un chequeo de tipos cuyos únicos errores son de artefactos de build NO es un
 * chequeo limpio ni uno fallido: no miró el código (ver cabecera). Con un error
 * real mezclado, sí falla.
 */
function verdict(check, output, code, artifacts) {
  if (code === 0) return { status: 'ok' };

  if (shellMissing(output, code)) {
    return { status: 'broken', reason: 'el shell no encontró el programa del comando (¿falta instalarlo?)' };
  }

  if ((check.id === 'typecheck' || check.id === 'typecheck-tests') && artifacts.length > 0) {
    const errors = output.split(/\r?\n/).filter((l) => /\berror\b/i.test(l) && !/^\s/.test(l));
    const isArtifact = (l) => {
      const norm = l.split('\\').join('/').toLowerCase();
      return artifacts.some((a) => norm.includes(a));
    };
    const fromArtifacts = errors.filter(isArtifact);
    if (errors.length > 0 && fromArtifacts.length === errors.length) {
      return {
        status: 'broken',
        reason:
          `los ${errors.length} errores son de artefactos de build (${artifacts.join(', ')}). Un error de sintaxis ahí ` +
          'aborta el análisis del programa entero: el código del repositorio NO se verificó. ' +
          'Detener lo que regenera esos archivos (o borrarlos) y repetir.',
      };
    }
  }

  return { status: 'fail' };
}

// ---------------------------------------------------------------------------
// Resúmenes
// ---------------------------------------------------------------------------

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(ANSI, '').trimEnd())
    .filter((l) => l.trim() !== '');
}

/**
 * Pegado en el prompt de varios agentes, 2000 líneas de un runner de tests es
 * exactamente el gasto que este script viene a evitar: alcanza con los totales y
 * QUÉ falló. Quien quiera el detalle corre ese test solo.
 */
function summarizeTests(lines) {
  const totals = lines.filter((l) => /\b(tests?|test suites?|test files?|passed|failed|total)\b.*\d|\d+\s+(passed|failed|passing|failing)/i.test(l.trim())).slice(-6);
  const failing = lines
    .filter((l) => /^\s*(FAIL(ED)?\b|not ok\b|\[FAIL\]|●|×|✗|✘|--- FAIL|Failed\b)/.test(l))
    .filter((l) => !/Console|Cannot log after/.test(l))
    .slice(0, 20);
  const sel = [...totals, ...failing];
  return sel.length > 0 ? sel : lines.slice(-20);
}

/**
 * Un lint sobre un repositorio con deuda escupe cientos de líneas. Lo útil: cuántos
 * problemas, en qué archivos, de qué reglas — no el listado entero.
 */
function summarizeLint(lines) {
  const byFile = new Map();
  const byRule = new Map();
  let file = null;

  for (const raw of lines) {
    const l = raw.trim();
    if (/^(?:[A-Za-z]:)?[\\/]?[^\s:]+\.\w+$/.test(l) && !/^\d+:\d+/.test(l)) {
      file = l;
      continue;
    }
    const m = l.match(/^(\d+):(\d+)\s+(error|warning)\s+(.*)$/);
    if (!m || !file) continue;
    const rule = m[4].trim().split(/\s{2,}/).pop() || '(sin regla)';
    byFile.set(file, (byFile.get(file) || 0) + 1);
    byRule.set(rule, (byRule.get(rule) || 0) + 1);
  }

  const total = lines.filter((l) => /\d+\s+problems?\b/i.test(l)).slice(-1);
  if (byFile.size === 0) return total.concat(lines.slice(-15));

  const top = (map, n) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${v}  ${k}`);
  return total.concat(['Archivos con más problemas:'], top(byFile, 10), ['Reglas más frecuentes:'], top(byRule, 8));
}

function summarize(check) {
  const lines = cleanLines(check.output);
  if (check.id === 'tests') return summarizeTests(lines);
  if (check.id === 'lint') return summarizeLint(lines);
  const errors = lines.filter((l) => /\berror\b/i.test(l));
  return (errors.length > 0 ? errors : lines.slice(-25)).slice(0, 25);
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

function render(block) {
  const { label, rel, base, results } = block;
  const lines = [`## Checks — ${label} (ya ejecutados, NO volver a correrlos)`, `_ejecutados en \`${rel}\` · base \`${base}\`_`, ''];

  const ok = results.filter((r) => r.status === 'ok');
  if (ok.length > 0) lines.push(`OK sin hallazgos: ${ok.map((r) => `${r.label} (${r.seconds}s)`).join(' · ')}`);

  for (const r of results.filter((x) => x.status === 'fail')) {
    lines.push('', `FALLA — ${r.label} (${r.seconds}s)`);
    if (r.note) lines.push(`   nota: ${r.note}`);
    for (const l of summarize(r)) lines.push(`    ${l}`);
  }

  for (const r of results.filter((x) => x.status === 'na')) {
    lines.push('', `NO APLICA — ${r.label}: ${r.na}`);
  }

  for (const r of results.filter((x) => x.status === 'undeclared')) {
    lines.push(
      '',
      `NO DECLARADO — ${r.label}: el repositorio no declara \`${r.undeclared}\` en ai-workspace.json.` +
        (r.note ? ` ${r.note}.` : ''),
      '   Es *sin verificar*, no *sin hallazgos*: decirlo en el informe.',
    );
  }

  for (const r of results.filter((x) => x.status === 'broken')) {
    lines.push('', `NO SE PUDO EJECUTAR — ${r.label}: ${r.reason}`);
    lines.push('   Tratar como *sin verificar*, no como *sin hallazgos*, y decirlo en el informe.');
  }

  for (const r of results.filter((x) => x.note && x.status === 'ok')) {
    lines.push('', `Nota — ${r.label}: ${r.note}`);
  }
  for (const r of results.filter((x) => x.pipeWarning)) {
    lines.push('', `Aviso — ${r.label}: el comando declarado lleva un pipe (\`|\`), que puede ocultar su código de salida.`);
  }

  lines.push('', '> No se corre `buildCommand` en una revisión: no agrega nada sobre el chequeo de tipos y suele ser lo más caro.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  return {
    all: argv.includes('--all'),
    repo: value('--repo'),
    from: value('--from'),
    base: value('--base'),
    scope: value('--scope') || 'diff',
    serial: argv.includes('--serial'),
    maxParallel: Number(value('--max-parallel')) || Number(process.env.AI_CHECKS_MAX_PARALLEL) || 2,
    json: argv.includes('--json'),
  };
}

function usage(cfg) {
  process.stderr.write(
    `\nUso: node scripts/run-checks.js (--all | --repo ${cfg.repos.map((r) => r.name).join('|')}) ` +
      '[--scope diff|full] [--base <ref>] [--from <slot>] [--serial] [--max-parallel N] [--json]\n\n',
  );
  process.exit(2);
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  if (!['diff', 'full'].includes(opts.scope)) return usage(cfg);

  let from = repoLocation.slotNameFrom(cfg, opts.from);
  let repos;
  if (opts.all) {
    repos = cfg.repos;
  } else if (opts.repo) {
    const located = repoLocation.resolve(cfg, opts.repo);
    if (!located) return usage(cfg);
    if (located.isSlot) from = from || located.slot;
    repos = [cfg.repos.find((r) => r.name === located.name)];
  } else {
    return usage(cfg);
  }

  const targets = [];
  const missing = [];
  for (const repo of repos) {
    const dir = from ? wt.slotRepoDir(cfg, from, repo) : repo.absPath;
    if (fs.existsSync(dir)) targets.push({ repo, dir });
    else missing.push({ repo, dir });
  }

  // Los repositorios en paralelo con tope; los checks de uno, en serie. Ver la
  // cabecera: es el techo de recursos, no un detalle de implementación.
  const run = async ({ repo, dir }) => {
    const base = reviewBase.baseFor(repo, opts.base, dir);
    if (opts.scope !== 'full') reviewBase.warnIfStaleBase(dir, base, repo.name);

    const profile = languages.forRepo(cfg, repo);
    const diff = opts.scope === 'full' ? null : reviewBase.diffFiles(dir, base);
    const artifacts = artifactPathsOf(cfg, repo);

    const results = [];
    for (const check of checksFor(repo, { scope: opts.scope, diff, profile, base })) {
      if (check.command) process.stderr.write(`▶ ${repo.name}: ${check.label}…\n`);
      const result = await runCheck(check, dir, artifacts);
      if (result.command && hasPipe(result.command)) result.pipeWarning = true;
      const mark = { ok: '✓', fail: '✗', broken: '✗', na: '—', undeclared: '?' }[result.status];
      process.stderr.write(`${mark} ${repo.name}: ${check.label}${check.command ? ` (${result.seconds}s)` : ''}\n`);
      results.push(result);
    }

    const rel = path.relative(config.ROOT, dir).split(path.sep).join('/') || '.';
    return { label: repo.name, rel, base, results };
  };

  const limit = opts.serial ? 1 : Math.max(1, opts.maxParallel);
  const blocks = await pool(targets.map((t) => () => run(t)), limit);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        [
          ...blocks.map((b) => ({
            repo: b.label,
            dir: b.rel,
            base: b.base,
            checks: b.results.map((r) => ({
              id: r.id,
              label: r.label,
              status: r.status,
              // `ok` solo si CORRIÓ y salió limpio: NO APLICA y NO DECLARADO no son verdes.
              ok: r.status === 'ok',
              seconds: r.seconds,
              exitCode: r.exitCode === undefined ? null : r.exitCode,
              note: r.note || r.na || r.reason || null,
              summary: r.status === 'fail' ? summarize(r) : [],
            })),
          })),
          ...missing.map(({ repo, dir }) => ({ repo: repo.name, dir, missing: true, checks: [] })),
        ],
        null,
        2,
      ) + '\n',
    );
  } else {
    const out = blocks.map(render);
    for (const { repo } of missing) {
      out.push(
        `## Checks — ${repo.name}\n\nNO SE PUDO EJECUTAR: ${
          from ? `el slot "${from}" no tiene el repositorio` : `el repositorio no está en \`${repo.path}\``
        }. Tratar como *sin verificar*.`,
      );
    }
    process.stdout.write(out.join('\n\n') + '\n');
  }

  // Un repositorio que no existe no es "sin hallazgos": es un check que no corrió,
  // y el código de salida tiene que decirlo. 2 y no 1: 1 es "corrió y falló".
  if (missing.length > 0) process.exit(2);

  const failed = blocks.some((b) => b.results.some((r) => r.status === 'fail' || r.status === 'broken'));
  // Nada se verificó por falta de comandos declarados: no es limpio.
  const nothingVerified = blocks.some(
    (b) => !b.results.some((r) => r.status === 'ok') && b.results.some((r) => r.status === 'undeclared'),
  );
  process.exit(failed || nothingVerified ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`run-checks falló: ${err && err.message}\n`);
    process.exit(2);
  });
}

module.exports = { checksFor, firstProgram, hasPipe, verdict };
