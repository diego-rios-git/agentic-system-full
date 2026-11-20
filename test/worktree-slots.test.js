#!/usr/bin/env node
/**
 * Slots de worktree (`scripts/manage-worktree.js`) contra git de verdad.
 *
 * Cada prueba arma un workspace temporal con dos repositorios, remotos locales
 * bare, y corre el script REAL en un proceso aparte (ver test/slot-workspace.js).
 * Cada regla del script nació de un incidente; hay una prueba por regla, y por
 * cada guarda hay un caso que tiene que PASAR y otro que tiene que CORTAR: una
 * guarda que corta de más se desactiva a la semana.
 *
 * Las pruebas que necesitan un enlace de directorio se omiten, con el motivo a
 * la vista, si el entorno no permite crearlo (nunca pasan en falso).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const link = require('../scripts/lib/deps-link');
const { buildWorkspace, LINK_SKIP, git, write } = require('./slot-workspace');
const { switchPrincipalBranch } = require('../scripts/manage-worktree');

const out = (r) => `${r.stdout}\n${r.stderr}`;

// ---------------------------------------------------------------------------
// Flujo completo
// ---------------------------------------------------------------------------

test('flujo: open → commit en el slot → promote → release', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    const slotApi = w.slotDir('implementation-1', 'api');
    const binBefore = w.binCount();

    const open = w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/uno']);
    assert.strictEqual(open.code, 0, out(open));
    assert.strictEqual(w.branch(slotApi), 'feat/uno');
    assert.strictEqual(w.branch(w.api), 'main', 'la principal no se movió');
    assert.ok(link.isLink(path.join(slotApi, 'node_modules')), 'el pack declara el enlace y el lockfile coincide');

    // Manifiesto del slot: slot, kind, createdAt, repos.
    const manifest = JSON.parse(fs.readFileSync(path.join(w.ws, 'worktrees', 'implementation-1', '.ai-worktree.json'), 'utf8'));
    assert.strictEqual(manifest.slot, 'implementation-1');
    assert.strictEqual(manifest.kind, 'implementation');
    assert.deepStrictEqual(manifest.repos, ['api']);
    assert.ok(manifest.createdAt);

    // Trabajo en el slot: código, una migración generada (no corrida) y un lockfile nuevo.
    w.commit(slotApi, 'src/feature.ts', 'export const f = 1;\n');
    w.commit(slotApi, 'src/migrations/001-nueva.ts', '// migracion\n');
    w.commit(slotApi, 'package-lock.json', '{"lockfileVersion":3,"v":2}\n');
    git(slotApi, ['push', '-u', 'origin', 'feat/uno', '--quiet']);

    const promote = w.manage(['promote', '--slot', 'implementation-1']);
    assert.strictEqual(promote.code, 0, out(promote));
    assert.strictEqual(w.branch(w.api), 'feat/uno', 'la principal pasó a la rama');
    assert.ok(!fs.existsSync(slotApi), 'el slot quedó libre');
    assert.ok(!fs.existsSync(path.join(w.ws, 'worktrees', 'implementation-1')), 'y sin manifiesto ni carpeta');
    assert.strictEqual(w.binCount(), binBefore, 'el node_modules del principal sigue entero');
    assert.match(promote.stdout, /package-lock\.json cambió/, 'avisa que el lockfile cambió (reinstalar en la principal)');
    assert.match(promote.stdout, /1 migración\(es\) nueva\(s\)/, 'avisa de las migraciones nuevas');
    assert.ok(!fs.existsSync(path.join(w.api, 'src', 'migrations', 'ejecutada')), 'no corrió nada');

    const release = w.manage(['release', '--repo', 'api']);
    assert.strictEqual(release.code, 0, out(release));
    assert.strictEqual(w.branch(w.api), 'main', 'la principal volvió a la base');
    assert.strictEqual(w.binCount(), binBefore);
  } finally {
    w.cleanup();
  }
});

test('release hace fast-forward a origin/<base> y avisa de lo que entró', () => {
  const w = buildWorkspace();
  try {
    w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'feat/dos']);
    const slot = w.slotDir('implementation-1', 'web');
    w.commit(slot, 'nuevo.txt', 'x');
    git(slot, ['push', '-u', 'origin', 'feat/dos', '--quiet']);
    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']).code, 0);

    // Otra persona avanza la base mientras la principal está en la rama.
    const other = w.pushOtherBranch('web', 'tmp-base');
    git(other, ['push', 'origin', 'tmp-base:main', '--quiet']);

    const r = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(r.code, 0, out(r));
    assert.ok(fs.existsSync(path.join(w.web, 'other.txt')), 'la base se actualizó con ff-only');
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

test('open --no-track: la rama nueva nace SIN upstream aunque git quiera ponerle uno', () => {
  const w = buildWorkspace();
  try {
    // Control: la configuración que causó el incidente. Con `autoSetupMerge`, un
    // `worktree add -b` desde `origin/main` SÍ le pone upstream. Sin este control
    // la prueba pasaría aunque `--no-track` no estuviera.
    git(w.api, ['config', 'branch.autoSetupMerge', 'always']);
    git(w.api, ['worktree', 'add', '-b', 'control', path.join(w.tmp, 'control-wt'), 'origin/main']);
    assert.strictEqual(w.upstream(w.api, 'control'), 'origin/main', 'precondición: sin --no-track la rama hereda la base como upstream');
    git(w.api, ['worktree', 'remove', path.join(w.tmp, 'control-wt')]);

    const r = w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/sin-upstream']);
    assert.strictEqual(r.code, 0, out(r));
    assert.strictEqual(w.upstream(w.api, 'feat/sin-upstream'), '', 'upstream VACÍO');
    assert.match(r.stdout, /sin upstream/);
  } finally {
    w.cleanup();
  }
});

test('open: rama local existente → worktree add; rama solo en el remoto → la sigue', () => {
  const w = buildWorkspace();
  try {
    git(w.web, ['branch', 'local-existente']);
    const a = w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'local-existente']);
    assert.strictEqual(a.code, 0, out(a));
    assert.strictEqual(w.branch(w.slotDir('implementation-1', 'web')), 'local-existente', 'rama checkouteada, no desprendido');

    w.pushOtherBranch('web', 'feat/remota');
    const b = w.manage(['open', '--slot', 'implementation-2', '--repo', 'web', '--branch', 'feat/remota']);
    assert.strictEqual(b.code, 0, out(b));
    assert.strictEqual(w.upstream(w.web, 'feat/remota'), 'origin/feat/remota', 'una rama que ya existe en el remoto SÍ sigue a la suya');
    assert.ok(fs.existsSync(path.join(w.slotDir('implementation-2', 'web'), 'other.txt')));
  } finally {
    w.cleanup();
  }
});

test('open: un slot de implementación ocupado se niega; slot desconocido, falta de rama y --force son error de uso', () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'a']).code, 0);
    const again = w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'b']);
    assert.strictEqual(again.code, 1);
    assert.match(again.stderr, /ya está ocupado/);
    assert.strictEqual(w.branch(w.slotDir('implementation-1', 'web')), 'a', 'no se tocó');

    assert.strictEqual(w.manage(['open', '--slot', 'nope', '--repo', 'web', '--branch', 'x']).code, 2);
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-2', '--repo', 'web']).code, 2, 'falta --branch');
    const noBranchReview = w.manage(['open', '--slot', 'review', '--repo', 'web']);
    assert.strictEqual(noBranchReview.code, 2);
    assert.match(noBranchReview.stderr, /--branch/);
    assert.strictEqual(w.manage(['clean', '--slot', 'implementation-1', '--force']).code, 2, 'no existe --force');
    assert.ok(fs.existsSync(w.slotDir('implementation-1', 'web')));
  } finally {
    w.cleanup();
  }
});

test('open --all abre el slot en todos los repositorios clonados', () => {
  const w = buildWorkspace();
  try {
    const r = w.manage(['open', '--slot', 'implementation-2', '--all', '--branch', 'feat/dos-repos']);
    assert.strictEqual(r.code, 0, out(r));
    assert.strictEqual(w.branch(w.slotDir('implementation-2', 'api')), 'feat/dos-repos');
    assert.strictEqual(w.branch(w.slotDir('implementation-2', 'web')), 'feat/dos-repos');
    const manifest = JSON.parse(fs.readFileSync(path.join(w.ws, 'worktrees', 'implementation-2', '.ai-worktree.json'), 'utf8'));
    assert.deepStrictEqual(manifest.repos.sort(), ['api', 'web']);
  } finally {
    w.cleanup();
  }
});

test('open con lockfile distinto al del principal: no enlaza y avisa (con --link-deps también)', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    const other = w.pushOtherBranch('api', 'feat/otro-lock', { 'package-lock.json': '{"lockfileVersion":3,"v":77}\n' });
    assert.ok(other);
    const r = w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/otro-lock', '--link-deps']);
    assert.strictEqual(r.code, 0, out(r));
    assert.match(r.stdout, /no coincide/);
    assert.ok(!link.exists(path.join(w.slotDir('implementation-1', 'api'), 'node_modules')), 'no se enlazó');
  } finally {
    w.cleanup();
  }
});

test('--link-deps enlaza el directorio del PERFIL aunque el repo no tenga pack con `link`', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace({
    config: { repos: [{ name: 'api', path: 'api', packs: [], baseBranch: 'main', deps: 'node' }, { name: 'web', path: 'web', packs: [], baseBranch: 'main' }] },
  });
  try {
    const plain = w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'a']);
    assert.strictEqual(plain.code, 0, out(plain));
    assert.ok(!link.exists(path.join(w.slotDir('implementation-1', 'api'), 'node_modules')), 'sin --link-deps y sin pack, no se enlaza');
    w.manage(['clean', '--slot', 'implementation-1']);

    const linked = w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'b', '--link-deps']);
    assert.strictEqual(linked.code, 0, out(linked));
    assert.ok(link.isLink(path.join(w.slotDir('implementation-1', 'api'), 'node_modules')));

    const noProfile = w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'c', '--link-deps']);
    assert.strictEqual(noProfile.code, 0, out(noProfile));
    assert.match(noProfile.stdout, /no declara un perfil/);
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Slot review: apertura y reuso
// ---------------------------------------------------------------------------

function openReview(w, branch) {
  return w.manage(['open', '--slot', 'review', '--repo', 'api', '--branch', branch]);
}

test('review: se abre desprendido sobre origin/<rama> y se REUSA para otra rama sin clean', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    w.pushOtherBranch('api', 'feat/uno');
    w.pushOtherBranch('api', 'feat/dos', { 'dos.txt': '2' });
    const dir = w.slotDir('review', 'api');

    const first = openReview(w, 'feat/uno');
    assert.strictEqual(first.code, 0, out(first));
    assert.strictEqual(w.branch(dir), '', 'desprendido');
    assert.strictEqual(git(dir, ['rev-parse', 'HEAD']).stdout, git(w.api, ['rev-parse', 'origin/feat/uno']).stdout);
    assert.ok(link.isLink(path.join(dir, 'node_modules')));

    const second = openReview(w, 'feat/dos');
    assert.strictEqual(second.code, 0, `el review ocupado y limpio se reusa: ${out(second)}`);
    assert.match(second.stdout, /reutilizado/);
    assert.strictEqual(git(dir, ['rev-parse', 'HEAD']).stdout, git(w.api, ['rev-parse', 'origin/feat/dos']).stdout);
    assert.ok(fs.existsSync(path.join(dir, 'dos.txt')));
    assert.ok(link.isLink(path.join(dir, 'node_modules')), 'el enlace sigue (no hubo borrado)');
    assert.strictEqual(w.branch(w.api), 'main');
  } finally {
    w.cleanup();
  }
});

test('review: rama local sin remoto → desprendido sobre la local; rama inexistente → error', () => {
  const w = buildWorkspace();
  try {
    git(w.web, ['branch', 'solo-local']);
    const ok = w.manage(['open', '--slot', 'review', '--repo', 'web', '--branch', 'solo-local']);
    assert.strictEqual(ok.code, 0, out(ok));
    assert.strictEqual(w.branch(w.slotDir('review', 'web')), '');
    w.manage(['clean', '--slot', 'review']);
    const bad = w.manage(['open', '--slot', 'review', '--repo', 'web', '--branch', 'no-existe']);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.stderr, /No existe la rama/);
  } finally {
    w.cleanup();
  }
});

test('review: las 4 guardas del reuso cortan ANTES de mover el HEAD', { skip: LINK_SKIP }, async (t) => {
  const w = buildWorkspace();
  try {
    w.pushOtherBranch('api', 'feat/uno');
    w.pushOtherBranch('api', 'feat/dos', { 'dos.txt': '2' });
    w.pushOtherBranch('api', 'feat/lock', { 'package-lock.json': '{"lockfileVersion":3,"v":55}\n' });
    const dir = w.slotDir('review', 'api');
    assert.strictEqual(openReview(w, 'feat/uno').code, 0);
    const head = () => git(dir, ['rev-parse', 'HEAD']).stdout;
    const reset = () => {
      git(dir, ['reset', '--hard', '--quiet']);
      git(dir, ['clean', '-fd', '--quiet']);
      git(dir, ['checkout', '--detach', '--quiet', 'origin/feat/uno']);
    };
    const refused = (label, pattern) => {
      const before = head();
      const r = openReview(w, 'feat/dos');
      assert.notStrictEqual(r.code, 0, `${label}: tenía que cortar. ${out(r)}`);
      assert.match(r.stderr, pattern, label);
      assert.strictEqual(head(), before, `${label}: el HEAD no se movió`);
    };

    await t.test('guarda 1a: no es un worktree de git', () => {
      const bogus = path.join(w.ws, 'worktrees', 'review', 'web');
      write(path.join(bogus, 'archivo.txt'), 'no es un worktree');
      const r = w.manage(['open', '--slot', 'review', '--repo', 'web', '--branch', 'main']);
      assert.notStrictEqual(r.code, 0, out(r));
      assert.match(r.stderr, /no es un worktree de git/);
      assert.ok(fs.existsSync(path.join(bogus, 'archivo.txt')), 'no se tocó');
      fs.rmSync(bogus, { recursive: true });
    });

    await t.test('guarda 1b: tiene una rama checkouteada (no está desprendido)', () => {
      git(dir, ['checkout', '-b', 'rama-en-review', '--quiet']);
      refused('rama checkouteada', /rama "rama-en-review" checkouteada/);
      git(dir, ['checkout', '--detach', '--quiet', 'origin/feat/uno']);
      git(dir, ['branch', '-D', 'rama-en-review', '--quiet']);
    });

    await t.test('guarda 2a: cambios sin commitear', () => {
      write(path.join(dir, 'src', 'app.ts'), 'export const a = 999;\n');
      refused('cambios', /cambios sin commit/);
      reset();
    });

    await t.test('guarda 2b: archivos sin trackear', () => {
      write(path.join(dir, 'suelto.txt'), 'nuevo');
      refused('untracked', /sin trackear/);
      assert.ok(fs.existsSync(path.join(dir, 'suelto.txt')));
      reset();
    });

    await t.test('guarda 3: commits que ninguna rama contiene quedarían huérfanos', () => {
      git(dir, ['config', 'user.name', 'T']);
      git(dir, ['config', 'user.email', 't@e.com']);
      git(dir, ['config', 'commit.gpgsign', 'false']);
      w.commit(dir, 'huerfano.txt', 'commit en detached');
      refused('huérfano', /no está en ninguna rama/);
      reset();
    });

    await t.test('guarda 4: con dependencias enlazadas, el lockfile destino debe coincidir', () => {
      const before = head();
      const r = openReview(w, 'feat/lock');
      assert.notStrictEqual(r.code, 0, out(r));
      assert.match(r.stderr, /no coincide con el del principal/);
      assert.strictEqual(head(), before, 'el slot queda donde estaba');
    });

    await t.test('con todas las guardas en verde, el reuso funciona (el caso que NO debe cortar)', () => {
      reset();
      const r = openReview(w, 'feat/dos');
      assert.strictEqual(r.code, 0, out(r));
      assert.ok(fs.existsSync(path.join(dir, 'dos.txt')));
    });
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// promote
// ---------------------------------------------------------------------------

function openWithBranch(w, slot, repo, branch, { push = true } = {}) {
  assert.strictEqual(w.manage(['open', '--slot', slot, '--repo', repo, '--branch', branch]).code, 0);
  const dir = w.slotDir(slot, repo);
  w.commit(dir, 'trabajo.txt', `trabajo de ${branch}`);
  if (push) git(dir, ['push', '-u', 'origin', branch, '--quiet']);
  return dir;
}

test('promote verifica TODO antes de tocar: principal sucia, slot sucio, principal fuera de la base', () => {
  const w = buildWorkspace();
  try {
    const dir = openWithBranch(w, 'implementation-1', 'web', 'feat/x');
    const state = () => `${w.branch(w.web)}|${fs.existsSync(dir)}`;

    write(path.join(w.web, 'sucio.txt'), 'cambios sin commit en la principal');
    const dirtyMain = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(dirtyMain.code, 1);
    assert.match(dirtyMain.stderr, /principal de web tiene cambios sin commitear/);
    assert.strictEqual(state(), 'main|true', 'no se tocó nada');
    fs.rmSync(path.join(w.web, 'sucio.txt'));

    write(path.join(dir, 'sucio.txt'), 'sin commit en el slot');
    const dirtySlot = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(dirtySlot.code, 1);
    assert.match(dirtySlot.stderr, /sin commitear/);
    assert.strictEqual(state(), 'main|true');
    fs.rmSync(path.join(dir, 'sucio.txt'));

    git(w.web, ['checkout', '-b', 'otra-cosa', '--quiet']);
    const offBase = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(offBase.code, 1);
    assert.match(offBase.stderr, /no en "main"/);
    assert.strictEqual(w.branch(w.web), 'otra-cosa');
    git(w.web, ['checkout', 'main', '--quiet']);

    // Y el caso que NO debe cortar.
    const ok = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(ok.code, 0, out(ok));
    assert.strictEqual(state().startsWith('feat/x|false'), true);
  } finally {
    w.cleanup();
  }
});

test('promote: con varios repos, uno inválido frena a TODOS (nada a medias)', () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--all', '--branch', 'feat/dos-repos']).code, 0);
    write(path.join(w.slotDir('implementation-1', 'web'), 'sucio.txt'), 'x'); // el segundo repo está sucio
    const r = w.manage(['promote', '--slot', 'implementation-1']);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(w.branch(w.api), 'main', 'api no se movió aunque ella estaba bien');
    assert.ok(fs.existsSync(w.slotDir('implementation-1', 'api')), 'el slot de api sigue');
  } finally {
    w.cleanup();
  }
});

test('promote: una rama sin upstream AVISA pero no aborta; un slot review no se promueve', () => {
  const w = buildWorkspace();
  try {
    openWithBranch(w, 'implementation-1', 'web', 'feat/sin-push', { push: false });
    const r = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(r.code, 0, out(r));
    assert.match(r.stdout, /no tiene upstream/);
    assert.strictEqual(w.branch(w.web), 'feat/sin-push');

    const review = w.manage(['promote', '--slot', 'review']);
    assert.strictEqual(review.code, 2);
    assert.match(review.stderr, /de revisión/);
  } finally {
    w.cleanup();
  }
});

test('promote: git switch que falla al escribir HEAD se recupera SOLO si índice y archivos ya son los de la rama', () => {
  // Se prueba la lógica con un git simulado: bloquear `.git/HEAD` de verdad no es portable.
  const calls = [];
  const fake = (script) => (args) => {
    calls.push(args.join(' '));
    return script(args);
  };
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const bad = (stderr = 'error: unable to write symref for HEAD: Permission denied') => ({ status: 1, stdout: '', stderr });

  // Coinciden: se reintenta symbolic-ref y al segundo intento escribe.
  let tries = 0;
  const sleeps = [];
  const res = switchPrincipalBranch('X', 'feat/x', {
    pauseMs: 100,
    sleep: (ms) => sleeps.push(ms),
    run: fake((a) => {
      if (a[0] === 'switch') return bad();
      if (a[0] === 'symbolic-ref') return ++tries < 2 ? bad('locked') : ok();
      return ok(); // rev-parse --verify, diff --cached, diff: coinciden
    }),
  });
  assert.deepStrictEqual(res, { recovered: true, attempt: 2 });
  assert.deepStrictEqual(sleeps, [100, 200], 'pausas crecientes');

  // El índice NO coincide: se frena sin escribir HEAD.
  calls.length = 0;
  assert.throws(
    () =>
      switchPrincipalBranch('X', 'feat/x', {
        pauseMs: 0,
        sleep: () => {},
        run: fake((a) => (a[0] === 'switch' || (a[0] === 'diff' && a.includes('--cached')) ? bad('diff') : ok())),
      }),
    /el índice no coincide/,
  );
  assert.ok(!calls.some((c) => c.startsWith('symbolic-ref')), 'no se tocó HEAD');

  // Los archivos no coinciden con el índice: se frena.
  assert.throws(
    () =>
      switchPrincipalBranch('X', 'feat/x', {
        pauseMs: 0,
        sleep: () => {},
        run: fake((a) => (a[0] === 'switch' || (a[0] === 'diff' && !a.includes('--cached')) ? bad() : ok())),
      }),
    /archivos distintos del índice/,
  );

  // La rama no existe: no se "recupera" apuntando HEAD a una rama inexistente.
  assert.throws(
    () =>
      switchPrincipalBranch('X', 'no-existe', {
        pauseMs: 0,
        sleep: () => {},
        run: fake((a) => (a[0] === 'switch' || a[0] === 'rev-parse' ? bad() : ok())),
      }),
    /índice no coincide/,
  );

  // Siempre bloqueado: tras 5 intentos, error con el comando manual.
  assert.throws(
    () =>
      switchPrincipalBranch('X', 'feat/x', {
        pauseMs: 0,
        sleep: () => {},
        run: fake((a) => (a[0] === 'switch' || a[0] === 'symbolic-ref' ? bad() : ok())),
      }),
    /symbolic-ref HEAD refs\/heads\/feat\/x/,
  );

  // Camino feliz: switch normal, sin recuperación.
  assert.deepStrictEqual(switchPrincipalBranch('X', 'feat/x', { run: () => ok() }), { recovered: false });
});

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

test('release se niega con cambios sin commitear, commits sin pushear, sin upstream o con upstream distinto', () => {
  const w = buildWorkspace();
  try {
    openWithBranch(w, 'implementation-1', 'web', 'feat/r');
    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']).code, 0);
    const still = () => assert.strictEqual(w.branch(w.web), 'feat/r', 'la principal no se movió');

    write(path.join(w.web, 'sucio.txt'), 'x');
    const dirty = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(dirty.code, 1);
    assert.match(dirty.stderr, /cambios sin commitear/);
    still();
    fs.rmSync(path.join(w.web, 'sucio.txt'));

    w.commit(w.web, 'sin-push.txt', 'x');
    const unpushed = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(unpushed.code, 1);
    assert.match(unpushed.stderr, /1 commit\(s\) sin pushear/);
    still();
    git(w.web, ['push', '--quiet']);

    git(w.web, ['branch', '-u', 'origin/main', 'feat/r']);
    const wrongUp = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(wrongUp.code, 1);
    assert.match(wrongUp.stderr, /upstream de "feat\/r" es "origin\/main"/);
    still();

    git(w.web, ['branch', '--unset-upstream', 'feat/r']);
    const noUp = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(noUp.code, 1);
    assert.match(noUp.stderr, /no tiene upstream/);
    still();

    // El caso que NO debe cortar.
    git(w.web, ['push', '-u', 'origin', 'feat/r', '--quiet']);
    const ok = w.manage(['release', '--repo', 'web']);
    assert.strictEqual(ok.code, 0, out(ok));
    assert.strictEqual(w.branch(w.web), 'main');
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

test('clean: cambios sin commitear abortan; limpio cierra, deja el principal entero y borra el manifiesto', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--all', '--branch', 'feat/c']).code, 0);
    const slotApi = w.slotDir('implementation-1', 'api');
    const bin = w.binCount();

    write(path.join(slotApi, 'sucio.txt'), 'trabajo de horas');
    const dirty = w.manage(['clean', '--slot', 'implementation-1']);
    assert.strictEqual(dirty.code, 1);
    assert.match(dirty.stderr, /sin commitear/);
    assert.ok(fs.existsSync(path.join(slotApi, 'sucio.txt')), 'no se perdió nada');
    assert.ok(link.isLink(path.join(slotApi, 'node_modules')), 'ni se tocó el enlace');
    fs.rmSync(path.join(slotApi, 'sucio.txt'));

    const r = w.manage(['clean', '--slot', 'implementation-1']);
    assert.strictEqual(r.code, 0, out(r));
    assert.ok(!fs.existsSync(path.join(w.ws, 'worktrees', 'implementation-1')), 'sin carpeta ni manifiesto');
    assert.strictEqual(w.binCount(), bin, 'el node_modules del principal sigue entero');
    assert.ok(fs.existsSync(path.join(w.api, 'node_modules', 'dep-a', 'package.json')));
    assert.strictEqual(git(w.api, ['worktree', 'list']).stdout.split('\n').length, 1, 'git ya no registra el worktree');

    const again = w.manage(['clean', '--slot', 'implementation-1']);
    assert.strictEqual(again.code, 0);
    assert.match(again.stdout, /no estaba abierto/);
  } finally {
    w.cleanup();
  }
});

test('clean --repo cierra solo ese repo y deja el manifiesto con el otro', () => {
  const w = buildWorkspace();
  try {
    w.manage(['open', '--slot', 'implementation-1', '--all', '--branch', 'feat/p']);
    assert.strictEqual(w.manage(['clean', '--slot', 'implementation-1', '--repo', 'web']).code, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(w.ws, 'worktrees', 'implementation-1', '.ai-worktree.json'), 'utf8'));
    assert.deepStrictEqual(manifest.repos, ['api']);
  } finally {
    w.cleanup();
  }
});

test('clean con un enlace ANIDADO (dentro de un directorio de salida del bundler) no vacía el principal', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/n']).code, 0);
    const slot = w.slotDir('implementation-1', 'api');
    const bin = w.binCount();

    // Lo que dejó una build: un enlace al node_modules del principal bajo `dist/` (ignorado por git).
    write(path.join(slot, 'dist', 'standalone', 'app', 'main.js'), '//');
    fs.symlinkSync(path.join(w.api, 'node_modules'), path.join(slot, 'dist', 'standalone', 'app', 'node_modules'), link.LINK_TYPE);

    const r = w.manage(['clean', '--slot', 'implementation-1']);
    assert.strictEqual(r.code, 0, out(r));
    assert.match(r.stdout, /enlace anidado quitado/);
    assert.ok(!fs.existsSync(slot), 'el slot se cerró');
    assert.strictEqual(w.binCount(), bin, 'el principal conserva sus ejecutables');
    assert.ok(fs.existsSync(path.join(w.api, 'node_modules', '@scope', 'dep-b', 'package.json')));
  } finally {
    w.cleanup();
  }
});

test('clean de un directorio SIN .git: vacío se borra; con archivos se nombran y se niega; no mira el repo padre', () => {
  const w = buildWorkspace();
  try {
    // El workspace queda DENTRO de un repo git (el "padre"), con cambios: el
    // incidente era que `git -C <dir sin .git>` subía a ese padre y reportaba
    // cambios inexistentes.
    git(w.ws, ['init', '-b', 'main', '--quiet']);
    write(path.join(w.ws, 'sucio-del-padre.txt'), 'cambio del repo padre');

    const empty = path.join(w.ws, 'worktrees', 'implementation-2', 'web');
    fs.mkdirSync(empty, { recursive: true });
    const a = w.manage(['clean', '--slot', 'implementation-2', '--repo', 'web']);
    assert.strictEqual(a.code, 0, out(a));
    assert.ok(!fs.existsSync(empty), 'el directorio vacío se borró');
    assert.doesNotMatch(out(a), /sin commitear/);

    write(path.join(empty, 'dejado.txt'), 'x');
    write(path.join(empty, 'otro.log'), 'y');
    const b = w.manage(['clean', '--slot', 'implementation-2', '--repo', 'web']);
    assert.strictEqual(b.code, 1);
    assert.match(b.stderr, /no es un worktree/);
    assert.match(b.stderr, /dejado\.txt/);
    assert.match(b.stderr, /otro\.log/);
    assert.doesNotMatch(b.stderr, /sin commitear/, 'no confundió el estado del repo padre con el del directorio');
    assert.ok(fs.existsSync(path.join(empty, 'dejado.txt')), 'no se borró nada');
  } finally {
    w.cleanup();
  }
});

test('clean --orphans: poda registros muertos, borra directorios vacíos y manifiestos de slots vacíos; nombra lo que tiene contenido', () => {
  const w = buildWorkspace();
  try {
    // Un worktree cuya carpeta se borró a mano: git sigue registrándolo.
    w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'feat/o1']);
    const dead = w.slotDir('implementation-1', 'web');
    fs.rmSync(dead, { recursive: true, force: true });
    assert.match(git(w.web, ['worktree', 'list']).stdout, /implementation-1/, 'precondición: registro muerto');

    // Un directorio vacío que no es worktree, y un manifiesto huérfano.
    fs.mkdirSync(w.slotDir('implementation-2', 'api'), { recursive: true });
    write(path.join(w.ws, 'worktrees', 'implementation-2', '.ai-worktree.json'), '{"slot":"implementation-2"}');

    const r = w.manage(['clean', '--orphans']);
    assert.strictEqual(r.code, 0, out(r));
    assert.doesNotMatch(git(w.web, ['worktree', 'list']).stdout, /implementation-1/, 'registro podado');
    assert.ok(!fs.existsSync(path.join(w.ws, 'worktrees', 'implementation-2')), 'directorio vacío y manifiesto, fuera');

    // Con contenido: se nombra y se niega.
    write(path.join(w.slotDir('review', 'web'), 'resto.txt'), 'x');
    const blocked = w.manage(['clean', '--orphans']);
    assert.strictEqual(blocked.code, 1);
    assert.match(blocked.stdout, /resto\.txt/);
    assert.ok(fs.existsSync(path.join(w.slotDir('review', 'web'), 'resto.txt')));
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

test('status --json describe la principal y cada slot', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    w.pushOtherBranch('api', 'feat/rev');
    w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/s']);
    openReview(w, 'feat/rev');
    const j = JSON.parse(w.manage(['status', '--json']).stdout);
    assert.deepStrictEqual(j.principals.map((p) => [p.repo, p.branch, p.free]), [['api', 'main', true], ['web', 'main', true]]);
    const impl = j.slots.find((s) => s.slot === 'implementation-1');
    assert.strictEqual(impl.branch, 'feat/s');
    assert.strictEqual(impl.kind, 'implementation');
    assert.strictEqual(impl.depsLinked, true);
    const review = j.slots.find((s) => s.slot === 'review');
    assert.strictEqual(review.detached, true);
    assert.match(review.branch, /^detached@/);

    git(w.web, ['checkout', '-b', 'ocupada', '--quiet']);
    const human = w.manage(['status']).stdout;
    assert.match(human, /web: ocupada · OCUPADA/);
  } finally {
    w.cleanup();
  }
});

test('slots desactivados → 2', () => {
  const w = buildWorkspace({ config: { worktrees: { enabled: false, slots: ['review'] } } });
  try {
    const r = w.manage(['status']);
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /desactivados/);
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Turno de la principal
// ---------------------------------------------------------------------------

const turnFile = (w) => path.join(w.ws, 'worktrees', '.turno', 'turno.json');
const readTurnFile = (w) => JSON.parse(fs.readFileSync(turnFile(w), 'utf8'));

test('turno: el primero lo toma, el segundo queda en cola (sale 3) y promote no lo deja colarse', () => {
  const w = buildWorkspace();
  try {
    openWithBranch(w, 'implementation-1', 'web', 'feat/uno');
    openWithBranch(w, 'implementation-2', 'api', 'feat/dos');

    const first = w.manage(['turn', '--slot', 'implementation-1', '--session', 'sesion-a']);
    assert.strictEqual(first.code, 0, out(first));
    assert.match(first.stdout, /TURNO: es de implementation-1/);

    const second = w.manage(['turn', '--slot', 'implementation-2', '--session', 'sesion-b']);
    assert.strictEqual(second.code, 3, out(second));
    assert.match(second.stdout, /implementation-2 espera, puesto 1 de 1; lo tiene implementation-1/);

    // Pedirlo otra vez no duplica la entrada.
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-2']).code, 3);
    assert.deepStrictEqual(readTurnFile(w).queue.map((e) => [e.slot, e.session]), [['implementation-2', 'sesion-b']]);

    const sneak = w.manage(['promote', '--slot', 'implementation-2', '--repo', 'api']);
    assert.strictEqual(sneak.code, 1);
    assert.match(sneak.stderr, /La principal es de implementation-1/);
    assert.strictEqual(w.branch(w.api), 'main', 'no se tocó nada');
    assert.ok(fs.existsSync(w.slotDir('implementation-2', 'api')), 'el slot sigue');

    // Y el caso que NO debe cortar: el dueño del turno promueve.
    const ok = w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']);
    assert.strictEqual(ok.code, 0, out(ok));
    assert.strictEqual(w.branch(w.web), 'feat/uno');
  } finally {
    w.cleanup();
  }
});

test('turno: release lo devuelve y avisa a la sesión siguiente; el aviso no es el turno', () => {
  const w = buildWorkspace();
  try {
    openWithBranch(w, 'implementation-1', 'web', 'feat/uno');
    openWithBranch(w, 'implementation-2', 'api', 'feat/dos');
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-1']).code, 0);
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-2', '--session', 'sesion-b']).code, 3);
    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']).code, 0);

    const release = w.manage(['release']);
    assert.strictEqual(release.code, 0, out(release));
    assert.match(release.stdout, /TURNO: implementation-1 devolvió la principal/);
    assert.match(release.stdout, /TURNO-AVISAR: sesion-b implementation-2/);
    assert.strictEqual(readTurnFile(w).holder, null, 'release no le da el turno a nadie');

    const sneakFromQueue = w.manage(['turn', '--slot', 'implementation-1']);
    assert.strictEqual(sneakFromQueue.code, 3, 'el que acaba de soltar va al final');

    const next = w.manage(['turn', '--slot', 'implementation-2']);
    assert.strictEqual(next.code, 0, out(next));
    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-2', '--repo', 'api']).code, 0);
  } finally {
    w.cleanup();
  }
});

test('turno: sin cola, promote lo toma solo; una precondición que falla no se queda con el turno', () => {
  const w = buildWorkspace();
  try {
    const dir = openWithBranch(w, 'implementation-1', 'web', 'feat/uno');
    write(path.join(dir, 'sucio.txt'), 'sin commit');
    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']).code, 1);
    assert.ok(!fs.existsSync(turnFile(w)) || readTurnFile(w).holder === null, 'el promote fallido no tomó el turno');
    fs.rmSync(path.join(dir, 'sucio.txt'));

    assert.strictEqual(w.manage(['promote', '--slot', 'implementation-1', '--repo', 'web']).code, 0);
    assert.strictEqual(readTurnFile(w).holder.slot, 'implementation-1');
  } finally {
    w.cleanup();
  }
});

test('turno: con la principal fuera de la base nadie lo recibe; release con la principal ya en la base libera un turno colgado', () => {
  const w = buildWorkspace();
  try {
    openWithBranch(w, 'implementation-1', 'web', 'feat/uno');
    git(w.web, ['checkout', '-b', 'ticket-grande', '--quiet']);
    const waiting = w.manage(['turn', '--slot', 'implementation-1']);
    assert.strictEqual(waiting.code, 3);
    assert.match(waiting.stdout, /no está en la base y limpia/);
    git(w.web, ['checkout', 'main', '--quiet']);

    // Turno colgado: lo tiene un slot cuya sesión murió y la principal ya está en la base.
    fs.writeFileSync(turnFile(w), JSON.stringify({ holder: { slot: 'implementation-2', since: 'ayer' }, queue: readTurnFile(w).queue }));
    const release = w.manage(['release']);
    assert.strictEqual(release.code, 0, out(release));
    assert.match(release.stdout, /implementation-2 devolvió la principal/);
    assert.match(release.stdout, /TURNO-AVISAR: \(sin sesión\) implementation-1/);
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-1']).code, 0);
  } finally {
    w.cleanup();
  }
});

test('turno: --leave saca de la cola o suelta el turno; status lo muestra; un slot review no pide turno', () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-1']).code, 0);
    assert.strictEqual(w.manage(['turn', '--slot', 'implementation-2', '--session', 's2']).code, 3);

    const human = w.manage(['status']).stdout;
    assert.match(human, /Turno de la principal: implementation-1/);
    assert.match(human, /1\. implementation-2 \(desde .*, sesión s2\)/);
    assert.strictEqual(JSON.parse(w.manage(['status', '--json']).stdout).turn.holder.slot, 'implementation-1');

    const leaveQueue = w.manage(['turn', '--slot', 'implementation-2', '--leave']);
    assert.match(leaveQueue.stdout, /salió de la cola/);
    const leaveHolder = w.manage(['turn', '--slot', 'implementation-1', '--leave']);
    assert.match(leaveHolder.stdout, /devolvió el turno sin release/);
    assert.deepStrictEqual(readTurnFile(w), { holder: null, queue: [] });

    const review = w.manage(['turn', '--slot', 'review']);
    assert.strictEqual(review.code, 2);

    // clean --orphans no confunde la carpeta del turno con un slot.
    const orphans = w.manage(['clean', '--orphans']);
    assert.strictEqual(orphans.code, 0, out(orphans));
    assert.doesNotMatch(orphans.stdout, /\.turno/);
  } finally {
    w.cleanup();
  }
});

test('turno: un lock abandonado por un proceso que murió no traba a nadie', () => {
  const w = buildWorkspace();
  try {
    fs.mkdirSync(path.join(w.ws, 'worktrees', '.turno'), { recursive: true });
    // Un pid que no existe: el proceso que tenía el lock murió.
    fs.writeFileSync(path.join(w.ws, 'worktrees', '.turno', 'turno.lock'), '999999');
    const r = w.manage(['turn', '--slot', 'implementation-1']);
    assert.strictEqual(r.code, 0, out(r));
    assert.ok(!fs.existsSync(path.join(w.ws, 'worktrees', '.turno', 'turno.lock')), 'el lock se suelta al terminar');
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// start-worktree-session.js
// ---------------------------------------------------------------------------

function sessionWorkspace() {
  const w = buildWorkspace({
    config: {
      harnesses: ['fake', 'sin-launch'],
      harnessDefinitions: {
        fake: {
          title: 'Fake',
          launch: { command: process.execPath, args: ['{root}/fake-tool.js', '--dir', '{cwd}'], env: { FAKE_ROOT: '{root}' } },
        },
        'sin-launch': { title: 'Sin launch' },
      },
    },
  });
  write(
    path.join(w.ws, 'fake-tool.js'),
    "require('fs').writeFileSync(require('path').join(process.env.AI_WORKTREE_ROOT, 'lanzado.json'), JSON.stringify({ cwd: process.cwd(), slot: process.env.AI_WORKTREE_SLOT, root: process.env.AI_WORKTREE_ROOT, fakeRoot: process.env.FAKE_ROOT, argv: process.argv.slice(2) }));\n",
  );
  return w;
}

test('start-worktree-session: arma el cwd, exporta las variables y lanza el harness declarado', () => {
  const w = sessionWorkspace();
  try {
    assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--all', '--branch', 'feat/s']).code, 0);
    const slotRoot = path.join(w.ws, 'worktrees', 'implementation-1');

    const dry = w.script('start-worktree-session.js', ['--slot', 'implementation-1', '--repo', 'web', '--harness', 'fake', '--dry-run']);
    assert.strictEqual(dry.code, 0, out(dry));
    const plan = JSON.parse(dry.stdout);
    assert.strictEqual(plan.cwd, w.slotDir('implementation-1', 'web'));
    assert.strictEqual(plan.env.AI_WORKTREE_SLOT, 'implementation-1');
    assert.strictEqual(plan.env.AI_WORKTREE_ROOT, slotRoot);
    assert.strictEqual(plan.env.FAKE_ROOT, w.ws, 'la raíz del workspace le llega al harness');

    // Sin --repo → el cwd es la raíz del slot.
    const all = JSON.parse(w.script('start-worktree-session.js', ['--slot', 'implementation-1', '--all', '--dry-run']).stdout);
    assert.strictEqual(all.cwd, slotRoot);
    assert.strictEqual(all.harness, 'fake', 'sin --harness, el primero que declara launch');

    const run = w.script('start-worktree-session.js', ['--slot', 'implementation-1', '--repo', 'api']);
    assert.strictEqual(run.code, 0, out(run));
    const seen = JSON.parse(fs.readFileSync(path.join(slotRoot, 'lanzado.json'), 'utf8'));
    assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync(w.slotDir('implementation-1', 'api')));
    assert.strictEqual(seen.slot, 'implementation-1');
    assert.strictEqual(seen.fakeRoot, w.ws);
  } finally {
    w.cleanup();
  }
});

test('start-worktree-session: sin `launch` imprime cómo hacerlo y sale 2; errores de uso salen 2', () => {
  const w = sessionWorkspace();
  try {
    w.manage(['open', '--slot', 'implementation-1', '--repo', 'web', '--branch', 'feat/s']);
    const noLaunch = w.script('start-worktree-session.js', ['--slot', 'implementation-1', '--repo', 'web', '--harness', 'sin-launch']);
    assert.strictEqual(noLaunch.code, 2);
    assert.match(noLaunch.stderr, /no declara `launch`/);
    assert.match(noLaunch.stderr, /AI_WORKTREE_SLOT=implementation-1/);

    const cases = [
      ['--slot', 'implementation-2', '--all'], // slot cerrado
      ['--slot', 'nope', '--all'],
      ['--slot', 'implementation-1', '--repo', 'api'], // repo no abierto en el slot
      ['--slot', 'implementation-1', '--harness', 'no-declarado'],
      ['--slot', 'implementation-1', '--repo', 'web', '--all'],
      [],
      ['--slot'],
    ];
    for (const args of cases) {
      assert.strictEqual(w.script('start-worktree-session.js', args).code, 2, JSON.stringify(args));
    }
  } finally {
    w.cleanup();
  }
});
