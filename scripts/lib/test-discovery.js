#!/usr/bin/env node
/**
 * test-discovery.js
 *
 * Encuentra los tests de un repositorio y les extrae el título.
 *
 * De qué sirve un título: es lo único que un script puede verificar sin
 * ejecutar nada. Un test que prueba el escenario pero se llama distinto es,
 * para cualquier herramienta, indistinguible de un escenario sin test. La
 * convención de nombres es lo que hace verificable la trazabilidad entre una
 * especificación y sus pruebas.
 *
 * Por qué hace falta una estrategia por lenguaje y no una expresión regular
 * configurable: **en muchos lenguajes el título no es una cadena.** En Jest o
 * Vitest está a la vista, `it('rechaza el monto', …)`. En xUnit el test es un
 * método decorado y su nombre ES el título: `Rechaza_El_Monto()`, o un
 * `[Fact(DisplayName = "…")]` cuando alguien quiso escribirlo en prosa. En Go
 * es `func TestRechazaElMonto`. Pedir una regex no alcanza: hay que saber
 * además cómo convertir lo que se capturó en algo comparable con la frase de un
 * escenario.
 *
 * La estrategia la declara el perfil del pack, bajo `language.testTitles`:
 *
 *   "testTitles": { "strategy": "callback", "functions": ["it", "test"] }
 *   "testTitles": { "strategy": "attribute-or-method",
 *                   "attributes": ["Fact", "Theory"], "titleField": "DisplayName" }
 *   "testTitles": { "strategy": "function-name", "prefix": "Test" }
 *   "testTitles": { "strategy": "regex", "pattern": "…(…)…" }
 *
 * Sin `testTitles` declarado, un lenguaje no aporta títulos. Eso **no** se
 * reporta como "no hay tests": quien consume esto tiene que distinguir "busqué
 * y no encontré" de "no supe buscar", y por eso `titlesOf` devuelve también los
 * lenguajes que no supo leer.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const languages = require('./languages');

// ---------------------------------------------------------------------------
// Normalización de nombres
// ---------------------------------------------------------------------------

/**
 * Convierte el nombre de un método de test en una frase comparable.
 *
 *   Rechaza_Un_Monto_Mayor    → "Rechaza Un Monto Mayor"
 *   rechazaUnMontoMayor       → "rechaza Un Monto Mayor"
 *   TestRechazaMonto          → "Rechaza Monto"   (con prefix "Test")
 *   test_rechaza_monto        → "rechaza monto"
 *
 * Sin esto, la comparación por similitud recibiría una sola palabra pegada y no
 * compartiría ningún término con la frase del escenario: el test existiría y el
 * gate lo reportaría igual como faltante.
 */
function humanize(name, prefix) {
  let out = String(name);

  if (prefix) {
    const re = new RegExp(`^${prefix}[_]?`, 'i');
    out = out.replace(re, '');
  }

  return out
    .replace(/[_-]+/g, ' ')
    // Corte de camelCase y de PascalCase, incluido el caso de siglas seguidas
    // de palabra: `HTTPRequestFalla` → `HTTP Request Falla`.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Estrategias
// ---------------------------------------------------------------------------

/**
 * Cada estrategia recibe el contenido de un archivo y devuelve
 * `[{ title, line }]`. Ninguna ejecuta nada ni construye un árbol sintáctico:
 * leen la forma del texto, que es lo que alcanza para comparar títulos y lo
 * único que se puede hacer sin una dependencia por lenguaje.
 */
const STRATEGIES = {
  /** `it('…')`, `test('…')`, `it.each(…)('…')` — Jest, Vitest, Mocha, Jasmine. */
  callback(content, opts) {
    const fns = (opts.functions || ['it', 'test']).join('|');
    const re = new RegExp(`\\b(?:${fns})\\s*(?:\\.\\w+)?\\s*\\(\\s*['"\`](.+?)['"\`]`);
    return byLine(content, (line) => {
      const m = re.exec(line);
      return m ? m[1] : null;
    });
  },

  /**
   * xUnit, NUnit, MSTest, JUnit: el test es un método decorado.
   *
   * Prefiere el título en prosa del atributo cuando está —`[Fact(DisplayName =
   * "…")]`— y si no, usa el nombre del método, que es lo habitual. El atributo
   * y el método suelen estar en líneas distintas, así que hay que recordar que
   * la línea anterior abrió un test.
   */
  'attribute-or-method'(content, opts) {
    const attrs = (opts.attributes || ['Fact', 'Theory', 'Test', 'TestMethod']).join('|');
    const field = opts.titleField || 'DisplayName';

    const attrRe = new RegExp(`\\[\\s*(?:${attrs})\\b`);
    const titleRe = new RegExp(`${field}\\s*=\\s*"([^"]+)"`);
    const methodRe = /(?:^|\s)(?:public|internal|private|protected)?\s*(?:async\s+)?[\w<>,.\[\]?]+\s+(\w+)\s*\(/;

    const out = [];
    const lines = content.split(/\r?\n/);
    let pending = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (attrRe.test(line)) {
        const withTitle = titleRe.exec(line);
        pending = { line: i + 1, title: withTitle ? withTitle[1] : null };
        continue;
      }

      if (!pending) continue;

      // Entre el atributo y el método puede haber más atributos o datos de
      // `[InlineData]`. Se sigue esperando hasta encontrar la firma.
      if (pending.title === null) {
        const withTitle = titleRe.exec(line);
        if (withTitle) pending.title = withTitle[1];
      }

      const method = methodRe.exec(line);
      if (method) {
        out.push({
          title: pending.title || humanize(method[1], opts.prefix),
          line: pending.line,
        });
        pending = null;
      }
    }

    return out;
  },

  /** `func TestAlgo(t *testing.T)` de Go, `def test_algo():` de pytest. */
  'function-name'(content, opts) {
    const keyword = opts.keyword || 'func';
    const prefix = opts.prefix || 'Test';
    const re = new RegExp(`\\b${keyword}\\s+(${prefix}\\w+)`);
    return byLine(content, (line) => {
      const m = re.exec(line);
      return m ? humanize(m[1], prefix) : null;
    });
  },

  /** Escape para el marco que no encaje en ninguna de las anteriores. */
  regex(content, opts) {
    if (!opts.pattern) return [];
    let re;
    try {
      re = new RegExp(opts.pattern);
    } catch {
      return [];
    }
    return byLine(content, (line) => {
      const m = re.exec(line);
      if (!m) return null;
      return opts.humanize ? humanize(m[1], opts.prefix) : m[1];
    });
  },
};

function byLine(content, extract) {
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const title = extract(lines[i]);
    if (title) out.push({ title, line: i + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Títulos de test de un repositorio.
 *
 * @returns {{
 *   titles: Array<{title: string, at: string}>,
 *   files: number,
 *   strategies: string[],
 *   unreadable: string[],
 * }}
 *   `unreadable` son los lenguajes cuyos archivos de test se encontraron pero
 *   cuyo perfil no declara `testTitles`. Es la diferencia entre "no hay tests" y
 *   "no supe leerlos", y quien consuma esto tiene que tratarla distinto: lo
 *   segundo es un gate que no pudo verificar, no un repositorio sin pruebas.
 */
function titlesOf(profile, repoRoot) {
  const titles = [];
  const strategies = new Set();
  const unreadable = new Set();
  let files = 0;

  for (const file of languages.walk(profile, repoRoot)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (!profile.isTest(rel)) continue;

    files++;

    const spec = profile.testTitlesFor(rel);
    if (!spec || !spec.strategy) {
      unreadable.add(profile.languageOf(rel) || 'desconocido');
      continue;
    }

    const strategy = STRATEGIES[spec.strategy];
    if (!strategy) {
      unreadable.add(`${profile.languageOf(rel)} (estrategia desconocida: ${spec.strategy})`);
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    strategies.add(spec.strategy);
    for (const found of strategy(content, spec)) {
      titles.push({ title: found.title, at: `${rel}:${found.line}` });
    }
  }

  return {
    titles,
    files,
    strategies: [...strategies],
    unreadable: [...unreadable],
  };
}

module.exports = { titlesOf, humanize, STRATEGIES };
