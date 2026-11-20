#!/usr/bin/env node
/**
 * check-context-budget.js
 *
 * Cuánto contexto paga una sesión antes de que el agente haga nada.
 *
 * Hay tres costos fijos, y ninguno se ve crecer:
 *
 *   1. **Las descripciones de skills y agentes.** El harness las mete todas en
 *      el prompt del sistema para poder elegir, así que se pagan en cada sesión
 *      aunque no se invoque ninguno. Una descripción de tres renglones por
 *      treinta activos es un archivo entero de texto en cada tarea.
 *   2. **El mapa del sistema** — `CLAUDE.md`, `AGENTS.md` — que se carga solo.
 *   3. **`ai/local/`**: el brief del proyecto y las reglas de negocio. Es el que
 *      más crece y el que nadie mira: cada persona que agrega un párrafo lo
 *      agrega para siempre y para todas las sesiones.
 *
 * Nada de esto es gratis y nada de esto avisa. Este script lo mide y avisa.
 *
 * No es un gate de calidad: pasarse del presupuesto no significa que algo esté
 * mal escrito. Significa que se está pagando en cada tarea, y que conviene
 * saberlo antes de que sea la mitad del contexto.
 *
 * Códigos de salida: 0 dentro del presupuesto · 1 alguna partida se pasó · 2 no
 * se pudo medir.
 *
 * Uso:
 *   node scripts/check-context-budget.js
 *   node scripts/check-context-budget.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const assets = require('./lib/asset-roots');

const ROOT = config.ROOT;

/**
 * Presupuesto por partida, en bytes.
 *
 * Los números salen de una relación práctica: unos cuatro bytes por token. Lo
 * que se busca no es un límite exacto sino un orden de magnitud — que el costo
 * fijo de una sesión no pase de unos pocos miles de tokens antes de leer una
 * sola línea de código.
 *
 * Un proyecto los ajusta con `contextBudget` en `ai-workspace.json`.
 */
const DEFAULTS = {
  descriptions: 4000,
  systemMap: 8000,
  local: 12000,
};

function bytesOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function walkBytes(dir) {
  let total = 0;
  let archivos = 0;

  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        total += bytesOf(full);
        archivos++;
      }
    }
  };

  walk(dir);
  return { total, archivos };
}

// ---------------------------------------------------------------------------
// Medición
// ---------------------------------------------------------------------------

function measure(cfg) {
  const partidas = [];

  // 1. Descripciones: lo que el harness carga para poder elegir.
  let descripciones = 0;
  let activos = 0;
  const largas = [];

  for (const root of assets.roots(cfg)) {
    const manifest = assets.rawManifest(root);
    if (!manifest) continue;

    for (const item of [...(manifest.skills || []), ...(manifest.agents || [])]) {
      const len = (item.description || '').length;
      descripciones += len;
      activos++;
      largas.push({ name: item.name, bytes: len });
    }
  }

  largas.sort((a, b) => b.bytes - a.bytes);

  partidas.push({
    id: 'descriptions',
    label: `descripciones de ${activos} activos`,
    bytes: descripciones,
    detalle: largas.slice(0, 5),
    consejo:
      'La descripción es para que el modelo ELIJA: dice cuándo usar el activo, no qué hace. ' +
      'El detalle va en el cuerpo, que se carga solo al invocarlo.',
  });

  // 2. El mapa del sistema.
  const mapa = ['CLAUDE.md', 'AGENTS.md'].map((f) => ({ f, bytes: bytesOf(path.join(ROOT, f)) }));
  partidas.push({
    id: 'systemMap',
    label: 'mapa del sistema',
    bytes: mapa.reduce((n, m) => n + m.bytes, 0),
    detalle: mapa.filter((m) => m.bytes > 0).map((m) => ({ name: m.f, bytes: m.bytes })),
    consejo: 'Lo que no cambia el comportamiento del agente no necesita estar acá.',
  });

  // 3. El contexto propio del proyecto.
  const local = walkBytes(path.join(ROOT, 'ai', 'local'));
  partidas.push({
    id: 'local',
    label: `contexto del proyecto (${local.archivos} archivo(s))`,
    bytes: local.total,
    detalle: [],
    consejo:
      'El brief y las reglas de negocio se leen en cada tarea. Lo que ya está en el código ' +
      'o en un ticket no hace falta repetirlo acá.',
  });

  return partidas;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const asJson = process.argv.includes('--json');

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const limites = { ...DEFAULTS, ...(cfg.raw.contextBudget || {}) };
  const partidas = measure(cfg).map((p) => ({
    ...p,
    limite: limites[p.id],
    excedido: p.bytes > limites[p.id],
  }));

  const total = partidas.reduce((n, p) => n + p.bytes, 0);
  const excedidas = partidas.filter((p) => p.excedido);

  if (asJson) {
    process.stdout.write(JSON.stringify({ total, partidas }, null, 2) + '\n');
    process.exit(excedidas.length > 0 ? 1 : 0);
  }

  console.log(`\n  Costo fijo de contexto por sesión: ~${Math.round(total / 4)} tokens (${total} bytes)\n`);

  for (const p of partidas) {
    const marca = p.excedido ? '!' : ' ';
    const pct = Math.round((p.bytes / p.limite) * 100);
    console.log(`  ${marca} ${p.label.padEnd(38)} ${String(p.bytes).padStart(6)} / ${p.limite}  (${pct}%)`);
  }

  if (excedidas.length === 0) {
    console.log('\n  Todo dentro del presupuesto.\n');
    process.exit(0);
  }

  console.log('');
  for (const p of excedidas) {
    console.log(`  ── ${p.label} ──`);
    console.log(`  ${p.consejo}`);
    for (const d of p.detalle) console.log(`      ${String(d.bytes).padStart(5)}  ${d.name}`);
    console.log('');
  }

  console.log('  Esto no es un gate de calidad: pasarse no significa que esté mal escrito.');
  console.log('  Significa que se paga en cada tarea. Ajustable con `contextBudget`.\n');
  process.exit(1);
}

main();
