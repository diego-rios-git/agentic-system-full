#!/usr/bin/env node
/**
 * pr-review-docs.test.js — los documentos del circuito de revisión y de pruebas
 * de punta a punta, verificados como documentos.
 *
 * Qué se comprueba, todo mecánico:
 *
 *   1. Ningún documento cita una ruta de la base que no existe: una ruta
 *      inventada hace que el agente improvise en vez de fallar.
 *   2. Ningún documento contiene un nombre fijo del proyecto de origen (el
 *      nombre del producto, su gestor de tickets, su host de PRs, su rama base).
 *      Lo propio de un tracker o de un host vive en su pack.
 *   3. Todo agente, prompt y procedimiento de revisión nombra `REVIEW_ROOT`:
 *      sin esa línea los subagentes leen la rama equivocada.
 *   4. El vocabulario de modos es uno solo: A, S y C.
 *   5. Lo que cada pieza tiene que decir sí lo dice (el incidente de cada regla
 *      es lo que evita que alguien la "simplifique").
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./helpers');

// ---------------------------------------------------------------------------
// Los documentos de esta pieza
// ---------------------------------------------------------------------------

function listMd(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listMd(path.posix.join(dir, e.name)) : e.name.endsWith('.md') ? [path.posix.join(dir, e.name)] : []));
}

const DOCS = [
  'ai/core/procedures/pr-review.md',
  'ai/core/procedures/prueba-e2e.md',
  ...listMd('ai/core/prompts/code-review'),
  'ai/core/agents/workspace-router.md',
  'ai/core/agents/qa-agent.md',
  'ai/core/agents/code-reviewer.md',
  'ai/core/agents/security-auditor.md',
  'ai/core/rules/edicion-por-reemplazo.md',
  'ai/core/rules/dobles-de-repositorio.md',
  'ai/core/rules/aislamiento-de-rama.md',
  'ai/core/rules/autoria-de-activos.md',
  'ai/packs/nestjs/rules/probar-el-borde.md',
  'ai/packs/nextjs/rules/copy-de-interfaz.md',
  ...listMd('ai/packs/fullstack'),
  ...listMd('ai/packs/e2e'),
];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Interfaces acordadas entre piezas que pueden no existir todavía en una rama parcial. */
const INTERFACES_DEL_CONTRATO = new Set(['scripts/run-checks.js']);

describe('los documentos existen', () => {
  for (const rel of DOCS) {
    test(rel, () => assert.ok(fs.existsSync(path.join(ROOT, rel)), `falta ${rel}`));
  }
});

describe('rutas citadas', () => {
  const RE_PATH = /`((?:ai|scripts|test|docs)\/[^`\s<>*{}$]+\.(?:md|js|json|py))`/g;

  for (const rel of DOCS) {
    test(`${rel} no cita rutas inexistentes de la base`, () => {
      const missing = [];
      for (const m of read(rel).matchAll(RE_PATH)) {
        const cited = m[1];
        if (cited.startsWith('ai/local/')) continue; // es del proyecto: no existe en la base
        if (INTERFACES_DEL_CONTRATO.has(cited)) continue;
        if (!fs.existsSync(path.join(ROOT, cited))) missing.push(cited);
      }
      assert.deepEqual([...new Set(missing)], [], `rutas que no existen: ${missing.join(', ')}`);
    });
  }
});

describe('nombres fijos del proyecto de origen', () => {
  // `develop` solo como palabra (no `developer`). Un ejemplo se marca con `ejemplo-de-origen` en la línea.
  const FIJOS = /linxdash|bitbucket|jira|\bLIN-\d|\bdevelop\b|casino/i;

  for (const rel of DOCS) {
    test(`${rel}`, () => {
      const hits = read(rel)
        .split(/\r?\n/)
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => FIJOS.test(l) && !/ejemplo-de-origen/.test(l));
      assert.deepEqual(
        hits.map((h) => `${h.n}: ${h.l.trim().slice(0, 80)}`),
        [],
      );
    });
  }

  test('ningún documento trae una ruta absoluta personal', () => {
    const RE_ABS = /\b[A-Za-z]:\\(?:Users|proyectos|openix)\b|\/home\/[a-z]+\//i;
    const hits = DOCS.filter((rel) => RE_ABS.test(read(rel)));
    assert.deepEqual(hits, []);
  });

  test('el pack fullstack no fija un stack', () => {
    const RE_STACK = /nestjs|next\.?js|typeorm|react|express|django|rails|laravel|spring/i;
    const hits = listMd('ai/packs/fullstack').filter((rel) => RE_STACK.test(read(rel)));
    assert.deepEqual(hits, []);
  });
});

describe('REVIEW_ROOT', () => {
  const REVISION = [
    'ai/core/procedures/pr-review.md',
    'ai/core/agents/qa-agent.md',
    'ai/core/agents/code-reviewer.md',
    'ai/core/agents/security-auditor.md',
    'ai/core/rules/aislamiento-de-rama.md',
    ...listMd('ai/core/prompts/code-review'),
  ];

  for (const rel of REVISION) {
    test(`${rel} menciona REVIEW_ROOT`, () => assert.match(read(rel), /REVIEW_ROOT/));
  }

  test('pr-review la pone como PRIMERA línea del prompt, en los modos S y C', () => {
    const t = read('ai/core/procedures/pr-review.md');
    assert.match(t, /REVIEW_ROOT: <ruta>`? como PRIMERA línea/);
    assert.match(t, /modos \*\*S y C\*\*/);
  });
});

describe('vocabulario de modos: A, S y C', () => {
  for (const rel of DOCS.filter((d) => /pr-review|code-review|agents/.test(d))) {
    test(`${rel} no usa A/B ni "modo B"`, () => {
      const t = read(rel);
      assert.doesNotMatch(t, /\bA\/B\b|\bmodo B\b|\bMode B\b|\bmodo A\/B\b/i);
    });
  }

  test('pr-review define los tres modos', () => {
    const t = read('ai/core/procedures/pr-review.md');
    assert.match(t, /\*\*A\*\* \(default\)/);
    assert.match(t, /\| \*\*S\*\* \|/);
    assert.match(t, /\| \*\*C\*\* \|/);
  });
});

describe('contenido que no se puede perder', () => {
  const has = (rel, ...patterns) => {
    const t = read(rel);
    for (const p of patterns) assert.match(t, p, `${rel}: falta ${p}`);
  };

  test('pr-review: el diff real del modo A, --from en S y C, y las salvaguardas', () => {
    has(
      'ai/core/procedures/pr-review.md',
      /git -C <repo> diff <base>\.\.\.HEAD/,
      /git -C <repo> diff HEAD/,
      /sin trackear/,
      /--from <slot>/,
      /obligatorio/,
      /run-checks\.js/,
      /run-gates\.js/,
      /verify-findings\.js/,
      /gate-from-finding/,
      /sin verificar/i,
      /\| tail/,
      /textual/,
      /no hereda|No se hereda|no heredan/i,
      /Un ticket, un review con revisores/,
    );
  });

  test('pr-review: el modo C escribe a un archivo en una carpeta que define el proyecto', () => {
    const t = read('ai/core/procedures/pr-review.md');
    assert.match(t, /no se inventa/);
    assert.match(t, /A un archivo/);
  });

  test('prueba-e2e: los pasos y los incidentes', () => {
    has(
      'ai/core/procedures/prueba-e2e.md',
      /BLOQUEANTE/,
      /Con el código viejo/,
      /NO CONCLUYENTE/,
      /INSERT/,
      /git diff --stat/,
      /edicion-por-reemplazo/,
      /subagente/,
      /N\/N OK/,
      /Lección/,
      /gate de código|Gate de código/i,
      /webapp-testing/,
      /Apache 2\.0/,
      /ai\/local\//,
    );
  });

  test('las reglas transversales traen su incidente y su "cómo aplicarlo"', () => {
    for (const rel of [
      'ai/core/rules/edicion-por-reemplazo.md',
      'ai/core/rules/dobles-de-repositorio.md',
      'ai/core/rules/aislamiento-de-rama.md',
      'ai/core/rules/autoria-de-activos.md',
      'ai/packs/nestjs/rules/probar-el-borde.md',
      'ai/packs/nextjs/rules/copy-de-interfaz.md',
    ]) {
      const t = read(rel);
      assert.match(t, /incidente|Incidente|Por qué|De dónde sale|Qué pasa si no/, `${rel}: sin incidente`);
      assert.match(t, /Cómo aplicarlo en tu proyecto|Cómo se aplica|Cómo se verifica/, `${rel}: sin "cómo aplicarlo"`);
    }
  });

  test('edicion-por-reemplazo afirma el conteo y reemplaza por límite de palabra', () => {
    has('ai/core/rules/edicion-por-reemplazo.md', /assert n == 1/, /\\bdia\\b/, /git diff --stat/);
  });

  test('autoria-de-activos: estados, alias que delega y sin secretos', () => {
    has('ai/core/rules/autoria-de-activos.md', /sugerencia/, /garantía/, /experimental/, /pendiente de revisión/, /delega/, /sin dueño/i);
  });

  test('los agentes de revisión referencian la regla en vez de copiarla', () => {
    for (const rel of ['qa-agent', 'code-reviewer', 'security-auditor']) {
      has(`ai/core/agents/${rel}.md`, /ai\/core\/rules\/aislamiento-de-rama\.md/, /no los vuelvas a correr|no los repitas|no los corras/i);
    }
  });

  test('el prompt de contrato y diseño no fija un stack ni un tracker', () => {
    const t = read('ai/core/prompts/code-review/review-contrato-diseno.md');
    assert.doesNotMatch(t, /nestjs|next\.?js|typeorm/i);
  });
});
