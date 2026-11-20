#!/usr/bin/env node
/**
 * check-tenant-isolation.js — gate del pack `multi-tenant`.
 *
 * Verifica `ai/packs/multi-tenant/rules/tenant-isolation.md`: el filtro por
 * cliente va en la condición de la consulta, no sobre el resultado.
 *
 * Tres detecciones:
 *
 *   TENANT-1  Consulta de lectura sin la columna de cliente en su condición.
 *   TENANT-2  Filtrado por cliente aplicado DESPUÉS de la consulta. Peor que
 *             el anterior: parece correcto y los datos ajenos ya salieron.
 *   TENANT-3  Búsqueda por identificador solo, sin acompañar por cliente.
 *
 * **Es una heurística, no una prueba.** Lee la forma del código, no lo ejecuta:
 * una consulta armada dinámicamente o un repositorio con filtro por defecto
 * pueden pasar sin ser marcados. Un resultado limpio no significa que el
 * aislamiento sea correcto — significa que no encontró los casos evidentes.
 *
 * Uso:
 *   node ai/packs/multi-tenant/scripts/check-tenant-isolation.js --repo mi-api
 *   … --json  ·  --target <ruta>  ·  --baseline  ·  --write-baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIB = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib');
const config = require(path.join(LIB, 'workspace-config'));
const baseline = require(path.join(LIB, 'baseline'));
const languages = require(path.join(LIB, 'languages'));

const ROOT = config.ROOT;
const BASELINE_NAME = 'tenant-isolation';

/**
 * Qué archivos se analizan lo decide el perfil de lenguaje de los packs
 * activos, no este script. Antes era `/\.[cm]?ts$/`: solo TypeScript, ni
 * siquiera JavaScript. El gate más importante que tiene esta base en materia de
 * seguridad —el que impide que los datos de un cliente se filtren a otro— era
 * también el más angosto de todos, y en un backend C#, Java o Go no miraba un
 * solo archivo mientras seguía reportando "sin hallazgos".
 */

/**
 * Dialectos de consulta.
 *
 * El concepto que verifica este gate —toda lectura lleva el filtro del
 * cliente— es el mismo en cualquier stack. **Cómo se ve una consulta no lo es.**
 * Este script no sabe nada de ningún ORM: lo declara el pack del stack, en su
 * `manifest.json`, bajo `tenant`.
 *
 *   "tenant": {
 *     "dialect": "typeorm",
 *     "readMethods": ["find", "findOne", "count"],
 *     "conditionMarker": "\\bwhere\\b",
 *     "byIdMethods": ["findOne", "findOneOrFail"],
 *     "byIdCondition": "where\\s*:\\s*\\{\\s*id\\b",
 *     "afterFilter": "\\.filter\\s*\\(\\s*\\(?\\s*(\\w+)\\s*\\)?\\s*=>[^)]*\\b\\1\\.(?:{tenant})\\b"
 *   }
 *
 * `{tenant}` se reemplaza por las variantes del nombre de la columna.
 *
 * Por qué no hay un dialecto por defecto: el que había era TypeORM —
 * `find`/`findOne`, condiciones con `where:` y objetos `{ id: … }` — escrito
 * dentro del script como si fuera universal. En un proyecto con EF Core,
 * Dapper, Prisma o el SDK de Mongo, ese dialecto no encuentra nada, y el gate
 * más importante que tiene esta base en materia de seguridad reportaba "sin
 * hallazgos" sobre un código que no había sabido leer. Sin dialecto declarado
 * este gate no corre: sale con 2 y lo dice.
 */
function dialectsFor(cfg, repo) {
  const assets = require(path.join(LIB, 'asset-roots'));
  const dialects = [];
  const problems = [];

  for (const root of assets.rootsFor(cfg, repo)) {
    const manifest = assets.rawManifest(root);
    const raw = manifest && manifest.tenant;
    if (!raw || !Array.isArray(raw.readMethods) || raw.readMethods.length === 0) continue;

    try {
      dialects.push(compileDialect(raw, root.id));
    } catch (err) {
      problems.push(`${root.dir}/manifest.json (tenant): ${err.message}`);
    }
  }

  return { dialects, problems };
}

/**
 * Compila un patrón del dialecto, rechazando el error que un JSON permite
 * escribir sin quejarse.
 *
 * En JSON, `"\b"` no es la secuencia de expresión regular: es el **carácter de
 * retroceso**, U+0008. Escribir `"\bwhere\b"` en vez de `"\\bwhere\\b"` produce
 * un patrón que compila sin error y no coincide con nada — y `"\1"` se
 * convierte en U+0001, con lo cual la referencia hacia atrás desaparece. El
 * gate queda mudo: recorre todos los archivos, no reconoce ni una consulta y
 * reporta "sin hallazgos". Es el modo de falla exacto que este archivo entero
 * existe para evitar, escondido en una barra invertida.
 *
 * Un carácter de control en un patrón no tiene ningún uso legítimo, así que se
 * lo trata como lo que casi siempre es: una barra invertida sin escapar.
 */
function compilePattern(value, field) {
  if (value === undefined || value === null) return null;

  const control = /[\u0000-\u001f]/.exec(String(value));
  if (control) {
    const code = control[0].charCodeAt(0).toString(16).padStart(4, '0');
    throw new Error(
      `\`${field}\` contiene el carácter de control U+${code}. ` +
        'En JSON las barras invertidas de una expresión regular van dobles: ' +
        'escribí "\\\\bwhere\\\\b", no "\\bwhere\\b".',
    );
  }

  try {
    return new RegExp(String(value));
  } catch (err) {
    throw new Error(`\`${field}\` no es una expresión regular válida: ${err.message}`);
  }
}

function compileDialect(raw, origin) {
  const escape = (n) => String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const group = (list) => list.map(escape).join('|');

  // `afterFilter` se compila recién al usarlo, cuando se conocen las variantes
  // de la columna, pero se valida acá: un patrón roto tiene que aparecer al
  // cargar el dialecto y no en medio del barrido.
  if (raw.afterFilter !== undefined) {
    compilePattern(String(raw.afterFilter).replace('{tenant}', 'tenant_id'), 'afterFilter');
  }

  return {
    id: raw.dialect || origin,
    // Llamadas de lectura: `.find(`, `.Where(`, `.filter(`…
    readCall: new RegExp(`\\.(${group(raw.readMethods)})\\s*\\(`, 'g'),
    // Cómo se reconoce que la llamada trae una condición. Sin condición no se
    // puede afirmar nada: puede ser un contador global legítimo, y marcarlo
    // daría demasiado ruido para ser útil.
    conditionMarker: compilePattern(raw.conditionMarker, 'conditionMarker'),
    // Búsqueda por identificador solo. La reporta TENANT-3, con un mensaje más
    // preciso, y por eso TENANT-1 la excluye: el mismo problema contado dos
    // veces hace que el informe pierda credibilidad.
    byIdCall: raw.byIdMethods && raw.byIdMethods.length > 0
      ? new RegExp(`\\.(${group(raw.byIdMethods)})\\s*\\(`, 'g')
      : null,
    byIdCondition: compilePattern(raw.byIdCondition, 'byIdCondition'),
    afterFilter: raw.afterFilter || null,
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function tenantVariants(column) {
  // `tenant_id` puede aparecer como tenantId en el código y tenant_id en SQL.
  const camel = column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return [...new Set([column, camel])];
}

function mentionsTenant(text, variants) {
  return variants.some((v) => new RegExp(`\\b${v}\\b`).test(text));
}

/**
 * Devuelve el fragmento que abarca la llamada que empieza en `index`, hasta
 * cerrar sus paréntesis. Sin esto, mirar una sola línea daría un falso positivo
 * en cada consulta escrita en varias líneas — que son casi todas.
 */
function callFragment(content, index) {
  const open = content.indexOf('(', index);
  if (open === -1) return '';

  let depth = 0;
  for (let i = open; i < content.length && i < open + 4000; i++) {
    const c = content[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return content.slice(open, Math.min(open + 4000, content.length));
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------------------
// Detecciones
// ---------------------------------------------------------------------------

function scanFile(content, rel, variants, findings, dialects) {
  for (const d of dialects) {
    // TENANT-1 — lectura sin el filtro en la condición.
    for (const m of content.matchAll(new RegExp(d.readCall.source, 'g'))) {
      const fragment = callFragment(content, m.index);
      if (!fragment) continue;
      if (d.conditionMarker && !d.conditionMarker.test(fragment)) continue;
      if (mentionsTenant(fragment, variants)) continue;
      if (d.byIdCondition && d.byIdCondition.test(fragment)) continue;

      findings.push({
        rule: 'TENANT-1',
        file: rel,
        line: lineOf(content, m.index),
        code: fragment.replace(/\s+/g, ' ').trim().slice(0, 120),
        message:
          'Consulta de lectura cuya condición no incluye la columna de cliente. ' +
          'El filtro va en la consulta, no sobre el resultado.',
      });
    }

    // TENANT-2 — filtrado después de traer los datos.
    if (d.afterFilter) {
      const pattern = new RegExp(d.afterFilter.replace('{tenant}', variants.join('|')), 'g');
      for (const m of content.matchAll(pattern)) {
        findings.push({
          rule: 'TENANT-2',
          file: rel,
          line: lineOf(content, m.index),
          code: m[0].replace(/\s+/g, ' ').trim().slice(0, 120),
          message:
            'El filtro por cliente se aplica sobre el resultado: los datos ajenos ya ' +
            'salieron de la base. Moverlo a la condición de la consulta.',
        });
      }
    }

    // TENANT-3 — búsqueda por identificador solo.
    if (d.byIdCall && d.byIdCondition) {
      for (const m of content.matchAll(new RegExp(d.byIdCall.source, 'g'))) {
        const fragment = callFragment(content, m.index);
        if (!fragment) continue;
        if (!d.byIdCondition.test(fragment)) continue;
        if (mentionsTenant(fragment, variants)) continue;

        findings.push({
          rule: 'TENANT-3',
          file: rel,
          line: lineOf(content, m.index),
          code: fragment.replace(/\s+/g, ' ').trim().slice(0, 120),
          message:
            'Búsqueda por identificador sin acompañar por cliente. Comprobar después ' +
            'es tarde: el registro ajeno ya está en memoria.',
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Barrido
// ---------------------------------------------------------------------------

function scan(repo, column, exempt, only, profile, dialects) {
  const variants = tenantVariants(column);
  const srcRoot = path.join(repo.absPath, 'src');
  const files = only
    ? [path.join(ROOT, only)].filter((f) => fs.existsSync(f))
    : languages.walk(profile, fs.existsSync(srcRoot) ? srcRoot : repo.absPath);

  const findings = [];

  for (const file of files) {
    const rel = path.relative(repo.absPath, file).split(path.sep).join('/');
    if (profile.isTest(rel) || profile.isIgnoredPath(rel)) continue;
    if (exempt.some((e) => rel.startsWith(e.replace(/\\/g, '/')))) continue;

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanFile(content, rel, variants, findings, dialects);
  }

  return findings;
}

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

  const column = cfg.tenant.column;
  if (!column) {
    // Sin columna declarada no hay nada que verificar, y decirlo importa: el
    // silencio se leería como "todo bien".
    if (asJson) process.stdout.write('[]\n');
    else {
      console.log('\n  El pack multi-tenant está instalado pero `tenant.column` no está');
      console.log('  declarado en ai-workspace.json. Sin ese dato el gate no verifica nada.\n');
    }
    process.exit(0);
  }

  const repoName = arg('--repo');
  if (!repoName) {
    process.stderr.write(
      `\nUso: node ai/packs/multi-tenant/scripts/check-tenant-isolation.js --repo <${cfg.repos
        .map((r) => r.name)
        .join('|')}> [--target ruta] [--json] [--baseline] [--write-baseline]\n\n`,
    );
    process.exit(2);
  }

  let repo;
  try {
    repo = config.repo(cfg, repoName);
  } catch (err) {
    return config.reportAndExit(err);
  }

  // Sale con 2, no con 0: un repositorio sin clonar no es un repositorio
  // limpio. En `--json` quien lee esto es un script, y `[]` con código 0 es
  // indistinguible de "revisé todo y no encontré nada".
  if (!fs.existsSync(repo.absPath)) {
    process.stderr.write(`\n  ${repo.name}: el repositorio no existe en ${repo.path}\n\n`);
    process.exit(2);
  }

  const profile = languages.forRepo(cfg, repo);
  for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);

  if (profile.empty) {
    process.stderr.write(
      `\n  ${repo.name}: ningún pack activo declara un perfil de lenguaje, ` +
        'no hay extensiones que analizar.\n\n',
    );
    process.exit(2);
  }

  // Sin un dialecto declarado este gate no sabe cómo se ve una consulta en
  // este stack. Sale con 2 — "no pude verificar" — y nunca con 0: un gate que
  // no reconoce ni una sola consulta y reporta "sin hallazgos" es peor que no
  // tenerlo, porque produce confianza donde no hay verificación.
  const { dialects, problems } = dialectsFor(cfg, repo);
  for (const p of problems) process.stderr.write(`  aviso: ${p}\n`);

  if (dialects.length === 0) {
    process.stderr.write(
      `\n  ${repo.name}: el pack multi-tenant está instalado, pero ningún pack activo\n` +
        '  declara cómo se ven las consultas de este stack.\n' +
        `  Packs del repositorio: ${repo.packs.join(', ') || 'ninguno'}.\n` +
        '  El dialecto se declara con `tenant.readMethods` en el manifiesto del pack\n' +
        '  del stack; la forma completa está documentada arriba, en `dialectsFor`.\n\n',
    );
    process.exit(2);
  }

  const exempt = (cfg.raw.tenant && cfg.raw.tenant.exempt) || [];
  let findings = scan(repo, column, exempt, arg('--target'), profile, dialects);

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
    console.log(`  ${repo.name}: sin violaciones nuevas de aislamiento (columna "${column}").`);
    process.exit(0);
  }

  console.log(
    `\n  ${repo.name}  —  ${findings.length} hallazgo(s)  ·  columna "${column}"\n`,
  );
  for (const f of findings) {
    console.log(`  [${f.rule}] ${f.file}:${f.line}`);
    console.log(`    ${f.message}`);
    console.log(`    ${f.code}\n`);
  }
  console.log('  Recordá: esto es una heurística. Un resultado limpio no prueba que el');
  console.log('  aislamiento sea correcto.\n');
  process.exit(1);
}

main();
