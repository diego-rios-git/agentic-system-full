#!/usr/bin/env node
/**
 * domain-gate.js
 *
 * El motor de un GATE DE DOMINIO: una política del proyecto escrita en UNA regla
 * (`ai/**\/rules/<dominio>.md`) y un gate que la verifica. Sirve para dinero,
 * fechas con zona horaria, datos personales, unidades de medida: todo lo que se
 * decide por el SIGNIFICADO del nombre de un campo y no por la forma del código.
 *
 * La lib trae el motor. **El vocabulario y las reglas son del proyecto**: esta
 * base no sabe qué es un monto ni qué es un dato personal. La guía para escribir
 * uno es `ai/core/procedures/domain-gate.md`.
 *
 * Qué resuelve el motor, y de dónde sale cada decisión (el gate de dinero del que
 * se generalizó pasó por todas):
 *
 *  1. CLASIFICADOR DE NOMBRES POR TOKENS, no una regex ancha. Decidir si
 *     `daily_limit` es del dominio exige mirar sus partes: `limit` a secas es
 *     paginación, `daily_limit` es dinero; `amount` es dinero, `amount_repetitions`
 *     es un contador. Una regex sobre la palabra marca la paginación como dinero
 *     y el equipo aprende a ignorar el gate. Cuatro listas:
 *       domain         con uno de estos tokens basta (`amount`, `saldo`)
 *       ambiguous      son del dominio solo CALIFICADOS (`limit`, `threshold`)
 *       qualifiers     califican a un ambiguo (`daily`, `max`)
 *       disqualifiers  descartan el nombre aunque tenga un token del dominio
 *                      (`count`, `percent`, `id`): ganan sobre todo lo demás
 *     Se parte en `snake_case` y `camelCase`.
 *
 *  2. ALLOWLIST de puntos de conversión: la lista explícita de los módulos donde
 *     la conversión que el gate prohíbe es, por definición, legítima (el helper
 *     que convierte). Son rutas, y se aplican solo a las reglas que se declaran
 *     `allowlistable`.
 *
 *  3. EXENCIÓN POR LÍNEA, nunca por archivo. Es la lección más cara: la primera
 *     versión eximía el archivo entero si contenía un formateador, y un solo uso
 *     correcto en cualquier parte dejaba ciega la regla para todo el archivo.
 *     Así entró un caso real a la rama base —la conversión estaba tres líneas
 *     arriba del formateo correcto— y al corregir la exención a nivel de línea la
 *     detección pasó de 22 a 43 hallazgos: los 21 nuevos eran deuda real que el
 *     filtro por archivo escondía. Por eso `exemptLine(line)` es lo único que hay:
 *     el motor se niega a recibir una exención de archivo (`exemptFile`).
 *
 *  4. BASELINE SIN NÚMERO DE LÍNEA: la huella es `regla|archivo|campo`. Mover
 *     código no puede reintroducir un hallazgo ya aceptado.
 *
 *  5. FIXTURES EJECUTABLES. `fixtures.names` (nombres que sí/no son del dominio)
 *     y `rules[].fixtures` (líneas que marcan y que no marcan) se corren con
 *     `--validate-fixtures`. Un clasificador sin el caso "no es del dominio" no
 *     se sabe si marca de más.
 *
 * Uso (el gate del proyecto, ~20 líneas):
 *
 *   const domain = require('./lib/domain-gate');
 *   domain.run({
 *     name: 'fechas',
 *     policy: 'ai/local/rules/fechas.md',
 *     vocabulary: { domain: ['date', 'fecha'], ambiguous: ['limit'], qualifiers: ['start'], disqualifiers: ['count'] },
 *     rules: [{ id: 'DATE-1', title: '…', allowlistable: true, match: (c) => … , fixtures: { bad: [], good: [] } }],
 *     exemptLine: (line) => /formatCalendarDate\(/.test(line),
 *     allowlist: ['src/lib/dates/'],
 *     fixtures: { names: { domain: ['start_date'], notDomain: ['date_count'] } },
 *   });
 *
 * `rules[].match(ctx)` devuelve una lista de `{field, message?, line?}` (o nada).
 * `ctx`: `{ line, lines, idx, rel, isDomainName(name), nameOf(expr), profile }`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const cli = require('./gate-cli');
const languages = require('./languages');

// ---------------------------------------------------------------------------
// Clasificador de nombres
// ---------------------------------------------------------------------------

/** Parte un identificador en tokens: `snake_case`, `kebab-case` y `camelCase`. */
function tokenize(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[_\-\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Si el texto es una expresión (`account.dailyLimit`, `row['x']`, `fn(x)`),
 * se queda con el último nombre: es el que dice qué es.
 */
function nameOf(expr) {
  if (!expr) return '';
  // `row['daily_limit']`: el nombre es el texto entre comillas.
  const bracket = /\[\s*['"`]([^'"`]+)['"`]\s*\]\s*[)\s;,]*$/.exec(String(expr));
  if (bracket) return bracket[1];
  const cleaned = String(expr).replace(/[)'"`\s;,\]].*$/, '').split(/[.[]/).pop();
  return cleaned || '';
}

/**
 * @param {{domain?: string[], ambiguous?: string[], qualifiers?: string[], disqualifiers?: string[]}} vocab
 * @returns {{isDomainName: (name: string) => boolean, tokenize: Function, nameOf: Function}}
 */
function classifier(vocab = {}) {
  const set = (list) => new Set((list || []).map((t) => String(t).toLowerCase()));
  const domain = set(vocab.domain);
  const ambiguous = set(vocab.ambiguous);
  const qualifiers = set(vocab.qualifiers);
  const disqualifiers = set(vocab.disqualifiers);

  function isDomainName(name) {
    const tokens = tokenize(nameOf(name));
    if (tokens.length === 0) return false;

    // Los descalificadores ganan sobre todo: `amount_repetitions` no es un monto.
    if (tokens.some((t) => disqualifiers.has(t))) return false;
    if (tokens.some((t) => domain.has(t))) return true;

    // Un ambiguo solo cuenta si algo lo califica: `limit` es paginación,
    // `daily_limit` es del dominio.
    if (tokens.some((t) => ambiguous.has(t))) return tokens.some((t) => qualifiers.has(t));

    return false;
  }

  return { isDomainName, tokenize, nameOf };
}

// ---------------------------------------------------------------------------
// Verificación de fixtures
// ---------------------------------------------------------------------------

/** Corre los fixtures declarados. @returns {string[]} problemas */
function verifyFixtures(spec) {
  const problems = [];
  const { isDomainName } = classifier(spec.vocabulary);
  const names = (spec.fixtures && spec.fixtures.names) || {};

  if (!(names.domain || []).length || !(names.notDomain || []).length) {
    problems.push('fixtures.names debe traer nombres que SON del dominio (`domain`) y que NO lo son (`notDomain`)');
  }
  for (const n of names.domain || []) {
    if (!isDomainName(n)) problems.push(`el clasificador NO reconoce como del dominio: ${n}`);
  }
  for (const n of names.notDomain || []) {
    if (isDomainName(n)) problems.push(`el clasificador marca como del dominio algo que no lo es: ${n}`);
  }

  for (const rule of spec.rules || []) {
    const bad = (rule.fixtures && rule.fixtures.bad) || [];
    const good = (rule.fixtures && rule.fixtures.good) || [];
    if (bad.length === 0 || good.length === 0) {
      problems.push(`${rule.id}: la regla necesita fixtures que marquen (\`bad\`) Y que no marquen (\`good\`)`);
    }
    for (const line of bad) {
      if (hitsOf(spec, rule, line, 'x/y.ts').length === 0) problems.push(`${rule.id}: NO marca un caso que debería — ${JSON.stringify(line)}`);
    }
    for (const line of good) {
      if (hitsOf(spec, rule, line, 'x/y.ts').length > 0) problems.push(`${rule.id}: marca un caso correcto — ${JSON.stringify(line)}`);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Barrido
// ---------------------------------------------------------------------------

/** Aplica una regla a una línea (con la exención por línea ya considerada). */
function hitsOf(spec, rule, line, rel, extra = {}) {
  const { isDomainName } = classifier(spec.vocabulary);
  if (spec.exemptLine && spec.exemptLine(line, { rel })) return [];

  const ctx = {
    line,
    lines: extra.lines || [line],
    idx: extra.idx || 0,
    rel,
    isDomainName,
    nameOf,
    profile: extra.profile || null,
  };
  return rule.match(ctx) || [];
}

function inAllowlist(spec, rel) {
  const p = rel.split(path.sep).join('/');
  return (spec.allowlist || []).some((allowed) => p.includes(String(allowed).split('\\').join('/')));
}

function scanRepo(spec, repoName, dir, profile) {
  const srcRoot = path.join(dir, 'src');
  const files = languages.walk(profile, fs.existsSync(srcRoot) ? srcRoot : dir);
  const findings = [];

  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    if (profile.isIgnoredPath(rel)) continue;
    const isTest = profile.isTest(rel);
    const allowlisted = inAllowlist(spec, rel);

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);

    for (const rule of spec.rules) {
      if (isTest && !rule.includeTests) continue;
      if (allowlisted && rule.allowlistable) continue;

      for (let idx = 0; idx < lines.length; idx++) {
        for (const hit of hitsOf(spec, rule, lines[idx], rel, { lines, idx, profile })) {
          findings.push({
            rule: rule.id,
            file: rel,
            line: hit.line || idx + 1,
            field: String(hit.field || '').slice(0, 60),
            message: hit.message || rule.title,
            code: lines[idx].trim().slice(0, 140),
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Arma y ejecuta el gate. Contrato de salida de siempre: 0 / 1 / 2.
 *
 * @param {object} spec
 * @param {string} spec.name           nombre del gate y de su baseline
 * @param {string} spec.policy         ruta de la regla escrita que el gate verifica
 * @param {object} spec.vocabulary     `{domain, ambiguous, qualifiers, disqualifiers}`
 * @param {object[]} spec.rules        `{id, title, match, allowlistable?, includeTests?, fixtures}`
 * @param {Function} [spec.exemptLine] `(line, {rel}) => boolean`. Exención POR LÍNEA
 * @param {string[]} [spec.allowlist]  fragmentos de ruta de los puntos de conversión
 * @param {object} [spec.fixtures]     `{names: {domain: [], notDomain: []}}`
 */
function run(spec) {
  if (spec.exemptFile) {
    throw new Error(
      'domain-gate: no se admite una exención por archivo (`exemptFile`). Un solo caso correcto ' +
        'en el archivo dejaba ciega la regla para todo lo demás. Usá `exemptLine`, o `allowlist` ' +
        'para los módulos que SON el punto de conversión.',
    );
  }
  if (!spec.name || !spec.policy || !Array.isArray(spec.rules) || spec.rules.length === 0) {
    throw new Error('domain-gate: faltan `name`, `policy` o `rules`');
  }

  cli.run({
    name: spec.name,
    script: spec.script || `scripts/check-${spec.name}.js`,
    usage: '[--validate-fixtures]',
    // Sin número de línea: mover código no debe reintroducir un hallazgo congelado.
    fingerprint: (f) => `${f.rule}|${f.file}|${f.field}`,

    scan(ctx) {
      if (ctx.has('--validate-fixtures')) {
        const problems = verifyFixtures(spec);
        return cli.findings(
          problems.map((m) => ({ rule: 'FIXTURE', file: spec.policy, line: 1, code: m.slice(0, 60), message: m })),
          { emptyMessage: 'todos los fixtures se comportan como declaran' },
        );
      }

      const profile = languages.forRepo(ctx.cfg, ctx.repo);
      for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);
      if (profile.empty) {
        return cli.unverified(
          `${ctx.repo.name}: ningún perfil de lenguaje activo, no hay archivos que analizar`,
          'Instalá el pack del stack, o declará `language` en ai-workspace.json.',
        );
      }

      const findings = scanRepo(spec, ctx.repo.name, ctx.dir, profile).map((f) => ({
        ...f,
        message: `${f.message} Política: ${spec.policy}`,
      }));
      return cli.findings(findings, { emptyMessage: `sin violaciones de la política (${spec.policy})` });
    },
  });
}

module.exports = { tokenize, nameOf, classifier, verifyFixtures, scanRepo, run };
