#!/usr/bin/env node
/**
 * check-context-links.js
 *
 * Verifica que las rutas de archivo que citan los activos de IA existan.
 *
 * Una ruta rota no da error visible: el agente falla la lectura y después
 * improvisa. Es una de las causas más baratas de código que no sigue las
 * convenciones del proyecto, y no la detecta ningún test.
 *
 * Los scopes salen de `ai-workspace.json`: el workspace y cada repositorio
 * declarado. Ningún nombre de repositorio está escrito acá.
 *
 * Uso:
 *   node scripts/check-context-links.js
 *   node scripts/check-context-links.js --json
 *   node scripts/check-context-links.js --scope mi-api
 *   node scripts/check-context-links.js --baseline
 *   node scripts/check-context-links.js --scope mi-api --write-baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const baseline = require('./lib/baseline');

const ROOT = config.ROOT;
const BASELINE_NAME = 'context-links';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Dónde viven los activos de IA dentro de un repositorio. */
const REPO_ASSET_DIRS = ['.claude', '.opencode'];
const REPO_ASSET_FILES = ['CLAUDE.md', 'AGENTS.md'];

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

function scopesFor(cfg) {
  const scopes = [
    {
      name: 'workspace',
      base: '.',
      dirs: ['ai', '.claude', '.opencode', 'docs', 'templates'],
      files: ['CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'INVENTORY.md'],
    },
  ];

  // En topología de repositorio único el código comparte raíz con la base: el
  // scope del workspace ya lo cubre y agregarlo de nuevo duplicaría cada
  // hallazgo.
  if (cfg.topology === 'multi-repo') {
    for (const repo of cfg.repos) {
      scopes.push({
        name: repo.name,
        base: repo.path,
        dirs: REPO_ASSET_DIRS,
        files: REPO_ASSET_FILES,
      });
    }
  }

  return scopes;
}

/**
 * Bases contra las que se intenta resolver una ruta citada. Los activos
 * compartidos citan rutas de un repositorio sin prefijarlo — `src/lib/format.ts`
 * refiriéndose al frontend — así que cada repositorio declarado, y su `src/`,
 * son bases válidas.
 */
function resolutionBases(cfg, scopeRoot, fileDir) {
  const bases = [scopeRoot, ROOT, fileDir, path.join(scopeRoot, 'src')];
  for (const repo of cfg.repos) {
    bases.push(repo.absPath, path.join(repo.absPath, 'src'));
  }
  return bases;
}

// ---------------------------------------------------------------------------
// Extracción de rutas
// ---------------------------------------------------------------------------

/**
 * Las extensiones más largas van PRIMERO: la alternancia de una expresión
 * regular se resuelve por orden, así que con `js` antes que `json` una ruta
 * como `settings.local.json.example` se corta en `settings.local.js` y se
 * reporta como rota una ruta que nunca existió. El sufijo `(?![\w.])` refuerza
 * lo mismo exigiendo que la extensión termine ahí.
 */
const EXTENSIONS = 'jsonc|json|tsx|jsx|mjs|cjs|yaml|yml|java|md|ts|js|ps1|sh|py|go|rb|sql';

/** Extrae candidatos a ruta de archivo de una línea de markdown o yaml. */
function extractPaths(line) {
  const out = new Set();

  // Rutas dentro de backticks.
  for (const m of line.matchAll(new RegExp('`([^`\\s]+\\.(?:' + EXTENSIONS + '))`', 'g'))) {
    out.add(m[1]);
  }
  // Rutas sueltas con extensión, precedidas de separador o inicio de línea.
  // El guion NO cuenta como separador: si lo fuera, un nombre como
  // `scope-discipline/SKILL.md` se cortaría en `discipline/SKILL.md` y se
  // reportaría como roto un fragmento que nunca existió como ruta.
  for (const m of line.matchAll(
    new RegExp(
      '(?:^|[\\s:(\\[>"\'])((?:\\.{0,2}\\/)?[\\w.-]+(?:\\/[\\w.@-]+)+\\.(?:' + EXTENSIONS + '))',
      'g',
    ),
  )) {
    out.add(m[1]);
  }
  return [...out];
}

/** Nombres de tecnología que terminan en una extensión y no son rutas. */
const TECH_NAME = /(?:^|\/)(?:next|node|nuxt|vue|three|d3|nest|express|alpine)\.js$/i;

/** Rutas de ejemplo en documentación, no destinos reales. */
const EXAMPLE_PATH = /^(?:path|ruta)\/to\/|\/(?:foo|bar|ejemplo|example)\./i;

/**
 * Placeholders que no son rutas reales: plantillas que se rellenan en tiempo de
 * ejecución. El prefijo de ticket del proyecto entra acá — citar
 * `changes/ABC-XXX/design.md` es correcto aunque no exista ningún ABC-XXX.
 */
function placeholderPattern(cfg) {
  const parts = [
    '\\{[^}]+\\}', // {variable}
    '<[^>]+>', // <placeholder>
    '\\$\\{', // ${interpolación}
    '\\bXXX\\b',
    '\\*',
    '\\.\\.\\.',
  ];
  if (cfg.project.ticketPrefix) {
    parts.push(`\\b${cfg.project.ticketPrefix}-(?:XXX|\\{)`);
  }
  return new RegExp(parts.join('|'));
}

function isIgnorable(p, placeholder) {
  if (placeholder.test(p)) return true;
  if (/^https?:/.test(p)) return true;
  if (/^@/.test(p)) return true; // paquetes con scope
  if (!p.includes('/')) return true; // nombre suelto, no ruta
  if (/^(node_modules|dist)\//.test(p)) return true;
  if (TECH_NAME.test(p)) return true;
  if (EXAMPLE_PATH.test(p)) return true;
  if (/[[\]]/.test(p)) return true; // rutas dinámicas
  return false;
}

// ---------------------------------------------------------------------------
// Barrido
// ---------------------------------------------------------------------------

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (/\.(md|ya?ml)$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function checkScope(cfg, scope, placeholder) {
  const scopeRoot = path.join(ROOT, scope.base);
  if (!fs.existsSync(scopeRoot)) return null;

  const files = [];
  for (const d of scope.dirs) {
    const dir = path.join(scopeRoot, d);
    if (fs.existsSync(dir)) walk(dir, files);
  }
  for (const f of scope.files) {
    const p = path.join(scopeRoot, f);
    if (fs.existsSync(p)) files.push(p);
  }

  const broken = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const bases = resolutionBases(cfg, scopeRoot, path.dirname(file));

    content.split(/\r?\n/).forEach((line, idx) => {
      for (const cand of extractPaths(line)) {
        if (isIgnorable(cand, placeholder)) continue;
        // Un archivo `X.example` documenta la existencia de `X`: citar `X` es
        // correcto aunque todavía no exista, porque el propio proyecto indica
        // que hay que crearlo copiando el ejemplo.
        if (bases.some((b) => fs.existsSync(path.resolve(b, `${cand}.example`)))) continue;
        if (bases.some((b) => fs.existsSync(path.resolve(b, cand)))) continue;

        broken.push({
          scope: scope.name,
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          line: idx + 1,
          target: cand,
        });
      }
    });
  }

  return { scope: scope.name, filesScanned: files.length, broken };
}

/** Sin la línea: mover una cita no debe reintroducir un hallazgo congelado. */
function fingerprint(b) {
  return `${b.file}|${b.target}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const useBaseline = argv.includes('--baseline');
  const writeBaseline = argv.includes('--write-baseline');
  const si = argv.indexOf('--scope');
  const only = si !== -1 ? argv[si + 1] : null;

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const placeholder = placeholderPattern(cfg);
  const scopes = scopesFor(cfg);

  if (only && !scopes.some((s) => s.name === only)) {
    process.stderr.write(
      `\n  Scope desconocido: "${only}". Disponibles: ${scopes.map((s) => s.name).join(', ')}\n\n`,
    );
    process.exit(2);
  }

  const results = [];
  for (const scope of scopes) {
    if (only && scope.name !== only) continue;
    const r = checkScope(cfg, scope, placeholder);
    if (r) results.push(r);
  }

  if (writeBaseline) {
    // Sin --scope se escribiría el baseline de todos los scopes barridos, que
    // es justamente lo que borra en silencio lo congelado para los demás si el
    // barrido fue parcial. Se exige nombrarlo.
    if (!only) {
      process.stderr.write(
        '\n  --write-baseline requiere --scope <nombre>: escribir sin nombrarlo\n' +
          '  reemplazaría lo congelado para los demás scopes.\n\n',
      );
      process.exit(2);
    }
    const prints = results.flatMap((r) => r.broken).map(fingerprint);
    const res = baseline.write(BASELINE_NAME, only, prints);
    console.log(`\n  Baseline de "${only}": ${res.written} referencias congeladas`);
    console.log(`  Total en el archivo: ${res.total} (scopes: ${res.scopes.join(', ')})\n`);
    process.exit(0);
  }

  if (useBaseline) {
    for (const r of results) {
      r.broken = baseline.filter(r.broken, BASELINE_NAME, r.scope, fingerprint);
    }
  }

  const all = results.flatMap((r) => r.broken);

  if (asJson) {
    process.stdout.write(JSON.stringify(all, null, 2) + '\n');
    process.exit(all.length > 0 ? 1 : 0);
  }

  for (const r of results) {
    const label = `${r.scope} (${r.filesScanned} archivos)`;
    if (r.broken.length === 0) {
      console.log(`\n  ${label}\n    sin rutas rotas`);
      continue;
    }
    console.log(`\n  ${label}  —  ${r.broken.length} rutas rotas`);
    console.log('  ' + '─'.repeat(66));

    // Agrupado por destino: la misma ruta rota citada en varios lugares es un
    // solo problema, no N.
    const byTarget = new Map();
    for (const b of r.broken) {
      if (!byTarget.has(b.target)) byTarget.set(b.target, []);
      byTarget.get(b.target).push(`${b.file}:${b.line}`);
    }
    for (const [target, where] of [...byTarget].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${target}`);
      for (const w of where.slice(0, 3)) console.log(`      citada en ${w}`);
      if (where.length > 3) console.log(`      … y ${where.length - 3} lugares más`);
    }
  }

  console.log(`\n  Total: ${all.length} referencias rotas\n`);
  process.exit(all.length > 0 ? 1 : 0);
}

main();
