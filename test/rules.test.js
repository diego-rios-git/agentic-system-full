#!/usr/bin/env node
/**
 * rules.test.js — cada regla se comporta como dicen sus fixtures.
 *
 * `gate-from-finding.md` exige un ejemplo que debe marcar y otro que no. Esto
 * es esa exigencia, ejecutada: mientras corra, ninguna regla puede entrar sin
 * fixtures ni quedarse con unos que ya no describen lo que hace.
 *
 * El fixture que **no** debe marcar es el que importa. Una regla probada solo
 * contra código malo no se distingue de una regla que marca todo, y esa es la
 * que enseña al equipo a ignorar los avisos.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runGate } = require('./helpers');

describe('fixtures de las reglas', () => {
  // Cada repositorio del fixture activa un pack distinto, así que entre los
  // tres se recorren todas las reglas que trae la base.
  for (const repo of ['js-repo', 'dotnet-repo', 'empty-repo']) {
    test(`todas las reglas activas en ${repo} pasan sus propios fixtures`, () => {
      const { code, findings } = runGate('scripts/check-antipatterns.js', [
        '--repo', repo, '--validate-rules',
      ]);

      const detalle = (findings || []).map((f) => f.message).join('\n      ');
      assert.equal(code, 0, `hay reglas que no se comportan como declaran:\n      ${detalle}`);
    });
  }

  test('una regla sin fixtures se reporta como problema', () => {
    // Se comprueba con el mecanismo, no con una regla real: agregar una rota al
    // repositorio para probar esto dejaría el gate en rojo para todo el mundo.
    const { validateRules } = requireGateModule();

    const problemas = validateRules(
      [{ id: 'X-1', test: () => false }],
      () => [],
    );
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /no declara fixtures/);
  });

  test('una regla que no marca su propio caso malo se reporta', () => {
    const { validateRules } = requireGateModule();

    const problemas = validateRules(
      [{ id: 'X-2', test: () => false, fixtures: { bad: ['esto deberia marcar'] } }],
      () => [],
    );
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /NO marca un caso que debería marcar/);
  });

  test('una regla que marca su propio caso correcto se reporta', () => {
    const { validateRules } = requireGateModule();

    const problemas = validateRules(
      [{ id: 'X-3', test: () => true, fixtures: { good: ['esto no deberia marcar'] } }],
      () => [],
    );
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /marca un caso correcto/);
  });
});

/**
 * `check-antipatterns.js` es un script ejecutable: correr `require` sobre él
 * dispararía su `main()`. Se lee el archivo y se evalúa solo lo que hace falta.
 */
function requireGateModule() {
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./helpers');

  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'check-antipatterns.js'), 'utf8');
  const desde = src.indexOf('function validateRules(');
  const hasta = src.indexOf('// ------', desde);
  assert.ok(desde > 0 && hasta > desde, 'no se encontró validateRules en el gate');

  // eslint-disable-next-line no-new-func
  return { validateRules: new Function(`${src.slice(desde, hasta)}; return validateRules;`)() };
}
