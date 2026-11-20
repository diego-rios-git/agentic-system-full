#!/usr/bin/env node
/**
 * baseline-report.js
 *
 * Qué hay congelado, desde cuándo y si todavía existe.
 *
 * Por qué hace falta: una baseline congela la deuda del día cero para que el
 * gate arranque en silencio, y ese es exactamente su riesgo. Una vez congelada,
 * **nadie la vuelve a mirar**. Al año hay cientos de hallazgos aceptados que
 * nadie decidió aceptar: los aceptó el comando que se corrió al instalar. Sin
 * una forma de verlos, la baseline deja de ser una decisión y pasa a ser una
 * alfombra.
 *
 * Este script no bloquea nada ni es un gate. Solo cuenta lo que hay:
 *
 *   - Cuántas huellas por scope y por regla.
 *   - Cuándo se congelaron, si el archivo lo registra.
 *   - Cuántas ya no corresponden a ningún hallazgo — deuda que se arregló y
 *     quedó congelada de más, ocupando lugar y escondiendo lo que venga después
 *     con la misma huella.
 *
 * Uso:
 *   node scripts/baseline-report.js
 *   node scripts/baseline-report.js --json
 *   node scripts/baseline-report.js --stale     # solo lo que ya no aplica
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const gates = require('./lib/gates');
const baseline = require('./lib/baseline');

const ROOT = config.ROOT;

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Los baselines que existen en disco, con su contenido por scope. */
function readAll() {
  const dir = process.env.AI_BASELINE_DIR ? path.resolve(process.env.AI_BASELINE_DIR) : ROOT;

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    const m = /^\.(.+)-baseline\.json$/.exec(name);
    if (!m) continue;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      out.push({ gate: m[1], file: name, invalid: true, scopes: {} });
      continue;
    }

    const scopes = Array.isArray(parsed) ? { default: parsed } : parsed.scopes || {};
    out.push({ gate: m[1], file: name, frozenAt: parsed.frozenAt || null, scopes });
  }

  return out;
}

/**
 * Huellas que hoy ya no corresponden a ningún hallazgo.
 *
 * Se obtiene corriendo el gate **sin** baseline y comparando. Una huella
 * congelada que ya no aparece significa que alguien arregló ese problema: la
 * entrada quedó de más, y mientras esté ahí puede tapar un hallazgo futuro que
 * produzca la misma huella.
 */
function staleOf(gate, scope, frozen) {
  const declared = gates.all(configCache()).find((g) => g.id === gate);
  if (!declared || !declared.scriptExists) return null;

  const args = gates.argsFor(declared, { repo: scope, scope }, false).filter((a) => a !== '--baseline');

  const run = spawnSync(process.execPath, [path.join(ROOT, args[0]), ...args.slice(1), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
  });

  // 0 y 1 son resultados; cualquier otro código significa que el gate no pudo
  // correr, y ahí no se puede afirmar que una huella sobre.
  if (run.status !== 0 && run.status !== 1) return null;

  let actuales;
  try {
    actuales = JSON.parse(run.stdout || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(actuales)) return null;

  const vivas = new Set(actuales.map((f) => `${f.rule}|${f.file}|${f.code}`));
  return frozen.filter((h) => !vivas.has(h));
}

let cached = null;
function configCache() {
  if (!cached) cached = config.load();
  return cached;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const onlyStale = argv.includes('--stale');

  try {
    configCache();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const archivos = readAll();

  if (archivos.length === 0) {
    if (asJson) process.stdout.write('[]\n');
    else console.log('\n  No hay ningún baseline. Nada congelado.\n');
    process.exit(0);
  }

  const reporte = [];
  let total = 0;

  for (const archivo of archivos) {
    for (const [scope, huellas] of Object.entries(archivo.scopes)) {
      total += huellas.length;

      const porRegla = new Map();
      for (const h of huellas) {
        const regla = String(h).split('|')[0];
        porRegla.set(regla, (porRegla.get(regla) || 0) + 1);
      }

      const stale = staleOf(archivo.gate, scope, huellas);

      reporte.push({
        gate: archivo.gate,
        scope,
        total: huellas.length,
        frozenAt: archivo.frozenAt,
        porRegla: [...porRegla.entries()].sort((a, b) => b[1] - a[1]),
        stale: stale === null ? null : stale.length,
        staleList: stale || [],
      });
    }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(reporte, null, 2) + '\n');
    process.exit(0);
  }

  console.log(`\n  Deuda congelada — ${total} hallazgo(s) en ${reporte.length} scope(s)\n`);

  for (const r of reporte) {
    if (onlyStale && !r.stale) continue;

    console.log(`  ${r.gate} · ${r.scope} — ${r.total} congelado(s)`);
    if (r.frozenAt) console.log(`    congelado el ${r.frozenAt}`);

    for (const [regla, n] of r.porRegla.slice(0, 5)) {
      console.log(`      ${String(regla).padEnd(24)} ${n}`);
    }
    if (r.porRegla.length > 5) console.log(`      … y ${r.porRegla.length - 5} reglas más`);

    if (r.stale === null) {
      console.log('    (no se pudo comprobar cuáles siguen vigentes: el gate no corrió)');
    } else if (r.stale > 0) {
      console.log(`    ${r.stale} ya no corresponden a ningún hallazgo: se arreglaron.`);
      console.log('    Conviene recalibrar para que no tapen un hallazgo futuro con la misma huella:');
      console.log(`      node scripts/check-${r.gate}.js --repo ${r.scope} --write-baseline`);
    }
    console.log('');
  }

  console.log('  Esto no es un gate: no bloquea nada. Es para que la deuda congelada');
  console.log('  siga siendo una decisión y no una alfombra.\n');
  process.exit(0);
}

main();
