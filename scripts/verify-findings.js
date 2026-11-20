#!/usr/bin/env node
/**
 * verify-findings.js
 *
 * Comprueba que los hallazgos de un agente correspondan a código que existe.
 *
 * Por qué existe: `pr-review` le pedía al orquestador, **en prosa**, que
 * descartara los hallazgos que citan líneas inexistentes. Eso es exactamente lo
 * que esta base sostiene que no funciona — una regla escrita consume tokens en
 * cada corrida y se cumple mientras el modelo tenga atención disponible. Un
 * script cuesta cero y no se puede saltear.
 *
 * Qué comprueba, todo mecánico:
 *
 *   1. El archivo citado existe.
 *   2. La línea citada existe dentro de ese archivo.
 *   3. Si el hallazgo cita un fragmento (`evidence`), ese texto está realmente
 *      en esa línea o en las de alrededor.
 *
 * Lo que no comprueba: si el hallazgo tiene razón. Eso no lo puede decidir un
 * script, y es lo único que el orquestador debería estar leyendo.
 *
 * Formato de entrada — una lista JSON, por stdin o por archivo:
 *
 *   [{ "file": "src/x.ts", "line": 42, "rule": "…", "severity": "alta",
 *      "summary": "…", "evidence": "const x = 1;" }]
 *
 * Códigos de salida: 0 todos verificados · 1 alguno no verifica · 2 no se pudo
 * (entrada ilegible, repositorio inexistente).
 *
 * Uso:
 *   node scripts/verify-findings.js --repo mi-api < hallazgos.json
 *   node scripts/verify-findings.js --repo mi-api --input hallazgos.json
 *   node scripts/verify-findings.js --repo mi-api --json < hallazgos.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');

const ROOT = config.ROOT;

/** Cuántas líneas alrededor se aceptan al buscar el fragmento citado. */
const EVIDENCE_WINDOW = 3;

// ---------------------------------------------------------------------------
// Verificación
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Verifica un hallazgo contra el código real.
 * @returns {{ok: boolean, reason?: string}}
 */
function verify(finding, repoRoot, cache) {
  if (!finding || typeof finding !== 'object') {
    return { ok: false, reason: 'no es un objeto' };
  }

  const rel = String(finding.file || '').split('\\').join('/');
  if (!rel) return { ok: false, reason: 'no cita ningún archivo' };

  // Una ruta que se sale del repositorio no se lee: un hallazgo no puede
  // mandar a leer `../../.ssh/id_rsa`.
  const abs = path.resolve(repoRoot, rel);
  if (!abs.startsWith(path.resolve(repoRoot))) {
    return { ok: false, reason: `la ruta sale del repositorio: ${rel}` };
  }

  if (!cache.has(abs)) {
    try {
      cache.set(abs, fs.readFileSync(abs, 'utf8').split(/\r?\n/));
    } catch {
      cache.set(abs, null);
    }
  }
  const lines = cache.get(abs);

  if (lines === null) return { ok: false, reason: `el archivo no existe: ${rel}` };

  // Sin línea, el hallazgo es sobre el archivo entero: legítimo para algunas
  // cosas — un archivo que falta, una estructura — y no hay nada más que mirar.
  if (finding.line === undefined || finding.line === null) return { ok: true };

  const line = Number(finding.line);
  if (!Number.isInteger(line) || line < 1) {
    return { ok: false, reason: `número de línea inválido: ${JSON.stringify(finding.line)}` };
  }
  if (line > lines.length) {
    return {
      ok: false,
      reason: `cita ${rel}:${line} y el archivo tiene ${lines.length} líneas`,
    };
  }

  if (!finding.evidence) return { ok: true };

  // El fragmento citado tiene que estar cerca de la línea citada. Se acepta una
  // ventana porque un agente puede desfasarse por uno o dos al contar, y eso no
  // hace falso el hallazgo; lo que sí lo hace falso es que el texto no exista.
  const desde = Math.max(0, line - 1 - EVIDENCE_WINDOW);
  const hasta = Math.min(lines.length, line + EVIDENCE_WINDOW);
  const ventana = normalize(lines.slice(desde, hasta).join(' '));

  if (!ventana.includes(normalize(finding.evidence))) {
    return {
      ok: false,
      reason: `el fragmento citado no está en ${rel}:${line} ni en las ${EVIDENCE_WINDOW} líneas de alrededor`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function readInput(file) {
  if (file) return fs.readFileSync(path.resolve(file), 'utf8');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const repoName = arg('--repo');
  if (!repoName) {
    process.stderr.write(
      `\nUso: node scripts/verify-findings.js --repo <${cfg.repos
        .map((r) => r.name)
        .join('|')}> [--input archivo.json] [--json]\n\n`,
    );
    process.exit(2);
  }

  let repo;
  try {
    repo = config.repo(cfg, repoName);
  } catch (err) {
    return config.reportAndExit(err);
  }

  if (!fs.existsSync(repo.absPath)) {
    process.stderr.write(`\n  ${repo.name}: el repositorio no existe en ${repo.path}\n\n`);
    process.exit(2);
  }

  let entrada;
  try {
    entrada = JSON.parse(readInput(arg('--input')) || '[]');
  } catch (err) {
    process.stderr.write(`\n  La entrada no es JSON válido: ${err.message}\n\n`);
    process.exit(2);
  }

  if (!Array.isArray(entrada)) {
    process.stderr.write('\n  La entrada debe ser una lista de hallazgos.\n\n');
    process.exit(2);
  }

  const cache = new Map();
  const verificados = [];
  const descartados = [];

  for (const f of entrada) {
    const res = verify(f, repo.absPath, cache);
    if (res.ok) verificados.push(f);
    else descartados.push({ ...f, descartadoPorque: res.reason });
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ verificados, descartados }, null, 2) + '\n');
    process.exit(descartados.length > 0 ? 1 : 0);
  }

  console.log(`\n  ${verificados.length} de ${entrada.length} hallazgo(s) verificados contra el código\n`);

  if (descartados.length > 0) {
    console.log(`  Descartados (${descartados.length}):\n`);
    for (const d of descartados) {
      console.log(`    ${d.file || '(sin archivo)'}${d.line ? `:${d.line}` : ''}`);
      console.log(`      ${d.summary || d.message || ''}`);
      console.log(`      → ${d.descartadoPorque}\n`);
    }
    console.log('  Un hallazgo que cita código inexistente no se corrige: se descarta.');
    console.log('  Esto no dice si los verificados tienen razón — eso hay que leerlo.\n');
    process.exit(1);
  }

  console.log('  Ninguno cita código inexistente.');
  console.log('  Esto NO dice que tengan razón: eso es lo que hay que leer.\n');
  process.exit(0);
}

module.exports = { verify };

if (require.main === module) main();
