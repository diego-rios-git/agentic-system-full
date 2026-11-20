#!/usr/bin/env node
/**
 * check-antipatterns.js
 *
 * Motor de detección de anti-patrones. **No contiene ninguna regla.**
 *
 * Las reglas las aportan el núcleo y los packs instalados, en un archivo
 * `rules/antipatterns.js` dentro de cada raíz de activos. Instalar el pack de
 * un stack instala sus anti-patrones; no instalarlo los deja fuera sin que
 * nadie tenga que acordarse de nada.
 *
 * Un archivo de reglas exporta un array. Hay dos tipos:
 *
 *   Por línea, el habitual:
 *     {
 *       id: 'XX-1.1',
 *       title: 'Qué detecta',
 *       why: 'Por qué importa — se le muestra a quien lo dispara',
 *       test: (line, ctx) => boolean,
 *       skipFile: (rel) => boolean,     // opcional
 *       includeTests: false,            // opcional: por defecto los tests se omiten
 *     }
 *
 *   `ctx` trae `{ file, before, envAccess, rel }`. `envAccess` son las formas de
 *   leer la configuración del entorno **en el lenguaje de ese archivo**, según
 *   el perfil del pack: `process.env` en JavaScript, `IConfiguration` en C#,
 *   `os.environ` en Python. Una regla que las dé por sentadas deja de ser
 *   portable — y la que asumía `process.env` marcaba como cableado todo el
 *   código que no fuera JavaScript.
 *
 *   Estructural, para lo que no es una línea sino la forma del árbol:
 *     {
 *       id: 'XX-2.1',
 *       kind: 'structure',
 *       title: '…', why: '…',
 *       scan: (repoRoot) => [{ file, line, code }],
 *     }
 *
 * Uso:
 *   node scripts/check-antipatterns.js --repo mi-api
 *   node scripts/check-antipatterns.js --repo mi-api --json
 *   node scripts/check-antipatterns.js --repo mi-api --rule XX-1.1
 *   node scripts/check-antipatterns.js --repo mi-api --target src/x.ts
 *   node scripts/check-antipatterns.js --repo mi-api --write-baseline
 *   node scripts/check-antipatterns.js --repo mi-api --baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const assets = require('./lib/asset-roots');
const baseline = require('./lib/baseline');
const languages = require('./lib/languages');

const ROOT = config.ROOT;
const BASELINE_NAME = 'antipatterns';

// ---------------------------------------------------------------------------
// Carga de reglas
// ---------------------------------------------------------------------------

/**
 * Reglas aplicables a un repositorio: las del núcleo, las de cada pack que ese
 * repositorio tiene activo, y las locales del proyecto.
 *
 * Un archivo de reglas roto se reporta y se omite. Fallar entero dejaría al
 * repositorio sin ninguna verificación por culpa de un solo pack.
 */
function loadRules(cfg, repo) {
  const rules = [];
  const problems = [];

  for (const root of assets.roots(cfg)) {
    const applies =
      root.kind === 'core' ||
      root.kind === 'local' ||
      repo.packs.includes(root.id) ||
      (cfg.raw.packs || []).includes(root.id);
    if (!applies) continue;

    const file = path.join(root.absDir, 'rules', 'antipatterns.js');
    if (!fs.existsSync(file)) continue;

    try {
      const loaded = require(file);
      if (!Array.isArray(loaded)) {
        problems.push(`${root.dir}/rules/antipatterns.js no exporta un array`);
        continue;
      }
      for (const rule of loaded) rules.push({ ...rule, origin: root.id });
    } catch (err) {
      problems.push(`${root.dir}/rules/antipatterns.js falló al cargar: ${err.message}`);
    }
  }

  return { rules, problems };
}

// ---------------------------------------------------------------------------
// Barrido
// ---------------------------------------------------------------------------

/**
 * El recorrido del árbol, la detección de tests y el recorte de comentarios ya
 * no viven acá: los provee `lib/languages.js` a partir del perfil que declara
 * cada pack. Antes eran constantes cableadas a JavaScript, y un repositorio en
 * C# o Go no producía ni un solo archivo para analizar — el gate salía con 0 y
 * "sin hallazgos" sin haber mirado nada.
 */

function scanFiles(repoRoot, rules, only, profile) {
  // Preferir `src/` cuando existe: barrer la raíz del repositorio incluiría
  // configuración, scripts de compilación y ejemplos, que no son producción.
  const srcRoot = path.join(repoRoot, 'src');
  const files = only
    ? [path.join(ROOT, only)].filter((f) => fs.existsSync(f))
    : languages.walk(profile, fs.existsSync(srcRoot) ? srcRoot : repoRoot);

  const lineRules = rules.filter((r) => r.kind !== 'structure' && typeof r.test === 'function');
  const findings = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');

    // Rutas generadas: migraciones, código de un generador, declaraciones de
    // tipos. Nadie las refactoriza y su forma la decide una herramienta.
    if (profile.isIgnoredPath(rel)) continue;

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);

    // La sintaxis depende del archivo, no del repositorio: un repositorio
    // políglota tiene `//` en unos archivos y `#` en otros.
    const syntax = profile.syntaxFor(rel);
    const envAccess = profile.envAccessFor(rel);
    const isTest = profile.isTest(rel);

    for (const rule of lineRules) {
      if (rule.skipFile && rule.skipFile(rel)) continue;
      // Los tests usan simulaciones, direcciones locales y errores genéricos de
      // forma legítima. Una regla que quiera mirarlos lo declara.
      if (isTest && !rule.includeTests) continue;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = languages.stripComment(raw, syntax);
        if (!line.trim()) continue;

        const ctx = {
          file: content,
          before: lines.slice(Math.max(0, i - 12), i).join('\n'),
          // Cómo se lee la configuración del entorno en ESTE lenguaje. Una regla
          // que quiera distinguir un valor cableado de uno inyectable tiene que
          // preguntarlo: `process.env` no existe fuera de JavaScript, y una
          // regla que lo dé por sentado marca como error todo el código C#.
          envAccess,
          rel,
        };

        let hit = false;
        try {
          hit = rule.test(line, ctx);
        } catch {
          continue; // una regla que revienta no tumba el barrido entero
        }

        if (hit) {
          findings.push({
            rule: rule.id,
            file: rel,
            line: i + 1,
            code: raw.trim().slice(0, 120),
            message: rule.why || rule.title || rule.id,
          });
        }
      }
    }
  }

  return findings;
}

function scanStructure(repoRoot, rules) {
  const findings = [];
  for (const rule of rules.filter((r) => r.kind === 'structure' && typeof r.scan === 'function')) {
    let produced = [];
    try {
      produced = rule.scan(repoRoot) || [];
    } catch {
      continue;
    }
    for (const f of produced) {
      findings.push({
        rule: rule.id,
        file: f.file,
        line: f.line || 0,
        code: f.code || '',
        message: rule.why || rule.title || rule.id,
      });
    }
  }
  return findings;
}

/** Sin la línea: mover código no debe reintroducir un hallazgo congelado. */
function fingerprint(f) {
  return `${f.rule}|${f.file}|${f.code}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const useBaseline = argv.includes('--baseline');
  const writeBaseline = argv.includes('--write-baseline');

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
      `\nUso: node scripts/check-antipatterns.js --repo <${cfg.repos
        .map((r) => r.name)
        .join('|')}> [--rule ID] [--target ruta] [--json] [--baseline] [--write-baseline]\n\n`,
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
    process.stderr.write(`\n  El repositorio "${repo.name}" no existe en ${repo.path}\n\n`);
    process.exit(2);
  }

  const { rules, problems } = loadRules(cfg, repo);
  for (const p of problems) process.stderr.write(`  aviso: ${p}\n`);

  // Qué cuenta como archivo fuente en este repositorio. Lo declaran los packs
  // activos; sin perfil no hay nada que barrer.
  const profile = languages.forRepo(cfg, repo);
  for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);

  if (profile.empty) {
    process.stderr.write(
      `\n  ${repo.name}: ningún pack activo declara un perfil de lenguaje, ` +
        'no hay extensiones que analizar.\n' +
        `  Packs del repositorio: ${repo.packs.join(', ') || 'ninguno'}.\n` +
        '  Instalá el pack del stack, o declaralo a mano con `language` en ai-workspace.json.\n\n',
    );
    process.exit(2);
  }

  const only = arg('--rule');
  const active = only ? rules.filter((r) => r.id === only) : rules;

  // Sin reglas no hay verificación. Sale con 2, no con 0: en `--json` quien
  // consume esto es un script, que lee el código de salida y no el aviso, y una
  // lista vacía con código 0 es indistinguible de "no encontré nada". "No
  // encontré nada" y "no busqué nada" no son lo mismo.
  if (active.length === 0) {
    process.stderr.write(
      only
        ? `\n  ${repo.name}: no existe ninguna regla con el identificador "${only}".\n\n`
        : `\n  ${repo.name}: no hay reglas de anti-patrones activas.` +
            `\n  Las aportan los packs instalados (${repo.packs.join(', ') || 'ninguno'}).\n\n`,
    );
    process.exit(2);
  }

  const target = arg('--target');
  let findings = [
    ...scanFiles(repo.absPath, active, target, profile),
    ...(target ? [] : scanStructure(repo.absPath, active)),
  ];

  if (writeBaseline) {
    const res = baseline.write(BASELINE_NAME, repo.name, findings.map(fingerprint));
    console.log(`\n  Baseline de "${repo.name}": ${res.written} hallazgos congelados`);
    console.log(`  Total en el archivo: ${res.total} (scopes: ${res.scopes.join(', ')})\n`);
    process.exit(0);
  }

  if (useBaseline) {
    findings = baseline.filter(findings, BASELINE_NAME, repo.name, fingerprint);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log(`\n  ${repo.name}: sin anti-patrones nuevos (${active.length} reglas activas)\n`);
    process.exit(0);
  }

  console.log(`\n  ${repo.name}  —  ${findings.length} hallazgo(s)\n`);
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  for (const [id, list] of byRule) {
    const rule = active.find((r) => r.id === id);
    console.log(`  [${id}] ${rule ? rule.title : ''}  (${list.length})`);
    if (rule && rule.why) console.log(`    ${rule.why}`);
    for (const f of list.slice(0, 10)) console.log(`      ${f.file}:${f.line}  ${f.code}`);
    if (list.length > 10) console.log(`      … y ${list.length - 10} más`);
    console.log('');
  }

  process.exit(1);
}

main();
