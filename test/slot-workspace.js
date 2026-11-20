#!/usr/bin/env node
/**
 * slot-workspace.js — arma un workspace REAL en os.tmpdir() para probar los
 * slots, la status line y la salud de dependencias contra git de verdad.
 *
 * Por qué un workspace copiado y no los fixtures de test/fixtures: la raíz del
 * workspace la fija la ubicación de los scripts (`scripts/lib/workspace-config.js`
 * sube dos niveles desde su propio archivo). Para que los scripts operen sobre
 * repositorios temporales hay que correrlos DESDE el workspace temporal, así que
 * se copia lo mínimo (scripts, núcleo, el pack nestjs y su manifiesto) y se
 * ejecutan las copias, en un proceso aparte, como las corre un proyecto.
 *
 * Qué arma (todo en `<tmp>/ws`, con remotos locales bare en `<tmp>/origins`):
 *   api   repo git en `main`, con commits, remoto `origin`, perfil de
 *         dependencias `node` (node_modules con `.bin` de 25 ejecutables y dos
 *         paquetes instalados), pack nestjs (que declara `link` de node_modules)
 *         y `database.migrationsDir`.
 *   web   repo git en `main`, sin perfil de dependencias.
 *   slots implementation-1, implementation-2 y review.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const link = require('../scripts/lib/deps-link');

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} (en ${cwd}) falló: ${r.stderr}`);
  }
  return { status: r.status, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '').trim() };
}

/** ¿Este entorno puede crear el enlace que usa la base (junction en Windows, symlink en Unix)? */
function canLink() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-link-probe-'));
  try {
    fs.mkdirSync(path.join(dir, 'target'));
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), link.LINK_TYPE);
    return link.isLink(path.join(dir, 'link'));
  } catch {
    return false;
  } finally {
    try {
      link.removeLink(path.join(dir, 'link'));
    } catch {
      /* nada */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LINK_SKIP = canLink()
  ? false
  : 'este entorno no permite crear enlaces de directorio (junction/symlink): se omiten las pruebas de enlaces, NO se dan por pasadas';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function initRepo(ws, origins, name, files) {
  const dir = path.join(ws, name);
  const bare = path.join(origins, `${name}.git`);
  fs.mkdirSync(bare, { recursive: true });
  git(bare, ['init', '--bare', '-b', 'main', '--quiet']);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main', '--quiet']);
  for (const [k, v] of Object.entries({ 'user.name': 'Test', 'user.email': 'test@example.com', 'commit.gpgsign': 'false', 'core.autocrlf': 'false' })) {
    git(dir, ['config', k, v]);
  }
  for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'inicial', '--quiet']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-u', 'origin', 'main', '--quiet']);
  return dir;
}

/** node_modules de juguete: `.bin` con 25 ejecutables y dos paquetes con su manifiesto. */
function installFakeDeps(apiDir) {
  const nm = path.join(apiDir, 'node_modules');
  for (let i = 0; i < 25; i++) write(path.join(nm, '.bin', `tool-${i}`), '#!/bin/sh\n');
  write(path.join(nm, 'dep-a', 'package.json'), '{"name":"dep-a","version":"1.0.0"}');
  write(path.join(nm, '@scope', 'dep-b', 'package.json'), '{"name":"@scope/dep-b","version":"1.0.0"}');
}

function buildWorkspace(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-slots-'));
  const ws = path.join(tmp, 'ws');
  const origins = path.join(tmp, 'origins');
  fs.mkdirSync(ws, { recursive: true });

  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(ws, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'ai', 'core'), path.join(ws, 'ai', 'core'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'ai', 'packs', 'nestjs'), path.join(ws, 'ai', 'packs', 'nestjs'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'template.manifest.json'), path.join(ws, 'template.manifest.json'));

  const cfg = {
    version: 1,
    project: { name: 'slots-fixture' },
    topology: 'multi-repo',
    repos: [
      {
        name: 'api',
        path: 'api',
        packs: ['nestjs'],
        baseBranch: 'main',
        deps: 'node',
        database: { shared: true, migrationsDir: 'src/migrations' },
      },
      { name: 'web', path: 'web', packs: [], baseBranch: 'main' },
    ],
    harnesses: opts.harnesses || [],
    worktrees: {
      enabled: true,
      dir: 'worktrees',
      slots: [
        { name: 'implementation-1', kind: 'implementation' },
        { name: 'implementation-2', kind: 'implementation' },
        { name: 'review', kind: 'review' },
      ],
    },
    ...(opts.config || {}),
  };
  write(path.join(ws, 'ai-workspace.json'), `${JSON.stringify(cfg, null, 2)}\n`);

  const api = initRepo(ws, origins, 'api', {
    'package.json': JSON.stringify({ name: 'api', dependencies: { 'dep-a': '1.0.0', '@scope/dep-b': '1.0.0' }, optionalDependencies: { 'opt-x': '1.0.0' } }),
    'package-lock.json': '{"lockfileVersion":3,"v":1}\n',
    // `node_modules` SIN barra final: con barra no ignora un enlace en Unix.
    '.gitignore': 'node_modules\ndist\n',
    'src/app.ts': 'export const a = 1;\n',
    'src/migrations/.gitkeep': '',
  });
  installFakeDeps(api);
  const web = initRepo(ws, origins, 'web', { 'index.js': 'module.exports = 1;\n', '.gitignore': 'dist\n' });

  const env = { ...process.env, AI_WORKSPACE_CONFIG: path.join(ws, 'ai-workspace.json') };
  delete env.AI_WORKTREE_SLOT;
  delete env.AI_WORKTREE_ROOT;

  const w = {
    tmp,
    ws,
    origins,
    api,
    web,
    env,
    repoDir: (name) => path.join(ws, name),
    slotDir: (slot, repo) => path.join(ws, 'worktrees', slot, repo),
    git,
    /** Corre un script del workspace en un proceso aparte. */
    script(name, args = [], o = {}) {
      const r = spawnSync(process.execPath, [path.join(ws, 'scripts', name), ...args], {
        cwd: o.cwd || ws,
        encoding: 'utf8',
        timeout: 180000,
        env: { ...env, ...(o.env || {}) },
        input: o.input,
      });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
    },
    manage(args, o) {
      return w.script('manage-worktree.js', args, o);
    },
    /** Commit con un archivo nuevo o modificado dentro de `dir`. */
    commit(dir, rel, content, msg = 'cambio') {
      write(path.join(dir, rel), content);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-m', msg, '--quiet']);
      return git(dir, ['rev-parse', 'HEAD']).stdout;
    },
    /** Rama publicada "por otra persona": se crea desde un clon aparte y se pushea. */
    pushOtherBranch(repo, branch, files = { 'other.txt': 'de otra persona\n' }) {
      const other = path.join(tmp, `other-${repo}-${branch.replace(/[^\w]/g, '_')}`);
      git(tmp, ['clone', '--quiet', path.join(origins, `${repo}.git`), other]);
      for (const [k, v] of Object.entries({ 'user.name': 'Otra', 'user.email': 'otra@example.com', 'commit.gpgsign': 'false' })) git(other, ['config', k, v]);
      git(other, ['checkout', '-b', branch, '--quiet']);
      for (const [rel, content] of Object.entries(files)) write(path.join(other, rel), content);
      git(other, ['add', '-A']);
      git(other, ['commit', '-m', `trabajo en ${branch}`, '--quiet']);
      git(other, ['push', 'origin', branch, '--quiet']);
      return other;
    },
    upstream: (dir, branch) => git(dir, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]).stdout,
    branch: (dir) => git(dir, ['branch', '--show-current']).stdout,
    binCount: () => fs.readdirSync(path.join(api, 'node_modules', '.bin')).length,
    cleanup() {
      try {
        // Primero los enlaces, como enlaces: nada recursivo los atraviesa.
        for (const l of link.findLinks(tmp)) link.removeLink(l);
      } catch {
        /* se sigue */
      }
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  return w;
}

module.exports = { buildWorkspace, LINK_SKIP, git, write, canLink };
