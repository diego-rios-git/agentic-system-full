#!/usr/bin/env node
/**
 * hooks-fixture.js — un workspace temporal para probar los hooks como los corre
 * un proyecto: el script real, en un proceso aparte, con el JSON por stdin
 * armado con JSON.stringify (nunca por shell: bash se come las `\` de las rutas
 * de Windows) y rutas construidas con `path.join` sobre el workspace.
 *
 * Se copian `scripts/`, `ai/` y `template.manifest.json` a una carpeta temporal:
 * `workspace-config` fija su raíz según dónde viva el script, así que el hook
 * copiado ve el workspace de prueba y no el de la plantilla.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE = path.resolve(__dirname, '..');

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
}

/** La configuración base: tres repositorios (con perfil de deps, con base y sin nada). */
function baseConfig(extra = {}) {
  return {
    version: 1,
    project: { name: 'demo' },
    topology: 'multi-repo',
    repos: [
      {
        name: 'svc-api',
        path: 'svc-api',
        packs: ['nestjs'],
        database: {
          shared: true,
          migrationsDir: 'src/database/migrations',
          writeCommands: ['migration:run', 'migration:revert', 'npm run seed', 'ts-node src/database/seeds/'],
          generateCommands: ['migration:generate'],
          readOnlyAllowed: ['migration:show'],
          generateAlternative: 'node ai/packs/nestjs/scripts/migration-generate-shadow.js <Nombre> --from <slot>',
        },
      },
      { name: 'svc-web', path: 'svc-web', packs: ['nextjs'] },
      { name: 'svc-lib', path: 'svc-lib' },
    ],
    worktrees: { enabled: true, dir: 'worktrees', slots: ['implementation-1', 'review'] },
    commits: { forbidAiAttribution: true },
    ...extra,
  };
}

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-hooks-'));
  copyTree(path.join(SOURCE, 'scripts'), path.join(dir, 'scripts'));
  copyTree(path.join(SOURCE, 'ai'), path.join(dir, 'ai'));
  fs.copyFileSync(path.join(SOURCE, 'template.manifest.json'), path.join(dir, 'template.manifest.json'));

  const configPath = path.join(dir, 'ai-workspace.json');
  const ws = {
    dir,
    configPath,
    slot: (name = 'implementation-1') => path.join(dir, 'worktrees', name),
    slotRepo: (repo = 'svc-api', name = 'implementation-1') => path.join(dir, 'worktrees', name, repo),
    repo: (repo = 'svc-api') => path.join(dir, repo),
    setConfig(cfg) {
      fs.writeFileSync(configPath, typeof cfg === 'string' ? cfg : JSON.stringify(cfg, null, 2));
    },
    removeConfig() {
      fs.rmSync(configPath, { force: true });
    },
    /** Pone un archivo (y sus carpetas) dentro del workspace. */
    put(rel, content = '') {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    },
    read(rel) {
      try {
        return fs.readFileSync(path.join(dir, rel), 'utf8');
      } catch {
        return null;
      }
    },
    /** Corre un hook. `payload` puede ser un objeto o un texto crudo. */
    hook(name, payload, opts = {}) {
      const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const env = { ...process.env, ...(opts.env || {}) };
      delete env.AI_WORKSPACE_CONFIG;
      const run = spawnSync(process.execPath, [path.join(dir, 'scripts', 'hooks', `${name}.js`), '--ai-managed'], {
        input,
        encoding: 'utf8',
        cwd: opts.runCwd || dir,
        env,
        timeout: 60000,
      });
      return { code: run.status, stderr: String(run.stderr || ''), stdout: String(run.stdout || '') };
    },
    /**
     * Corre el despachador como lo registra el harness: un evento y la lista de
     * scripts (relativos a la raíz), con el JSON por stdin.
     */
    dispatch(event, scripts, payload, opts = {}) {
      const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const env = { ...process.env, ...(opts.env || {}) };
      delete env.AI_WORKSPACE_CONFIG;
      const run = spawnSync(
        process.execPath,
        [path.join(dir, 'scripts', 'hooks', 'dispatch.js'), event, ...scripts, '--ai-managed'],
        { input, encoding: 'utf8', cwd: opts.runCwd || dir, env, timeout: 60000 },
      );
      return { code: run.status, stderr: String(run.stderr || ''), stdout: String(run.stdout || '') };
    },
    /** Corre un script de `scripts/` con la raíz del workspace como cwd. */
    script(rel, args = [], opts = {}) {
      const env = { ...process.env, ...(opts.env || {}) };
      delete env.AI_WORKSPACE_CONFIG;
      const run = spawnSync(process.execPath, [path.join(dir, rel), ...args], {
        encoding: 'utf8',
        cwd: opts.cwd || dir,
        env,
        timeout: 60000,
      });
      return { code: run.status, stderr: String(run.stderr || ''), stdout: String(run.stdout || '') };
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  ws.setConfig(baseConfig());
  return ws;
}

const bash = (command, cwd) => ({ tool_name: 'Bash', cwd, tool_input: { command } });
const write = (file_path, cwd, content = 'x') => ({ tool_name: 'Write', cwd, tool_input: { file_path, content } });
const edit = (file_path, cwd) => ({
  tool_name: 'Edit',
  cwd,
  tool_input: { file_path, old_string: 'a', new_string: 'b' },
});

const slash = (p) => String(p).split('\\').join('/');
const back = (p) => String(p).split('/').join('\\');

module.exports = { makeWorkspace, baseConfig, bash, write, edit, slash, back };
