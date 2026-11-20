#!/usr/bin/env node
/**
 * Enlace de dependencias, su MEDICIÓN y su salud (`scripts/check-deps.js`).
 *
 * La medición existe porque la explicación que circulaba ("un borrado recursivo
 * atraviesa el enlace") era falsa en la plataforma donde se midió, y blindar la
 * puerta equivocada dejó la verdadera abierta: lo que vaciaba el destino era el
 * REINSTALADOR (`npm ci`) y `git worktree remove` con un enlace anidado. Este
 * test mide, en la plataforma donde corre, qué operación atraviesa un enlace y lo
 * REPORTA. Si una operación no se reproduce, lo dice como NOTA (no falla): la
 * regla de la base es "medí antes de blindar", no "esta operación es peligrosa".
 *
 * Los enlaces son junctions en Windows y symlinks 'dir' en Unix. Si el entorno no
 * permite crearlos, esas pruebas se OMITEN con el motivo a la vista: nunca pasan
 * en falso.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const link = require('../scripts/lib/deps-link');
const { buildWorkspace, LINK_SKIP, git, write } = require('./slot-workspace');

// ---------------------------------------------------------------------------
// MEDICIÓN: qué operación atraviesa un enlace
// ---------------------------------------------------------------------------

function tool(name, probeArgs = ['--version']) {
  const r = spawnSync([name, ...probeArgs].join(' '), { encoding: 'utf8', shell: true });
  return r.status === 0;
}

/** Destino con archivos + un enlace a él dentro de un "slot". `crossed()` dice si el destino perdió algo. */
function scenario() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-measure-'));
  const target = path.join(base, 'principal', 'deps');
  const slot = path.join(base, 'slot');
  write(path.join(target, 'a.txt'), 'a');
  write(path.join(target, 'sub', 'b.txt'), 'b');
  write(path.join(slot, 'src.txt'), 'codigo');
  const lnk = path.join(slot, 'deps');
  fs.symlinkSync(target, lnk, link.LINK_TYPE);
  return {
    base,
    target,
    slot,
    lnk,
    crossed: () => !(fs.existsSync(path.join(target, 'a.txt')) && fs.existsSync(path.join(target, 'sub', 'b.txt'))),
    done() {
      try {
        for (const l of link.findLinks(base)) link.removeLink(l);
      } catch {
        /* nada */
      }
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

test('medición: qué operación atraviesa un enlace en ESTA plataforma', { skip: LINK_SKIP }, (t) => {
  const rows = [];
  const measure = (label, fn, { assertSafe = false } = {}) => {
    const s = scenario();
    let error = '';
    try {
      fn(s);
    } catch (err) {
      error = ` (la operación falló: ${String(err.message).split('\n')[0]})`;
    }
    const crossed = s.crossed();
    rows.push({ label, crossed, error });
    if (assertSafe) assert.strictEqual(crossed, false, `"${label}" vació el destino: el desenlace de la base ya no es seguro en esta plataforma`);
    s.done();
    return crossed;
  };

  // Las tres que la base USA para quitar un enlace: tienen que ser seguras. Si
  // alguna deja de serlo, la base no puede quitar enlaces y esto falla en rojo.
  measure('fs.unlinkSync(enlace)', (s) => fs.unlinkSync(s.lnk), { assertSafe: true });
  measure('fs.rmdirSync(enlace)', (s) => fs.rmdirSync(s.lnk), { assertSafe: true });
  measure('deps-link.removeLink(enlace)', (s) => link.removeLink(s.lnk), { assertSafe: true });

  // Las que la base NO usa sobre un enlace pero que otros usan: se miden y se reportan.
  measure('fs.rmSync(enlace, {recursive})', (s) => fs.rmSync(s.lnk, { recursive: true, force: true }));
  measure('fs.rmSync(slot, {recursive}) con el enlace adentro', (s) => fs.rmSync(s.slot, { recursive: true, force: true }));

  if (process.platform !== 'win32' || tool('bash', ['-c', 'true'])) {
    measure('rm -rf <slot>', (s) => {
      const r = spawnSync('rm', ['-rf', s.slot], { encoding: 'utf8' });
      if (r.error) throw r.error;
    });
  }
  if (process.platform === 'win32') {
    measure('cmd: rmdir /s /q <slot>', (s) => spawnSync('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', s.slot], { encoding: 'utf8' }));
    if (tool('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])) {
      measure('PowerShell: Remove-Item -Recurse -Force <slot>', (s) =>
        spawnSync('powershell', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${s.slot}' -Recurse -Force`], { encoding: 'utf8' }));
    }
  }

  // git worktree remove con un enlace ANIDADO (el caso que dejó una build).
  if (tool('git')) {
    measure('git worktree remove con un enlace anidado (dist/nested)', (s) => {
      const repo = path.join(s.base, 'repo');
      fs.mkdirSync(repo);
      git(repo, ['init', '-b', 'main', '--quiet']);
      for (const [k, v] of Object.entries({ 'user.name': 'T', 'user.email': 't@e.com', 'commit.gpgsign': 'false' })) git(repo, ['config', k, v]);
      write(path.join(repo, '.gitignore'), 'dist\n');
      write(path.join(repo, 'f.txt'), 'x');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-m', 'i', '--quiet']);
      const wt = path.join(s.base, 'wt');
      git(repo, ['worktree', 'add', '--detach', wt]);
      fs.mkdirSync(path.join(wt, 'dist'));
      fs.symlinkSync(s.target, path.join(wt, 'dist', 'nested'), link.LINK_TYPE);
      git(repo, ['worktree', 'remove', wt], { allowFail: true });
    });
  }

  // El reinstalador: `npm ci` con el directorio enlazado.
  if (tool('npm')) {
    measure('npm ci con node_modules enlazado (proyecto sin dependencias)', (s) => {
      const proj = path.join(s.base, 'proj');
      write(path.join(proj, 'package.json'), '{"name":"p","version":"1.0.0"}');
      write(path.join(proj, 'package-lock.json'), '{"name":"p","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"p","version":"1.0.0"}}}');
      fs.symlinkSync(s.target, path.join(proj, 'node_modules'), link.LINK_TYPE);
      spawnSync('npm ci --offline --no-audit --no-fund', { cwd: proj, encoding: 'utf8', shell: true, timeout: 120000 });
    });
  }

  const report = rows.map((r) => `  ${r.crossed ? 'ATRAVIESA   ' : 'no atraviesa'}  ${r.label}${r.error}`);
  t.diagnostic(`MEDICIÓN en ${process.platform} (node ${process.version}):\n${report.join('\n')}`);
  process.stdout.write(`\n# MEDICIÓN en ${process.platform}, node ${process.version}\n${report.map((l) => `# ${l}`).join('\n')}\n`);

  const crossing = rows.filter((r) => r.crossed).map((r) => r.label);
  if (crossing.length === 0) {
    t.diagnostic('NOTA: ninguna de las operaciones medidas atravesó el enlace en esta plataforma. La regla "medí antes de blindar" se mantiene: otra plataforma o gestor puede comportarse distinto.');
  } else {
    t.diagnostic(`Operaciones que SÍ vaciaron el destino acá: ${crossing.join('; ')}`);
  }
});

// ---------------------------------------------------------------------------
// Primitivas de enlace
// ---------------------------------------------------------------------------

test('removeLink quita el enlace y deja el destino; findLinks/sweepLinks barren los anidados', { skip: LINK_SKIP }, () => {
  const s = scenario();
  try {
    write(path.join(s.slot, 'dist', 'out', 'x.js'), 'x');
    const nested = path.join(s.slot, 'dist', 'out', 'nested-deps');
    fs.symlinkSync(s.target, nested, link.LINK_TYPE);

    assert.ok(link.isLink(s.lnk));
    assert.ok(!link.isLink(path.join(s.slot, 'dist')), 'un directorio común no es un enlace');
    assert.deepStrictEqual(link.findLinks(s.slot).sort(), [s.lnk, nested].sort());

    const { removed, survivors } = link.sweepLinks(s.slot);
    assert.strictEqual(removed.length, 2);
    assert.strictEqual(survivors.length, 0);
    assert.ok(!s.crossed(), 'el destino quedó intacto');
    assert.ok(fs.existsSync(path.join(s.slot, 'dist', 'out', 'x.js')), 'los archivos comunes no se tocan');
  } finally {
    s.done();
  }
});

test('removeLink sobre algo que no es un enlace no hace nada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-nolink-'));
  try {
    write(path.join(dir, 'real', 'f.txt'), 'f');
    link.removeLink(path.join(dir, 'real'));
    assert.ok(fs.existsSync(path.join(dir, 'real', 'f.txt')), 'un directorio real jamás se borra con removeLink');
    link.removeLink(path.join(dir, 'no-existe'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('healthCount cuenta contenido según el perfil y es null sin perfil de salud', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-count-'));
  try {
    for (let i = 0; i < 7; i++) write(path.join(dir, 'node_modules', '.bin', `t${i}`), '');
    assert.strictEqual(link.healthCount(dir, { dir: 'node_modules', health: { kind: 'node-modules', binDir: '.bin' } }), 7);
    assert.strictEqual(link.healthCount(dir, { dir: 'node_modules', health: null }), null);
    assert.strictEqual(link.healthCount(dir, { dir: 'node_modules', health: { kind: 'node-modules', binDir: '.bin' } }), 7);
    write(path.join(dir, '.venv', 'Scripts', 'python.exe'), '');
    assert.strictEqual(link.healthCount(dir, { dir: '.venv', health: { kind: 'python-venv', binDir: 'bin', altBinDir: 'Scripts' } }), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('linkDir: enlaza con lockfile igual; no enlaza (y avisa) con lockfile distinto o sin destino', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    const profile = { dir: 'node_modules', lockfile: 'package-lock.json' };
    const slot = path.join(w.tmp, 'slot-api');
    git(w.api, ['worktree', 'add', '--detach', slot]);

    const ok = link.linkDir(w.api, slot, 'node_modules', { profile, ref: 'HEAD' });
    assert.strictEqual(ok.status, 'linked');
    assert.ok(link.isLink(path.join(slot, 'node_modules')));
    assert.strictEqual(link.linkDir(w.api, slot, 'node_modules', { profile, ref: 'HEAD' }).status, 'present');
    link.removeLink(path.join(slot, 'node_modules'));

    // Otra rama con otro lockfile.
    git(w.api, ['checkout', '-b', 'otro-lock', '--quiet']);
    w.commit(w.api, 'package-lock.json', '{"lockfileVersion":3,"v":99}\n', 'lock distinto');
    git(w.api, ['checkout', 'main', '--quiet']);
    const skipped = link.linkDir(w.api, slot, 'node_modules', { profile, ref: 'otro-lock' });
    assert.strictEqual(skipped.status, 'skipped');
    assert.match(skipped.reason, /no coincide/);
    assert.ok(!link.exists(path.join(slot, 'node_modules')), 'no se enlazó');

    const noRef = link.linkDir(w.api, slot, 'node_modules', { profile, ref: 'rama-que-no-existe' });
    assert.strictEqual(noRef.status, 'skipped', 'no poder comparar NO es "coincide"');

    const noTarget = link.linkDir(w.web, slot, 'node_modules', { profile, ref: 'HEAD' });
    assert.strictEqual(noTarget.status, 'skipped');
    assert.match(noTarget.reason, /no existe node_modules/);
  } finally {
    w.cleanup();
  }
});

// ---------------------------------------------------------------------------
// check-deps.js
// ---------------------------------------------------------------------------

test('check-deps: sano → 0 y reporta el conteo', () => {
  const w = buildWorkspace();
  try {
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK\s+api/);
    const j = JSON.parse(w.script('check-deps.js', ['--repo', 'api', '--json']).stdout);
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.results[0].count, 25);
  } finally {
    w.cleanup();
  }
});

test('check-deps: repositorio sin perfil se omite con una nota, no falla', () => {
  const w = buildWorkspace();
  try {
    const r = w.script('check-deps.js', ['--repo', 'web']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /sin perfil/);
  } finally {
    w.cleanup();
  }
});

test('check-deps: .bin vaciado con el conteo de carpetas intacto → roto (mira el CONTENIDO)', () => {
  const w = buildWorkspace();
  try {
    const nm = path.join(w.api, 'node_modules');
    const topLevelBefore = fs.readdirSync(nm).length;
    fs.rmSync(path.join(nm, '.bin'), { recursive: true });
    fs.mkdirSync(path.join(nm, '.bin')); // la carpeta sigue; adentro no hay nada
    assert.strictEqual(fs.readdirSync(nm).length, topLevelBefore, 'precondición: el conteo de primer nivel no cambió');
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 1, r.stdout);
    assert.match(r.stdout, /\.bin/);
  } finally {
    w.cleanup();
  }
});

test('check-deps: dependencia declarada sin su manifest instalado → roto, y nombra cuál', () => {
  const w = buildWorkspace();
  try {
    fs.rmSync(path.join(w.api, 'node_modules', '@scope', 'dep-b', 'package.json'));
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stdout, /@scope\/dep-b/);
    assert.doesNotMatch(r.stdout, /dep-a,/);
  } finally {
    w.cleanup();
  }
});

test('check-deps: una dependencia OPCIONAL ausente no es rotura', () => {
  const w = buildWorkspace();
  try {
    // `opt-x` está declarada como opcional y NO está instalada (ver el fixture).
    assert.ok(!fs.existsSync(path.join(w.api, 'node_modules', 'opt-x')));
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'api']).code, 0);
  } finally {
    w.cleanup();
  }
});

test('check-deps: sin directorio de dependencias → roto', () => {
  const w = buildWorkspace();
  try {
    fs.rmSync(path.join(w.api, 'node_modules'), { recursive: true });
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stdout, /no hay node_modules/);
  } finally {
    w.cleanup();
  }
});

test('check-deps: enlace INVERTIDO (el directorio del principal es un enlace) → roto', { skip: LINK_SKIP }, () => {
  const w = buildWorkspace();
  try {
    const real = path.join(w.tmp, 'real-deps');
    fs.renameSync(path.join(w.api, 'node_modules'), real);
    fs.symlinkSync(real, path.join(w.api, 'node_modules'), link.LINK_TYPE);
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 1, r.stdout);
    assert.match(r.stdout, /es un enlace/);

    // --fix NO repara a ciegas un enlace invertido: un reinstalador a través de
    // él vaciaría el destino.
    const fix = w.script('check-deps.js', ['--repo', 'api', '--fix']);
    assert.strictEqual(fix.code, 1);
    assert.ok(fs.existsSync(path.join(real, 'dep-a', 'package.json')), 'el destino del enlace no se tocó');
  } finally {
    w.cleanup();
  }
});

test('check-deps: repositorio ausente → 2 (no se pudo verificar), nunca 0', () => {
  const w = buildWorkspace();
  try {
    link.removeLink(path.join(w.api, 'node_modules')); // por si acaso; no es un enlace
    fs.rmSync(w.api, { recursive: true, force: true });
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 2, r.stdout + r.stderr);
    const all = w.script('check-deps.js');
    assert.strictEqual(all.code, 2, 'con --all, un repo ausente tampoco da verde');
  } finally {
    w.cleanup();
  }
});

test('check-deps: uso incorrecto → 2', () => {
  const w = buildWorkspace();
  try {
    assert.strictEqual(w.script('check-deps.js', ['--nope']).code, 2);
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'no-existe']).code, 2);
    assert.strictEqual(w.script('check-deps.js', ['--repo']).code, 2);
  } finally {
    w.cleanup();
  }
});

test('check-deps --fix corre el comando de reparación del perfil y re-verifica', () => {
  const w = buildWorkspace({
    config: {
      repos: [
        {
          name: 'api',
          path: 'api',
          packs: [],
          baseBranch: 'main',
          // Perfil propio con un `repair` que reinstala de mentira: recrea el contenido borrado.
          deps: {
            profile: 'node',
            repair: `node -e "const fs=require('fs');fs.mkdirSync('node_modules/.bin',{recursive:true});for(let i=0;i<25;i++)fs.writeFileSync('node_modules/.bin/t'+i,'');for(const p of ['dep-a','@scope/dep-b']){fs.mkdirSync('node_modules/'+p,{recursive:true});fs.writeFileSync('node_modules/'+p+'/package.json','{}')}"`,
          },
        },
      ],
    },
  });
  try {
    fs.rmSync(path.join(w.api, 'node_modules'), { recursive: true });
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'api']).code, 1);
    const r = w.script('check-deps.js', ['--repo', 'api', '--fix']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /reparado/);
  } finally {
    w.cleanup();
  }
});

test('check-deps: perfil python (.venv) y php (vendor) leen su propia salud', () => {
  const mk = (profile, files) => {
    const w = buildWorkspace({
      config: { repos: [{ name: 'api', path: 'api', packs: [], baseBranch: 'main', deps: profile }] },
    });
    for (const [rel, c] of Object.entries(files)) write(path.join(w.api, rel), c);
    return w;
  };

  let w = mk('python', { '.venv/pyvenv.cfg': 'home = x', '.venv/bin/python': '' });
  try {
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'api']).code, 0);
    fs.rmSync(path.join(w.api, '.venv', 'pyvenv.cfg'));
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'api']).code, 1);
  } finally {
    w.cleanup();
  }

  w = mk('php', { 'composer.json': '{"require":{"php":"^8","acme/lib":"1.0"}}', 'vendor/autoload.php': '<?php', 'vendor/composer/installed.json': '{}' });
  try {
    const r = w.script('check-deps.js', ['--repo', 'api']);
    assert.strictEqual(r.code, 1, 'acme/lib declarada y no instalada');
    assert.match(r.stdout, /acme\/lib/);
    write(path.join(w.api, 'vendor', 'acme', 'lib', 'x.php'), '<?php');
    assert.strictEqual(w.script('check-deps.js', ['--repo', 'api']).code, 0, 'php y ext-* no cuentan como paquetes');
  } finally {
    w.cleanup();
  }
});
