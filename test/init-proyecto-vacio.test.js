#!/usr/bin/env node
/**
 * init-proyecto-vacio.test.js — la base instalada en un proyecto nuevo.
 *
 * Las demás pruebas miran cada pieza por separado. Esta mira lo que ninguna ve:
 * que **juntas** se instalen bien. Genera un proyecto a partir de la base como
 * lo haría quien usa la plantilla (un clon limpio: solo lo versionado), con dos
 * repositorios de aplicación, corre `init` desatendido y comprueba el resultado.
 *
 * Dos de los defectos que encontró la primera vez que se hizo a mano:
 *   - el registro de candidatos a gate arrancaba con entradas ajenas, y un
 *     proyecto nuevo salía con hallazgos que no eran suyos;
 *   - un gate de aislamiento entre clientes que salía 2 para siempre sobre el
 *     repositorio de frontend, dejando `run-gates --all` en rojo permanente.
 *
 * Solo corre en la base: un proyecto ya instalado no es un clon limpio de nada.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT, hasTool } = require('./helpers');

function enLaBase() {
  if (!hasTool('git')) return 'git no está instalado';
  if (fs.existsSync(path.join(ROOT, 'template.lock.json'))) return 'es un proyecto ya instalado, no la base';
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    return 'no es un repositorio git: no se puede armar un clon limpio';
  }
  return false;
}

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdio: 'pipe',
  });

const node = (cwd, ...args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 280000 });

/** Los archivos de un clon limpio: lo versionado y lo nuevo que no está ignorado. */
function cleanFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function buildProject(tmp) {
  const dir = path.join(tmp, 'proyecto');
  for (const rel of cleanFiles()) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) continue; // borrado y todavía sin `git rm`
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(dir, rel));
  }

  for (const [name, file, code] of [
    ['mi-api', 'src/app.service.ts', 'export class AppService { listar() { return []; } }\n'],
    ['mi-web', 'src/page.tsx', 'export default function Page() { return null; }\n'],
  ]) {
    const repo = path.join(dir, name);
    fs.mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), code);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
  }

  fs.writeFileSync(
    path.join(dir, 'plan.json'),
    JSON.stringify({
      version: 1,
      project: { name: 'prueba', title: 'Prueba', ticketPrefix: 'PRU', language: 'es' },
      topology: 'multi-repo',
      repos: [
        {
          name: 'mi-api',
          path: 'mi-api',
          packs: ['nestjs'],
          baseBranch: 'main',
          database: {
            shared: true,
            migrationsDir: 'src/database/migrations',
            writeCommands: ['migration:run'],
            generateCommands: ['migration:generate'],
            readOnlyAllowed: ['migration:show'],
          },
        },
        { name: 'mi-web', path: 'mi-web', packs: ['nextjs'], baseBranch: 'main', consumes: ['mi-api'] },
      ],
      packs: ['multi-tenant'],
      harnesses: ['claude', 'opencode', 'agents-md'],
      worktrees: { enabled: true, dir: 'worktrees', slots: ['implementation-1', 'review'] },
      tenant: { column: 'tenant_id' },
      commits: { forbidAiAttribution: true },
    }),
  );
  return dir;
}

describe('init en un proyecto vacío', { skip: enLaBase() }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-init-'));
  let dir;
  let init;

  test('init desatendido termina bien', { timeout: 290000 }, () => {
    dir = buildProject(tmp);
    init = node(dir, 'init.js', '--config', 'plan.json');
    assert.equal(init.status, 0, init.stdout + init.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'ai-workspace.json')));
    assert.ok(fs.existsSync(path.join(dir, 'template.lock.json')));
  });

  test('instala solo los packs elegidos y descarta el resto', () => {
    for (const kept of ['nestjs', 'nextjs', 'multi-tenant']) {
      assert.ok(fs.existsSync(path.join(dir, 'ai', 'packs', kept)), `falta ${kept}`);
    }
    for (const dropped of ['dotnet', 'openspec', 'e2e', 'fullstack', 'tracker-jira', 'tracker-github']) {
      assert.ok(!fs.existsSync(path.join(dir, 'ai', 'packs', dropped)), `sobra ${dropped}`);
    }
  });

  test('los hooks quedan registrados con ruta absoluta al proyecto y la marca de administrado', () => {
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    const cmds = Object.values(s.hooks)
      .flat()
      .flatMap((g) => g.hooks.map((h) => h.command));
    // Un comando por evento (el despachador), con los scripts de ese evento.
    assert.equal(cmds.length, 3, cmds.join('\n'));
    for (const c of cmds) {
      assert.match(
        c,
        /^node "\$CLAUDE_PROJECT_DIR\/scripts\/hooks\/dispatch\.js" (pre-write|post-write|pre-bash)( scripts\/hooks\/[\w-]+\.js)+ --ai-managed$/,
        c,
      );
    }
    assert.ok(cmds.join(' ').match(/scripts\/hooks\/[\w-]+\.js/g).length >= 5, cmds.join('\n'));
    // Los condicionados a la configuración entran SOLO si su condición se cumple.
    assert.ok(cmds.some((c) => c.includes('pre-bash-slot-deps')), 'worktrees habilitado');
    assert.ok(cmds.some((c) => c.includes('pre-bash-slot-migrations')), 'database declarada');
    assert.ok(cmds.some((c) => c.includes('pre-commit-attribution')), 'commits.forbidAiAttribution');
    assert.ok(!cmds.some((c) => c.includes('pre-commit-gates')), 'opcional: no se enciende solo');
    assert.equal(s.statusLine && s.statusLine.command.includes('statusline'), true);
    assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'ai-pre-write-secrets.js')));
  });

  test('consolidate-skills --check queda en verde', () => {
    const r = node(dir, 'scripts/consolidate-skills.js', '--check');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('el registro de candidatos a gate arranca vacío, con su leyenda, y pasa su lint', () => {
    const text = fs.readFileSync(path.join(dir, 'ai', 'gate-candidates.md'), 'utf8');
    assert.match(text, /## Estados/, 'conserva la leyenda');
    assert.match(text, /Todavía no hay ninguno/);
    assert.doesNotMatch(text, /Objeto liberable|EF Core/, 'las entradas de la base no son del proyecto');
    const r = node(dir, 'scripts/check-gate-candidates.js');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('ninguna ruta citada está rota', () => {
    const r = node(dir, 'scripts/check-context-links.js', '--scope', 'workspace');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('run-gates --all sale en verde y dice honestamente lo que no corrió', () => {
    const r = node(dir, 'scripts/run-gates.js', '--all');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // El frontend no consulta la base: "NO CORRIÓ" con motivo, no un error permanente.
    assert.match(r.stdout, /aislamiento entre clientes — NO CORRIÓ/);
    // Sin tablero de requisitos tampoco es "limpio".
    assert.match(r.stdout, /tablero de requisitos — NO CORRIÓ/);
    // Ningún gate que DEBÍA correr quedó sin poder. Se miran los encabezados de
    // gate (`### nombre — ESTADO`): el pie estándar del bloque nombra el estado
    // en una frase y haría coincidir siempre.
    assert.doesNotMatch(r.stdout, /^### .* — NO SE PUDO EJECUTAR/m, r.stdout);
  });

  test('un slot se abre, se commitea, se lee con --from y se libera', () => {
    // Un remoto local para cada repo: promote y release lo necesitan.
    for (const name of ['mi-api']) {
      const bare = path.join(tmp, 'remotos', `${name}.git`);
      fs.mkdirSync(bare, { recursive: true });
      git(bare, 'init', '-q', '--bare', '-b', 'main');
      const repo = path.join(dir, name);
      git(repo, 'remote', 'add', 'origin', bare);
      git(repo, 'push', '-q', '-u', 'origin', 'main');
    }

    const open = node(dir, 'scripts/manage-worktree.js', 'open', '--slot', 'implementation-1', '--repo', 'mi-api', '--branch', 'feat/PRU-1-x');
    assert.equal(open.status, 0, open.stdout + open.stderr);

    const slot = path.join(dir, 'worktrees', 'implementation-1', 'mi-api');
    const upstream = execFileSync('git', ['for-each-ref', '--format=%(upstream)', 'refs/heads/feat/PRU-1-x'], {
      cwd: slot,
      encoding: 'utf8',
    });
    assert.equal(upstream.trim(), '', 'una rama nueva se crea SIN upstream');

    fs.mkdirSync(path.join(slot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(slot, 'src', 'cosa.service.ts'),
      'export class Cosa {\n  async tragar() {\n    try { await this.hacer(); } catch (e) { }\n  }\n}\n',
    );
    git(slot, 'add', '-A');
    git(slot, 'commit', '-qm', 'feat(cosa): add cosa');

    // Los gates leen DEL SLOT: el hallazgo está en el slot y no en la principal.
    const desdeElSlot = node(dir, 'scripts/run-gates.js', '--repo', 'mi-api', '--from', 'implementation-1');
    assert.equal(desdeElSlot.status, 1, 'hay un hallazgo en el diff del slot');
    assert.match(desdeElSlot.stdout, /CORE-1\.1\] src\/cosa\.service\.ts/);
    assert.match(desdeElSlot.stdout, /leído desde worktrees[\\/]implementation-1/);

    const principal = node(dir, 'scripts/run-gates.js', '--repo', 'mi-api');
    assert.equal(principal.status, 0, 'la principal NO tiene ese código: auditar la principal daría limpio');

    git(slot, 'push', '-q', '-u', 'origin', 'feat/PRU-1-x');
    const promote = node(dir, 'scripts/manage-worktree.js', 'promote', '--slot', 'implementation-1', '--repo', 'mi-api');
    assert.equal(promote.status, 0, promote.stdout + promote.stderr);
    assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: path.join(dir, 'mi-api'), encoding: 'utf8' }).trim(), 'feat/PRU-1-x');

    const release = node(dir, 'scripts/manage-worktree.js', 'release', '--repo', 'mi-api');
    assert.equal(release.status, 0, release.stdout + release.stderr);
    assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: path.join(dir, 'mi-api'), encoding: 'utf8' }).trim(), 'main');
  });

  test('limpieza', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
