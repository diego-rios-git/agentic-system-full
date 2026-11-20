/**
 * Hook pre-bash-slot-deps: con un slot en juego bloquea reinstalar dependencias
 * y borrar el directorio compartido; todo lo demás tiene que seguir pasando.
 * Un guard que corta de más se desactiva a la semana, así que los casos que
 * PASAN pesan tanto como los que bloquean.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { makeWorkspace, bash, slash, back } = require('./hooks-fixture');

const HOOK = 'pre-bash-slot-deps';
let ws;

before(() => {
  ws = makeWorkspace();
});
after(() => ws.cleanup());

const blocked = (command, cwd, label) => {
  const r = ws.hook(HOOK, bash(command, cwd));
  assert.equal(r.code, 2, `${label || command} debería bloquearse. stderr: ${r.stderr}`);
  return r;
};
const passes = (command, cwd, label) => {
  const r = ws.hook(HOOK, bash(command, cwd));
  assert.equal(r.code, 0, `${label || command} debería pasar. stderr: ${r.stderr}`);
  return r;
};

describe('bloquea con un slot en juego', () => {
  test('npm ci con el directorio de trabajo en un slot', () => {
    const r = blocked('npm ci', ws.slotRepo());
    assert.match(r.stderr, /enlace \(junction en Windows, symlink en Unix\)/);
    assert.match(r.stderr, /check-deps\.js/);
  });

  test('npm install --no-audit con el cwd en un slot', () => {
    blocked('npm install --no-audit', ws.slotRepo());
  });

  test('npm --prefix <slot>/<repo> install desde la raíz, con / y con \\', () => {
    const rel = path.join('worktrees', 'implementation-1', 'svc-api');
    blocked(`npm --prefix ${slash(rel)} install`, ws.dir);
    blocked(`npm --prefix ${back(rel)} install`, ws.dir);
    blocked(`npm --prefix "${slash(ws.slotRepo())}" ci`, ws.dir);
    blocked(`npm --prefix "${back(ws.slotRepo())}" ci`, ws.dir);
  });

  test('cd al slot encadenado con &&', () => {
    blocked(`cd ${slash(ws.slotRepo())} && npm ci`, ws.dir);
    blocked(`cd ${slash(path.join('worktrees', 'review', 'svc-web'))} && yarn add left-pad`, ws.dir);
  });

  test('otros gestores y subcomandos destructivos', () => {
    blocked('pnpm add left-pad', ws.slotRepo());
    blocked('npm uninstall left-pad', ws.slotRepo());
    blocked('npm update', ws.slotRepo());
    blocked('FOO=1 npm ci', ws.slotRepo());
    blocked('bash -c "npm ci"', ws.slotRepo());
  });

  test('rm -rf del directorio de dependencias de un slot (ambas barras)', () => {
    blocked(`rm -rf ${slash(path.join(ws.slotRepo(), 'node_modules'))}`, ws.dir);
    blocked(`rm -rf ${back(path.join(ws.slotRepo(), 'node_modules'))}`, ws.dir);
    blocked('rm -rf node_modules', ws.slotRepo());
    blocked('rm -rf node_modules/.cache', ws.slotRepo());
    blocked('rm -r -f ./node_modules', ws.slotRepo());
  });

  test('Remove-Item -Recurse, rimraf, rmdir /s y del /s', () => {
    blocked(`Remove-Item -Recurse -Force ${ws.slot()}`, ws.dir, 'Remove-Item sobre el slot');
    blocked(`Remove-Item -Recurse -Force -Path ${path.join(ws.slotRepo(), 'node_modules')}`, ws.dir);
    blocked('rimraf node_modules', ws.slotRepo());
    blocked('npx rimraf node_modules', ws.slotRepo());
    blocked(`rmdir /s /q ${back(path.join(ws.slotRepo(), 'node_modules'))}`, ws.dir);
    blocked(`del /s /q ${back(path.join(ws.slotRepo(), 'node_modules'))}`, ws.dir);
  });

  test('borrar la raíz de un slot, por ruta, por . o por *', () => {
    blocked(`rm -rf ${slash(ws.slot())}`, ws.dir);
    blocked(`rm -rf ${slash(path.join('worktrees', 'implementation-1'))}`, ws.dir);
    blocked(`rm -rf ${slash(ws.slotRepo())}`, ws.dir);
    blocked('rm -rf .', ws.slotRepo());
    blocked('rm -rf *', ws.slotRepo());
    blocked('rm -rf ../*', ws.slotRepo());
  });

  test('un bloqueo queda en .ai-gates-log.jsonl', () => {
    blocked('npm ci', ws.slotRepo());
    const lines = ws.read('.ai-gates-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    assert.equal(last.hook, HOOK);
    assert.equal(last.decision, 'blocked');
    assert.equal(last.reason, 'reinstala-dependencias-en-slot');
  });
});

describe('sigue pasando', () => {
  test('npm ci en el repositorio principal', () => {
    passes('npm ci', ws.repo());
    passes('npm ci', ws.dir);
  });

  test('scripts, tests y consultas dentro de un slot', () => {
    passes('npm run test -- --run', ws.slotRepo());
    passes('npm test', ws.slotRepo());
    passes('npm ls', ws.slotRepo());
    passes('npm --prefix worktrees/implementation-1/svc-api run build', ws.dir);
    passes('git status', ws.slotRepo());
    passes('grep -r "npm ci" docs', ws.slotRepo());
    passes('echo npm install', ws.slotRepo());
  });

  test('un script llamado como un subcomando (npm run update) y un argumento llamado add (npm test add)', () => {
    passes('npm run update', ws.slotRepo());
    passes('npm run add', ws.slotRepo());
    passes('npm test add', ws.slotRepo());
    passes('npm test -- add', ws.slotRepo());
    passes('npm run install-hooks', ws.slotRepo());
  });

  test('borrados que no atraviesan el enlace', () => {
    passes('rm -rf /tmp/basura', ws.slotRepo());
    passes(`rm -rf ${slash(path.join(ws.slotRepo(), 'dist'))}`, ws.dir);
    passes(`rm -rf ${back(path.join(ws.slotRepo(), 'dist'))}`, ws.dir);
    passes('rm -rf dist', ws.slotRepo());
    passes('rm -rf ./coverage .cache', ws.slotRepo());
    passes('rm -f notes.txt', ws.slotRepo());
    passes(`Remove-Item -Force ${ws.slotRepo()}`, ws.dir, 'Remove-Item sin -Recurse');
    passes('rm -rf /tmp/basura', ws.dir);
  });

  test('un repositorio sin perfil de dependencias no tiene nada compartido', () => {
    passes('npm ci', ws.slotRepo('svc-lib'));
    passes('rm -rf node_modules', ws.slotRepo('svc-lib'));
  });

  test('desde un slot, hacia el repositorio principal (cd explícito)', () => {
    passes(`cd ${slash(ws.repo())} && npm ci`, ws.slotRepo());
  });

  test('lo que se escribe después de && en el principal tampoco se bloquea', () => {
    passes(`cd ${slash(ws.repo())} && rm -rf node_modules && npm ci`, ws.dir);
  });
});

describe('fail-open', () => {
  test('JSON ilegible o vacío permite', () => {
    assert.equal(ws.hook(HOOK, '{no es json').code, 0);
    assert.equal(ws.hook(HOOK, '').code, 0);
    assert.equal(ws.hook(HOOK, '[1,2]').code, 0);
  });

  test('otra herramienta que no es Bash permite', () => {
    const r = ws.hook(HOOK, { tool_name: 'Write', cwd: ws.slotRepo(), tool_input: { command: 'npm ci' } });
    assert.equal(r.code, 0);
  });

  test('sin ai-workspace.json permite y deja un diagnóstico', () => {
    ws.removeConfig();
    try {
      const r = ws.hook(HOOK, bash('npm ci', ws.slotRepo()));
      assert.equal(r.code, 0);
      assert.match(r.stderr, /ai-workspace\.json/);
    } finally {
      ws.setConfig(require('./hooks-fixture').baseConfig());
    }
  });

  test('con la configuración rota permite y deja un diagnóstico', () => {
    for (const broken of ['{ esto no es json', JSON.stringify({ version: 7, project: {} })]) {
      ws.setConfig(broken);
      const r = ws.hook(HOOK, bash('npm ci', ws.slotRepo()));
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, new RegExp(`\\[${HOOK}\\]`));
    }
    ws.setConfig(require('./hooks-fixture').baseConfig());
  });

  test('si no se puede escribir el log, igual bloquea', () => {
    require('fs').rmSync(path.join(ws.dir, '.ai-gates-log.jsonl'), { force: true });
    ws.put('.ai-gates-log.jsonl/placeholder', '');
    try {
      assert.equal(ws.hook(HOOK, bash('npm ci', ws.slotRepo())).code, 2);
    } finally {
      require('fs').rmSync(path.join(ws.dir, '.ai-gates-log.jsonl'), { recursive: true, force: true });
    }
  });
});
