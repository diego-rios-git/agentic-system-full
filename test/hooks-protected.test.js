/**
 * Hook pre-write-protected y script allow-protected-edit: lo generado no se
 * escribe ni se edita a mano sin que el operador lo autorice, por tiempo y por
 * archivo. Las rutas protegidas salen del manifiesto de los packs activos y de
 * `ai-workspace.json`.
 */

'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeWorkspace, baseConfig, bash, write, edit, slash, back } = require('./hooks-fixture');

const HOOK = 'pre-write-protected';
const ALLOW = '.protected-edit-allow.json';
let ws;
let migration; // una migración del principal
let slotMigration; // la misma, vista desde un slot

before(() => {
  ws = makeWorkspace();

  // La regla del pack nestjs, como la declara su manifiesto.
  const manifestPath = path.join(ws.dir, 'ai', 'packs', 'nestjs', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.protectedPaths = [
    {
      id: 'nestjs-migrations',
      globs: ['**/src/database/migrations/*.ts'],
      write: 'block',
      edit: 'authorization',
      message: 'Las migraciones las genera la herramienta del ORM.',
      procedure: 'nestjs-create-migration',
    },
  ];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  migration = ws.put('svc-api/src/database/migrations/1700000000000-AddFoo.ts', 'export class AddFoo {}');
  slotMigration = ws.put('worktrees/implementation-1/svc-api/src/database/migrations/1700000000000-AddFoo.ts', 'x');
  ws.put('svc-web/src/database/migrations/1700000000000-Otra.ts', 'x'); // repo sin el pack
  ws.put('svc-api/package-lock.json', '{}');
  ws.put('svc-api/src/app.service.ts', 'x');
});
after(() => ws.cleanup());

beforeEach(() => {
  ws.setConfig(
    baseConfig({
      protectedPaths: [
        {
          id: 'lockfile',
          globs: ['**/package-lock.json'],
          write: 'block',
          edit: 'block',
          message: 'El lockfile lo escribe el gestor de paquetes.',
        },
      ],
    }),
  );
  fs.rmSync(path.join(ws.dir, ALLOW), { force: true });
  fs.rmSync(path.join(ws.dir, '.ai-gates-log.jsonl'), { force: true });
});

const allowFile = (args) => ws.script('scripts/allow-protected-edit.js', args);
const writeAllow = (entries) => ws.put(ALLOW, JSON.stringify({ allows: entries }));
const minutesFromNow = (m) => new Date(Date.now() + m * 60000).toISOString();

describe('Write', () => {
  test('sobre una migración del principal o de un slot bloquea, con ambas barras', () => {
    for (const file of [migration, slotMigration, slash(migration), back(slotMigration)]) {
      const r = ws.hook(HOOK, write(file, ws.dir));
      assert.equal(r.code, 2, `${file}: ${r.stderr}`);
      assert.match(r.stderr, /no se escribe a mano/);
      assert.match(r.stderr, /Las migraciones las genera la herramienta del ORM/);
      assert.match(r.stderr, /nestjs-create-migration/);
    }
  });

  test('sobre un archivo nuevo de la carpeta protegida también bloquea', () => {
    const nuevo = path.join(ws.repo(), 'src', 'database', 'migrations', '1800000000000-Nueva.ts');
    assert.equal(ws.hook(HOOK, write(nuevo, ws.dir)).code, 2);
  });

  test('una autorización vigente NO habilita un Write', () => {
    writeAllow([{ file: path.basename(migration), expiresAt: minutesFromNow(30) }]);
    assert.equal(ws.hook(HOOK, write(migration, ws.dir)).code, 2);
  });

  test('sobre otra ruta pasa', () => {
    assert.equal(ws.hook(HOOK, write(path.join(ws.repo(), 'src', 'app.service.ts'), ws.dir)).code, 0);
    assert.equal(ws.hook(HOOK, write(path.join(ws.repo(), 'src', 'database', 'migrations', 'README.md'), ws.dir)).code, 0);
    assert.equal(ws.hook(HOOK, write(path.join(ws.dir, 'notas.md'), ws.dir)).code, 0);
  });

  test('una regla de un pack no aplica a un repositorio que no lo tiene', () => {
    const otra = path.join(ws.repo('svc-web'), 'src', 'database', 'migrations', '1700000000000-Otra.ts');
    assert.equal(ws.hook(HOOK, write(otra, ws.dir)).code, 0);
  });

  test('queda en el log', () => {
    ws.hook(HOOK, write(migration, ws.dir));
    const last = JSON.parse(ws.read('.ai-gates-log.jsonl').trim().split('\n').pop());
    assert.equal(last.hook, HOOK);
    assert.equal(last.reason, 'write-a-mano');
    assert.equal(last.rule, 'nestjs-migrations');
  });
});

describe('Edit', () => {
  test('sin autorización bloquea y explica cómo se pide', () => {
    const r = ws.hook(HOOK, edit(migration, ws.dir));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /allow-protected-edit\.js 1700000000000-AddFoo\.ts/);
  });

  test('con autorización vigente pasa, desde la raíz y desde un slot', () => {
    writeAllow([{ file: path.basename(migration), expiresAt: minutesFromNow(30) }]);
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 0);
    assert.equal(ws.hook(HOOK, edit(slotMigration, ws.slotRepo())).code, 0);
    const last = JSON.parse(ws.read('.ai-gates-log.jsonl').trim().split('\n').pop());
    assert.equal(last.decision, 'allowed');
  });

  test('con autorización vencida bloquea', () => {
    writeAllow([{ file: path.basename(migration), expiresAt: minutesFromNow(-1) }]);
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 2);
  });

  test('la autorización de OTRO archivo no vale', () => {
    writeAllow([{ file: '1700000000000-OtraCosa.ts', expiresAt: minutesFromNow(30) }]);
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 2);
  });

  test('una regla con edit "block" no tiene escape, ni con autorización', () => {
    const lock = path.join(ws.repo(), 'package-lock.json');
    writeAllow([{ file: 'package-lock.json', expiresAt: minutesFromNow(30) }]);
    const r = ws.hook(HOOK, edit(lock, ws.dir));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no admite edición manual/);
  });

  test('las reglas de ai-workspace.json también aplican a Write', () => {
    assert.equal(ws.hook(HOOK, write(path.join(ws.repo(), 'package-lock.json'), ws.dir)).code, 2);
  });

  test('otra ruta pasa', () => {
    assert.equal(ws.hook(HOOK, edit(path.join(ws.repo(), 'src', 'app.service.ts'), ws.dir)).code, 0);
  });

  test('el archivo de autorización es inescribible por el agente', () => {
    for (const tool of [write(path.join(ws.dir, ALLOW), ws.dir), edit(path.join(ws.dir, ALLOW), ws.dir)]) {
      const r = ws.hook(HOOK, tool);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /la crea el operador/);
    }
  });
});

describe('allow-protected-edit', () => {
  test('autoriza por nombre, 30 minutos por defecto, y el hook la respeta', () => {
    const r = allowFile([back(migration)]);
    assert.equal(r.code, 0, r.stderr);
    const saved = JSON.parse(ws.read(ALLOW));
    assert.equal(saved.allows[0].file, '1700000000000-AddFoo.ts');
    const minutes = (Date.parse(saved.allows[0].expiresAt) - Date.now()) / 60000;
    assert.ok(minutes > 29 && minutes <= 30, `venció en ${minutes} min`);
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 0);
  });

  test('--minutes y su tope de 480', () => {
    assert.equal(allowFile(['x.ts', '--minutes', '60']).code, 0);
    const minutes = (Date.parse(JSON.parse(ws.read(ALLOW)).allows[0].expiresAt) - Date.now()) / 60000;
    assert.ok(minutes > 59 && minutes <= 60);
    assert.equal(allowFile(['x.ts', '--minutes', '480']).code, 0);
    for (const bad of ['0', '481', '-5', 'abc']) {
      assert.equal(allowFile(['x.ts', '--minutes', bad]).code, 1, `--minutes ${bad}`);
    }
  });

  test('--status, --revoke de uno y de todos', () => {
    assert.match(allowFile(['--status']).stdout, /No hay ninguna autorización/);
    allowFile(['a.ts']);
    allowFile(['b.ts', '--note', 'falta el down']);
    const status = allowFile(['--status']).stdout;
    assert.match(status, /a\.ts/);
    assert.match(status, /b\.ts/);
    assert.match(status, /falta el down/);

    allowFile(['--revoke', 'a.ts']);
    assert.deepEqual(
      JSON.parse(ws.read(ALLOW)).allows.map((a) => a.file),
      ['b.ts'],
    );
    allowFile(['--revoke']);
    assert.equal(ws.read(ALLOW), null);
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 2);
  });

  test('sin argumentos, o sobre el archivo de autorización, falla', () => {
    assert.equal(allowFile([]).code, 1);
    assert.equal(allowFile([ALLOW]).code, 1);
  });

  test('funciona corriendo desde un slot (la raíz es el ancestro más externo)', () => {
    fs.mkdirSync(ws.slotRepo(), { recursive: true });
    const r = ws.script('scripts/allow-protected-edit.js', ['x.ts'], { cwd: ws.slotRepo() });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(ws.read(ALLOW));
  });
});

describe('desde Bash (hook opcional con los mismos globs)', () => {
  const sh = (command) => ws.hook(HOOK, bash(command, ws.dir));

  test('redirecciones, tee, sed -i y rm sobre una migración existente bloquean', () => {
    assert.equal(sh(`echo x > ${slash(migration)}`).code, 2);
    assert.equal(sh(`echo x >> ${slash(migration)}`).code, 2);
    assert.equal(sh(`echo x | tee ${slash(migration)}`).code, 2);
    assert.equal(sh(`sed -i s/a/b/ ${slash(migration)}`).code, 2);
    assert.equal(sh(`rm ${slash(migration)}`).code, 2);
    assert.equal(sh(`mv ${slash(migration)} /tmp/x.ts`).code, 2);
    assert.equal(sh(`cd svc-api && echo x > src/database/migrations/1700000000000-AddFoo.ts`).code, 2);
    assert.equal(sh(`Set-Content -Path ${slash(migration)} -Value x`).code, 2);
  });

  test('crear una migración nueva por la shell bloquea aun con autorización', () => {
    const nueva = path.join(ws.repo(), 'src', 'database', 'migrations', '1900000000000-Nueva.ts');
    writeAllow([{ file: path.basename(nueva), expiresAt: minutesFromNow(30) }]);
    assert.equal(sh(`echo x > ${slash(nueva)}`).code, 2);
  });

  test('una edición de un archivo existente con autorización vigente pasa', () => {
    writeAllow([{ file: path.basename(migration), expiresAt: minutesFromNow(30) }]);
    assert.equal(sh(`sed -i s/a/b/ ${slash(migration)}`).code, 0);
  });

  test('leer, copiar desde y escribir en otras rutas pasa', () => {
    assert.equal(sh(`cat ${slash(migration)}`).code, 0);
    assert.equal(sh(`cp ${slash(migration)} /tmp/copia.ts`).code, 0);
    assert.equal(sh(`grep -n AddFoo ${slash(migration)} > /tmp/out.txt`).code, 0);
    assert.equal(sh(`echo x > ${slash(path.join(ws.repo(), 'src', 'app.service.ts'))}`).code, 0);
    assert.equal(sh('npm run migration:show 2>&1').code, 0);
    assert.equal(sh('ls src/database/migrations').code, 0);
  });
});

describe('fail-open', () => {
  test('JSON ilegible o vacío permite', () => {
    assert.equal(ws.hook(HOOK, '{ roto').code, 0);
    assert.equal(ws.hook(HOOK, '').code, 0);
  });

  test('una herramienta sin ruta permite', () => {
    assert.equal(ws.hook(HOOK, { tool_name: 'Write', cwd: ws.dir, tool_input: {} }).code, 0);
  });

  test('un archivo de autorización ilegible se trata como sin autorización', () => {
    ws.put(ALLOW, '{ no es json');
    assert.equal(ws.hook(HOOK, edit(migration, ws.dir)).code, 2);
  });

  test('sin ai-workspace.json permite y deja un diagnóstico', () => {
    ws.removeConfig();
    const r = ws.hook(HOOK, write(migration, ws.dir));
    assert.equal(r.code, 0);
    assert.match(r.stderr, /ai-workspace\.json/);
  });

  test('con la configuración rota permite y deja un diagnóstico', () => {
    for (const broken of ['{ roto', JSON.stringify({ version: 2 })]) {
      ws.setConfig(broken);
      const r = ws.hook(HOOK, write(migration, ws.dir));
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, new RegExp(`\\[${HOOK}\\]`));
    }
  });

  test('si no se puede escribir el log, igual bloquea', () => {
    ws.put('.ai-gates-log.jsonl/placeholder', '');
    try {
      assert.equal(ws.hook(HOOK, write(migration, ws.dir)).code, 2);
    } finally {
      fs.rmSync(path.join(ws.dir, '.ai-gates-log.jsonl'), { recursive: true, force: true });
    }
  });
});
