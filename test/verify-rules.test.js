#!/usr/bin/env node
/**
 * verify-rules.test.js — toda regla activa trae un fixture que marca Y uno que no.
 *
 * `rules.test.js` ya comprueba que las reglas de la base se comporten como sus
 * fixtures declaran. Lo que agrega `verify-rules.js` es lo que ese test NO exige
 * y que los tests de la base, que no viajan al proyecto, no pueden vigilar: que
 * cada regla —también las que el proyecto agrega— declare LOS DOS lados.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ROOT, runGate, rulesOf, packsMissing } = require('./helpers');
const { completeness, structureBehavior, fingerprint } = require('../scripts/verify-rules');

const SCRIPT = 'scripts/verify-rules.js';

describe('verify-rules: completitud de los fixtures', () => {
  const rule = (fixtures, extra = {}) => ({ id: 'X-1', source: 'ai/local/rules/antipatterns.js', test: () => true, fixtures, ...extra });
  const codes = (rules) => completeness(rules).map((f) => f.code).sort();

  test('una regla sin fixtures falla dos veces: le falta lo que marca y lo que no marca', () => {
    assert.deepEqual(codes([rule(undefined)]), ['falta-bad', 'falta-good']);
  });

  test('solo `bad`: falta el que NO marca (el que importa)', () => {
    assert.deepEqual(codes([rule({ bad: ['a'] })]), ['falta-good']);
  });

  test('solo `good`: falta el que marca', () => {
    assert.deepEqual(codes([rule({ good: ['a'] })]), ['falta-bad']);
  });

  test('con los dos lados: completa', () => {
    assert.deepEqual(codes([rule({ bad: ['a'], good: ['b'] })]), []);
  });

  test('una regla sin `test` ni `scan` no detecta nada y se marca', () => {
    assert.deepEqual(codes([{ id: 'X-2', fixtures: { bad: ['a'], good: ['b'] } }]), ['sin-test']);
    assert.deepEqual(codes([{ id: 'X-3', kind: 'structure', fixtures: { bad: [{}], good: [{}] } }]), ['sin-scan']);
  });

  test('cada hallazgo apunta al archivo de reglas y se puede congelar', () => {
    const [f] = completeness([rule(undefined)]);
    assert.equal(f.file, 'ai/local/rules/antipatterns.js');
    assert.ok(f.message && f.code && f.rule === 'X-1');
  });
});

describe('verify-rules: baseline', () => {
  // Un proyecto que actualiza trae reglas propias sin fixtures: esa deuda se
  // congela y se paga de a una. La huella decide qué se congela, y un error
  // acá silencia hallazgos que nadie quiso silenciar.
  const rule = { id: 'X-1', source: 'ai/local/rules/antipatterns.js', test: () => true };

  test('las dos faltas de una misma regla tienen huellas DISTINTAS', () => {
    const [a, b] = completeness([rule]);
    assert.notEqual(fingerprint(a), fingerprint(b), 'congelar "falta el que marca" no puede silenciar "falta el que no marca"');
  });

  test('el mismo hallazgo da siempre la misma huella (si no, nada queda congelado)', () => {
    assert.equal(fingerprint(completeness([rule])[0]), fingerprint(completeness([rule])[0]));
  });

  test('reglas distintas con la misma falta tienen huellas distintas', () => {
    const [a] = completeness([rule]);
    const [b] = completeness([{ ...rule, id: 'X-2' }]);
    assert.notEqual(fingerprint(a), fingerprint(b));
  });
});

describe('verify-rules: reglas estructurales (fixture = un árbol de archivos)', () => {
  const scanNeedsErrors = (dir) => {
    const fs = require('fs');
    const path = require('path');
    const found = fs.existsSync(path.join(dir, 'src', 'errors.ts')) ? [] : [{ file: 'src', line: 0, code: 'sin errors.ts' }];
    return found;
  };
  const structure = (fixtures, scan = scanNeedsErrors) => ({ id: 'S-1', kind: 'structure', source: 'rules.js', scan, fixtures });

  const BAD = { files: { 'src/a.ts': 'x\n' } };
  const GOOD = { files: { 'src/a.ts': 'x\n', 'src/errors.ts': 'y\n' } };

  test('un árbol malo que marca y uno bueno que no: sin problemas', () => {
    assert.deepEqual(structureBehavior([structure({ bad: [BAD], good: [GOOD] })]), []);
  });

  test('el árbol malo que NO marca se reporta', () => {
    const problems = structureBehavior([structure({ bad: [GOOD], good: [GOOD] })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /NO marca el fixture `bad\[0\]`/);
  });

  test('el árbol bueno que marca se reporta', () => {
    const problems = structureBehavior([structure({ bad: [BAD], good: [BAD] })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /Marca el fixture `good\[0\]`/);
  });

  test('un `scan` que lanza se reporta, no tumba la verificación', () => {
    const boom = () => {
      throw new Error('boom');
    };
    const problems = structureBehavior([structure({ bad: [BAD], good: [GOOD] }, boom)]);
    assert.equal(problems.length, 2);
    assert.match(problems[0].message, /boom/);
  });

  test('los fixtures que se proponen para NEST-2.1 funcionan con la regla real del pack', () => {
    const rules = require(`${ROOT}/ai/packs/nestjs/rules/antipatterns.js`);
    const real = rules.find((r) => r.id === 'NEST-2.1');
    const proposed = {
      ...real,
      source: 'ai/packs/nestjs/rules/antipatterns.js',
      fixtures: {
        bad: [{ files: { 'src/modules/pagos/pagos.service.ts': 'export class PagosService {}\n' } }],
        good: [
          {
            files: {
              'src/modules/pagos/pagos.service.ts': 'export class PagosService {}\n',
              'src/modules/pagos/errors/pagos.error-codes.ts': 'export const PAGO_RECHAZADO = 1;\n',
            },
          },
        ],
      },
    };
    assert.deepEqual(completeness([proposed]), []);
    assert.deepEqual(structureBehavior([proposed]), []);
  });
});

describe('verify-rules: el comando, sobre las reglas reales de la base', () => {
  test('dotnet-repo: todas las reglas activas traen los dos lados y se comportan', { skip: packsMissing(['dotnet']) }, () => {
    const { code, findings } = runGate(SCRIPT, ['--repo', 'dotnet-repo']);
    assert.equal(code, 0, JSON.stringify(findings));
    assert.deepEqual(findings, []);
  });

  test('js-repo: lo único que puede marcar es una regla estructural sin fixtures de árbol', () => {
    const { code, findings } = runGate(SCRIPT, ['--repo', 'js-repo']);
    // Hoy NEST-2.1 (estructural) no declara `fixtures`: el gate lo dice, que es su trabajo.
    // Cuando el pack los declare, esto es 0.
    assert.ok(code === 0 || code === 1, `código ${code}`);
    assert.deepEqual(rulesOf(findings).filter((r) => r !== 'NEST-2.1'), []);
  });

  test('un repositorio sin clonar sale con 2 y stdout vacío', () => {
    const { code, stdout } = runGate(SCRIPT, ['--repo', 'missing-repo']);
    assert.equal(code, 2);
    assert.equal(stdout.trim(), '');
  });

  test('sin --repo sale con 2', () => {
    const { code } = runGate(SCRIPT, []);
    assert.equal(code, 2);
  });
});
