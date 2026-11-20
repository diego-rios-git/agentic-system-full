#!/usr/bin/env node
/**
 * review-base.test.js — contra qué se compara un cambio.
 *
 * El caso que motivó el respaldo: un repositorio recién creado, sin remoto,
 * dejaba todo gate que compara contra la base en "no se pudo verificar" para
 * siempre. Y el caso opuesto, que NO debe cambiar: con un remoto configurado,
 * una base local es justo la que se queda atrás, y el camino es `git fetch`.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { withTempDir } = require('./helpers');
const reviewBase = require('../scripts/lib/review-base');

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Un repositorio con un commit en la rama `main`. */
function repoIn(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const REPO = { name: 'api', baseBranch: 'main' };

describe('review-base: baseFor', () => {
  test('sin remoto configurado y con la rama local: compara contra la local', () => {
    withTempDir((tmp) => {
      const dir = repoIn(path.join(tmp, 'r'));
      assert.equal(reviewBase.baseFor(REPO, undefined, dir), 'main');
    });
  });

  test('con remoto configurado pero sin la referencia: sigue pidiendo origin/<base> (el camino es `git fetch`)', () => {
    withTempDir((tmp) => {
      const dir = repoIn(path.join(tmp, 'r'));
      git(dir, 'remote', 'add', 'origin', path.join(tmp, 'no-existe.git'));
      assert.equal(reviewBase.baseFor(REPO, undefined, dir), 'origin/main');
    });
  });

  test('con el remoto y la referencia: usa origin/<base>, no la local', () => {
    withTempDir((tmp) => {
      const bare = path.join(tmp, 'remoto.git');
      fs.mkdirSync(bare);
      git(bare, 'init', '-q', '--bare', '-b', 'main');
      const dir = repoIn(path.join(tmp, 'r'));
      git(dir, 'remote', 'add', 'origin', bare);
      git(dir, 'push', '-q', 'origin', 'main');
      git(dir, 'fetch', '-q', 'origin');
      assert.equal(reviewBase.baseFor(REPO, undefined, dir), 'origin/main');
    });
  });

  test('una base pedida explícitamente gana siempre', () => {
    withTempDir((tmp) => {
      const dir = repoIn(path.join(tmp, 'r'));
      assert.equal(reviewBase.baseFor(REPO, 'otra-rama', dir), 'otra-rama');
    });
  });

  test('sin remoto y SIN la rama local: no inventa una base', () => {
    withTempDir((tmp) => {
      const dir = repoIn(path.join(tmp, 'r'));
      git(dir, 'branch', '-m', 'trunk'); // ya no existe `main`
      assert.equal(reviewBase.baseFor(REPO, undefined, dir), 'origin/main');
    });
  });

  test('sin el directorio, el comportamiento de siempre', () => {
    assert.equal(reviewBase.baseFor(REPO), 'origin/main');
  });

  test('el diff contra la base local de un repo sin remoto se puede leer', () => {
    withTempDir((tmp) => {
      const dir = repoIn(path.join(tmp, 'r'));
      git(dir, 'checkout', '-q', '-b', 'feat');
      fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'b');

      const diff = reviewBase.diffFiles(dir, reviewBase.baseFor(REPO, undefined, dir));
      assert.ok(diff, 'antes salía null: "no se pudo leer el diff"');
      assert.deepEqual([...diff.added], ['b.txt']);
    });
  });
});
