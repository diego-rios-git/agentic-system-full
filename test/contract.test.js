#!/usr/bin/env node
/**
 * contract.test.js — el contrato que todo gate debe cumplir, sea cual sea.
 *
 * Los tests de `gates.test.js` verifican que cada gate encuentre lo suyo. Estos
 * verifican lo otro: que **ninguno mienta sobre si pudo verificar**.
 *
 * Se recorren los gates declarados en los manifiestos, no una lista escrita
 * acá. Un gate nuevo —de un pack, del núcleo, del proyecto— queda sujeto al
 * contrato el día que se declara, sin que nadie se acuerde de agregarlo.
 *
 * El contrato:
 *
 *   0  se verificó y no hay hallazgos
 *   1  se verificó y hay hallazgos, listados en stdout como JSON
 *   2  NO se pudo verificar — y entonces stdout queda vacío
 *
 * La tercera línea es la que se olvida. Un gate que sale con 0 sin haber
 * corrido, o que emite `[]` cuando no pudo, produce exactamente lo que esta
 * base entera existe para evitar: confianza donde no hubo verificación.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { ROOT, CONFIG, runGate } = require('./helpers');

/** Los gates declarados por el núcleo y por los packs que el fixture activa. */
function declaredGates() {
  process.env.AI_WORKSPACE_CONFIG = CONFIG;

  // Se cargan con require porque son módulos, no scripts ejecutables.
  const config = require(path.join(ROOT, 'scripts', 'lib', 'workspace-config'));
  const gates = require(path.join(ROOT, 'scripts', 'lib', 'gates'));

  return gates.all(config.load()).filter((g) => g.scriptExists && g.scope === 'repo');
}

describe('contrato de los gates', () => {
  const declarados = declaredGates();

  test('el fixture activa al menos un gate de cada origen', () => {
    assert.ok(declarados.length >= 4, `solo ${declarados.length} gates declarados`);
  });

  for (const gate of declarados) {
    describe(gate.id, () => {
      test('con el repositorio sin clonar sale con 2 y stdout vacío', () => {
        const args = gate.args
          .map((a) => String(a).replace('{repo}', 'missing-repo').replace('{scope}', 'missing-repo'))
          .filter((a) => a !== '--baseline');

        const { code, stdout } = runGate(gate.script, args);

        assert.equal(code, 2, `${gate.id}: un repositorio sin clonar no es un repositorio limpio`);
        assert.equal(
          stdout.trim(),
          '',
          `${gate.id}: en --json, una lista vacía es indistinguible de "sin hallazgos"`,
        );
      });

      test('el código de salida corresponde a lo que emite', () => {
        const args = gate.args
          .map((a) => String(a).replace('{repo}', 'js-repo').replace('{scope}', 'js-repo'))
          .filter((a) => a !== '--baseline');

        const { code, stdout, findings } = runGate(gate.script, args);

        assert.ok([0, 1, 2].includes(code), `${gate.id}: código inesperado ${code}`);

        if (code === 2) {
          assert.equal(stdout.trim(), '', `${gate.id}: código 2 no puede escribir en stdout`);
          return;
        }

        assert.ok(Array.isArray(findings), `${gate.id}: con código ${code} debe emitir una lista JSON`);
        assert.equal(
          code,
          findings.length > 0 ? 1 : 0,
          `${gate.id}: el código no coincide con la cantidad de hallazgos (${findings.length})`,
        );
      });

      test('cada hallazgo trae lo necesario para ubicarlo y congelarlo', () => {
        const args = gate.args
          .map((a) => String(a).replace('{repo}', 'js-repo').replace('{scope}', 'js-repo'))
          .filter((a) => a !== '--baseline');

        const { findings } = runGate(gate.script, args);
        if (!findings || findings.length === 0) return;

        for (const f of findings) {
          assert.ok(f.file, `${gate.id}: un hallazgo sin archivo no se puede ubicar`);
          assert.ok(f.message, `${gate.id}: un hallazgo sin mensaje no dice qué corregir`);
        }

        // Huellas repetidas harían que congelar un hallazgo silenciara otros.
        const huellas = findings.map((f) => `${f.rule}|${f.file}|${f.code || f.hash || ''}`);
        assert.equal(
          new Set(huellas).size,
          huellas.length,
          `${gate.id}: hay hallazgos distintos con la misma huella de baseline`,
        );
      });
    });
  }
});
