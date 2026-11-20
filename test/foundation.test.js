#!/usr/bin/env node
/**
 * foundation.test.js — los cimientos del circuito de trabajo.
 *
 * Cubre lo que todo lo demás da por sentado: el esquema nuevo de
 * `ai-workspace.json`, la definición ÚNICA de qué es un slot, la resolución del
 * directorio de dependencias compartido y el registro declarativo de hooks.
 *
 * El registro de hooks se prueba en un workspace temporal copiado, nunca sobre
 * el repositorio de la base: `consolidate-skills` escribe `.claude/settings.json`
 * y un test que lo hiciera sobre el repo real pisaría la configuración de quien
 * lo corre.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, withTempDir } = require('./helpers');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function baseConfig(extra = {}) {
  return {
    version: 1,
    project: { name: 'demo', ticketPrefix: 'DEM' },
    topology: 'multi-repo',
    repos: [
      { name: 'api', path: 'api', packs: ['nestjs'], baseBranch: 'trunk' },
      { name: 'web', path: 'web', packs: ['nextjs'], baseBranch: 'trunk' },
      { name: 'ops', path: 'ops', baseBranch: 'trunk' },
    ],
    harnesses: [],
    worktrees: { enabled: true, dir: 'worktrees', slots: ['implementation-1', 'review'] },
    ...extra,
  };
}

/** Carga la config en un proceso aparte (el módulo cachea y fija la ruta al requerirse). */
function load(config) {
  return withTempDir((dir) => {
    const file = path.join(dir, 'ai-workspace.json');
    fs.writeFileSync(file, JSON.stringify(config));
    const code = `
      const c = require(${JSON.stringify(path.join(ROOT, 'scripts/lib/workspace-config'))});
      try { process.stdout.write(JSON.stringify({ ok: true, cfg: (() => { const x = c.load(); delete x.raw; return x; })() })); }
      catch (e) { process.stdout.write(JSON.stringify({ ok: false, name: e.name, message: e.message })); }
    `;
    const run = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8',
      env: { ...process.env, AI_WORKSPACE_CONFIG: file },
    });
    return JSON.parse(run.stdout);
  });
}

/** Un workspace mínimo con la base copiada, para probar el registro de hooks. */
function makeWorkspace(dir, config, { settings } = {}) {
  const copy = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  for (const rel of ['scripts', 'ai', 'template.manifest.json', 'VERSION']) copy(rel);
  fs.writeFileSync(path.join(dir, 'ai-workspace.json'), JSON.stringify(config));
  if (settings) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  }
  return dir;
}

function consolidate(dir, ...args) {
  const run = spawnSync(process.execPath, [path.join(dir, 'scripts', 'consolidate-skills.js'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { code: run.status, out: String(run.stdout) + String(run.stderr) };
}

function readSettings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
}

function commandsOf(settings) {
  return Object.values(settings.hooks || {})
    .flat()
    .flatMap((g) => g.hooks.map((h) => h.command));
}

// ---------------------------------------------------------------------------
// Esquema de ai-workspace.json
// ---------------------------------------------------------------------------

describe('esquema: campos del circuito de trabajo', () => {
  test('una configuración de 1.1.0 sigue siendo válida y no activa nada nuevo', () => {
    const r = load({
      version: 1,
      project: { name: 'viejo' },
      topology: 'single-repo',
      repos: [{ name: 'viejo', path: '.' }],
    });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.cfg.tracker.kind, 'none');
    assert.equal(r.cfg.forge.kind, 'none');
    assert.equal(r.cfg.requirements, null);
    assert.equal(r.cfg.commits.forbidAiAttribution, false);
    assert.equal(r.cfg.repos[0].database, null);
    assert.equal(r.cfg.repos[0].deps, null);
  });

  test('un slot declarado como texto deduce su tipo por el nombre', () => {
    const r = load(baseConfig());
    assert.deepEqual(r.cfg.worktrees.slots, ['implementation-1', 'review']);
    assert.deepEqual(
      r.cfg.worktrees.slotDefs.map((s) => `${s.name}:${s.kind}`),
      ['implementation-1:implementation', 'review:review'],
    );
  });

  test('un slot declarado como objeto pisa el tipo deducido', () => {
    const r = load(
      baseConfig({ worktrees: { enabled: true, slots: [{ name: 'qa', kind: 'review' }, 'implementation-1'] } }),
    );
    assert.equal(r.cfg.worktrees.slotDefs[0].kind, 'review');
  });

  test('rechaza tracker, forge y tipos de slot desconocidos con un mensaje que dice qué hacer', () => {
    for (const [patch, fragment] of [
      [{ tracker: { kind: 'trello' } }, 'tracker.kind'],
      [{ forge: { kind: 'svn' } }, 'forge.kind'],
      [{ worktrees: { enabled: true, slots: [{ name: 'x', kind: 'otro' }] } }, 'kind'],
      [{ worktrees: { enabled: true, slots: ['a', 'a'] } }, 'duplicado'],
      [{ worktrees: { enabled: true, slots: ['Mal Nombre'] } }, 'nombre del slot'],
    ]) {
      const r = load(baseConfig(patch));
      assert.equal(r.ok, false, `debía rechazar ${JSON.stringify(patch)}`);
      assert.match(r.message, new RegExp(fragment), r.message);
    }
  });

  test('database se normaliza y rechaza listas que no son de texto', () => {
    const ok = load(
      baseConfig({
        repos: [
          {
            name: 'api',
            path: 'api',
            database: { migrationsDir: 'db/m', writeCommands: ['migrar'], generateAlternative: 'node x.js' },
          },
        ],
      }),
    );
    assert.equal(ok.ok, true, ok.message);
    assert.equal(ok.cfg.repos[0].database.shared, true);
    assert.deepEqual(ok.cfg.repos[0].database.generateCommands, []);

    const bad = load(baseConfig({ repos: [{ name: 'api', path: 'api', database: { writeCommands: 'migrar' } }] }));
    assert.equal(bad.ok, false);
    assert.match(bad.message, /writeCommands/);
  });

  test('la rama base sale de la configuración y nunca de una constante', () => {
    const r = load(baseConfig());
    assert.ok(r.cfg.repos.every((x) => x.baseBranch === 'trunk'));
  });
});

// ---------------------------------------------------------------------------
// Qué es un slot
// ---------------------------------------------------------------------------

describe('worktree-paths: una sola definición de slot', () => {
  const cfg = {
    root: path.join(path.sep, 'ws'),
    worktrees: {
      dir: 'worktrees',
      slots: ['implementation-1', 'review'],
      slotDefs: [
        { name: 'implementation-1', kind: 'implementation' },
        { name: 'review', kind: 'review' },
      ],
    },
    repos: [
      { name: 'api', path: 'api', absPath: path.join(path.sep, 'ws', 'api') },
      { name: 'web', path: 'web', absPath: path.join(path.sep, 'ws', 'web') },
    ],
  };
  const wp = require(path.join(ROOT, 'scripts', 'lib', 'worktree-paths'));

  test('reconoce un slot en rutas con / y con \\, relativas y absolutas', () => {
    for (const text of [
      'worktrees/implementation-1/api',
      'worktrees\\implementation-1\\api',
      'D:\\proyecto\\worktrees\\implementation-1\\api\\src\\x.ts',
      '/home/u/proyecto/worktrees/implementation-1/api/src/x.ts',
      'npm --prefix worktrees/implementation-1/api install',
      'cd "worktrees/implementation-1/api" && ls',
    ]) {
      const hit = wp.parseSlotPath(cfg, text);
      assert.ok(hit, `debía reconocer: ${text}`);
      assert.equal(hit.slot, 'implementation-1');
      assert.equal(hit.repo, 'api');
    }
  });

  test('devuelve lo que sigue al repositorio y el tipo del slot', () => {
    const hit = wp.parseSlotPath(cfg, 'worktrees/review/web/src/app/page.tsx');
    assert.equal(hit.kind, 'review');
    assert.equal(hit.rest, 'src/app/page.tsx');
  });

  test('un slot abierto a mano con un nombre no declarado sigue siendo un slot', () => {
    // Un hook que no ve el slot deja pasar justo el comando que tenía que bloquear.
    const hit = wp.parseSlotPath(cfg, 'worktrees/verif-manual/api');
    assert.ok(hit);
    assert.equal(hit.kind, 'implementation');
  });

  test('NO reconoce lo que no es un slot', () => {
    for (const text of [
      'api/src/x.ts',
      'git status',
      'worktrees/implementation-1', // sin repositorio
      'worktrees/implementation-1/otro', // repositorio no declarado
      'miworktrees/implementation-1/api', // el directorio debe ser exacto
      'rm -rf /tmp/basura',
    ]) {
      assert.equal(wp.parseSlotPath(cfg, text), null, `no debía reconocer: ${text}`);
    }
  });

  test('un repositorio con nombre que es prefijo de otro no se confunde', () => {
    const c = { ...cfg, repos: [{ name: 'app', path: 'app' }, { name: 'app-admin', path: 'app-admin' }] };
    assert.equal(wp.parseSlotPath(c, 'worktrees/review/app-admin/x').repo, 'app-admin');
  });

  test('resolveRepo devuelve el repositorio LÓGICO aunque se lea desde un slot', () => {
    const byName = wp.resolveRepo(cfg, 'api');
    assert.equal(byName.isSlot, false);
    assert.equal(byName.repo.name, 'api');

    const fromSlot = wp.resolveRepo(cfg, 'worktrees/review/api');
    assert.equal(fromSlot.isSlot, true);
    assert.equal(fromSlot.slot, 'review');
    assert.equal(fromSlot.repo.name, 'api', 'el nombre que va en hallazgos y baseline es el lógico');
    assert.equal(fromSlot.dir, path.join(cfg.root, 'worktrees', 'review', 'api'));

    assert.equal(wp.resolveRepo(cfg, 'desconocido'), null);
    assert.equal(wp.resolveRepo(cfg, undefined), null);
  });

  test('repoArgFrom construye el --repo que apunta al slot', () => {
    assert.equal(wp.repoArgFrom(cfg, 'api', 'review'), 'worktrees/review/api');
    assert.equal(wp.repoArgFrom(cfg, 'api', null), 'api');
  });

  test('findWorkspaceRoot gana el ancestro MÁS EXTERNO (en single-repo un slot trae su propio config)', () => {
    withTempDir((dir) => {
      const inner = path.join(dir, 'worktrees', 'implementation-1');
      fs.mkdirSync(inner, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ai-workspace.json'), '{}');
      fs.writeFileSync(path.join(inner, 'ai-workspace.json'), '{}');
      assert.equal(fs.realpathSync(wp.findWorkspaceRoot(path.join(inner, 'src'))), fs.realpathSync(dir));
    });
  });

  test('findWorkspaceRoot devuelve null fuera de un workspace', () => {
    withTempDir((dir) => assert.equal(wp.findWorkspaceRoot(dir), null));
  });
});

// ---------------------------------------------------------------------------
// Perfiles de dependencias
// ---------------------------------------------------------------------------

describe('deps-profiles: qué comparte un repositorio con sus slots', () => {
  function resolve(config) {
    return withTempDir((dir) => {
      const file = path.join(dir, 'ai-workspace.json');
      fs.writeFileSync(file, JSON.stringify(config));
      const code = `
        const wc = require(${JSON.stringify(path.join(ROOT, 'scripts/lib/workspace-config'))});
        const dp = require(${JSON.stringify(path.join(ROOT, 'scripts/lib/deps-profiles'))});
        try {
          const cfg = wc.load();
          const out = {};
          for (const r of cfg.repos) { const p = dp.profileFor(cfg, r); out[r.name] = p && { id: p.id, source: p.source, dir: p.dir, lockfile: p.lockfile, repair: p.repair }; }
          process.stdout.write(JSON.stringify({ ok: true, out }));
        } catch (e) { process.stdout.write(JSON.stringify({ ok: false, message: e.message })); }
      `;
      const run = spawnSync(process.execPath, ['-e', code], {
        encoding: 'utf8',
        env: { ...process.env, AI_WORKSPACE_CONFIG: file },
      });
      return JSON.parse(run.stdout);
    });
  }

  test('el perfil sale del pack; un repositorio sin pack ni deps no comparte nada', () => {
    const r = resolve(baseConfig());
    assert.equal(r.ok, true, r.message);
    assert.equal(r.out.api.id, 'node');
    assert.equal(r.out.api.source, 'pack');
    assert.equal(r.out.api.dir, 'node_modules');
    assert.equal(r.out.ops, null, 'sin perfil, ninguna guarda de dependencias se activa');
  });

  test('un repositorio no-Node declara su perfil sin tocar el núcleo', () => {
    const r = resolve(
      baseConfig({ repos: [{ name: 'svc', path: 'svc', deps: 'python' }, { name: 'site', path: 'site', deps: 'php' }] }),
    );
    assert.equal(r.out.svc.dir, '.venv');
    assert.equal(r.out.site.dir, 'vendor');
    assert.equal(r.out.site.lockfile, 'composer.lock');
  });

  test('deps con profile + campos pisa solo esos campos', () => {
    const r = resolve(baseConfig({ repos: [{ name: 'svc', path: 'svc', deps: { profile: 'node', dir: 'packages/node_modules', repair: 'pnpm install --frozen-lockfile' } }] }));
    assert.equal(r.out.svc.dir, 'packages/node_modules');
    assert.equal(r.out.svc.repair, 'pnpm install --frozen-lockfile');
    assert.equal(r.out.svc.lockfile, 'package-lock.json');
  });

  test('un perfil completo propio sin `profile` se acepta', () => {
    const r = resolve(baseConfig({ repos: [{ name: 'svc', path: 'svc', deps: { dir: 'deps', managers: ['mi-gestor'] } }] }));
    assert.equal(r.out.svc.id, 'custom');
    assert.equal(r.out.svc.dir, 'deps');
  });

  test('un perfil inexistente falla con un mensaje accionable, no se ignora', () => {
    const r = resolve(baseConfig({ repos: [{ name: 'svc', path: 'svc', deps: 'ruby' }] }));
    assert.equal(r.ok, false);
    assert.match(r.message, /ruby/);
    assert.match(r.message, /depsProfiles/);
  });
});

// ---------------------------------------------------------------------------
// Registro declarativo de hooks
// ---------------------------------------------------------------------------

describe('hooks: registro declarativo vía consolidate-skills', () => {
  const claude = { harnesses: ['claude'] };

  test('registra los hooks del núcleo con ruta absoluta al proyecto y la marca de administrado', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude, worktrees: { enabled: false, slots: [] } }));
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);

      const cmds = commandsOf(readSettings(dir));
      assert.ok(cmds.length >= 2, 'al menos los hooks de siempre');
      for (const c of cmds) {
        assert.match(c, /^node "\$CLAUDE_PROJECT_DIR\/scripts\/hooks\/[\w-]+\.js" --ai-managed$/, c);
      }
      assert.ok(cmds.some((c) => c.includes('pre-write-secrets')));
      assert.ok(cmds.some((c) => c.includes('post-edit-checks')));
    });
  });

  test('un hook condicionado no se instala si su condición no se cumple', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude, worktrees: { enabled: false, slots: [] } }));
      consolidate(dir, '--wrappers');
      const cmds = commandsOf(readSettings(dir));
      for (const id of ['slot-deps', 'slot-migrations', 'commit-attribution', 'commit-gates', 'heredoc']) {
        assert.ok(!cmds.some((c) => c.includes(id)), `${id} no debía instalarse`);
      }
    });
  });

  test('un hook cuyo script no existe NO se registra (se vería como un hook que falla y deja pasar)', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }));
      // Un manifiesto local declara un hook sin script.
      fs.mkdirSync(path.join(dir, 'ai', 'local'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ai', 'local', 'manifest.json'),
        JSON.stringify({ hooks: [{ id: 'fantasma', event: 'pre-bash', script: 'scripts/hooks/no-existe.js' }] }),
      );
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);
      assert.ok(!commandsOf(readSettings(dir)).some((c) => c.includes('fantasma')));
      assert.match(consolidate(dir, '--list').out, /fantasma: falta el script/);
    });
  });

  test('respeta lo que el proyecto ya tiene: permisos, hooks propios y status line propia', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }), {
        settings: {
          permissions: { allow: ['Bash(git status:*)'] },
          hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node mio.js' }] }] },
          statusLine: { type: 'command', command: 'node mi-statusline.js' },
        },
      });
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);
      const s = readSettings(dir);
      assert.deepEqual(s.permissions.allow, ['Bash(git status:*)']);
      assert.ok(commandsOf(s).includes('node mio.js'), 'el hook propio sigue');
      assert.equal(s.statusLine.command, 'node mi-statusline.js', 'no se pisa la status line ajena');
    });
  });

  test('adopta los registros heredados: el mismo script no corre dos veces', () => {
    // Los de 1.1.0 eran relativos; los que un proyecto registró a mano traen
    // otras rutas. Si quedaran junto a los administrados, cada acción ejecutaría
    // el hook dos veces, y el relativo es el que falla con la sesión en un repo.
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude, worktrees: { enabled: false, slots: [] } }), {
        settings: {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  { type: 'command', command: 'node scripts/hooks/pre-write-secrets.js', timeout: 15 },
                  { type: 'command', command: 'node mi-hook-propio.js' },
                ],
              },
            ],
            PostToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/post-edit-checks.js"', timeout: 30 },
                ],
              },
            ],
          },
        },
      });
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /adoptado el registro heredado de pre-write-secrets/);
      assert.match(r.out, /adoptado el registro heredado de post-edit-checks/);

      const cmds = commandsOf(readSettings(dir));
      assert.equal(cmds.filter((c) => c.includes('pre-write-secrets')).length, 1, cmds.join('\n'));
      assert.equal(cmds.filter((c) => c.includes('post-edit-checks')).length, 1, cmds.join('\n'));
      assert.ok(cmds.every((c) => !c.startsWith('node scripts/hooks/')), 'ningún comando relativo');
      assert.ok(cmds.includes('node mi-hook-propio.js'), 'el hook propio del proyecto queda');
    });
  });

  test('es idempotente: regenerar no duplica ni cambia nada', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }));
      consolidate(dir, '--wrappers');
      const first = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
      consolidate(dir, '--wrappers');
      consolidate(dir, '--wrappers');
      assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), first);
    });
  });

  test('--check detecta un hook borrado a mano y regenerar lo repara', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }));
      consolidate(dir, '--wrappers');
      assert.equal(consolidate(dir, '--check').code, 0);

      const file = path.join(dir, '.claude', 'settings.json');
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete s.hooks;
      fs.writeFileSync(file, JSON.stringify(s));

      const drift = consolidate(dir, '--check');
      assert.equal(drift.code, 1, 'un hook faltante es drift');
      assert.match(drift.out, /settings\.json/);

      assert.equal(consolidate(dir, '--wrappers').code, 0);
      assert.equal(consolidate(dir, '--check').code, 0);
    });
  });

  test('un hook que la base deja de declarar se retira; el del proyecto queda', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }), {
        settings: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node mio.js' }] }] } },
      });
      consolidate(dir, '--wrappers');

      // El proyecto apaga un hook de la base.
      const cfgFile = path.join(dir, 'ai-workspace.json');
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      cfg.hooks = { 'pre-write-secrets': { enabled: false } };
      fs.writeFileSync(cfgFile, JSON.stringify(cfg));
      consolidate(dir, '--wrappers');

      const cmds = commandsOf(readSettings(dir));
      assert.ok(!cmds.some((c) => c.includes('pre-write-secrets')), 'apagado por el proyecto');
      assert.ok(cmds.some((c) => c.includes('post-edit-checks')));
      assert.ok(cmds.includes('node mio.js'));
    });
  });

  test('un settings.json que no es JSON no se pisa: se avisa', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ ...claude }));
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ esto no es json');
      const r = consolidate(dir, '--wrappers');
      assert.match(r.out, /no es JSON válido/);
      assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), '{ esto no es json');
    });
  });

  test('sin harnesses declarados no se escribe ningún archivo de harness', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ harnesses: [] }));
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);
      assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
      assert.equal(fs.existsSync(path.join(dir, '.opencode')), false);
    });
  });

  test('OpenCode: genera un plugin que delega en el mismo hook y avisa lo que no puede registrar', () => {
    withTempDir((dir) => {
      makeWorkspace(dir, baseConfig({ harnesses: ['opencode'], worktrees: { enabled: false, slots: [] } }));
      const r = consolidate(dir, '--wrappers');
      assert.equal(r.code, 0, r.out);

      const plugin = path.join(dir, '.opencode', 'plugins', 'ai-pre-write-secrets.js');
      assert.ok(fs.existsSync(plugin));
      const src = fs.readFileSync(plugin, 'utf8');
      assert.match(src, /ai-managed/);
      assert.match(src, /scripts\/hooks\/pre-write-secrets\.js/);
      assert.match(src, /status !== 2/, 'bloquea solo con la salida 2');
      assert.match(r.out, /post-edit-checks: OpenCode no tiene un evento equivalente/);

      // Un plugin propio del proyecto no se toca al regenerar.
      fs.writeFileSync(path.join(dir, '.opencode', 'plugins', 'mio.js'), '// propio');
      consolidate(dir, '--wrappers');
      assert.equal(fs.readFileSync(path.join(dir, '.opencode', 'plugins', 'mio.js'), 'utf8'), '// propio');
    });
  });
});

describe('harnesses: el bloque hooks se valida', () => {
  const h = require(path.join(ROOT, 'scripts', 'lib', 'harnesses'));

  test('un harness con hooks sin eventos es un error, no un harness que no protege', () => {
    const problems = h.problemsOf('x', { hooks: { format: 'claude-settings', file: '.x/s.json', command: 'node {script} --ai-managed', events: {} } });
    assert.ok(problems.some((p) => /hooks\.events/.test(p)));
  });

  test('el comando de un harness debe llevar la marca de administrado', () => {
    const problems = h.problemsOf('x', {
      hooks: { format: 'claude-settings', file: '.x/s.json', command: 'node {script}', events: { 'pre-bash': { event: 'E', matcher: 'M' } } },
    });
    assert.ok(problems.some((p) => /--ai-managed/.test(p)));
  });

  test('los harnesses de la base declaran hooks válidos', () => {
    const catalog = h.catalog({});
    for (const id of ['claude', 'opencode']) {
      assert.deepEqual(h.problemsOf(id, catalog[id]), [], id);
      assert.ok(catalog[id].hooks, `${id} debe declarar cómo recibe hooks`);
    }
  });
});
