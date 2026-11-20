#!/usr/bin/env node
/**
 * check-scenario-coverage.js
 *
 * Cada escenario de aceptación de un cambio debe tener un test cuyo título lo
 * nombre.
 *
 * Por qué la correspondencia es por título y no por otra cosa: es lo único que
 * un script puede verificar sin ejecutar nada. Un test que prueba el escenario
 * pero se llama distinto es, para cualquier herramienta, indistinguible de un
 * escenario sin test. La convención de nombres es lo que hace verificable la
 * trazabilidad.
 *
 * Este gate no conoce ninguna herramienta de especificación en particular.
 * Dónde viven los documentos, cómo se marca un escenario y cómo se llama el
 * programa que los valida son datos que declara un pack proveedor — ver
 * `scripts/lib/sdd.js`. Estaba dentro del pack `openspec` y con esa herramienta
 * escrita adentro: cambiar de herramienta obligaba a reescribir el gate, así
 * que en la práctica no se cambiaba.
 *
 * Sin proveedor declarado sale con 0 y lo dice: un proyecto que trabaja sin
 * especificación previa no tiene nada que verificar acá.
 *
 * Los cambios a verificar se **detectan solos** desde el diff de la rama contra
 * su base, archivados incluidos. Barrer todos los cambios activos del
 * repositorio no sirve: devuelve escenarios de funcionalidades que hace meses
 * están en producción y que nadie archivó, y ese ruido pegado en el prompt de
 * un agente es exactamente el gasto que los gates vienen a evitar.
 *
 * Códigos de salida: 0 todos los escenarios tienen test · 1 hay escenarios sin
 * test · 2 no se pudo verificar (configuración inválida, o no se encontró
 * ningún título de test en un repositorio que declara `testCommand` — ver más
 * abajo por qué eso no es lo mismo que "no hay tests").
 *
 * Uso:
 *   node scripts/check-scenario-coverage.js --repo mi-api
 *   … --change <nombre>   (repetible; fuerza un conjunto en vez de detectarlo)
 *   … --json  ·  --base <rama>
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const languages = require('./lib/languages');
const testDiscovery = require('./lib/test-discovery');
const sdd = require('./lib/sdd');

const ROOT = config.ROOT;

/** Similitud mínima para considerar que un test cubre un escenario. */
const MATCH_THRESHOLD = 0.7;
/** Por debajo de esto no se sugiere nada: sería ruido. */
const HINT_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Comparación de títulos
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'que', 'con',
  'para', 'por', 'en', 'al', 'se', 'su', 'lo', 'a', 'the', 'of', 'and', 'to', 'is',
]);

function tokens(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Similitud de Jaccard sobre las palabras significativas. Se eligió por ser
 * estable ante el reordenamiento —un test puede decir lo mismo en otro orden—
 * y por no premiar los títulos largos, que es lo que pasa al contar palabras
 * compartidas sin normalizar.
 */
function similarity(a, b) {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;

  return shared / (setA.size + setB.size - shared);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Títulos de test del repositorio.
 *
 * La extracción vive en `lib/test-discovery.js` y la estrategia la declara el
 * perfil de cada lenguaje. Antes estaba acá, cableada a JavaScript: archivos
 * `.spec`/`.test` y llamadas `it(…)`/`test(…)`. En un repositorio .NET con
 * xUnit devolvía cero títulos, y como cada escenario quedaba sin
 * correspondencia, el gate los reportaba **todos** como sin test.
 */

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');

  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const explicit = argv.reduce(
    (acc, a, i) => (a === '--change' && argv[i + 1] ? [...acc, argv[i + 1]] : acc),
    [],
  );

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const repoName = arg('--repo');
  if (!repoName) {
    process.stderr.write(
      `\nUso: node scripts/check-scenario-coverage.js --repo <${cfg.repos
        .map((r) => r.name)
        .join('|')}> [--change <nombre>]… [--base <rama>] [--json]\n\n`,
    );
    process.exit(2);
  }

  let repo;
  try {
    repo = config.repo(cfg, repoName);
  } catch (err) {
    return config.reportAndExit(err);
  }

  // Un repositorio sin clonar no tiene sus escenarios cubiertos: no se sabe.
  if (!fs.existsSync(repo.absPath)) {
    process.stderr.write(
      `\n  ${repo.name}: el repositorio no existe en ${repo.path}. ¿Falta clonarlo?\n` +
        '  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n\n',
    );
    process.exit(2);
  }

  // Qué herramienta implementa el ciclo, y con ella dónde viven los documentos
  // y cómo se marca un escenario. Lo declara un pack; este script no conoce
  // ninguna herramienta en particular.
  const { provider, problems } = sdd.providerFor(cfg, repo);
  for (const p of problems) process.stderr.write(`  aviso: ${p}\n`);

  // Sin proveedor no hay ciclo instalado, y eso no es un fallo: es un proyecto
  // que trabaja sin especificación previa. Sale con 0 — "no hay nada que
  // verificar" — y no con 2, que significaría "no pude verificar".
  if (!provider) {
    if (asJson) process.stdout.write('[]\n');
    else {
      console.log(`\n  ${repo.name}: ningún pack activo declara un ciclo dirigido por especificación.`);
      console.log('  Nada que verificar. Ver docs/agregar-un-sdd.md.\n');
    }
    process.exit(0);
  }

  if (!fs.existsSync(path.join(repo.absPath, provider.changesDir))) {
    if (asJson) process.stdout.write('[]\n');
    else console.log(`  ${repo.name}: no hay ${provider.changesDir}, nada que verificar.`);
    process.exit(0);
  }

  const base = arg('--base') || repo.baseBranch;
  const changes = explicit.length > 0
    ? explicit
    : sdd.changesTouched(provider, repo.absPath, base);

  if (changes.length === 0) {
    // No se omite en silencio: que el gate desaparezca del informe es lo que
    // hace que nadie note que los escenarios nunca se verificaron.
    if (asJson) process.stdout.write('[]\n');
    else {
      console.log(`\n  ${repo.name}: no se detectó ningún cambio en el diff contra ${base}.`);
      console.log('  Tratarlo como "sin verificar", no como "sin hallazgos".\n');
    }
    process.exit(0);
  }

  const profile = languages.forRepo(cfg, repo);
  for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);

  const found = testDiscovery.titlesOf(profile, repo.absPath);
  const titles = found.titles;

  // Tres formas de no tener títulos, y solo una es un hallazgo.
  //
  // El gate compara la frase de cada escenario con el título de un test. Si no
  // hay ningún título, cada escenario queda sin correspondencia y el gate sale
  // con 1 reportándolos TODOS como sin test. Un equipo ve doscientos hallazgos
  // falsos la primera vez que lo corre y apaga el gate — que es exactamente el
  // fallo de adopción que las baselines vienen a evitar en el resto de la base.
  //
  // Se sale con 2, "no pude verificar", igual que `check-duplication.js` cuando
  // jscpd no está disponible.
  if (titles.length === 0) {
    if (found.unreadable.length > 0) {
      process.stderr.write(
        `\n  ${repo.name}: se encontraron ${found.files} archivo(s) de test que no se ` +
          `supieron leer (${found.unreadable.join(', ')}).\n` +
          '  El perfil de ese lenguaje no declara `language.testTitles`. ' +
          'Ver docs/agregar-un-pack-de-lenguaje.md.\n' +
          '  Tratarlo como NO VERIFICADO, no como "todos los escenarios sin test".\n\n',
      );
      process.exit(2);
    }

    if (repo.testCommand) {
      process.stderr.write(
        `\n  ${repo.name}: no se encontró ningún título de test, pero el repositorio ` +
          `declara \`testCommand\` (${repo.testCommand}).\n` +
          `  Se recorrieron ${found.files} archivo(s) reconocidos como test.\n` +
          '  Tratarlo como NO VERIFICADO, no como "todos los escenarios sin test".\n\n',
      );
      process.exit(2);
    }
  }

  const findings = [];

  for (const change of changes) {
    for (const scenario of sdd.scenariosOf(provider, repo.absPath, change)) {
      let best = null;
      for (const t of titles) {
        const score = similarity(scenario.title, t.title);
        if (!best || score > best.score) best = { ...t, score };
      }

      if (best && best.score >= MATCH_THRESHOLD) continue;

      const finding = {
        rule: 'BDD',
        change,
        file: scenario.spec.split(':')[0],
        line: Number(scenario.spec.split(':')[1]),
        message: `Escenario sin test: "${scenario.title}" (cambio ${change})`,
      };

      // Si hay un test muy parecido, el arreglo probablemente sea renombrarlo,
      // no escribir uno nuevo. Decirlo ahorra escribir un test duplicado.
      if (best && best.score >= HINT_THRESHOLD) {
        finding.message +=
          ` — hay un test parecido (${best.score.toFixed(2)}) en ${best.at}: ` +
          `"${best.title}". Verificá si es el mismo caso y renombralo.`;
      }

      findings.push(finding);
    }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log(`\n  ${repo.name}: todos los escenarios de ${changes.join(', ')} tienen test.\n`);
    process.exit(0);
  }

  console.log(`\n  ${repo.name}  —  ${findings.length} escenario(s) sin test\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    ${f.message}\n`);
  }
  process.exit(1);
}

main();
