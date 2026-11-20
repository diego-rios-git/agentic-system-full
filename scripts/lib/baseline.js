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

function filePath(name) {
  return path.join(ROOT, `.${name}-baseline.json`);
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
  const raw = readRaw(name) || { version: FORMAT_VERSION, scopes: {} };

  raw.version = FORMAT_VERSION;
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
