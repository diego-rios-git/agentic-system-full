/**
 * El despachador (scripts/hooks/dispatch.js) y lo que cambió para abaratar los
 * hooks: pre-write-secrets sin proceso hijo, post-edit-checks con los gates en
 * paralelo, la rotación del log, la rama leída sin `git` y el preflight.
 *
 * La prueba central es de EQUIVALENCIA: para cada comando, el despachador tiene
 * que decidir lo mismo que los hooks corridos uno por uno, que es como se
 * registraban antes. Juntar los hooks en un proceso no puede cambiar qué se
 * bloquea.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeWorkspace, baseConfig, bash, write, edit } = require('./hooks-fixture');

const ROOT = path.resolve(__dirname, '..');
const H = (name) => `scripts/hooks/${name}.js`;

// Se arma por partes: este archivo no puede contener, él mismo, un secreto con forma real.
const AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const ATTRIBUTION = 'Co-Authored-By: Claude <noreply@' + 'anthropic.com>';

let ws;
before(() => {
  ws = makeWorkspace();
});
after(() => ws.cleanup());

// ---------------------------------------------------------------------------
// Equivalencia con los hooks sueltos
// ---------------------------------------------------------------------------

describe('dispatch: decide lo mismo que cada hook por separado', () => {
  const BASH_HOOKS = ['pre-bash-slot-deps', 'pre-bash-slot-migrations', 'pre-commit-attribution', 'pre-write-protected'];
  const WRITE_HOOKS = ['pre-write-secrets', 'pre-write-protected'];

  function compare(event, hooks, payload, label) {
    const singles = hooks.map((h) => ({ h, r: ws.hook(h, payload) }));
    const expected = singles.some((s) => s.r.code === 2) ? 2 : 0;
    const d = ws.dispatch(event, hooks.map(H), payload);
    assert.equal(d.code, expected, `${label}: el despachador salió con ${d.code}. stderr: ${d.stderr}`);
    // Cada motivo de bloqueo de los hooks sueltos aparece en el del despachador.
    for (const { h, r } of singles) {
      if (r.code !== 2) continue;
      const first = r.stderr.split('\n')[0];
      assert.ok(d.stderr.includes(first), `${label}: falta el motivo de ${h} ("${first}")`);
    }
    return d;
  }

  const cases = () => [
    ['ls -la', ws.dir],
    ['git status', ws.dir],
    ['npm ci', ws.repo()],
    ['npm ci', ws.slotRepo()],
    ['npm run migration:run', ws.slotRepo()],
    ['npm run migration:show', ws.slotRepo()],
    ['git commit -m "fix: algo"', ws.dir],
    [`git commit -m "fix: algo\n\n${ATTRIBUTION}"`, ws.dir],
    [`cd worktrees/implementation-1/svc-api && npm ci && git commit -m "x\n\n${ATTRIBUTION}"`, ws.dir],
    ['echo hola > svc-api/package-lock.json', ws.dir],
  ];

  test('comandos de shell', () => {
    for (const [command, cwd] of cases()) compare('pre-bash', BASH_HOOKS, bash(command, cwd), command);
  });

  test('dos hooks que bloquean el mismo comando: van los dos motivos', () => {
    const d = compare(
      'pre-bash',
      BASH_HOOKS,
      bash(`cd worktrees/implementation-1/svc-api && npm ci && git commit -m "x\n\n${ATTRIBUTION}"`, ws.dir),
      'doble',
    );
    assert.equal(d.code, 2);
    assert.match(d.stderr, /enlace \(junction en Windows/);
    assert.match(d.stderr, /atribución de IA/);
  });

  test('escrituras', () => {
    const file = path.join(ws.dir, 'svc-api', 'src', 'config.ts');
    compare('pre-write', WRITE_HOOKS, write(file, ws.dir, 'export const x = 1;'), 'write limpio');
    compare('pre-write', WRITE_HOOKS, write(file, ws.dir, `const key = "${AWS_KEY}";`), 'write con secreto');
    compare('pre-write', WRITE_HOOKS, edit(file, ws.dir), 'edit');
  });
});

// ---------------------------------------------------------------------------
// Robustez
// ---------------------------------------------------------------------------

describe('dispatch: fail-open por hook y hooks propios', () => {
  test('un hook propio que no es módulo corre en su proceso, con la misma entrada', () => {
    ws.put(
      'scripts/hooks/propio.js',
      [
        "let d = '';",
        "process.stdin.on('data', (c) => (d += c));",
        "process.stdin.on('end', () => {",
        "  if (d.includes('prohibido')) { process.stderr.write('el hook propio dice que no'); process.exit(2); }",
        '  process.exit(0);',
        '});',
      ].join('\n'),
    );
    const hooks = [H('pre-commit-attribution'), H('propio')];
    const blocked = ws.dispatch('pre-bash', hooks, bash('echo prohibido', ws.dir));
    assert.equal(blocked.code, 2, blocked.stderr);
    assert.match(blocked.stderr, /el hook propio dice que no/);
    assert.equal(ws.dispatch('pre-bash', hooks, bash('ls', ws.dir)).code, 0);
  });

  test('un hook propio que revienta no bloquea, y lo dice', () => {
    ws.put('scripts/hooks/roto.js', "throw new Error('boom');");
    const r = ws.dispatch('pre-bash', [H('roto')], bash('ls', ws.dir));
    assert.equal(r.code, 0);
    assert.match(r.stderr, /roto\.js salió con 1/);
  });

  test('un módulo cuyo handler revienta no tumba a los demás', () => {
    ws.put(
      'scripts/hooks/revienta.js',
      "const core = require('../lib/guard-core');\n" +
        "core.defineHook(module, 'revienta', () => { throw new Error('boom'); }, { config: 'none' });\n",
    );
    const r = ws.dispatch(
      'pre-bash',
      [H('revienta'), H('pre-commit-attribution')],
      bash(`git commit -m "x\n\n${ATTRIBUTION}"`, ws.dir),
    );
    assert.equal(r.code, 2, 'el otro hook sigue bloqueando');
    assert.match(r.stderr, /\[revienta\] error propio \(boom\)/);
  });

  test('un script registrado que falta se dice, no se calla', () => {
    const r = ws.dispatch('pre-bash', [H('no-existe')], bash('ls', ws.dir));
    assert.equal(r.code, 0);
    assert.match(r.stderr, /falta scripts\/hooks\/no-existe\.js/);
  });

  test('entrada vacía o ilegible: deja pasar', () => {
    assert.equal(ws.dispatch('pre-bash', [H('pre-commit-attribution')], '').code, 0);
    assert.equal(ws.dispatch('pre-bash', [H('pre-commit-attribution')], '{ no es json').code, 0);
  });

  test('el filtro previo: un comando que no le interesa a nadie no carga la configuración', () => {
    ws.setConfig('{ esto no es json');
    try {
      const quiet = ws.dispatch('pre-bash', [H('pre-commit-attribution'), H('pre-commit-gates')], bash('ls -la', ws.dir));
      assert.equal(quiet.code, 0);
      assert.equal(quiet.stderr, '', 'sin cargar la config no hay nada que avisar');

      // Un commit sí la necesita: con la config rota se deja pasar y se avisa.
      const loud = ws.dispatch('pre-bash', [H('pre-commit-attribution')], bash('git commit -m x', ws.dir));
      assert.equal(loud.code, 0);
      assert.match(loud.stderr, /pre-commit-attribution/);
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});

// ---------------------------------------------------------------------------
// pre-write-secrets en el mismo proceso
// ---------------------------------------------------------------------------

describe('pre-write-secrets sin proceso hijo', () => {
  const file = () => path.join(ws.dir, 'svc-api', 'src', 'keys.ts');

  test('bloquea un Write y un Edit con un secreto; deja pasar lo limpio', () => {
    const w = ws.hook('pre-write-secrets', write(file(), ws.dir, `const key = "${AWS_KEY}";`));
    assert.equal(w.code, 2, w.stderr);
    assert.match(w.stderr, /SEC-2/);
    assert.match(w.stderr, /svc-api\/src\/keys\.ts/);

    const e = ws.hook('pre-write-secrets', {
      tool_name: 'Edit',
      cwd: ws.dir,
      tool_input: { file_path: file(), old_string: 'a', new_string: `const key = "${AWS_KEY}";` },
    });
    assert.equal(e.code, 2, e.stderr);

    assert.equal(ws.hook('pre-write-secrets', write(file(), ws.dir, 'const key = process.env.KEY;')).code, 0);
  });

  test('bloquea aunque la configuración del proyecto no exista', () => {
    ws.removeConfig();
    try {
      const r = ws.hook('pre-write-secrets', write(file(), ws.dir, `const key = "${AWS_KEY}";`));
      assert.equal(r.code, 2, r.stderr);
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});

// ---------------------------------------------------------------------------
// post-edit-checks
// ---------------------------------------------------------------------------

describe('post-edit-checks', () => {
  // `ó` leída como latin-1: el defecto que busca el gate de codificación.
  const MOJIBAKE = 'acci' + String.fromCharCode(0xc3, 0xb3) + 'n';

  test('reporta un hallazgo en el archivo escrito y lo cachea por contenido', () => {
    fs.rmSync(path.join(ws.dir, '.ai-gates-cache.json'), { force: true });
    const abs = ws.put('svc-lib/notas.txt', `una ${MOJIBAKE} rota\n`);

    const first = ws.hook('post-edit-checks', write(abs, ws.dir));
    assert.equal(first.code, 2, first.stderr);
    assert.match(first.stderr, /ENC-1\.1/);
    assert.match(first.stderr, /notas\.txt:1/);

    const cache = JSON.parse(ws.read('.ai-gates-cache.json'));
    assert.ok(Object.keys(cache).some((k) => k.startsWith('encoding:')), JSON.stringify(cache));

    // El mismo contenido otra vez: el resultado del caché vuelve a mostrarse.
    const again = ws.hook('post-edit-checks', write(abs, ws.dir));
    assert.equal(again.code, 2);
    assert.match(again.stderr, /ENC-1\.1/);

    const last = JSON.parse(ws.read('.ai-gates-log.jsonl').trim().split('\n').pop());
    assert.equal(last.file, 'svc-lib/notas.txt');
    assert.equal(last.blocked, true);
  });

  test('un archivo limpio pasa en silencio', () => {
    const abs = ws.put('svc-lib/limpio.txt', 'acción bien escrita\n');
    const r = ws.hook('post-edit-checks', write(abs, ws.dir));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
  });

  test('por el despachador decide lo mismo', () => {
    const abs = ws.put('svc-lib/otra.txt', `${MOJIBAKE}\n`);
    const r = ws.dispatch('post-write', [H('post-edit-checks')], write(abs, ws.dir));
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /ENC-1\.1/);
  });

  test('sin configuración sale en silencio', () => {
    const abs = ws.put('svc-lib/sin-config.txt', `${MOJIBAKE}\n`);
    ws.removeConfig();
    try {
      const r = ws.hook('post-edit-checks', write(abs, ws.dir));
      assert.equal(r.code, 0);
      assert.equal(r.stderr, '');
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

describe('el log de los hooks rota', () => {
  test('pasado el tope se mueve a .ai-gates-log.1.jsonl y se sigue escribiendo', () => {
    const big = `${'x'.repeat(1023)}\n`.repeat(1100); // ~1.1 MB
    ws.put('.ai-gates-log.jsonl', big);
    fs.rmSync(path.join(ws.dir, '.ai-gates-log.1.jsonl'), { force: true });

    const r = ws.hook('pre-write-secrets', write(path.join(ws.dir, 'a.ts'), ws.dir, `const k = "${AWS_KEY}";`));
    assert.equal(r.code, 2);

    assert.equal(fs.statSync(path.join(ws.dir, '.ai-gates-log.1.jsonl')).size, big.length);
    const lines = ws.read('.ai-gates-log.jsonl').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).hook, 'pre-write-secrets');
  });
});

// ---------------------------------------------------------------------------
// Status line: la rama sin lanzar git
// ---------------------------------------------------------------------------

describe('statusline: la rama se lee de HEAD', () => {
  const { branchFromHead } = require(path.join(ROOT, 'scripts', 'statusline.js'));

  function repoWithHead(head, { asWorktree = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-head-'));
    if (asWorktree) {
      const real = path.join(dir, 'real-gitdir');
      fs.mkdirSync(real, { recursive: true });
      fs.writeFileSync(path.join(real, 'HEAD'), head);
      fs.mkdirSync(path.join(dir, 'wt'));
      fs.writeFileSync(path.join(dir, 'wt', '.git'), `gitdir: ${path.join('..', 'real-gitdir')}\n`);
      return { dir: path.join(dir, 'wt'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    }
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), head);
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  test('rama, rama con barras, desacoplado y worktree', () => {
    for (const [head, want, opts] of [
      ['ref: refs/heads/main\n', 'main'],
      ['ref: refs/heads/feat/hooks-baratos\n', 'feat/hooks-baratos'],
      ['0123456789abcdef0123456789abcdef01234567\n', 'detached@0123456'],
      ['ref: refs/heads/slot\n', 'slot', { asWorktree: true }],
    ]) {
      const r = repoWithHead(head, opts);
      try {
        assert.equal(branchFromHead(r.dir), want, head);
      } finally {
        r.cleanup();
      }
    }
  });

  test('lo que no entiende lo deja a git (undefined)', () => {
    const r = repoWithHead('algo raro\n');
    try {
      assert.equal(branchFromHead(r.dir), undefined);
      assert.equal(branchFromHead(path.join(r.dir, 'no-existe')), undefined);
    } finally {
      r.cleanup();
    }
  });

  test('coincide con git en este mismo repositorio', () => {
    const { execFileSync } = require('child_process');
    let fromGit;
    try {
      fromGit = execFileSync('git', ['-C', ROOT, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    } catch {
      return; // sin git no hay contra qué comparar
    }
    if (fromGit) assert.equal(branchFromHead(ROOT), fromGit);
  });
});

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

describe('preflight: lo que la máquina necesita', () => {
  const pf = require(path.join(ROOT, 'scripts', 'lib', 'preflight.js'));
  const probe = (versions) => (name) => (name in versions ? versions[name] : null);

  test('todo en orden: sin errores ni avisos', () => {
    const r = pf.check({ current: '20.11.0', versionOf: probe({ node: 'v20.11.0', git: 'git version 2.45.0' }) });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });

  test('sin node en el PATH es un error: los hooks no correrían', () => {
    const r = pf.check({ current: '20.11.0', versionOf: probe({ git: 'git version 2.45.0' }) });
    assert.ok(r.errors.some((e) => /no está en el PATH/.test(e)), r.errors.join('\n'));
  });

  test('un node viejo, el que corre o el del PATH, es un error', () => {
    assert.ok(pf.check({ current: '16.20.0', versionOf: probe({ node: 'v20.0.0', git: 'g' }) }).errors.length > 0);
    assert.ok(pf.check({ current: '20.0.0', versionOf: probe({ node: 'v16.20.0', git: 'g' }) }).errors.length > 0);
  });

  test('sin git es un aviso, no un error', () => {
    const r = pf.check({ current: '20.0.0', versionOf: probe({ node: 'v20.0.0' }) });
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => /git/.test(w)));
  });

  test('esta máquina pasa (la suite corre con node y git)', () => {
    assert.deepEqual(pf.check().errors, []);
  });
});
