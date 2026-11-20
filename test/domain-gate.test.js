#!/usr/bin/env node
/**
 * domain-gate.test.js — el motor de los gates de dominio.
 *
 * El vocabulario es de juguete (un dominio inventado: "importes"): la base trae
 * el motor, no las reglas de ningún proyecto. Lo que se prueba es lo que el motor
 * garantiza SIEMPRE, sea cual sea el dominio:
 *
 *   - el clasificador por tokens (`limit` no es del dominio, `daily_limit` sí);
 *   - la exención por LÍNEA y nunca por archivo (el caso real: la exención por
 *     archivo dejó pasar una conversión que estaba tres líneas arriba del
 *     formateo correcto, y al corregirla la detección pasó de 22 a 43);
 *   - la allowlist de puntos de conversión;
 *   - baseline sin número de línea; fixtures ejecutables.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { ROOT } = require('./helpers');
const { withWorkspace } = require('./workspace-helper');
const domain = require('../scripts/lib/domain-gate');

const DEMO = 'test/fixtures/domain/check-demo.js';

const LANGUAGE = { id: 'ts-test', extensions: ['.ts'], testPatterns: ['\\.test\\.ts$'] };
const spec = (files) => ({ repos: [{ name: 'app', files, extra: { language: LANGUAGE } }] });
const gate = (ws, args = []) => ws.run(DEMO, ['--repo', 'app', ...args, '--json']);

describe('clasificador por tokens', () => {
  const { isDomainName } = domain.classifier({
    domain: ['amount', 'price', 'balance'],
    ambiguous: ['limit', 'cap'],
    qualifiers: ['daily', 'max', 'min'],
    disqualifiers: ['count', 'percent', 'id', 'repetitions'],
  });

  test('un token del dominio basta, en snake_case y en camelCase', () => {
    for (const n of ['amount', 'total_amount', 'totalAmount', 'unit-price', 'BALANCE', 'accountBalance']) {
      assert.equal(isDomainName(n), true, n);
    }
  });

  test('un ambiguo solo cuenta calificado: `limit` es paginación, `daily_limit` es del dominio', () => {
    assert.equal(isDomainName('limit'), false);
    assert.equal(isDomainName('page_limit'), false);
    assert.equal(isDomainName('daily_limit'), true);
    assert.equal(isDomainName('maxCap'), true);
    assert.equal(isDomainName('cap'), false);
  });

  test('un descalificador gana sobre el token del dominio', () => {
    for (const n of ['amount_repetitions', 'amountCount', 'percentAmount', 'amount_id']) {
      assert.equal(isDomainName(n), false, n);
    }
  });

  test('de una expresión se queda con el último nombre', () => {
    assert.equal(isDomainName('order.amount'), true);
    assert.equal(isDomainName('order?.dailyLimit'), true);
    assert.equal(isDomainName("row['balance']"), true);
    assert.equal(isDomainName('order.items'), false);
    assert.equal(isDomainName(''), false);
    assert.equal(isDomainName(undefined), false);
  });

  test('tokeniza siglas y números', () => {
    assert.deepEqual(domain.tokenize('parseHTTPAmount2'), ['parse', 'http', 'amount2']);
  });
});

describe('gate de dominio sobre un repositorio', () => {
  test('marca lo que viola la política y no toca lo correcto', () => {
    withWorkspace(
      spec({
        'src/malo.ts': 'const a = parseFloat(order.amount);\nconst b = Number(daily_limit) > 3;\nexport interface X {\n  amount: number;\n}\n',
        'src/bueno.ts': 'const a = parseFloat(page_limit);\nconst b = Number(item_count);\nexport interface X {\n  amount: string;\n  amount_repetitions: number;\n}\n',
      }),
      (ws) => {
        const r = gate(ws);
        assert.equal(r.code, 1, r.stderr);
        const rows = r.json.map((f) => `${f.rule} ${f.file}:${f.line} ${f.field}`).sort();
        assert.deepEqual(rows, ['DEMO-1 src/malo.ts:1 amount', 'DEMO-1 src/malo.ts:2 daily_limit', 'DEMO-2 src/malo.ts:4 amount']);
        assert.match(r.json[0].message, /ai\/local\/rules\/importes\.md/, 'el mensaje cita la política');
      },
    );
  });

  test('la exención es por LÍNEA: un formateo correcto en el archivo no tapa la conversión de otra línea', () => {
    withWorkspace(
      spec({
        'src/tabla.ts': [
          "const f = new Intl.NumberFormat('es').format(Number(amount));", // exenta: formatea en el acto
          'const filas = filas.map((r) => {',
          '  return parseFloat(r.amount);', // la que la exención por archivo dejaba pasar
          '});',
          '',
        ].join('\n'),
      }),
      (ws) => {
        const r = gate(ws);
        assert.equal(r.code, 1);
        assert.deepEqual(r.json.map((f) => f.line), [3], 'solo la línea 3: la 1 está exenta, la 3 no');
      },
    );
  });

  test('la allowlist exime solo a las reglas que se declaran allowlistable', () => {
    withWorkspace(
      spec({
        'src/lib/importes/convertir.ts': 'export const a = parseFloat(x.amount);\nexport interface T {\n  price: number;\n}\n',
      }),
      (ws) => {
        const r = gate(ws);
        assert.deepEqual(r.json.map((f) => f.rule), ['DEMO-2'], 'DEMO-1 (allowlistable) no; DEMO-2 sí');
      },
    );
  });

  test('los tests no se analizan', () => {
    withWorkspace(spec({ 'src/a.test.ts': 'const a = parseFloat(order.amount);\n' }), (ws) => {
      assert.equal(gate(ws).code, 0);
    });
  });

  test('baseline sin número de línea: mover código no reintroduce lo congelado', () => {
    withWorkspace(spec({ 'src/malo.ts': 'const a = parseFloat(order.amount);\n' }), (ws) => {
      assert.equal(ws.run(DEMO, ['--repo', 'app', '--write-baseline']).code, 0);
      assert.equal(gate(ws, ['--baseline']).code, 0);

      ws.write('app', 'src/malo.ts', '// una línea arriba\n\nconst a = parseFloat(order.amount);\n');
      assert.equal(gate(ws, ['--baseline']).code, 0, 'la huella no lleva el número de línea');

      ws.write('app', 'src/otro.ts', 'const b = parseFloat(order.price);\n');
      const r = gate(ws, ['--baseline']);
      assert.equal(r.code, 1);
      assert.deepEqual(r.json.map((f) => f.file), ['src/otro.ts']);
    });
  });

  test('un repositorio sin clonar sale con 2 y stdout vacío', () => {
    withWorkspace(spec({ 'src/a.ts': 'x\n' }), (ws) => {
      const cfg = JSON.parse(require('fs').readFileSync(ws.cfgPath, 'utf8'));
      cfg.repos.push({ name: 'ghost', path: `${ws.relDir}/ghost`, packs: [], baseBranch: 'main' });
      require('fs').writeFileSync(ws.cfgPath, JSON.stringify(cfg));
      const r = ws.run(DEMO, ['--repo', 'ghost', '--json']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('sin perfil de lenguaje no hay nada que analizar: sale con 2, no con 0', () => {
    // El núcleo siempre aporta el perfil de JavaScript: para quedarse sin perfil el
    // repositorio tiene que restringir sus lenguajes a uno que ningún pack declara.
    withWorkspace({ repos: [{ name: 'app', files: { 'src/a.ts': 'x\n' }, extra: { languages: ['no-existe'] } }] }, (ws) => {
      const r = gate(ws);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });
});

describe('fixtures ejecutables', () => {
  test('--validate-fixtures: todos se comportan', () => {
    withWorkspace(spec({ 'src/a.ts': 'x\n' }), (ws) => {
      const r = ws.run(DEMO, ['--repo', 'app', '--validate-fixtures', '--json']);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('--validate-fixtures: un nombre mal clasificado se reporta', () => {
    withWorkspace(spec({ 'src/a.ts': 'x\n' }), (ws) => {
      const r = ws.run(DEMO, ['--repo', 'app', '--validate-fixtures', '--json'], { env: { DEMO_BAD_FIXTURES: '1' } });
      assert.equal(r.code, 1);
      assert.match(r.json[0].message, /marca como del dominio algo que no lo es: price/);
    });
  });

  test('verifyFixtures exige los dos lados, en los nombres y en cada regla', () => {
    const base = { vocabulary: { domain: ['amount'] }, rules: [] };
    assert.match(domain.verifyFixtures({ ...base, fixtures: { names: { domain: ['amount'] } } })[0], /NO lo son/);

    const problems = domain.verifyFixtures({
      ...base,
      fixtures: { names: { domain: ['amount'], notDomain: ['name'] } },
      rules: [{ id: 'R', match: () => [], fixtures: { bad: ['x'] } }],
    });
    assert.ok(problems.some((p) => /necesita fixtures que marquen/.test(p)));
    assert.ok(problems.some((p) => /NO marca un caso que debería/.test(p)));
  });
});

describe('el motor se niega a lo que reintroduce el defecto', () => {
  test('una exención por archivo no se admite', () => {
    assert.throws(
      () => domain.run({ name: 'x', policy: 'p.md', rules: [{ id: 'R', match: () => [] }], exemptFile: () => true }),
      /exención por archivo/,
    );
  });

  test('faltan datos mínimos: se avisa en vez de correr a medias', () => {
    assert.throws(() => domain.run({ name: 'x' }), /faltan/);
  });

  test('el gate de ejemplo está donde la guía dice', () => {
    assert.ok(require('fs').existsSync(path.join(ROOT, DEMO)));
  });
});
