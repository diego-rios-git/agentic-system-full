#!/usr/bin/env node
/**
 * baseline.js
 *
 * Congelamiento de deuda preexistente, compartido por todos los gates.
 *
 * Por qué existe: un gate que se instala sobre un proyecto con historia
 * reporta cientos de hallazgos el primer día, ninguno introducido por quien lo
 * instaló. Eso se lee como ruido, el equipo lo apaga, y el gate no vuelve a
 * prenderse nunca. Con baseline, el gate arranca en silencio y solo habla de lo
 * que se agrega desde ahora.
 *
 * **Indexado por scope, no plano.** Un archivo plano compartido entre varios
 * repositorios tiene un problema real: `--write-baseline --repo api` reescribe
 * el archivo entero y borra en silencio lo congelado para `app`. Guardando un
 * objeto `{ scope: [huellas] }`, escribir el baseline de un scope deja los
 * demás intactos.
 *
 * Formato en disco:
 *   {
 *     "version": 1,
 *     "scopes": { "mi-api": ["huella", …], "mi-app": [ … ] }
 *   }
 *
 * Se acepta el formato viejo — un array plano — leyéndolo como el scope
 * `"default"`, para no romper un proyecto que ya tenía baselines escritos.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspace-config');

const FORMAT_VERSION = 1;

/**
 * `AI_BASELINE_DIR` cambia dónde se guardan los baselines.
 *
 * Como `AI_WORKSPACE_CONFIG`, existe para los tests de la propia base: un test
 * que ejercita el congelamiento escribe en un directorio temporal en vez de
 * pisar los baselines reales del proyecto. Sin esto, probar el filtrado por
 * baseline significaría reescribir el archivo del repositorio donde corre.
 */
function baselineDir() {
  return process.env.AI_BASELINE_DIR ? path.resolve(process.env.AI_BASELINE_DIR) : ROOT;
}

function filePath(name) {
  return path.join(baselineDir(), `.${name}-baseline.json`);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function readRaw(name) {
  const file = filePath(name);
  if (!fs.existsSync(file)) return null;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Un baseline corrupto no puede leerse como "no hay nada congelado": eso
    // haría que el gate reportara toda la deuda vieja de golpe. Se avisa y se
    // trata como ausente, que es lo mismo pero visible.
    process.stderr.write(`  aviso: ${path.basename(file)} no es JSON válido, se ignora\n`);
    return null;
  }

  if (Array.isArray(parsed)) return { version: 0, scopes: { default: parsed } };
  return { version: parsed.version || FORMAT_VERSION, scopes: parsed.scopes || {} };
}

/**
 * Huellas congeladas para un scope. Devuelve `null` cuando no hay baseline —
 * distinto de un Set vacío, que significa "hay baseline y no congela nada".
 */
function load(name, scope) {
  const raw = readRaw(name);
  if (!raw) return null;

  const entries = raw.scopes[scope] || raw.scopes.default || [];
  return new Set(entries);
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Reemplaza las huellas de UN scope y conserva las de los demás.
 * @returns {{total: number, written: number, scopes: string[]}}
 */
function write(name, scope, fingerprints) {
  // Congelar desde un slot perdonaría para siempre los hallazgos de una rama que
  // todavía no se mergeó: el baseline es de la rama base, no de un cambio en curso.
  // Es el punto por el que pasan TODOS los gates, así que se rechaza acá y no en
  // cada uno (así se olvida uno y nadie se entera).
  const slot = require('./workspace-config').readFromSlot();
  if (slot) {
    process.stderr.write(
      `\n  --write-baseline no se puede usar leyendo desde el slot "${slot}".\n` +
        '  Congelar ahí perdonaría la deuda de una rama sin mergear. Corrélo sobre el\n' +
        '  repositorio principal, con la rama base.\n\n',
    );
    process.exit(2);
  }

  const raw = readRaw(name) || { version: FORMAT_VERSION, scopes: {} };

  raw.version = FORMAT_VERSION;
  // Cuándo se congeló. Sin fecha, `baseline-report.js` puede decir cuánta deuda
  // hay pero no desde cuándo, y "340 hallazgos aceptados" pesa distinto según
  // sean de la semana pasada o de hace dos años.
  raw.frozenAt = new Date().toISOString().slice(0, 10);
  raw.scopes[scope] = [...new Set(fingerprints)].sort();

  const file = filePath(name);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');

  const total = Object.values(raw.scopes).reduce((n, arr) => n + arr.length, 0);
  return { total, written: raw.scopes[scope].length, scopes: Object.keys(raw.scopes) };
}

// ---------------------------------------------------------------------------
// Filtrado
// ---------------------------------------------------------------------------

/**
 * Quita de `findings` lo que ya estaba congelado para ese scope.
 * @param {Function} fingerprint cómo se identifica un hallazgo de forma estable
 *   entre corridas. Debe excluir el número de línea: mover código no puede
 *   reintroducir un hallazgo que ya estaba aceptado.
 */
function filter(findings, name, scope, fingerprint) {
  const frozen = load(name, scope);
  if (!frozen) return findings;
  return findings.filter((f) => !frozen.has(fingerprint(f)));
}

module.exports = { FORMAT_VERSION, filePath, load, write, filter };
