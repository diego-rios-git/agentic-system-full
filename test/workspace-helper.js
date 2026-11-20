#!/usr/bin/env node
/**
 * workspace-helper.js — un workspace temporal con repositorios de git REALES.
 *
 * Los gates que miran el diff (co-cambio, inalcanzables, `run-gates --from`) no
 * se pueden probar contra un fixture de archivos sueltos: necesitan un
 * repositorio con historia, una rama base remota y, para `--from`, un slot que
 * sea un worktree de git de verdad. Se arma uno en `.tmp/` (ignorado por git)
 * dentro de la raíz de la base: `repos[].path` tiene que ser relativo a ella, y
 * los scripts resuelven sus rutas desde ahí.
 *
 * Cada repositorio queda con un commit en `main` y la referencia
 * `refs/remotes/origin/main` apuntando a él, que es la base `origin/main` de la
 * que parten los gates sin necesidad de un remoto de verdad.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./helpers');

let counter = 0;

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

/**
 * @param {object} spec
 * @param {Array<{name: string, files?: object, extra?: object}>} spec.repos
 *   `files`: `{ 'ruta/relativa': 'contenido' }` del commit inicial.
 *   `extra`: campos que se mezclan en la entrada del repositorio en la config.
 * @param {object} [spec.config] campos que se mezclan en la raíz de la config
 */
function makeWorkspace(spec) {
  counter += 1;
  const id = `ws-${process.pid}-${counter}-${Date.now().toString(36)}`;
  const relDir = `.tmp/${id}`;
  const dir = path.join(ROOT, relDir);
  fs.mkdirSync(dir, { recursive: true });

  const repos = spec.repos.map((r) => {
    const repoDir = path.join(dir, r.name);
    fs.mkdirSync(repoDir, { recursive: true });
    git(repoDir, ['init', '-q', '-b', 'main']);
    git(repoDir, ['config', 'user.email', 't@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    git(repoDir, ['config', 'commit.gpgsign', 'false']);
    for (const [rel, content] of Object.entries(r.files || { 'README.md': '# repo\n' })) {
      const abs = path.join(repoDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '-q', '-m', 'inicial']);
    git(repoDir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    return { name: r.name, dir: repoDir, extra: r.extra || {} };
  });

  const cfg = {
    version: 1,
    project: { name: 'ws-test' },
    topology: 'multi-repo',
    repos: repos.map((r) => ({
      name: r.name,
      path: `${relDir}/${r.name}`,
      packs: [],
      baseBranch: 'main',
      ...r.extra,
    })),
    harnesses: [],
    worktrees: { enabled: true, dir: `${relDir}/worktrees`, slots: [{ name: 'review', kind: 'review' }] },
    ...(spec.config || {}),
  };
  const cfgPath = path.join(dir, 'ai-workspace.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const byName = (name) => repos.find((r) => r.name === name).dir;

  const ws = {
    dir,
    relDir,
    cfgPath,
    repoDir: byName,
    git: (name, ...args) => git(byName(name), args),
    write(name, rel, content) {
      const abs = path.join(byName(name), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    },
    remove(name, rel) {
      fs.rmSync(path.join(byName(name), rel), { force: true });
    },
    commit(name, message = 'cambio') {
      git(byName(name), ['add', '-A']);
      git(byName(name), ['commit', '-q', '-m', message]);
    },
    /** Un slot de verdad: un worktree de git en `<dir>/worktrees/<slot>/<repo>`. */
    openSlot(name, slot, branch = `feat-${slot}`) {
      const slotRepo = path.join(dir, 'worktrees', slot, name);
      fs.mkdirSync(path.dirname(slotRepo), { recursive: true });
      git(byName(name), ['worktree', 'add', '-q', '-b', branch, slotRepo, 'HEAD']);
      return slotRepo;
    },
    slotDir: (name, slot) => path.join(dir, 'worktrees', slot, name),
    /** Corre un script de la base contra este workspace. */
    run(script, args = [], opts = {}) {
      const r = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: opts.timeout || 120000,
        env: {
          ...process.env,
          AI_WORKSPACE_CONFIG: cfgPath,
          AI_BASELINE_DIR: dir,
          ...(opts.env || {}),
        },
      });
      const stdout = String(r.stdout || '');
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      return { code: r.status, stdout, stderr: String(r.stderr || ''), json };
    },
    cleanup() {
      // Los worktrees primero: sin `prune`, git recuerda carpetas que ya no están.
      for (const r of repos) {
        try {
          git(r.dir, ['worktree', 'prune']);
        } catch {
          /* el repositorio ya no está */
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return ws;
}

/** Corre `fn(ws)` y limpia siempre. */
function withWorkspace(spec, fn) {
  const ws = makeWorkspace(spec);
  try {
    return fn(ws);
  } finally {
    ws.cleanup();
  }
}

module.exports = { makeWorkspace, withWorkspace };
