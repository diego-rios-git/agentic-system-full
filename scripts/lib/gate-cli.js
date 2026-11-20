#!/usr/bin/env node
/**
 * gate-cli.js
 *
 * El andamiaje que todo gate repite: leer los argumentos, cargar la
 * configuración, resolver el repositorio, comprobar que exista, y salir con el
 * código correcto.
 *
 * Por qué esto es una biblioteca y no una convención escrita: el tri-estado
 * —0 limpio, 1 hallazgos, 2 no se pudo verificar— es lo que sostiene toda la
 * confianza del sistema, y **se olvidaba**. En este repositorio hubo cuatro
 * casos de un gate que salía con 0 donde correspondía 2: sin reglas activas,
 * con el repositorio sin clonar, sin la herramienta externa instalada, y con un
 * archivo de reglas que no cargó. Ninguno se veía como un fallo — se veían como
 * un proyecto limpio.
 *
 * Un gate que usa esto no puede cometer esos errores: no elige el código de
 * salida, lo devuelve como un resultado y el andamiaje lo traduce.
 *
 *   const cli = require('./lib/gate-cli');
 *
 *   cli.run({
 *     name: 'antipatterns',
 *     usage: '[--rule ID] [--target ruta]',
 *     scan(ctx) {
 *       if (algoNoSePudo) return cli.unverified('semgrep no está instalado');
 *       return cli.findings(lista);            // o cli.clean('mensaje')
 *     },
 *   });
 *
 * `ctx` trae `{ cfg, repo, dir, isSlot, slot, base, argv, arg, has, asJson,
 * useBaseline, writeBaseline }`.
 *
 * **`--repo` acepta el nombre lógico o la ruta de un slot** (ver
 * `repo-location.js`). El andamiaje lo resuelve una vez, para todos los gates:
 *   - `ctx.repo` es el repositorio declarado, con `absPath` ya apuntando a la
 *     carpeta de la que hay que leer (la principal o el slot), y `name` lógico.
 *   - los hallazgos y el baseline usan SIEMPRE el nombre lógico;
 *   - `--write-baseline` desde un slot sale con 2.
 * Un gate que lee `ctx.repo.absPath` y reporta `ctx.repo.name` funciona en un
 * slot sin saber que existen los slots.
 *
 * `ctx.base` es la base de comparación (`--base`, o `origin/<baseBranch>` del
 * repositorio) y `ctx.diff()` los archivos que toca la rama (ver `review-base.js`).
 */

'use strict';

const fs = require('fs');

const config = require('./workspace-config');
const baseline = require('./baseline');
const repoLocation = require('./repo-location');
const reviewBase = require('./review-base');

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

/** Se verificó y no hay nada. Código 0. */
function clean(message) {
  return { kind: 'clean', message: message || null };
}

/** Se verificó y hay hallazgos. Código 1 si la lista no está vacía. */
function findings(list, opts = {}) {
  return { kind: 'findings', list: list || [], ...opts };
}

/**
 * **No se pudo verificar.** Código 2, y en `--json` no se emite ninguna lista.
 *
 * Esta es la razón de existir del módulo. Emitir `[]` con código 0 acá es
 * indistinguible de "revisé todo y está limpio" para el script que lo consume,
 * y esa confusión es la que convierte un gate roto en una falsa garantía.
 */
function unverified(reason, hint) {
  return { kind: 'unverified', reason, hint: hint || null };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * @param {object} spec
 * @param {string} spec.name nombre del baseline y del gate
 * @param {string} [spec.usage] argumentos extra, para el mensaje de uso
 * @param {boolean} [spec.needsRepo=true] si requiere `--repo`
 * @param {Function} spec.scan recibe `ctx`, devuelve uno de los resultados
 * @param {Function} [spec.fingerprint] cómo se identifica un hallazgo en el baseline
 * @param {Function} [spec.render] cómo se imprime la lista en modo humano
 */
function run(spec) {
  const argv = process.argv.slice(2);

  const has = (flag) => argv.includes(flag);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };

  const asJson = has('--json');
  const useBaseline = has('--baseline');
  const writeBaseline = has('--write-baseline');

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  let repo = null;
  let located = null;
  if (spec.needsRepo !== false) {
    const repoName = arg('--repo');
    if (!repoName) {
      process.stderr.write(
        `\nUso: node ${spec.script || `scripts/check-${spec.name}.js`} --repo <${cfg.repos
          .map((r) => r.name)
          .join('|')}> ${spec.usage || ''} [--json] [--baseline] [--write-baseline]\n\n`,
      );
      process.exit(2);
    }

    // Nombre lógico o ruta de un slot. Si no es ninguno de los dos, el error
    // lista los repositorios declarados.
    located = repoLocation.resolve(cfg, repoName);
    if (!located) {
      try {
        config.repo(cfg, repoName);
      } catch (err) {
        return config.reportAndExit(err);
      }
    }
    repo = located.repo;

    // Un repositorio sin clonar no es un repositorio limpio.
    if (!located.exists) {
      return exitUnverified(
        located.isSlot
          ? `${repo.name}: el slot "${located.slot}" no tiene ese repositorio (${located.dir})`
          : `${repo.name}: el repositorio no existe en ${repo.path}`,
        located.isSlot ? 'Abrir el slot con ese repositorio, o no usar --from.' : '¿Falta clonarlo?',
      );
    }

    // Congelar desde un slot perdonaría para siempre los hallazgos de una rama
    // que todavía no se mergeó. Se corta ANTES de escanear.
    if (writeBaseline && located.isSlot) {
      return exitUnverified(
        `${repo.name}: no se escribe baseline desde un slot (${located.slot})`,
        'El baseline congela deuda de la rama principal; hacerlo desde la principal.',
      );
    }
  }

  const ctxBase = repo ? reviewBase.baseFor(repo, arg('--base'), located && located.dir) : null;
  let diffCache;
  const diff = (opts) => {
    if (diffCache === undefined || opts) {
      diffCache = reviewBase.diffFiles(located.dir, ctxBase, opts);
    }
    return diffCache;
  };

  let result;
  try {
    result = spec.scan({
      cfg,
      repo,
      dir: located ? located.dir : null,
      isSlot: located ? located.isSlot : false,
      slot: located ? located.slot : null,
      base: ctxBase,
      diff,
      warnBase: () => reviewBase.warnIfStaleBase(located.dir, ctxBase, repo.name),
      argv,
      arg,
      has,
      asJson,
      useBaseline,
      writeBaseline,
    });
  } catch (err) {
    // Una excepción del gate es "no se pudo verificar", nunca "está limpio".
    return exitUnverified(`${spec.name}: ${err.message}`);
  }

  if (!result || result.kind === 'unverified') {
    return exitUnverified(
      (result && result.reason) || `${spec.name}: el gate no devolvió ningún resultado`,
      result && result.hint,
    );
  }

  if (result.kind === 'clean') {
    // Congelar "nada" también es congelar: sin esto, un baseline viejo seguiría
    // perdonando hallazgos que ya no existen y los que reaparezcan.
    if (writeBaseline && spec.fingerprint) {
      const res = baseline.write(spec.name, repo ? repo.name : 'workspace', []);
      console.log(`\n  Baseline de "${repo ? repo.name : 'workspace'}": ${res.written} congelado(s)\n`);
      process.exit(0);
    }
    if (asJson) process.stdout.write('[]\n');
    else if (result.message) console.log(`\n  ${result.message}\n`);
    process.exit(0);
  }

  let list = result.list;

  if (writeBaseline && spec.fingerprint) {
    const res = baseline.write(spec.name, repo ? repo.name : 'workspace', list.map(spec.fingerprint));
    console.log(`\n  Baseline de "${repo ? repo.name : 'workspace'}": ${res.written} congelado(s)`);
    console.log(`  Total en el archivo: ${res.total} (scopes: ${res.scopes.join(', ')})\n`);
    process.exit(0);
  }

  if (useBaseline && spec.fingerprint) {
    list = baseline.filter(list, spec.name, repo ? repo.name : 'workspace', spec.fingerprint);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    process.exit(list.length > 0 ? 1 : 0);
  }

  if (list.length === 0) {
    console.log(`\n  ${repo ? repo.name : 'workspace'}: ${result.emptyMessage || 'sin hallazgos nuevos'}\n`);
    process.exit(0);
  }

  if (spec.render) spec.render(list, { repo, cfg });
  else {
    console.log(`\n  ${repo ? repo.name : 'workspace'}  —  ${list.length} hallazgo(s)\n`);
    for (const f of list) {
      console.log(`  [${f.rule || '?'}] ${f.file || ''}${f.line ? `:${f.line}` : ''}`);
      if (f.message) console.log(`    ${f.message}`);
    }
    console.log('');
  }

  process.exit(1);
}

/**
 * Sale con 2 y **sin escribir en stdout**, ni siquiera en `--json`.
 *
 * Lo que consume un gate en `--json` es un script, que lee el código de salida y
 * no el aviso. Una lista vacía ahí sería leída como "sin hallazgos".
 */
function exitUnverified(reason, hint) {
  process.stderr.write(`\n  ${reason}.\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.stderr.write('  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n\n');
  process.exit(2);
}

module.exports = { run, clean, findings, unverified, exitUnverified };
