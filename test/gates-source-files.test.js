#!/usr/bin/env node
/**
 * gates-source-files.test.js — `appliesTo.sourceFiles` en el hook de escritura.
 *
 * Los gates de código del núcleo declaraban `[".ts", ".tsx", ".js", …]` en su
 * manifiesto. Un repositorio Python con su perfil de lenguaje declarado nunca
 * disparaba anti-patrones al escribir un `.py`: el hook filtraba por esa lista
 * antes de mirar el perfil. Con `sourceFiles` decide el perfil del repositorio.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT, withTempDir } = require('./helpers');

const PYTHON = {
  id: 'python',
  extensions: ['.py'],
  syntax: { lineComment: '#', stringDelimiters: ['"', "'"] },
};

/** Ids de los gates que el hook correría para cada archivo. */
function gatesFor(cfgPath, files) {
  const script = `
    const gates = require(${JSON.stringify(path.join(ROOT, 'scripts/lib/gates.js'))});
    const cfg = require(${JSON.stringify(path.join(ROOT, 'scripts/lib/workspace-config.js'))}).load();
    const out = {};
    for (const f of JSON.parse(process.argv[1])) out[f] = gates.forFile(cfg, f).gates.map((g) => g.id);
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['-e', script, JSON.stringify(files)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, AI_WORKSPACE_CONFIG: cfgPath },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('anti-patrones corre al escribir un .py si el repo declara su perfil, y no sobre un .md', () => {
  withTempDir((dir) => {
    const cfgPath = path.join(dir, 'ai-workspace.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: 1,
        project: { name: 'py', title: 'py', language: 'es' },
        topology: 'multi-repo',
        repos: [
          { name: 'api', path: 'test/fixtures/py-api', packs: [], languages: ['python'], language: PYTHON, baseBranch: 'main' },
          { name: 'web', path: 'test/fixtures/js-repo', packs: [], baseBranch: 'main' },
        ],
        packs: [],
        harnesses: [],
        worktrees: { enabled: false, slots: [] },
      }),
    );

    const py = path.join(ROOT, 'test/fixtures/py-api/app/main.py');
    const md = path.join(ROOT, 'test/fixtures/py-api/README.md');
    const ts = path.join(ROOT, 'test/fixtures/js-repo/src/bueno.service.ts');
    const got = gatesFor(cfgPath, [py, md, ts]);

    assert.ok(got[py].includes('antipatterns'), `un .py con perfil python dispara anti-patrones: ${got[py]}`);
    assert.ok(!got[md].includes('antipatterns'), 'un .md no es fuente de ningún perfil');
    assert.ok(got[ts].includes('antipatterns'), 'el perfil JavaScript del núcleo sigue cubriendo .ts');
  });
});
