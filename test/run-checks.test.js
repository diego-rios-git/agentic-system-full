#!/usr/bin/env node
/**
 * run-checks.test.js — tipos, lint y tests, una vez por repositorio.
 *
 * Los "comandos" son de mentira (`fixtures/checks/check.js`) y se declaran en la
 * configuración como los declararía un proyecto: lo que se prueba es qué hace el
 * orquestador con cada desenlace. Lo central es que NINGÚN estado distinto de
 * "corrió y salió con 0" se lea como verde: no declarado, no aplica, binario
 * ausente, timeout y artefactos de build son todos "sin verificar".
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./helpers');
const { withWorkspace } = require('./workspace-helper');
const runChecks = require('../scripts/run-checks');

const CHECK = path.join(ROOT, 'test', 'fixtures', 'checks', 'check.js');
const cmd = (mode, ...rest) => `node "${CHECK}" ${mode}${rest.length ? ` ${rest.join(' ')}` : ''}`;

const LANGUAGE = { id: 'ts-test', extensions: ['.ts'], testPatterns: ['\\.test\\.ts$'] };
const FILES = { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'docs/leeme.md': '# x\n' };

const repoSpec = (extra = {}, name = 'api') => ({ name, files: FILES, extra: { language: LANGUAGE, ...extra } });

const run = (ws, args, env = {}) =>
  ws.run('scripts/run-checks.js', args, { env: { AI_CHECK_TIMEOUT_MS: '3000', ...env } });

const statusOf = (r, repo = 'api') => Object.fromEntries(r.json.find((b) => b.repo === repo).checks.map((c) => [c.id, c]));

describe('run-checks: qué corre', () => {
  test('todo declarado y sano: OK, exit 0, y cada check corrió con lo que el repositorio declara', () => {
    withWorkspace(
      {
        repos: [
          repoSpec({
            typecheckCommand: cmd('ok'),
            typecheckTestCommand: cmd('ok'),
            lintCommand: cmd('ok'),
            testCommand: cmd('ok'),
          }),
        ],
      },
      (ws) => {
        const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
        assert.equal(r.code, 0, r.stderr);
        const s = statusOf(r);
        assert.deepEqual(Object.keys(s), ['typecheck', 'typecheck-tests', 'lint', 'tests']);
        for (const c of Object.values(s)) {
          assert.equal(c.status, 'ok');
          assert.equal(c.ok, true);
        }
      },
    );
  });

  test('un check que falla es FALLA, sale 1 y el resumen trae lo que falló, no la salida entera', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('fail') })] }, (ws) => {
      const json = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(json.code, 1);
      assert.equal(statusOf(json).tests.status, 'fail');
      assert.equal(statusOf(json).tests.exitCode, 1);

      const text = run(ws, ['--repo', 'api', '--scope', 'full']);
      assert.match(text.stdout, /FALLA — Tests/);
      assert.match(text.stdout, /Tests: 1 failed, 3 passed, 4 total/);
      assert.match(text.stdout, /FAIL src\/a\.test\.ts/);
    });
  });

  test('comando ausente de la configuración: NO DECLARADO, nunca verde', () => {
    withWorkspace({ repos: [repoSpec({ typecheckCommand: cmd('ok') })] }, (ws) => {
      const json = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      const s = statusOf(json);
      assert.equal(s.typecheck.status, 'ok');
      assert.equal(s.lint.status, 'undeclared');
      assert.equal(s.lint.ok, false);
      assert.equal(s.tests.status, 'undeclared');
      assert.equal(json.code, 0, 'algo corrió y salió limpio');

      const text = run(ws, ['--repo', 'api', '--scope', 'full']);
      assert.match(text.stdout, /NO DECLARADO — Lint/);
      assert.match(text.stdout, /sin verificar/);
      const ok = /OK sin hallazgos:[^\n]*/.exec(text.stdout)[0];
      assert.doesNotMatch(ok, /Lint|Tests/);
    });
  });

  test('un repositorio que no declara NADA: exit 1, no se verificó nada', () => {
    withWorkspace({ repos: [repoSpec()] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(r.code, 1);
      for (const c of Object.values(statusOf(r))) assert.equal(c.status, 'undeclared');
    });
  });

  test('binario ausente: NO SE PUDO EJECUTAR y exit 1', () => {
    withWorkspace({ repos: [repoSpec({ typecheckCommand: 'programa-que-no-existe-xyz --noEmit' })] }, (ws) => {
      const json = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(statusOf(json).typecheck.status, 'broken');
      assert.equal(json.code, 1);

      const text = run(ws, ['--repo', 'api', '--scope', 'full']);
      assert.match(text.stdout, /NO SE PUDO EJECUTAR — Chequeo de tipos: binario ausente/);
    });
  });

  test('timeout: NO SE PUDO EJECUTAR, y el proceso colgado se da de baja', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('hang') })] }, (ws) => {
      const started = Date.now();
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json'], { AI_CHECK_TIMEOUT_MS: '1500' });
      assert.equal(statusOf(r).tests.status, 'broken');
      assert.match(statusOf(r).tests.note, /tope/);
      assert.equal(r.code, 1);
      assert.ok(Date.now() - started < 20000, 'no esperó al proceso colgado');
    });
  });

  test('un comando con pipe se avisa: puede ocultar el código de salida', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: `${cmd('fail')} | node -e "process.stdin.resume()"` })] }, (ws) => {
      const text = run(ws, ['--repo', 'api', '--scope', 'full']);
      assert.match(text.stdout, /lleva un pipe/);
    });
    assert.equal(runChecks.hasPipe('a | b'), true);
    assert.equal(runChecks.hasPipe('a || b'), false);
    assert.equal(runChecks.hasPipe('echo "a | b"'), false);
  });
});

describe('run-checks: acotado al diff', () => {
  const related = { typecheckCommand: cmd('ok'), testRelatedCommand: cmd('args', '{files}'), lintRelatedCommand: cmd('args', '{files}'), testCommand: cmd('fail'), lintCommand: cmd('fail') };

  test('con cambios de código corre los tests relacionados con {files}, sin los borrados', () => {
    withWorkspace({ repos: [repoSpec(related)] }, (ws) => {
      const log = path.join(ws.dir, 'checks.log');
      ws.write('api', 'src/a.ts', 'a2\n');
      ws.write('api', 'src/nuevo.ts', 'n\n');
      ws.remove('api', 'src/b.ts'); // borrado: un runner que lo recibe falla entero
      ws.write('api', 'docs/leeme.md', '# y\n');

      const r = run(ws, ['--repo', 'api', '--json'], { CHECK_LOG: log });
      assert.equal(r.code, 0, r.stdout + r.stderr);

      const runs = fs
        .readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((x) => x.mode === 'args'); // el chequeo de tipos corre sin archivos
      assert.equal(runs.length, 2, 'lint y tests acotados; el completo no corre');
      for (const x of runs) {
        assert.deepEqual([...x.args].sort(), ['src/a.ts', 'src/nuevo.ts'], 'solo código, sin el borrado ni el .md');
      }
    });
  });

  test('si la rama no toca código, los tests son NO APLICA (y no corre la suite entera)', () => {
    withWorkspace({ repos: [repoSpec(related)] }, (ws) => {
      const log = path.join(ws.dir, 'checks.log');
      ws.write('api', 'docs/leeme.md', '# solo documentación\n');

      const json = run(ws, ['--repo', 'api', '--json'], { CHECK_LOG: log });
      assert.equal(statusOf(json).tests.status, 'na');
      assert.equal(statusOf(json).tests.ok, false, 'NO APLICA no es verde');
      assert.equal(statusOf(json).lint.status, 'na');
      const ran = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).mode);
      assert.deepEqual(ran, ['ok'], 'solo corrió el chequeo de tipos: ni lint ni tests, ni acotados ni completos');
      assert.equal(json.code, 0);

      const text = run(ws, ['--repo', 'api']);
      assert.match(text.stdout, /NO APLICA — Tests: la rama no toca archivos de código/);
    });
  });

  test('--scope full ignora el diff y corre los comandos completos', () => {
    withWorkspace({ repos: [repoSpec(related)] }, (ws) => {
      ws.write('api', 'src/a.ts', 'a2\n');
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(statusOf(r).tests.status, 'fail', 'corrió testCommand, que falla');
      assert.equal(statusOf(r).lint.status, 'fail');
    });
  });

  test('sin testRelatedCommand corre la suite completa y lo dice', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('ok') })] }, (ws) => {
      ws.write('api', 'src/a.ts', 'a2\n');
      const r = run(ws, ['--repo', 'api', '--json']);
      assert.equal(statusOf(r).tests.status, 'ok');
      assert.match(statusOf(r).tests.note, /testRelatedCommand/);
    });
  });

  test('diff ilegible: corre completo y lo dice, no inventa un subconjunto', () => {
    withWorkspace({ repos: [repoSpec(related)] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--base', 'origin/no-existe', '--json']);
      assert.equal(statusOf(r).tests.status, 'fail', 'corrió testCommand completo');
      assert.match(statusOf(r).tests.note, /no se pudo leer el diff/);
    });
  });
});

describe('run-checks: artefactos de build en el chequeo de tipos', () => {
  const artifacts = ['.next/'];

  test('si TODOS los errores son de artefactos: NO SE PUDO EJECUTAR (el código no se miró), nunca verde', () => {
    withWorkspace({ repos: [repoSpec({ typecheckCommand: cmd('artifacts'), artifactPaths: artifacts })] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(statusOf(r).typecheck.status, 'broken');
      assert.match(statusOf(r).typecheck.note, /artefactos de build/);
      assert.equal(r.code, 1);
    });
  });

  test('con un error real mezclado: FALLA', () => {
    withWorkspace({ repos: [repoSpec({ typecheckCommand: cmd('mixed'), artifactPaths: artifacts })] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(statusOf(r).typecheck.status, 'fail');
      assert.match(statusOf(r).typecheck.summary.join('\n'), /TS2322/);
    });
  });

  test('sin `artifactPaths` declarado, los mismos errores son una falla común', () => {
    withWorkspace({ repos: [repoSpec({ typecheckCommand: cmd('artifacts') })] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--scope', 'full', '--json']);
      assert.equal(statusOf(r).typecheck.status, 'fail');
    });
  });
});

describe('run-checks: dónde y con qué tope', () => {
  test('--from <slot> corre en el directorio del slot; un slot sin el repo sale con 2', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('ok') })] }, (ws) => {
      const log = path.join(ws.dir, 'checks.log');
      const miss = run(ws, ['--repo', 'api', '--from', 'review', '--scope', 'full', '--json']);
      assert.equal(miss.code, 2, 'nunca cae a la principal');

      ws.openSlot('api', 'review');
      const r = run(ws, ['--repo', 'api', '--from', 'review', '--scope', 'full', '--json'], { CHECK_LOG: log });
      assert.equal(r.code, 0, r.stderr);
      const ran = JSON.parse(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)[0]);
      assert.equal(path.resolve(ran.cwd).toLowerCase(), path.resolve(ws.slotDir('api', 'review')).toLowerCase());
    });
  });

  test('repositorio ausente o uso incorrecto: exit 2', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('ok') })] }, (ws) => {
      const cfg = JSON.parse(fs.readFileSync(ws.cfgPath, 'utf8'));
      cfg.repos.push({ name: 'ghost', path: `${ws.relDir}/ghost`, packs: [], baseBranch: 'main' });
      fs.writeFileSync(ws.cfgPath, JSON.stringify(cfg));

      assert.equal(run(ws, ['--repo', 'ghost', '--json']).code, 2);
      assert.equal(run(ws, ['--json']).code, 2);
      assert.equal(run(ws, ['--repo', 'api', '--scope', 'otro']).code, 2);
    });
  });

  test('los repositorios van en paralelo con tope, y --serial los pone de a uno', () => {
    const repos = ['a', 'b', 'c'].map((n) => repoSpec({ testCommand: cmd('sleep') }, n));
    withWorkspace({ repos }, (ws) => {
      const overlaps = (runs) => runs.some((x, i) => runs.some((y, j) => i !== j && x.t0 < y.t1 && y.t0 < x.t1));
      const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

      const logSerial = path.join(ws.dir, 'serial.log');
      const serial = run(ws, ['--all', '--scope', 'full', '--serial', '--json'], { CHECK_LOG: logSerial });
      assert.equal(serial.code, 0, serial.stderr);
      assert.equal(read(logSerial).length, 3);
      assert.equal(overlaps(read(logSerial)), false, '--serial: ninguno se superpone');

      const logPar = path.join(ws.dir, 'par.log');
      const par = run(ws, ['--all', '--scope', 'full', '--json'], { CHECK_LOG: logPar });
      assert.equal(par.code, 0, par.stderr);
      assert.equal(overlaps(read(logPar)), true, 'por defecto hay paralelismo');

      // El tope: nunca más de 2 a la vez con el valor por defecto.
      const runs = read(logPar);
      const maxAtOnce = Math.max(...runs.map((x) => runs.filter((y) => y.t0 <= x.t0 && x.t0 < y.t1).length));
      assert.ok(maxAtOnce <= 2, `a la vez: ${maxAtOnce}`);
    });
  });

  test('el progreso va por stderr y el reporte por stdout', () => {
    withWorkspace({ repos: [repoSpec({ testCommand: cmd('ok') })] }, (ws) => {
      const r = run(ws, ['--repo', 'api', '--scope', 'full']);
      assert.match(r.stderr, /▶ api: Tests/);
      assert.match(r.stdout, /## Checks — api/);
      assert.doesNotMatch(r.stdout, /▶/);
    });
  });
});
