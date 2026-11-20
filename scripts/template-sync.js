#!/usr/bin/env node
/**
 * template-sync.js
 *
 * Trae a este proyecto las mejoras publicadas en la base agéntica.
 *
 * El contrato, archivo por archivo del área de la plantilla:
 *
 *   hash local == hash del registro  →  se pisa. Nadie lo tocó.
 *   hash local != hash del registro  →  NO se pisa. Se reporta como divergente.
 *   archivo nuevo en la base         →  se agrega.
 *   archivo eliminado en la base     →  se reporta. No se borra solo.
 *   cualquier archivo del proyecto   →  ni se mira.
 *
 * La regla del medio es la que hace que esto sea usable: si alguien adaptó un
 * procedimiento del núcleo a su proyecto, una actualización **no** puede
 * borrarle ese trabajo sin avisar. Se le dice qué cambió y decide.
 *
 * Uso:
 *   node scripts/template-sync.js --dry-run     # ver qué cambiaría
 *   node scripts/template-sync.js               # aplicarlo
 *   node scripts/template-sync.js --from ../base-local   # desde una copia local
 *   node scripts/template-sync.js --force       # pisar también lo divergente
 */

'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(ROOT, 'template.lock.json');
const { MANIFEST_NAME, templateFiles, activePacksOf } = require('./lib/template-files');

const say = (msg = '') => process.stdout.write(`${msg}\n`);

function sha256(file) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Obtener la base
// ---------------------------------------------------------------------------

/**
 * Devuelve el directorio con la versión nueva de la base y una función para
 * limpiarlo. Con `--from` se usa una copia local, que además de servir para
 * probar permite trabajar sin acceso a la red.
 */
function fetchTemplate(lock, fromPath) {
  if (fromPath) {
    const dir = path.resolve(fromPath);
    if (!fs.existsSync(path.join(dir, MANIFEST_NAME))) {
      throw new Error(`${dir} no parece la base agéntica: falta ${MANIFEST_NAME}`);
    }
    return { dir, cleanup: () => {} };
  }

  if (!lock.template) {
    throw new Error('El registro no dice de dónde viene la base. Usá --from <ruta>.');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-sync-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', lock.template, dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `No se pudo clonar ${lock.template}: ${err.message.split('\n')[0]}\n` +
        '  Si el repositorio es privado, verificá tus credenciales de git.',
    );
  }

  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Comparación
// ---------------------------------------------------------------------------

function plan(templateDir, lock, activePacks) {
  const result = { add: [], update: [], diverged: [], unchanged: [], removed: [] };
  const tracked = lock.files || {};

  for (const rel of templateFiles(templateDir, activePacks)) {
    const source = path.join(templateDir, rel);
    if (!fs.existsSync(source)) continue;

    const target = path.join(ROOT, rel);
    const newHash = sha256(source);

    if (!fs.existsSync(target)) {
      result.add.push({ rel, newHash });
      continue;
    }

    const localHash = sha256(target);
    if (localHash === newHash) {
      result.unchanged.push({ rel, newHash });
      continue;
    }

    // El registro dice con qué contenido se instaló. Si el local sigue siendo
    // ese, nadie lo tocó y se puede pisar sin perder trabajo de nadie.
    if (tracked[rel] && tracked[rel] === localHash) {
      result.update.push({ rel, newHash });
    } else {
      result.diverged.push({ rel, newHash, localHash });
    }
  }

  // Lo que el registro seguía y la base ya no trae.
  const current = new Set(templateFiles(templateDir, activePacks));
  for (const rel of Object.keys(tracked)) {
    if (!current.has(rel) && fs.existsSync(path.join(ROOT, rel))) {
      result.removed.push({ rel });
    }
  }

  return result;
}

function apply(templateDir, actions, force) {
  const applied = [];

  const copy = ({ rel }) => {
    const source = path.join(templateDir, rel);
    const target = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    applied.push(rel);
  };

  actions.add.forEach(copy);
  actions.update.forEach(copy);
  if (force) actions.diverged.forEach(copy);

  return applied;
}

/**
 * El registro guarda, para cada archivo, **el contenido que entregó la base** —
 * no el que hay en disco.
 *
 * La diferencia importa para los divergentes. Si se guardara el hash local, en
 * la corrida siguiente el archivo coincidiría con el registro, se leería como
 * "nadie lo tocó" y se pisaría: la adaptación del proyecto sobreviviría a un
 * sync y se perdería en el segundo, en silencio. Conservando el hash anterior,
 * un archivo divergente sigue reportándose como tal hasta que alguien lo
 * resuelva.
 */
function updateLock(templateDir, lock, activePacks, actions, force) {
  const manifest = readJson(path.join(templateDir, MANIFEST_NAME));
  const files = {};

  const stillDiverged = new Set(force ? [] : actions.diverged.map((a) => a.rel));

  for (const rel of templateFiles(templateDir, activePacks)) {
    if (stillDiverged.has(rel)) {
      // Se conserva lo que la base había entregado la última vez. Si no había
      // registro previo, se omite: sin referencia, el archivo se sigue tratando
      // como divergente, que es el lado seguro.
      if (lock.files && lock.files[rel]) files[rel] = lock.files[rel];
      continue;
    }
    const target = path.join(ROOT, rel);
    if (fs.existsSync(target)) files[rel] = sha256(target);
  }

  const next = {
    template: lock.template,
    version: manifest.template.version,
    installedAt: lock.installedAt,
    syncedAt: new Date().toISOString(),
    files,
  };

  fs.writeFileSync(LOCK_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const fromIdx = argv.indexOf('--from');
  const fromPath = fromIdx !== -1 ? argv[fromIdx + 1] : null;

  if (!fs.existsSync(LOCK_PATH)) {
    process.stderr.write(
      '\n  No hay template.lock.json: este workspace no se generó desde la base,\n' +
        '  o el registro se perdió. Sin él no se puede saber qué archivos son\n' +
        '  de la base y cuáles se modificaron acá.\n\n',
    );
    process.exit(2);
  }

  const lock = readJson(LOCK_PATH);
  const activePacks = activePacksOf(ROOT);

  let template;
  try {
    template = fetchTemplate(lock, fromPath);
  } catch (err) {
    process.stderr.write(`\n  ${err.message}\n\n`);
    process.exit(2);
  }

  try {
    const remote = readJson(path.join(template.dir, MANIFEST_NAME)).template;
    say(`\n  Base:      ${remote.version}   (instalada: ${lock.version})`);
    say(`  Packs:     ${activePacks.join(', ') || 'ninguno'}`);

    if (remote.version === lock.version && !force) {
      say('\n  Ya estás en la última versión. Se verifica igual por si algo cambió.\n');
    }

    const actions = plan(template.dir, lock, activePacks);

    say('');
    if (actions.add.length) {
      say(`  Nuevos (${actions.add.length}):`);
      for (const a of actions.add) say(`    + ${a.rel}`);
      say('');
    }
    if (actions.update.length) {
      say(`  Se actualizan (${actions.update.length}):`);
      for (const a of actions.update) say(`    ~ ${a.rel}`);
      say('');
    }
    if (actions.diverged.length) {
      say(`  DIVERGENTES — no se tocan (${actions.diverged.length}):`);
      for (const a of actions.diverged) say(`    ! ${a.rel}`);
      say('');
      say('    Estos archivos se modificaron en este proyecto. La base también los');
      say('    cambió. Revisá las dos versiones y resolvelo a mano, o corré con');
      say('    --force para quedarte con la versión de la base y perder lo local.');
      say('');
    }
    if (actions.removed.length) {
      say(`  Ya no existen en la base (${actions.removed.length}):`);
      for (const a of actions.removed) say(`    ? ${a.rel}`);
      say('');
      say('    No se borran solos. Revisá si todavía los usás.');
      say('');
    }

    const pending = actions.add.length + actions.update.length + (force ? actions.diverged.length : 0);

    if (pending === 0 && actions.diverged.length === 0) {
      say(`  Nada que hacer. ${actions.unchanged.length} archivos ya están al día.\n`);
      return;
    }

    if (dryRun) {
      say('  (dry-run: no se escribió nada)\n');
      return;
    }

    const applied = apply(template.dir, actions, force);
    const next = updateLock(template.dir, lock, activePacks, actions, force);

    say(`  ${applied.length} archivo(s) actualizado(s). Registro en v${next.version}.\n`);

    if (applied.some((f) => f.startsWith('ai/'))) {
      say('  Los activos cambiaron: regenerá los punteros de cada harness.');
      say('    node scripts/consolidate-skills.js --wrappers\n');
    }
  } finally {
    template.cleanup();
  }
}

main();
