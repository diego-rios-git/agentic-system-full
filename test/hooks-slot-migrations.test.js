/**
 * Hook pre-bash-slot-migrations: con un slot en juego bloquea migrar, revertir,
 * correr seeds y generar contra la base compartida; los comandos salen de la
 * config (`repos[].database`), no del código. Lo que tiene que seguir pasando
 * pesa tanto como lo que bloquea.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { makeWorkspace, baseConfig, bash, slash, back } = require('./hooks-fixture');

const HOOK = 'pre-bash-slot-migrations';
let ws;

before(() => {
  ws = makeWorkspace();
});
after(() => ws.cleanup());

const blocked = (command, cwd) => {
  const r = ws.hook(HOOK, bash(command, cwd));
  assert.equal(r.code, 2, `${command} debería bloquearse. stderr: ${r.stderr}`);
  return r;
};
const passes = (command, cwd) => {
  const r = ws.hook(HOOK, bash(command, cwd));
  assert.equal(r.code, 0, `${command} debería pasar. stderr: ${r.stderr}`);
  return r;
};

describe('bloquea con un slot en juego', () => {
  test('migrar y revertir, por script de npm', () => {
    const r = blocked('npm run migration:run', ws.slotRepo());
    assert.match(r.stderr, /una sola para el repositorio principal y todos los slots/);
    blocked('npm run migration:revert', ws.slotRepo());
  });

  test('migrar llamando al ORM directo', () => {
    blocked('npx typeorm migration:run -d src/database/data-source.ts', ws.slotRepo());
    blocked('typeorm-ts-node-commonjs migration:revert -d x', ws.slotRepo());
  });

  test('seeds, por script y por un runner sobre el directorio de seeds', () => {
    blocked('npm run seed', ws.slotRepo());
    blocked('npx ts-node src/database/seeds/run.ts', ws.slotRepo());
    blocked('ts-node -r tsconfig-paths/register ./src/database/seeds/run.ts', ws.slotRepo());
  });

  test('generar contra la base compartida redirige al comando alternativo y a promote', () => {
    const r = blocked('npm run migration:generate -- src/database/migrations/AddFoo', ws.slotRepo());
    assert.match(r.stderr, /migration-generate-shadow\.js/);
    const w = blocked('npm run migration:run', ws.slotRepo());
    assert.match(w.stderr, /manage-worktree\.js promote/);
  });

  test('con --prefix hacia el slot, con / y con \\, desde la raíz', () => {
    const rel = path.join('worktrees', 'implementation-1', 'svc-api');
    blocked(`npm --prefix ${slash(rel)} run migration:run`, ws.dir);
    blocked(`npm --prefix ${back(rel)} run migration:run`, ws.dir);
    blocked(`npm --prefix "${back(ws.slotRepo())}" run migration:revert`, ws.dir);
  });

  test('encadenados con && ; y |', () => {
    blocked('npm run build && npm run migration:run', ws.slotRepo());
    blocked('npm run build; npm run seed', ws.slotRepo());
    blocked(`cd ${slash(ws.slotRepo())} && npm run migration:run`, ws.dir);
    blocked('bash -c "npm run migration:run"', ws.slotRepo());
  });

  test('un bloqueo queda en el log con su motivo', () => {
    blocked('npm run migration:run', ws.slotRepo());
    const lines = ws.read('.ai-gates-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[lines.length - 1].reason, 'escribe-en-la-base-desde-slot');
  });
});

describe('sigue pasando', () => {
  test('el comando alternativo de generación, desde un slot', () => {
    passes('node ai/packs/nestjs/scripts/migration-generate-shadow.js AddFoo --from implementation-1', ws.slotRepo());
    passes(`node ${slash(path.join(ws.dir, 'ai/packs/nestjs/scripts/migration-generate-shadow.js'))} AddFoo`, ws.slotRepo());
  });

  test('lo que solo lee (readOnlyAllowed)', () => {
    passes('npm run migration:show', ws.slotRepo());
    passes('npx typeorm migration:show -d x', ws.slotRepo());
  });

  test('los mismos comandos en el repositorio principal', () => {
    passes('npm run migration:run', ws.repo());
    passes('npm run migration:revert', ws.repo());
    passes('npm run seed', ws.repo());
    passes('npm run migration:generate -- src/database/migrations/AddFoo', ws.repo());
    passes('npm run migration:run', ws.dir);
  });

  test('tests, builds y specs sobre el directorio de seeds', () => {
    passes('npm test', ws.slotRepo());
    passes('npm run build', ws.slotRepo());
    passes('npx jest src/database/seeds/run.spec.ts', ws.slotRepo());
    passes('npx eslint src/database/seeds/', ws.slotRepo());
  });

  test('comandos que mencionan el nombre pero no ejecutan nada', () => {
    passes('git commit -m "add seed"', ws.slotRepo());
    passes('git commit -m "run migration:run later"', ws.slotRepo());
    passes('grep migration:run package.json', ws.slotRepo());
    passes('grep -rn "npm run seed" docs', ws.slotRepo());
    passes('echo npm run migration:run', ws.slotRepo());
    passes('cat package.json | grep migration:run', ws.slotRepo());
  });

  test('un mensaje de commit en heredoc que menciona el comando', () => {
    passes("git commit -F - <<'EOF'\nfeat: x\n\nantes de migrar corré npm run migration:run en el principal\nEOF", ws.slotRepo());
  });

  test('un repositorio que no declara base de datos', () => {
    passes('npm run migration:run', ws.slotRepo('svc-web'));
    passes('npm run migration:run', ws.slotRepo('svc-lib'));
  });

  test('una base que no es compartida no se protege', () => {
    const cfg = baseConfig();
    cfg.repos[0].database.shared = false;
    ws.setConfig(cfg);
    try {
      passes('npm run migration:run', ws.slotRepo());
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});

describe('los comandos salen de la config, no del código', () => {
  test('otro stack: dotnet y alembic declarados en la config se bloquean; lo no declarado pasa', () => {
    const cfg = baseConfig();
    cfg.repos[0].database = {
      writeCommands: ['dotnet ef database update', 'alembic upgrade'],
      generateCommands: ['dotnet ef migrations add'],
      readOnlyAllowed: ['dotnet ef migrations list'],
      generateAlternative: 'python scripts/shadow_migrate.py <nombre>',
    };
    ws.setConfig(cfg);
    try {
      blocked('dotnet ef database update --project Infra --startup-project Api', ws.slotRepo());
      blocked('alembic upgrade head', ws.slotRepo());
      const g = blocked('dotnet ef migrations add Foo --project Infra', ws.slotRepo());
      assert.match(g.stderr, /shadow_migrate\.py/);
      passes('dotnet ef migrations list --project Infra', ws.slotRepo());
      passes('python scripts/shadow_migrate.py AddFoo', ws.slotRepo());
      // Los nombres de linxdash/typeorm ya no están fijos: sin declararse, pasan.
      passes('npm run migration:run', ws.slotRepo());
    } finally {
      ws.setConfig(baseConfig());
    }
  });

  test('sin generateAlternative el mensaje lo dice en vez de inventar uno', () => {
    const cfg = baseConfig();
    delete cfg.repos[0].database.generateAlternative;
    ws.setConfig(cfg);
    try {
      const r = blocked('npm run migration:generate -- x', ws.slotRepo());
      assert.match(r.stderr, /no declaró `repos\[\]\.database\.generateAlternative`/);
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});

describe('fail-open', () => {
  test('JSON ilegible o vacío permite', () => {
    assert.equal(ws.hook(HOOK, 'esto no es json').code, 0);
    assert.equal(ws.hook(HOOK, '').code, 0);
  });

  test('sin ai-workspace.json permite y deja un diagnóstico', () => {
    ws.removeConfig();
    try {
      const r = ws.hook(HOOK, bash('npm run migration:run', ws.slotRepo()));
      assert.equal(r.code, 0);
      assert.match(r.stderr, /ai-workspace\.json/);
    } finally {
      ws.setConfig(baseConfig());
    }
  });

  test('con la configuración rota (database mal formada) permite', () => {
    const cfg = baseConfig();
    cfg.repos[0].database.writeCommands = 'no es una lista';
    ws.setConfig(cfg);
    try {
      const r = ws.hook(HOOK, bash('npm run migration:run', ws.slotRepo()));
      assert.equal(r.code, 0);
      assert.match(r.stderr, new RegExp(`\\[${HOOK}\\]`));
    } finally {
      ws.setConfig(baseConfig());
    }
  });
});
