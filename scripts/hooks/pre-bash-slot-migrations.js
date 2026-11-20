#!/usr/bin/env node
/**
 * pre-bash-slot-migrations.js — hook PreToolUse sobre Bash.
 *
 * ## Qué problema resuelve
 *
 * La base de datos de desarrollo es UNA sola para el repositorio principal y
 * para todos los slots. Una migración corrida desde un slot cambia el esquema de
 * todos con código que todavía no está en la rama base, y dos ramas que migran
 * sobre la misma base se pisan: la segunda genera un diff contra un esquema que
 * ya incluye lo de la primera y propone BORRAR lo que hizo la otra.
 *
 * Por eso el flujo es: en el slot se escribe el código y se GENERA la migración
 * (contra una base descartable, ver `ai/core/procedures/shadow-migration.md`); se
 * commitea; la rama se lleva al principal (`manage-worktree.js promote`) y ahí se
 * corre, por orden del operador. Este hook hace que eso no dependa de acordarse.
 *
 * ## Qué bloquea (solo con un slot en juego y `repos[].database` declarado)
 *
 *   - `database.writeCommands`: migrar, revertir, seeds. Escriben en la base de
 *     todos. Incluye los seeds corridos por un runner de TypeScript/node sobre
 *     el directorio de seeds, si la config lo declara como comando.
 *   - `database.generateCommands`: generar contra la base compartida. Compara las
 *     entidades contra el esquema REAL, que acumula migraciones de otras ramas sin
 *     mergear. En su lugar va `database.generateAlternative`.
 *
 * Deja pasar `database.readOnlyAllowed` (solo lee), el comando alternativo y todo
 * lo que se corre en el principal.
 *
 * Los comandos NUNCA están fijos acá: son datos de la config, porque cada stack
 * los llama distinto (`npm run migration:run`, `dotnet ef database update`,
 * `alembic upgrade`, `prisma migrate deploy`...). Una entrada es un comando tal
 * como se escribiría, o un token suelto (`migration:run`), y coincide si sus
 * tokens aparecen EN ORDEN entre los tokens del tramo, sin contar flags ni sus
 * valores (`npm --prefix X run migration:run` coincide con `npm run migration:run`).
 * Un token que termina en `/` coincide con cualquier ruta que lo contenga
 * (`ts-node src/database/seeds/` coincide con `ts-node ./src/database/seeds/run.ts`).
 *
 * Un tramo solo cuenta si su comando es un EJECUTOR real (npm, node, dotnet,
 * python...): `grep migration:run package.json` o `git commit -m "add seed"` no
 * ejecutan nada, y un guard que corta de más se desactiva a la semana.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const core = require('../lib/guard-core');
const wt = require('../lib/worktree-paths');

const ID = 'pre-bash-slot-migrations';

/** Programas que ejecutan algo. Lista genérica de ejecutores, no de un stack. */
const EXECUTORS = new Set([
  'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'node', 'ts-node', 'tsx', 'deno',
  'typeorm', 'typeorm-ts-node-commonjs', 'typeorm-ts-node-esm', 'prisma', 'knex', 'sequelize',
  'sequelize-cli', 'drizzle-kit', 'mikro-orm', 'dotnet', 'python', 'python3', 'py', 'pip', 'poetry',
  'uv', 'pipenv', 'alembic', 'flask', 'django-admin', 'manage.py', 'php', 'artisan', 'composer',
  'ruby', 'rake', 'rails', 'bundle', 'mvn', 'mvnw', 'gradle', 'gradlew', 'flyway', 'liquibase',
  'java', 'go', 'goose', 'migrate', 'make', 'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd',
]);

/** Prefijos de ejecución que no cambian qué se corre: `npx ts-node x` ≡ `ts-node x`. */
const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'exec', 'dlx']);

/** Los tokens de un comando sin flags, sin sus valores y sin el prefijo de ejecución. */
function comparable(item) {
  return [item.word, ...item.positional].filter((t) => !RUNNERS.has(t.toLowerCase()));
}

/** Los tokens de una entrada de la config: sin flags ni marcadores `<...>` / `[...]`. */
function entryTokens(entry) {
  const tokens = core.positionals(core.tokenize(String(entry)));
  return tokens
    .filter((t) => !/^[<[].*[>\]]$/.test(t))
    .filter((t) => !RUNNERS.has(t.toLowerCase()));
}

function tokenMatches(entryToken, actual, first) {
  const e = wt.posix(entryToken).toLowerCase();
  const a = wt.posix(actual).toLowerCase();
  if (e === a) return true;
  if (first && core.normWord(entryToken) === core.normWord(actual)) return true;
  // `posix` quita la barra final: se mira antes si el token de la entrada era un directorio.
  return /[\\/]$/.test(entryToken) && `/${a}/`.includes(`/${e}/`);
}

/** ¿Los tokens de la entrada aparecen, en orden, entre los del comando? */
function matchesEntry(tokens, entry) {
  const want = entryTokens(entry);
  if (want.length === 0) return false;
  let from = 0;
  for (const [i, token] of want.entries()) {
    let found = -1;
    for (let j = from; j < tokens.length; j += 1) {
      if (tokenMatches(token, tokens[j], i === 0 && j === 0)) {
        found = j;
        break;
      }
    }
    if (found === -1) return false;
    from = found + 1;
  }
  return true;
}

const matchesAny = (tokens, entries) => entries.some((e) => matchesEntry(tokens, e));

function writeMessage(command, db) {
  return [
    'Comando bloqueado: escribe en la base de datos desde un slot de worktree.',
    '',
    `  ${String(command).trim().slice(0, 300)}`,
    '',
    'La base es una sola para el repositorio principal y todos los slots. Migrar,',
    'revertir y correr seeds desde un slot cambia el esquema (o los datos) de todos',
    'con código que no está en la rama base, y dos ramas que migran sobre la misma',
    'base se pisan: la segunda genera un diff contra un esquema que ya incluye lo',
    'de la primera y propone borrar lo que hizo la otra.',
    '',
    'Qué hacer en su lugar:',
    '',
    '  1. Generar la migración en el slot (sin tocar la base compartida):',
    `       ${db.generateAlternative || '(el proyecto no declaró `repos[].database.generateAlternative`)'}`,
    '  2. Commitear y pushear el trabajo del slot.',
    '  3. Llevar la rama al repositorio principal:',
    '       node scripts/manage-worktree.js promote --slot <slot>',
    '  4. Correrla ahí, solo por orden del operador.',
    '',
    db.readOnlyAllowed.length
      ? `Esto sí se puede correr desde un slot (solo lee): ${db.readOnlyAllowed.join(' | ')}`
      : 'Los comandos de solo lectura se declaran en `repos[].database.readOnlyAllowed`.',
    '',
    'Detalle: ai/core/procedures/shadow-migration.md y ai/core/procedures/worktree-slots.md',
  ].join('\n');
}

function generateMessage(command, db) {
  return [
    'Comando bloqueado: genera una migración contra la base compartida, desde un slot.',
    '',
    `  ${String(command).trim().slice(0, 300)}`,
    '',
    'Generar compara las entidades contra el esquema REAL de la base, y la base',
    'compartida acumula migraciones de otras ramas sin mergear: el archivo generado',
    'puede proponer borrarlas (el DROP de lo de otro).',
    '',
    'En su lugar:',
    '',
    `  ${db.generateAlternative || '(el proyecto no declaró `repos[].database.generateAlternative`: pedile al operador que genere en el principal)'}`,
    '',
    'Genera contra una base descartable armada solo con las migraciones de la rama',
    'y la borra al terminar. No toca la base compartida.',
    '',
    'Detalle: ai/core/procedures/shadow-migration.md',
  ].join('\n');
}

core.runHook(
  ID,
  (ctx) => {
    const { cfg, root, command } = ctx;
    if (!command) return null;

    for (const item of core.analyze(command, ctx.cwd)) {
      if (!EXECUTORS.has(item.word)) continue;

      const sc = core.slotContext(cfg, root, item.cwd, item.text);
      if (!sc) continue;

      const tokens = comparable(item);
      for (const repo of sc.repos) {
        const db = repo.database;
        if (!db || db.shared === false) continue;

        if (matchesAny(tokens, db.readOnlyAllowed)) continue;
        if (db.generateAlternative && matchesEntry(tokens, db.generateAlternative)) continue;

        if (matchesAny(tokens, db.writeCommands)) {
          return {
            reason: 'escribe-en-la-base-desde-slot',
            extra: { slot: sc.slot, repo: repo.name },
            message: writeMessage(command, db),
          };
        }
        if (matchesAny(tokens, db.generateCommands)) {
          return {
            reason: 'genera-contra-base-compartida',
            extra: { slot: sc.slot, repo: repo.name },
            message: generateMessage(command, db),
          };
        }
      }
    }
    return null;
  },
  { tools: ['Bash'] },
);
