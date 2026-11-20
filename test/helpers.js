#!/usr/bin/env node
/**
 * helpers.js — utilidades compartidas por los tests de la base.
 *
 * Los tests corren los gates **como los corre un proyecto**: invocando el
 * script real, en un proceso aparte, y mirando su código de salida y su salida
 * JSON. No se importan sus funciones internas a propósito.
 *
 * Por qué así: lo que consume un gate no es su código, es su **contrato de
 * salida** — 0 limpio, 1 hallazgos, 2 no se pudo verificar, y una lista JSON en
 * stdout. Los tres bugs más graves que tuvo esta base no estaban en la lógica
 * de detección sino justamente ahí: un gate que salía 0 sin haber corrido, otro
 * que salía 0 con el repositorio sin clonar, y una huella de baseline idéntica
 * para todos los hallazgos. Un test que llamara a las funciones internas habría
 * pasado con los tres presentes.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'test', 'fixtures', 'ai-workspace.test.json');

/**
 * Corre un gate y devuelve `{ code, findings, stdout, stderr }`.
 *
 * @param {string} script ruta del gate, relativa a la raíz
 * @param {string[]} args argumentos, sin `--json`
 * @param {{env?: object, json?: boolean}} [opts]
 */
function runGate(script, args, opts = {}) {
  const useJson = opts.json !== false;
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, script), ...args, ...(useJson ? ['--json'] : [])],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        AI_WORKSPACE_CONFIG: CONFIG,
        ...(opts.env || {}),
      },
    },
  );

  const stdout = String(run.stdout || '');
  let findings = null;
  if (useJson && stdout.trim().startsWith('[')) {
    try {
      findings = JSON.parse(stdout);
    } catch {
      findings = null;
    }
  }

  return { code: run.status, findings, stdout, stderr: String(run.stderr || '') };
}

/** Un directorio temporal propio, borrado al terminar. */
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Un PATH sin el directorio de una herramienta, para probar el camino en que no
 * está instalada. Devuelve `null` si la herramienta no está — ahí el test que
 * lo pida se omite en vez de dar un falso verde.
 */
function pathWithout(tool) {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [tool], {
    encoding: 'utf8',
  });
  if (which.status !== 0) return null;

  const toolDir = path.dirname(String(which.stdout).split(/\r?\n/)[0].trim());
  const sep = process.platform === 'win32' ? ';' : ':';

  return String(process.env.PATH || '')
    .split(sep)
    .filter((p) => p && path.resolve(p) !== path.resolve(toolDir))
    .join(sep);
}

/**
 * Motivo por el que una prueba debe OMITIRSE porque un pack que necesita no está
 * instalado en este proyecto, o `false` si están todos.
 *
 * Las pruebas viajan con la base a cada proyecto, y `init` descarta los packs que
 * no se eligieron: una prueba de un pack ausente fallaría por una razón que no es
 * un defecto. Se omite con el motivo a la vista (nunca en silencio, y nunca verde
 * sin haber corrido): `node:test` la cuenta como omitida.
 */
function packsMissing(ids) {
  const missing = ids.filter((id) => !fs.existsSync(path.join(ROOT, 'ai', 'packs', id)));
  return missing.length > 0 ? `el pack ${missing.join(', ')} no está instalado en este proyecto` : false;
}

/** ¿Está disponible esta herramienta externa? */
function hasTool(tool) {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [tool], {
    encoding: 'utf8',
  });
  return which.status === 0;
}

/** Los hallazgos que caen en un archivo cuyo nombre contiene `fragmento`. */
function inFile(findings, fragmento) {
  return (findings || []).filter((f) => String(f.file || '').includes(fragmento));
}

/** Identificadores de regla presentes en los hallazgos, sin repetir. */
function rulesOf(findings) {
  return [...new Set((findings || []).map((f) => f.rule))].sort();
}

module.exports = { ROOT, CONFIG, runGate, withTempDir, pathWithout, hasTool, packsMissing, inFile, rulesOf };
