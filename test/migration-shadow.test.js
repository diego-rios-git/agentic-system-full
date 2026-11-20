/**
 * migration-generate-shadow.js (pack nestjs): genera la migración contra una base
 * descartable y la borra SIEMPRE.
 *
 * Qué se prueba y qué NO. No hay PostgreSQL ni TypeORM reales en este entorno de
 * pruebas: el script se corre de verdad, en un proceso aparte, contra un `pg` y un
 * CLI de TypeORM de mentira que viven en el `node_modules` del repositorio de
 * prueba (el script los toma de ahí, como en un proyecto). Eso verifica lo que
 * importa del método —la sombra se crea, el CLI ve la sombra y no la base de
 * desarrollo, y la sombra se borra aunque falle a medio camino— pero NO que
 * TypeORM genere bien ni que `CREATE DATABASE` funcione en un servidor real.
 */

'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeWorkspace, baseConfig } = require('./hooks-fixture');
const shadow = require('../ai/packs/nestjs/scripts/migration-generate-shadow');

const SCRIPT = 'ai/packs/nestjs/scripts/migration-generate-shadow.js';
const DEV_DB = 'mi_base_de_desarrollo';

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

describe('argumentos y nombres', () => {
  test('acepta un nombre en PascalCase, --from y --repo', () => {
    assert.deepEqual(shadow.parseArgs(['AddFoo', '--from', 'implementation-1', '--repo', 'api']), {
      name: 'AddFoo',
      from: 'implementation-1',
      repo: 'api',
    });
  });

  test('rechaza lo que no es PascalCase, --name=, argumentos de más y la falta de nombre', () => {
    for (const bad of [['addFoo'], ['add-foo'], ['Foo Bar'], ['A'], ['--name=AddFoo'], ['AddFoo', 'Otro'], ['AddFoo', '--zzz'], [], ['AddFoo', '--from']]) {
      assert.throws(() => shadow.parseArgs(bad), shadow.UserError, JSON.stringify(bad));
    }
  });
});

describe('conexión y nombre de la sombra, sin nada fijo de un proyecto', () => {
  test('lee las variables más comunes y la URL', () => {
    const env = shadow.parseEnv('# c\nDB_HOST=db.local\nDB_PORT=5433\nDB_USER=app\nDB_PASSWORD="s3"\nDB_NAME=dev\n');
    assert.deepEqual(shadow.connectionOf(env), { host: 'db.local', port: 5433, user: 'app', password: 's3', database: 'dev' });
    assert.deepEqual(shadow.connectionOf({ DATABASE_URL: 'postgres://u:p%40@h:6543/dev' }), {
      host: 'h',
      port: 6543,
      user: 'u',
      password: 'p@',
      database: 'dev',
    });
  });

  test('un .env sin host o usuario dice qué variables busca', () => {
    assert.throws(() => shadow.connectionOf({ FOO: '1' }), /DATABASE_HOST.*DATABASE_USERNAME|DATABASE_USER/s);
  });

  test('el nombre sale del proyecto y del lugar; MIGRATION_SHADOW_PREFIX lo cambia', () => {
    assert.equal(shadow.shadowName('mi-proyecto', 'principal', {}), 'mi_proyecto_shadow_principal');
    assert.equal(shadow.shadowName('mi-proyecto', 'implementation_1', {}), 'mi_proyecto_shadow_implementation_1');
    assert.equal(shadow.shadowName('x', 'review', { MIGRATION_SHADOW_PREFIX: 'tmp_' }), 'tmp_review');
    assert.throws(() => shadow.shadowName('x', 'a'.repeat(70), {}), shadow.UserError);
    assert.throws(() => shadow.shadowName('x', 'a;drop', {}), shadow.UserError);
  });

  test('el entorno de TypeORM cambia solo el nombre de la base', () => {
    const out = shadow.shadowEnv({ DB_HOST: 'h', DB_NAME: 'dev', DB_PASSWORD: 'p' }, 'sh');
    assert.deepEqual(out, { DB_HOST: 'h', DB_NAME: 'sh', DB_PASSWORD: 'p' });
    assert.equal(shadow.shadowEnv({ DB_HOST: 'h' }, 'sh').DATABASE_NAME, 'sh');
    assert.match(shadow.shadowEnv({ DATABASE_URL: 'postgres://u:p@h:5432/dev' }, 'sh').DATABASE_URL, /\/sh$/);
  });
});

describe('revisión del archivo generado', () => {
  const file = (up) => `export class X { public async up(q) {\n${up}\n} public async down(q) {\n} }`;

  test('avisa de cualquier DROP', () => {
    const notes = shadow.reviewGenerated(file('await q.query(`ALTER TABLE "a" DROP COLUMN "b"`);'));
    assert.ok(notes.some((n) => /DROP/.test(n) && /ANTES de desplegar/.test(n)));
  });

  test('avisa de un renombre expresado como borrar y crear', () => {
    const notes = shadow.reviewGenerated(
      file('await q.query(`ALTER TABLE "a" DROP COLUMN "viejo"`);\nawait q.query(`ALTER TABLE "a" ADD "nuevo" integer`);'),
    );
    assert.ok(notes.some((n) => /renombre/.test(n) && /pierden los datos/.test(n)));
  });

  test('avisa del drift conocido que declara el proyecto, y no inventa uno propio', () => {
    const up = 'await q.query(`ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL`);';
    assert.deepEqual(shadow.reviewGenerated(file(up)), []);
    const notes = shadow.reviewGenerated(file(up), [{ pattern: '"c"\\s+SET NOT NULL', note: 'es el drift aceptado de t.c' }]);
    assert.deepEqual(notes, ['Drift conocido: es el drift aceptado de t.c']);
  });

  test('un archivo limpio no genera avisos', () => {
    assert.deepEqual(shadow.reviewGenerated(file('await q.query(`CREATE TABLE "n" ("id" int)`);')), []);
  });
});

// ---------------------------------------------------------------------------
// El script real, con un pg y un CLI de TypeORM de mentira
// ---------------------------------------------------------------------------

const FAKE_PG = `
const fs = require('fs');
const log = (e) => fs.appendFileSync(process.env.FAKE_PG_LOG, JSON.stringify(e) + '\\n');
class Client {
  constructor(cfg) { this.cfg = cfg; }
  async connect() { log({ op: 'connect', database: this.cfg.database }); }
  async query(sql, params) {
    log({ op: 'query', sql });
    if (/^CREATE DATABASE/.test(sql) && process.env.FAKE_PG_FAIL_CREATE) {
      const e = new Error('permission denied to create database'); e.code = '42501'; throw e;
    }
    if (/^DROP DATABASE IF EXISTS/.test(sql) && process.env.FAKE_PG_FAIL_DROP) throw new Error('la base está en uso');
    if (/FROM pg_database/.test(sql)) return { rowCount: process.env.FAKE_PG_EXISTS ? 1 : 0 };
    return { rowCount: 0 };
  }
  async end() {}
}
module.exports = { Client };
`;

const FAKE_TYPEORM = `
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const cmd = args.find((a) => a.startsWith('migration:'));
fs.appendFileSync(process.env.FAKE_PG_LOG, JSON.stringify({ op: 'typeorm', cmd, name: process.env.DB_NAME, cwd: process.cwd() }) + '\\n');
if (cmd === 'migration:run') { process.stderr.write('run fake\\n'); process.exit(Number(process.env.FAKE_RUN_EXIT || 0)); }
const mode = process.env.FAKE_GEN || 'file';
if (mode === 'nochanges') { console.log('No changes in database schema were found - cannot generate a migration.'); process.exit(1); }
if (mode === 'fail') { console.error('boom'); process.exit(1); }
const target = path.join(process.cwd(), args[args.length - 1]);
fs.writeFileSync(target.replace(/([^/\\\\]+)$/, Date.now() + '-$1') + '.ts',
  'export class X {\\n public async up(q) {\\n await q.query(\`ALTER TABLE "a" DROP COLUMN "b"\`);\\n }\\n public async down(q) {\\n }\\n}\\n');
console.log('Migration generated');
`;

describe('el script, de punta a punta', () => {
  let ws;
  const migrationsRel = 'src/database/migrations';

  before(() => {
    ws = makeWorkspace();
    const cfg = baseConfig();
    cfg.repos[0].database.migrationsDir = migrationsRel;
    ws.setConfig(cfg);

    const files = {
      'package.json': '{}',
      '.env': `DB_HOST=db.local\nDB_USER=app\nDB_PASSWORD=secreto\nDB_NAME=${DEV_DB}\n`,
      'src/database/data-source.ts': '',
      'node_modules/pg/index.js': FAKE_PG,
      'node_modules/typeorm/cli-ts-node-commonjs.js': FAKE_TYPEORM,
    };
    for (const [rel, content] of Object.entries(files)) ws.put(path.join('svc-api', rel), content);
    // Un slot con su código y sin .env ni node_modules propios.
    ws.put('worktrees/implementation-1/svc-api/src/database/data-source.ts', '');
  });
  after(() => ws.cleanup());

  const logPath = () => path.join(ws.dir, 'pg.log');
  beforeEach(() => {
    fs.rmSync(logPath(), { force: true });
    for (const base of ['svc-api', 'worktrees/implementation-1/svc-api']) {
      const dir = path.join(ws.dir, base, migrationsRel);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const run = (args, env = {}) => ws.script(SCRIPT, args, { env: { FAKE_PG_LOG: logPath(), ...env } });
  const events = () => (fs.existsSync(logPath()) ? fs.readFileSync(logPath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const sqls = () => events().filter((e) => e.op === 'query').map((e) => e.sql);
  const generated = (base = 'svc-api') => fs.readdirSync(path.join(ws.dir, base, migrationsRel));

  test('genera el archivo, el CLI ve la sombra (no la base de desarrollo) y la sombra se borra', () => {
    const r = run(['AddFoo']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Generada: /);
    assert.equal(generated().length, 1);
    assert.match(generated()[0], /AddFoo\.ts$/);

    const typeorm = events().filter((e) => e.op === 'typeorm');
    assert.deepEqual(typeorm.map((e) => e.cmd), ['migration:run', 'migration:generate']);
    for (const e of typeorm) assert.equal(e.name, 'demo_shadow_principal', 'el CLI tiene que ver la sombra');

    assert.ok(sqls().includes('CREATE DATABASE "demo_shadow_principal" TEMPLATE template0'));
    assert.equal(sqls().at(-1), 'DROP DATABASE IF EXISTS "demo_shadow_principal"');
    // Nunca se conecta a la base de desarrollo: el admin entra a `postgres`.
    assert.ok(events().filter((e) => e.op === 'connect').every((e) => e.database === 'postgres'));
    assert.ok(!sqls().some((s) => s.includes(DEV_DB)));
    assert.ok(!r.stdout.includes('secreto') && !r.stderr.includes('secreto'), 'no imprime nada del .env');
  });

  test('avisa del DROP del archivo generado', () => {
    assert.match(run(['AddFoo']).stdout, /ATENCION: El up\(\) borra algo/);
  });

  test('si las migraciones fallan a medio camino, la sombra igual se borra y sale con 1', () => {
    const r = run(['AddFoo'], { FAKE_RUN_EXIT: '1' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no construyen el esquema desde cero/);
    assert.equal(sqls().at(-1), 'DROP DATABASE IF EXISTS "demo_shadow_principal"');
    assert.equal(generated().length, 0);
    assert.ok(!events().some((e) => e.cmd === 'migration:generate'), 'no se llega a generar');
  });

  test('si generar falla, no queda archivo y la sombra se borra', () => {
    const r = run(['AddFoo'], { FAKE_GEN: 'fail' });
    assert.equal(r.code, 1);
    assert.equal(generated().length, 0);
    assert.equal(sqls().at(-1), 'DROP DATABASE IF EXISTS "demo_shadow_principal"');
  });

  test('sin cambios: dice "No hay cambios", sale 0, no deja archivo y borra la sombra', () => {
    const r = run(['AddFoo'], { FAKE_GEN: 'nochanges' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /No hay cambios de esquema/);
    assert.equal(generated().length, 0);
    assert.equal(sqls().at(-1), 'DROP DATABASE IF EXISTS "demo_shadow_principal"');
  });

  test('una sombra que quedó de una corrida cortada se recrea', () => {
    const r = run(['AddFoo'], { FAKE_PG_EXISTS: '1' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /se recrea/);
    const s = sqls();
    assert.ok(s.indexOf('DROP DATABASE "demo_shadow_principal"') < s.indexOf('CREATE DATABASE "demo_shadow_principal" TEMPLATE template0'));
  });

  test('si no se puede borrar la sombra, avisa pero no cambia el resultado', () => {
    const r = run(['AddFoo'], { FAKE_PG_FAIL_DROP: '1' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /AVISO: no se pudo borrar demo_shadow_principal/);
  });

  test('sin permiso de CREATEDB explica qué pasó y no deja nada', () => {
    const r = run(['AddFoo'], { FAKE_PG_FAIL_CREATE: '1' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /falta CREATEDB/);
    assert.equal(generated().length, 0);
  });

  test('desde un slot: la sombra es de ese slot, el archivo queda en la rama del slot y la conexión sale del principal', () => {
    const r = run(['AddFoo', '--from', 'worktrees/implementation-1']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(generated('worktrees/implementation-1/svc-api').length, 1);
    assert.equal(generated().length, 0, 'el principal no se toca');
    const typeorm = events().filter((e) => e.op === 'typeorm');
    assert.ok(typeorm.every((e) => e.name === 'demo_shadow_implementation_1'));
    assert.ok(typeorm.every((e) => e.cwd.includes('implementation-1')));
  });

  test('MIGRATION_SHADOW_PREFIX cambia el nombre', () => {
    run(['AddFoo'], { MIGRATION_SHADOW_PREFIX: 'tmp_' });
    assert.ok(sqls().includes('CREATE DATABASE "tmp_principal" TEMPLATE template0'));
  });

  test('un nombre inválido o un slot que no existe fallan antes de tocar la base', () => {
    for (const args of [['addFoo'], ['AddFoo', '--from', 'implementation-9'], ['AddFoo', '--repo', 'svc-web']]) {
      const r = run(args);
      assert.equal(r.code, 1, args.join(' '));
      assert.equal(events().length, 0, `${args.join(' ')} no debería conectarse a nada`);
    }
  });

  test('sin .env en el principal falla con un mensaje claro y sin conectarse', () => {
    const env = path.join(ws.dir, 'svc-api', '.env');
    const saved = fs.readFileSync(env);
    fs.rmSync(env);
    try {
      const r = run(['AddFoo']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /sin él no hay con qué conectarse/);
      assert.equal(events().length, 0);
    } finally {
      fs.writeFileSync(env, saved);
    }
  });

  test('sin ai-workspace.json falla con un mensaje claro', () => {
    const saved = fs.readFileSync(ws.configPath);
    ws.removeConfig();
    try {
      const r = run(['AddFoo']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /ai-workspace\.json/);
    } finally {
      fs.writeFileSync(ws.configPath, saved);
    }
  });
});
