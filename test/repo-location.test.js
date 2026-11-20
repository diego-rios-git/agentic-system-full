#!/usr/bin/env node
/**
 * repo-location.test.js — `--repo` como nombre lógico o como ruta de un slot, y
 * la base contra la que se mide una rama.
 *
 * Lo que se protege:
 *   - Una revisión en un slot audita el slot, no la rama que esté checkouteada en
 *     la principal (el defecto era que el resultado salía igual de prolijo).
 *   - Los hallazgos y el baseline usan el nombre LÓGICO: con la ruta del slot en
 *     la huella, toda la deuda congelada saldría como nueva.
 *   - `--write-baseline` desde un slot es un error: perdonaría para siempre la
 *     deuda de una rama sin mergear.
 *   - La base es `origin/<baseBranch>`, nunca un nombre fijo; los avisos van por
 *     stderr y nunca ensucian el JSON de stdout.
 *   - El diff incluye commiteado + working tree + sin trackear.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { withWorkspace } = require('./workspace-helper');
const reviewBase = require('../scripts/lib/review-base');

// "ó" mal codificada: a propósito, como escapes, para que este archivo no tenga el defecto.
const MOJIBAKE = `diagn${String.fromCharCode(0xc3, 0xb3)}stico`;

const SPEC = {
  repos: [{ name: 'api', files: { 'src/ok.js': 'ok\n', 'src/viejo.js': `// ${MOJIBAKE}\n` } }],
};

describe('--repo: nombre lógico o ruta de un slot', () => {
  test('desde un slot lee el código del slot, no el de la principal', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      // El defecto existe SOLO en el slot.
      fs.writeFileSync(path.join(ws.slotDir('api', 'review'), 'src', 'nuevo.js'), `// ${MOJIBAKE}\n`);

      const main = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--json']);
      const slot = ws.run('scripts/check-encoding.js', ['--repo', `${ws.relDir}/worktrees/review/api`, '--json']);

      assert.deepEqual(main.json.map((f) => f.file), ['src/viejo.js']);
      assert.deepEqual(slot.json.map((f) => f.file).sort(), ['src/nuevo.js', 'src/viejo.js']);
    });
  });

  test('el baseline congelado en la principal se aplica al leer desde el slot (nombre lógico)', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      const write = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--write-baseline']);
      assert.equal(write.code, 0, write.stderr);

      const slotArg = `${ws.relDir}/worktrees/review/api`;
      const slot = ws.run('scripts/check-encoding.js', ['--repo', slotArg, '--baseline', '--json']);
      assert.equal(slot.code, 0, 'la deuda ya congelada no vuelve a salir por leerla desde el slot');
      assert.deepEqual(slot.json, []);

      // Y lo nuevo del slot sí sale.
      fs.writeFileSync(path.join(ws.slotDir('api', 'review'), 'src', 'nuevo.js'), `// ${MOJIBAKE}\n`);
      const nuevo = ws.run('scripts/check-encoding.js', ['--repo', slotArg, '--baseline', '--json']);
      assert.equal(nuevo.code, 1);
      assert.deepEqual(nuevo.json.map((f) => f.file), ['src/nuevo.js']);
    });
  });

  test('--write-baseline desde un slot sale con 2 y no escribe nada', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      const r = ws.run('scripts/check-encoding.js', ['--repo', `${ws.relDir}/worktrees/review/api`, '--write-baseline']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /slot/);
      assert.equal(fs.existsSync(path.join(ws.dir, '.encoding-baseline.json')), false);
    });
  });

  test('un slot que no trae ese repositorio sale con 2: no cae a la principal', () => {
    withWorkspace(SPEC, (ws) => {
      const r = ws.run('scripts/check-encoding.js', ['--repo', `${ws.relDir}/worktrees/review/api`, '--json']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('un repositorio que no existe sale con 2 y stdout vacío', () => {
    withWorkspace(SPEC, (ws) => {
      const r = ws.run('scripts/check-encoding.js', ['--repo', 'no-existe', '--json']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });
});

describe('base de comparación', () => {
  test('sale de repos[].baseBranch, no de un nombre escrito en el código', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'package.json': '{}\n' }, extra: { baseBranch: 'trunk' } }], config: {
        coChange: [{ id: 'r', whenTouched: ['package.json'], mustAlsoTouch: ['lock'], message: 'm' }],
      } },
      (ws) => {
        ws.write('api', 'package.json', '{"a":1}\n');

        // Solo existe origin/main: la base de este repo es origin/trunk, y no está.
        const sinBase = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--json']);
        assert.equal(sinBase.code, 2);
        assert.match(sinBase.stderr, /origin\/trunk/);

        ws.git('api', 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
        const conBase = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--json']);
        assert.equal(conBase.code, 1, conBase.stderr);
      },
    );
  });

  test('una base local atrasada avisa por stderr y deja el JSON de stdout intacto', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'package.json': '{}\n' } }], config: {
        coChange: [{ id: 'r', whenTouched: ['package.json'], mustAlsoTouch: ['lock'], message: 'm' }],
      } },
      (ws) => {
        const viejo = ws.git('api', 'rev-parse', 'HEAD').trim();
        ws.write('api', 'otro.txt', 'x\n');
        ws.commit('api', 'avance de la base');
        ws.git('api', 'update-ref', 'refs/remotes/origin/main', 'HEAD');
        ws.git('api', 'reset', '-q', '--hard', viejo); // main local queda atrás del remoto

        const r = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--base', 'main', '--json']);
        assert.match(r.stderr, /atrás de `origin\/main`/);
        assert.deepEqual(r.json, [], 'stdout sigue siendo JSON puro');

        const ok = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--json']);
        assert.doesNotMatch(ok.stderr, /atrás/);
      },
    );
  });

  test('un diff con lo ya mergeado se evita usando origin/<base> y no la rama local', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'package.json': '{}\n', 'lock': '{}\n' } }], config: {
        coChange: [{ id: 'r', whenTouched: ['package.json'], mustAlsoTouch: ['lock'], message: 'm' }],
      } },
      (ws) => {
        const viejo = ws.git('api', 'rev-parse', 'HEAD').trim();
        // Un ticket ya mergeado: tocó package.json y llegó a la base remota.
        ws.write('api', 'package.json', '{"mergeado":1}\n');
        ws.commit('api', 'ticket mergeado');
        ws.git('api', 'update-ref', 'refs/remotes/origin/main', 'HEAD');
        ws.git('api', 'reset', '-q', '--hard', viejo); // el main local no se actualizó
        ws.git('api', 'checkout', '-q', '-b', 'mi-rama');
        ws.git('api', 'merge', '-q', '--no-edit', 'origin/main');
        ws.write('api', 'solo-mio.txt', 'x\n');

        // Contra el main local atrasado, el ticket mergeado se cuela en el diff.
        const local = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--base', 'main', '--json']);
        assert.equal(local.code, 1, 'con la base atrasada, lo ajeno aparece como del cambio');

        const remota = ws.run('scripts/check-cochange.js', ['--repo', 'api', '--json']);
        assert.equal(remota.code, 0, remota.stderr);
      },
    );
  });
});

describe('diffFiles: commiteado + working tree + sin trackear', () => {
  test('clasifica agregados, modificados y borrados, y combina las tres fuentes', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'a.txt': '1\n', 'b.txt': '1\n', 'c.txt': '1\n', 'd.txt': '1\n' } }] },
      (ws) => {
        const dir = ws.repoDir('api');

        // Commiteado en la rama: agrega e.txt, modifica a.txt.
        ws.write('api', 'e.txt', 'nuevo\n');
        ws.write('api', 'a.txt', '2\n');
        ws.commit('api');
        // Sin commitear: modifica b.txt, borra c.txt, y vuelve a tocar e.txt (sigue siendo nuevo).
        ws.write('api', 'b.txt', '2\n');
        ws.remove('api', 'c.txt');
        ws.write('api', 'e.txt', 'nuevo 2\n');
        // Sin trackear: f.txt.
        ws.write('api', 'f.txt', 'x\n');

        const diff = reviewBase.diffFiles(dir, 'origin/main');
        assert.deepEqual([...diff.added].sort(), ['e.txt', 'f.txt']);
        assert.deepEqual([...diff.modified].sort(), ['a.txt', 'b.txt']);
        assert.deepEqual([...diff.deleted], ['c.txt']);
        assert.equal(diff.files.has('d.txt'), false);

        const committed = reviewBase.diffFiles(dir, 'origin/main', { committedOnly: true });
        assert.deepEqual([...committed.files].sort(), ['a.txt', 'e.txt']);
      },
    );
  });

  test('antes de commitear, base...HEAD sola daría vacío; el diff por defecto no', () => {
    withWorkspace({ repos: [{ name: 'api', files: { 'a.txt': '1\n' } }] }, (ws) => {
      ws.write('api', 'a.txt', '2\n');
      const dir = ws.repoDir('api');
      assert.equal(reviewBase.diffFiles(dir, 'origin/main', { committedOnly: true }).files.size, 0);
      assert.deepEqual([...reviewBase.diffFiles(dir, 'origin/main').files], ['a.txt']);
    });
  });

  test('una base que no existe devuelve null: quien consume decide, no se inventa un diff vacío', () => {
    withWorkspace({ repos: [{ name: 'api' }] }, (ws) => {
      assert.equal(reviewBase.diffFiles(ws.repoDir('api'), 'origin/no-existe'), null);
    });
  });

  test('un archivo agregado y borrado antes de commitear no aparece', () => {
    withWorkspace({ repos: [{ name: 'api' }] }, (ws) => {
      ws.write('api', 'x.txt', '1\n');
      ws.commit('api');
      ws.remove('api', 'x.txt');
      const diff = reviewBase.diffFiles(ws.repoDir('api'), 'origin/main');
      assert.equal(diff.files.has('x.txt'), false);
    });
  });
});
