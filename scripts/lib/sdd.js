#!/usr/bin/env node
/**
 * sdd.js
 *
 * El ciclo dirigido por especificación, separado de la herramienta que lo
 * implementa.
 *
 * El ciclo —proponer, diseñar, escribir los tests, implementar, archivar— es
 * una forma de trabajar, no un producto. Lo que cambia de una herramienta a
 * otra es dónde viven los documentos, cómo se marca un escenario de aceptación
 * y cómo se llama el programa que los valida. Esas tres cosas son datos.
 *
 * Sin esta separación, cambiar de herramienta significaba reescribir el gate y
 * los cinco procedimientos, así que en la práctica no se cambiaba: la elección
 * hecha el primer día quedaba clavada en el sistema.
 *
 * El proveedor lo declara un pack en su `manifest.json`, bajo `sdd`:
 *
 *   "sdd": {
 *     "provider": "openspec",
 *     "changesDir": "openspec/changes",
 *     "archiveSegment": "archive",
 *     "scenarioPattern": "^#{3,4}\\s+Scenario:\\s*(.+?)\\s*$",
 *     "docExtension": ".md",
 *     "cli": "openspec"
 *   }
 *
 * Cambiar de herramienta mañana es escribir un pack con esas seis claves. Los
 * procedimientos del ciclo no se tocan: hablan del contrato, no de rutas.
 *
 * **Ninguno es obligatorio.** Un proyecto sin ciclo dirigido por especificación
 * no declara proveedor, y el gate de cobertura de escenarios sale con 0 diciendo
 * que no hay nada que verificar — no con 2, porque no es que no pudo: es que no
 * hay ciclo instalado.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const assets = require('./asset-roots');

/** Lo que se asume si el proveedor no lo declara. */
const DEFAULTS = {
  archiveSegment: 'archive',
  docExtension: '.md',
  cli: null,
};

// ---------------------------------------------------------------------------
// Resolución del proveedor
// ---------------------------------------------------------------------------

/**
 * El proveedor activo para un repositorio, o `null` si no hay ninguno.
 *
 * Si hubiera más de uno declarado se toma el último según el orden de
 * precedencia de `asset-roots` —el proyecto le gana al pack— y se reporta,
 * porque dos ciclos a la vez es casi siempre una instalación a medio migrar.
 */
function providerFor(cfg, repo) {
  const found = [];
  const problems = [];

  for (const root of assets.roots(cfg)) {
    const applies =
      root.kind === 'core' ||
      root.kind === 'local' ||
      (repo && repo.packs.includes(root.id)) ||
      (cfg.raw.packs || []).includes(root.id);
    if (!applies) continue;

    const manifest = assets.rawManifest(root);
    const raw = manifest && manifest.sdd;
    if (!raw) continue;

    if (!raw.changesDir) {
      problems.push(`${root.dir}/manifest.json (sdd): falta \`changesDir\`.`);
      continue;
    }

    let scenarioRe;
    try {
      scenarioRe = new RegExp(raw.scenarioPattern || '^#{3,4}\\s+Scenario:\\s*(.+?)\\s*$');
    } catch (err) {
      problems.push(`${root.dir}/manifest.json (sdd): \`scenarioPattern\` inválido — ${err.message}`);
      continue;
    }

    // El mismo error que en los dialectos de consulta: en JSON `"\s"` no es la
    // secuencia de expresión regular, y un patrón con un carácter de control
    // compila sin quejarse y no coincide con nada.
    if (/[\u0000-\u001f]/.test(String(raw.scenarioPattern || ''))) {
      problems.push(
        `${root.dir}/manifest.json (sdd): \`scenarioPattern\` tiene un carácter de control. ` +
          'En JSON las barras invertidas van dobles.',
      );
      continue;
    }

    found.push({
      ...DEFAULTS,
      ...raw,
      provider: raw.provider || root.id,
      origin: root.id,
      scenarioRe,
    });
  }

  if (found.length > 1) {
    problems.push(
      `Hay más de un ciclo dirigido por especificación activo (${found
        .map((f) => f.provider)
        .join(', ')}). Se usa "${found[found.length - 1].provider}".`,
    );
  }

  return { provider: found[found.length - 1] || null, problems };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function walkDocs(dir, extension, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDocs(full, extension, acc);
    else if (e.name.toLowerCase().endsWith(extension)) acc.push(full);
  }
  return acc;
}

/** Escenarios declarados en los documentos de un cambio. */
function scenariosOf(provider, repoRoot, change) {
  const dir = path.join(repoRoot, provider.changesDir, change);
  if (!fs.existsSync(dir)) return [];

  const scenarios = [];
  for (const file of walkDocs(dir, provider.docExtension)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');

    content.split(/\r?\n/).forEach((line, idx) => {
      const m = provider.scenarioRe.exec(line);
      if (!m) return;
      scenarios.push({ title: m[1], spec: `${rel}:${idx + 1}` });
    });
  }
  return scenarios;
}

/**
 * Cambios que toca la rama, leídos del diff contra su base.
 *
 * Incluye los archivados: cuando se revisa una rama, el cambio suele estar ya
 * archivado, y un barrido de "cambios activos" lo excluiría justo cuando hace
 * falta verificarlo.
 */
function changesTouched(provider, repoPath, base) {
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
  } catch {
    // Base inexistente o rama sin historia común: no es un fallo del gate.
    return [];
  }

  const dir = provider.changesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const archive = String(provider.archiveSegment || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${dir}/(${archive}/[^/]+|[^/]+)/`);

  const found = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(re);
    if (m && m[1] !== provider.archiveSegment) found.add(m[1]);
  }
  return [...found];
}

module.exports = { DEFAULTS, providerFor, scenariosOf, changesTouched };
