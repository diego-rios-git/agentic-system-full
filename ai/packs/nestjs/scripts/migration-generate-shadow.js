#!/usr/bin/env node
/**
 * migration-generate-shadow.js — genera una migración de TypeORM contra una base
 * DESCARTABLE ("sombra"), no contra la base de desarrollo.
 *
 * Es la variante ya adaptada (TypeORM + PostgreSQL) del método que cuenta
 * `ai/core/procedures/shadow-migration.md`. Otro ORM u otro motor: ese
 * procedimiento dice cómo adaptarlo.
 *
 * ## Por qué
 *
 * `migration:generate` compara las entidades contra el esquema REAL de la base.
 * La base de desarrollo es una sola para el repositorio principal y todos los
 * slots, y acumula todo lo que alguna vez se corrió en ella: migraciones de otras
 * ramas que todavía no se mergearon, una revertida a medias. Si la base tiene una
 * tabla o una columna que las entidades de la rama no conocen, el archivo
 * generado propone BORRARLA: el `DROP` de lo de otro.
 *
 * La sombra se arma desde cero con las migraciones de LA RAMA y nada más. La
 * diferencia contra ella es exactamente lo que la rama cambió, y es lo mismo que
 * va a ver producción, que también se construye solo con migraciones.
 *
 * ## Qué hace
 *
 *   1. Crea `<proyecto>_shadow_<lugar>` vacía (`principal`, `implementation_1`...).
 *      Una por lugar, así dos slots pueden generar a la vez. Si quedó una de una
 *      corrida cortada, es nuestra (lleva el prefijo) y se recrea.
 *   2. Corre ahí las migraciones de la rama.
 *   3. Genera la migración contra la sombra. El archivo queda en la rama.
 *   4. Borra la sombra SIEMPRE (`finally`), aunque algo haya fallado.
 *
 * No toca la base de desarrollo: no la lee ni la escribe.
 *
 * ## De dónde sale cada cosa (nada de un proyecto concreto)
 *
 *   - Repositorio:   el de `ai-workspace.json` con el pack `nestjs` (`--repo` si
 *                    hay más de uno).
 *   - Conexión:      el `.env` del repositorio PRINCIPAL, porque un slot no lo
 *                    tiene (está en .gitignore y un worktree no lo hereda). Se le
 *                    pasa a TypeORM por variables de entorno cambiando solo el
 *                    nombre de la base; `dotenv` no pisa una variable ya
 *                    definida. No se imprime nada del `.env`.
 *   - Prefijo de la sombra: `<project.name>_shadow_`; `MIGRATION_SHADOW_PREFIX`
 *                    lo cambia.
 *   - Carpeta de migraciones: `repos[].database.migrationsDir` (por defecto
 *                    `src/database/migrations`).
 *   - Data source:   `MIGRATION_DATA_SOURCE` (por defecto `src/database/data-source.ts`).
 *   - Drift conocido: `ai/local/migration-known-drift.json`, opcional:
 *                    `[{ "pattern": "regex sobre el up()", "note": "qué es y qué hacer" }]`.
 *
 * `pg` y el CLI de TypeORM se toman de las dependencias del propio proyecto
 * (`node_modules` del principal; un slot las ve por el enlace).
 *
 * ## Uso (desde la raíz del workspace)
 *
 *   node ai/packs/nestjs/scripts/migration-generate-shadow.js AddFooToBar
 *   node ai/packs/nestjs/scripts/migration-generate-shadow.js AddFooToBar --from implementation-1
 *   node ai/packs/nestjs/scripts/migration-generate-shadow.js AddFooToBar --repo mi-api
 *
 * El nombre va pelado y en PascalCase (sin `--name=`: con ese prefijo el archivo
 * puede salir como `AutoMigration<timestamp>`). Después de generar, el archivo se
 * revisa como dice `nestjs-create-migration`, y se corre en el principal, por
 * orden del operador.
 *
 * Exit: 0 generó (o no había cambios), 1 falló. La sombra se borra en ambos.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const LIB = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib');
const PACK_ID = 'nestjs';
const DEFAULT_MIGRATIONS_DIR = 'src/database/migrations';
const DEFAULT_DATA_SOURCE = 'src/database/data-source.ts';

/** Un error de uso o de entorno: se muestra y sale con 1, sin traza. */
class UserError extends Error {}

// ---------------------------------------------------------------------------
// Funciones puras (se prueban sin base de datos)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { name: null, from: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = argv[(i += 1)];
    else if (a === '--repo') args.repo = argv[(i += 1)];
    else if (a.startsWith('--name')) {
      throw new UserError('El nombre va pelado, sin `--name=`: con ese prefijo el archivo puede salir como AutoMigration<timestamp>.');
    } else if (!a.startsWith('-') && !args.name) args.name = a;
    else throw new UserError(`Argumento no reconocido: ${a}`);
  }
  if (!args.name) {
    throw new UserError('Falta el nombre. Uso: node ai/packs/nestjs/scripts/migration-generate-shadow.js NombreEnPascalCase [--from <slot>] [--repo <repo>]');
  }
  validateName(args.name);
  if ((argv.includes('--from') && !args.from) || (argv.includes('--repo') && !args.repo)) {
    throw new UserError('`--from` y `--repo` llevan un valor.');
  }
  return args;
}

function validateName(name) {
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) {
    throw new UserError(
      `"${name}" no es PascalCase. El nombre describe qué cambia el esquema: AddPlayerBankAccountReference.`,
    );
  }
}

/** `KEY=valor` de un `.env`. No imprime nada. */
function parseEnv(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/** Las variables con las que los proyectos NestJS suelen nombrar la conexión. */
const VARS = {
  host: ['DATABASE_HOST', 'DB_HOST', 'POSTGRES_HOST', 'PGHOST'],
  port: ['DATABASE_PORT', 'DB_PORT', 'POSTGRES_PORT', 'PGPORT'],
  user: ['DATABASE_USERNAME', 'DATABASE_USER', 'DB_USERNAME', 'DB_USER', 'POSTGRES_USER', 'PGUSER'],
  password: ['DATABASE_PASSWORD', 'DB_PASSWORD', 'POSTGRES_PASSWORD', 'PGPASSWORD'],
  name: ['DATABASE_NAME', 'DB_NAME', 'POSTGRES_DB', 'PGDATABASE'],
};
const URL_VAR = 'DATABASE_URL';

const firstOf = (env, keys) => keys.map((k) => env[k]).find((v) => v !== undefined && v !== '');

/** Los datos de conexión que hay en el `.env`, o un `UserError` que dice qué falta. */
function connectionOf(env) {
  if (env[URL_VAR]) {
    try {
      const u = new URL(env[URL_VAR]);
      return {
        host: u.hostname,
        port: Number(u.port || 5432),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
      };
    } catch {
      throw new UserError(`${URL_VAR} del .env no es una URL válida.`);
    }
  }
  const conn = {
    host: firstOf(env, VARS.host),
    port: Number(firstOf(env, VARS.port) || 5432),
    user: firstOf(env, VARS.user),
    password: firstOf(env, VARS.password) || '',
    database: firstOf(env, VARS.name),
  };
  if (!conn.host || !conn.user) {
    throw new UserError(
      'El .env no tiene los datos de conexión de PostgreSQL (host y usuario). Variables que se buscan: ' +
        `${[...VARS.host, ...VARS.user].join(', ')}, o ${URL_VAR}.`,
    );
  }
  return conn;
}

/** El nombre de la sombra de un lugar. */
function shadowName(projectName, place, env = process.env) {
  const prefix = env.MIGRATION_SHADOW_PREFIX || `${String(projectName).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_shadow_`;
  const name = `${prefix}${place}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new UserError(`El nombre de base sombra "${name}" no es un identificador válido de PostgreSQL (minúsculas, números y _; hasta 63).`);
  }
  return name;
}

/**
 * El entorno con el que corre TypeORM: el `.env` del principal con el nombre de
 * la base cambiado a la sombra (en la variable que el proyecto use, o en todas).
 */
function shadowEnv(fileEnv, shadow) {
  const env = { ...fileEnv };
  let touched = false;
  for (const key of VARS.name) {
    if (key in env) {
      env[key] = shadow;
      touched = true;
    }
  }
  if (!touched) env.DATABASE_NAME = shadow;
  if (env[URL_VAR]) {
    const u = new URL(env[URL_VAR]);
    u.pathname = `/${shadow}`;
    env[URL_VAR] = u.toString();
  }
  return env;
}

/** Los avisos sobre el archivo generado: lo que hay que mirar antes de seguir. */
function reviewGenerated(content, knownDrift = []) {
  const up = (String(content).split(/public async down\(/)[0] || '').split(/public async up\(/)[1] || '';
  const notes = [];

  for (const { pattern, note } of knownDrift) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    if (re.test(up)) notes.push(`Drift conocido: ${note}`);
  }

  const lines = up.split(/\r?\n/);
  const drops = lines.filter((l) => /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b/i.test(l)).map((l) => l.trim());
  if (drops.length > 0) {
    notes.push(
      `El up() borra algo (${drops.length} sentencia(s) DROP). Contra la sombra eso solo sale si la rama lo pidió, ` +
        'pero confirmalo, y recordá que el pipeline migra ANTES de desplegar: un DROP que el código viejo todavía ' +
        'usa rompe esa ventana.\n    ' +
        drops.slice(0, 8).join('\n    '),
    );
  }

  // Un renombre que el generador convierte en borrar + crear pierde los datos.
  const dropped = new Map();
  for (const l of lines) {
    const m = /ALTER TABLE\s+("?[\w.]+"?)\s+DROP COLUMN\s+("?\w+"?)/i.exec(l);
    if (m) dropped.set(m[1], (dropped.get(m[1]) || 0) + 1);
  }
  for (const l of lines) {
    const m = /ALTER TABLE\s+("?[\w.]+"?)\s+ADD\s+("?\w+"?)/i.exec(l);
    if (m && dropped.has(m[1])) {
      notes.push(
        `En ${m[1]} hay un DROP COLUMN y un ADD en el mismo up(): si es un renombre, el generador lo expresó como borrar ` +
          'y crear, y se pierden los datos de la columna. Hay que reemplazarlo por un RENAME (con autorización del operador).',
      );
      break;
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Con el workspace
// ---------------------------------------------------------------------------

function loadLib() {
  const wc = require(path.join(LIB, 'workspace-config'));
  const wt = require(path.join(LIB, 'worktree-paths'));
  let cfg;
  try {
    cfg = wc.load();
  } catch (err) {
    throw new UserError(`No se pudo leer ai-workspace.json: ${err.message}`);
  }
  return { wc, wt, cfg };
}

function pickRepo(wc, cfg, repoArg) {
  const repos = wc.reposWithPack(cfg, PACK_ID);
  if (repos.length === 0) throw new UserError(`Ningún repositorio de ai-workspace.json tiene el pack "${PACK_ID}".`);
  if (repoArg) {
    const hit = repos.find((r) => r.name === repoArg);
    if (!hit) throw new UserError(`"${repoArg}" no tiene el pack ${PACK_ID}. Con el pack: ${repos.map((r) => r.name).join(', ')}.`);
    return hit;
  }
  if (repos.length > 1) {
    throw new UserError(`Hay más de un repositorio con el pack ${PACK_ID}: indicá cuál con --repo (${repos.map((r) => r.name).join(', ')}).`);
  }
  return repos[0];
}

/** Dónde está el código de la rama y cómo se llama el lugar. */
function resolveTarget(wt, cfg, repo, from) {
  if (!from) return { dir: repo.absPath, place: 'principal' };
  const slot = path.basename(String(from).split('\\').join('/').replace(/\/+$/, ''));
  if (!wt.slots(cfg).some((s) => s.name === slot)) {
    throw new UserError(`--from tiene que ser un slot declarado (${wt.slots(cfg).map((s) => s.name).join(', ') || 'ninguno'}), no "${from}".`);
  }
  const dir = wt.slotRepoDir(cfg, slot, repo);
  if (!fs.existsSync(dir)) {
    throw new UserError(`No existe ${dir}: el slot "${slot}" no tiene abierto el repositorio ${repo.name} (node scripts/manage-worktree.js open ...).`);
  }
  return { dir, place: slot.replace(/-/g, '_') };
}

function typeormCli(dirs) {
  // Se llama con `node`, sin shell: invocar el `.cmd` de `.bin` en Windows exige
  // `shell: true`, que concatena los argumentos sin escaparlos.
  for (const d of dirs) {
    const cli = path.join(d, 'node_modules', 'typeorm', 'cli-ts-node-commonjs.js');
    if (fs.existsSync(cli)) return cli;
  }
  throw new UserError(
    'No está el CLI de TypeORM en las dependencias. En un slot, abrilo con `--link-deps`; ' +
      'nunca instales dependencias adentro de un slot (el directorio es un enlace al del principal).',
  );
}

function loadPg(dirs) {
  for (const d of dirs) {
    try {
      return createRequire(path.join(d, 'package.json'))('pg');
    } catch {
      // se prueba con el siguiente
    }
  }
  throw new UserError('No se encuentra el paquete `pg` en las dependencias del proyecto: hace falta para crear y borrar la base sombra.');
}

function typeorm(cli, cwd, env, args) {
  return spawnSync(process.execPath, [cli, '-d', process.env.MIGRATION_DATA_SOURCE || DEFAULT_DATA_SOURCE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tail(result, lines = 25) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation/.test(l))
    .slice(-lines)
    .join('\n');
}

async function withAdmin(pg, conn, fn) {
  const client = new pg.Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: 'postgres' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function readKnownDrift(root) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(root, 'ai', 'local', 'migration-known-drift.json'), 'utf8'));
    return Array.isArray(list) ? list.filter((d) => d && d.pattern && d.note) : [];
  } catch {
    return [];
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const { wc, wt, cfg } = loadLib();

  const repo = pickRepo(wc, cfg, args.repo);
  const { dir, place } = resolveTarget(wt, cfg, repo, args.from);
  const migrationsRel = (repo.database && repo.database.migrationsDir) || DEFAULT_MIGRATIONS_DIR;
  const migrationsDir = path.join(dir, migrationsRel);
  const dataSource = path.join(dir, process.env.MIGRATION_DATA_SOURCE || DEFAULT_DATA_SOURCE);
  if (!fs.existsSync(dataSource)) {
    throw new UserError(`${dataSource} no existe: no es un repositorio con data source de TypeORM (MIGRATION_DATA_SOURCE lo cambia).`);
  }

  // La conexión sale del principal: un slot no tiene .env.
  const envFile = path.join(repo.absPath, '.env');
  if (!fs.existsSync(envFile)) {
    throw new UserError(`No existe ${envFile}: sin él no hay con qué conectarse a PostgreSQL.`);
  }
  const fileEnv = parseEnv(fs.readFileSync(envFile, 'utf8'));
  const conn = connectionOf(fileEnv);
  const shadow = shadowName(cfg.project.name, place);
  if (conn.database === shadow) throw new UserError('El nombre de la sombra coincide con la base del .env. No se sigue.');

  const search = [dir, repo.absPath];
  const cli = typeormCli(search);
  const pg = loadPg([repo.absPath, dir]);
  const env = { ...process.env, ...shadowEnv(fileEnv, shadow) };

  fs.mkdirSync(migrationsDir, { recursive: true });
  const before = new Set(fs.readdirSync(migrationsDir));

  process.stdout.write(`Base sombra: ${shadow} (la de desarrollo no se toca)\n`);

  // 1. Crear. Una sombra de una corrida cortada es nuestra (lleva el prefijo): se recrea.
  try {
    await withAdmin(pg, conn, async (client) => {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [shadow]);
      if (exists.rowCount > 0) {
        process.stdout.write('  quedó una sombra de una corrida anterior: se recrea\n');
        await client.query(`DROP DATABASE "${shadow}"`);
      }
      await client.query(`CREATE DATABASE "${shadow}" TEMPLATE template0`);
    });
  } catch (error) {
    if (error.code === '42501') {
      throw new UserError(
        'El usuario de PostgreSQL del .env no puede crear bases (falta CREATEDB). No se tocó nada. ' +
          'Pedile al operador que le dé el permiso o que genere en el principal.',
      );
    }
    throw new UserError(`No se pudo crear la base sombra: ${error.message}`);
  }

  let generated = null;
  try {
    // 2. Construir el esquema de la rama. Nada de `process.exit` dentro de este
    //    `try`: saltearía el `finally` y la sombra quedaría creada.
    process.stdout.write('  corriendo las migraciones de la rama en la sombra...\n');
    const t0 = Date.now();
    const run = typeorm(cli, dir, env, ['migration:run']);
    if (run.status !== 0) {
      process.stderr.write(`${tail(run)}\n`);
      process.stderr.write(
        '\nLas migraciones de la rama no construyen el esquema desde cero (arriba, el error). ' +
          'Eso es un problema de la rama o de la base de las migraciones, no de la sombra: avisarle al operador.\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`  esquema de la rama listo en ${Math.round((Date.now() - t0) / 1000)} s\n`);

    // 3. Generar contra la sombra.
    const gen = typeorm(cli, dir, env, ['migration:generate', path.join(migrationsRel, args.name)]);
    const out = `${gen.stdout || ''}\n${gen.stderr || ''}`;
    if (/No changes in database schema were found/.test(out)) {
      process.stdout.write('\nNo hay cambios de esquema: las entidades de la rama coinciden con sus migraciones. No se generó nada.\n');
    } else if (gen.status !== 0) {
      process.stderr.write(`${tail(gen)}\n`);
      process.stderr.write('\nmigration:generate falló contra la sombra (arriba, el error).\n');
      process.exitCode = 1;
    } else {
      const created = fs.readdirSync(migrationsDir).filter((f) => !before.has(f));
      generated = created.length === 1 ? path.join(migrationsDir, created[0]) : null;
      process.stdout.write(`\nGenerada: ${generated ? path.relative(cfg.root, generated) : created.join(', ')}\n`);
    }
  } finally {
    // 4. Borrar siempre.
    try {
      await withAdmin(pg, conn, (client) => client.query(`DROP DATABASE IF EXISTS "${shadow}"`));
      process.stdout.write(`  sombra ${shadow} borrada\n`);
    } catch (error) {
      process.stderr.write(
        `  AVISO: no se pudo borrar ${shadow}: ${error.message}. No afecta a la base de desarrollo; la próxima corrida la recrea.\n`,
      );
    }
  }

  if (generated) {
    for (const note of reviewGenerated(fs.readFileSync(generated, 'utf8'), readKnownDrift(cfg.root))) {
      process.stdout.write(`\nATENCION: ${note}\n`);
    }
    process.stdout.write(
      '\nSiguiente: controlar el archivo como dice `nestjs-create-migration` (se corrige solo con autorización del operador). ' +
        'Se corre en el principal, y solo por orden del operador.\n',
    );
  }
}

module.exports = { UserError, parseArgs, validateName, parseEnv, connectionOf, shadowName, shadowEnv, reviewGenerated, VARS };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`\n${err instanceof UserError ? err.message : err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}
