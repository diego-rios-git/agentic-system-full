#!/usr/bin/env node
/**
 * cochange.test.js — "quien toca X regenera Y".
 *
 * Contra repositorios de git reales: el gate compara con `origin/main` y mira lo
 * commiteado, lo modificado y lo sin trackear. El caso que dio origen a la regla
 * —un archivo fuente tocado sin regenerar su derivado versionado— es el primero;
 * los demás son lo que tiene que seguir pasando: un gate que marca de más se apaga.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { withWorkspace } = require('./workspace-helper');

const RULE = {
  id: 'lock-1',
  whenTouched: ['package.json'],
  mustAlsoTouch: ['package-lock.json'],
  message: 'Se tocó package.json sin regenerar el lockfile.',
  fixHint: 'Regenerar el lockfile.',
};

const SPEC = {
  repos: [
    {
      name: 'api',
      files: { 'package.json': '{"name":"x"}\n', 'package-lock.json': '{"v":1}\n', 'src/a.js': 'a\n' },
    },
  ],
  config: { coChange: [RULE] },
};

const gate = (ws, args = ['--repo', 'api']) => ws.run('scripts/check-cochange.js', [...args, '--json']);

describe('check-cochange', () => {
  test('marca: se toca la fuente y no el derivado', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'package.json', '{"name":"y"}\n');
      const r = gate(ws);
      assert.equal(r.code, 1, r.stderr);
      assert.equal(r.json.length, 1);
      assert.equal(r.json[0].rule, 'lock-1');
      assert.equal(r.json[0].file, 'package.json');
      assert.match(r.json[0].message, /lockfile/);
    });
  });

  test('no marca: se tocan la fuente y el derivado', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'package.json', '{"name":"y"}\n');
      ws.write('api', 'package-lock.json', '{"v":2}\n');
      const r = gate(ws);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.json, []);
    });
  });

  test('no marca: se toca solo el derivado', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'package-lock.json', '{"v":2}\n');
      assert.equal(gate(ws).code, 0);
    });
  });

  test('no marca: sin diff', () => {
    withWorkspace(SPEC, (ws) => {
      const r = gate(ws);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.json, []);
    });
  });

  test('no marca: se toca otra cosa que no es la fuente', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/a.js', 'b\n');
      assert.equal(gate(ws).code, 0);
    });
  });

  test('cuenta lo ya commiteado en la rama, no solo el working tree', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'package.json', '{"name":"y"}\n');
      ws.commit('api');
      assert.equal(gate(ws).code, 1, 'el cambio commiteado contra origin/main sigue pendiente');

      ws.write('api', 'package-lock.json', '{"v":2}\n');
      ws.commit('api');
      assert.equal(gate(ws).code, 0);
    });
  });

  test('borrar la fuente sin tocar el derivado también marca', () => {
    withWorkspace(SPEC, (ws) => {
      ws.remove('api', 'package.json');
      assert.equal(gate(ws).code, 1);
    });
  });

  test('un archivo nuevo sin trackear cuenta como tocado', () => {
    withWorkspace(
      {
        repos: [{ name: 'api', files: { 'README.md': 'x\n' } }],
        config: { coChange: [{ ...RULE, whenTouched: ['src/**/*.proto'], mustAlsoTouch: ['gen/**'] }] },
      },
      (ws) => {
        ws.write('api', 'src/deep/svc.proto', 'syntax\n');
        assert.equal(gate(ws).code, 1);
        ws.write('api', 'gen/svc.js', 'generado\n');
        assert.equal(gate(ws).code, 0);
      },
    );
  });

  test('funciona desde un slot, y usa el nombre lógico del repositorio', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      // El cambio vive SOLO en el slot: la principal está limpia.
      ws.write('api', 'package.json', '{"name":"principal"}\n');
      ws.git('api', 'checkout', '-q', '--', 'package.json');
      require('fs').writeFileSync(`${ws.slotDir('api', 'review')}/package.json`, '{"name":"slot"}\n');

      assert.equal(gate(ws).code, 0, 'la principal no tiene el cambio');

      const fromSlot = gate(ws, ['--repo', `${ws.relDir}/worktrees/review/api`]);
      assert.equal(fromSlot.code, 1, fromSlot.stderr);
      assert.equal(fromSlot.json[0].rule, 'lock-1');
    });
  });

  test('--repo es obligatorio: no toma otro argumento como nombre y sale con 2', () => {
    withWorkspace(SPEC, (ws) => {
      const r = ws.run('scripts/check-cochange.js', ['--json']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');

      // Con un valor suelto en la posición donde antes se leía el nombre.
      const loose = ws.run('scripts/check-cochange.js', ['api', '--json']);
      assert.equal(loose.code, 2);
      assert.equal(loose.stdout.trim(), '');
    });
  });

  test('base ilegible: sale con 2 y stdout vacío (no se aprueba en silencio)', () => {
    withWorkspace(SPEC, (ws) => {
      const r = gate(ws, ['--repo', 'api', '--base', 'origin/no-existe']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
      assert.match(r.stderr, /diff|base/i);
    });
  });

  test('una regla mal declarada es no verificado, no ausente', () => {
    withWorkspace(
      { ...SPEC, config: { coChange: [{ id: 'x', whenTouched: [], mustAlsoTouch: ['y'], message: 'm' }] } },
      (ws) => {
        const r = gate(ws);
        assert.equal(r.code, 2);
        assert.equal(r.stdout.trim(), '');
      },
    );
  });

  test('las reglas de un repositorio no afectan a otro', () => {
    withWorkspace(
      {
        repos: [
          { name: 'api', files: { 'package.json': '{}\n', 'package-lock.json': '{}\n' }, extra: { coChange: [RULE] } },
          { name: 'web', files: { 'package.json': '{}\n', 'package-lock.json': '{}\n' } },
        ],
      },
      (ws) => {
        ws.write('api', 'package.json', '{"a":1}\n');
        ws.write('web', 'package.json', '{"a":1}\n');
        assert.equal(gate(ws, ['--repo', 'api']).code, 1);
        assert.equal(gate(ws, ['--repo', 'web']).code, 0, 'web no declara la regla');
      },
    );
  });

  test('sin reglas declaradas: sale con 0 y lo dice', () => {
    withWorkspace({ repos: SPEC.repos }, (ws) => {
      ws.write('api', 'package.json', '{"a":1}\n');
      const r = ws.run('scripts/check-cochange.js', ['--repo', 'api']);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /no hay reglas coChange/);
    });
  });
});
