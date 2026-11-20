#!/usr/bin/env node
/**
 * check-semgrep.js
 *
 * Gate de reglas estructurales, para lo que una expresión regular no puede ver.
 *
 * Por qué existe: `check-antipatterns.js` mira una línea por vez. Alcanza para
 * muchísimo —un `catch` vacío, una dirección cableada— y no alcanza para nada
 * que dependa de la **forma** del código: una transacción abierta dos veces en
 * el mismo método, un endpoint de lectura que llama a un servicio que escribe,
 * un valor que viaja desde la entrada de la petición hasta una consulta sin
 * pasar por validación.
 *
 * Por qué Semgrep y no un analizador propio: entiende C#, Java, Go, Python,
 * Kotlin, Ruby, PHP, Rust y JavaScript con el mismo formato de regla. Escribir
 * un analizador por lenguaje sería el trabajo de años que esta base no tiene
 * por qué hacer. Un pack aporta un archivo `.yml` y su stack queda cubierto.
 *
 * **Semgrep es opcional.** No está en las dependencias de la base y no hace
 * falta instalarlo: un proyecto sin él conserva todos los demás gates. Pero si
 * hay reglas declaradas y la herramienta no está, este gate sale con **2** — no
 * pudo verificar — y nunca con 0. La diferencia importa: 0 significa "miré y
 * está limpio", y decir eso sin haber mirado es el fallo que esta base entera
 * existe para evitar.
 *
 * Las reglas las aportan el núcleo y los packs, en `rules/semgrep/*.yml` dentro
 * de cada raíz de activos. Instalar el pack de un stack instala sus reglas.
 *
 * Códigos de salida: 0 sin hallazgos nuevos, o no hay reglas declaradas · 1 hay
 * hallazgos · 2 no se pudo verificar (semgrep ausente o falló, configuración
 * inválida, repositorio sin clonar).
 *
 * Uso:
 *   node scripts/check-semgrep.js --repo mi-api
 *   node scripts/check-semgrep.js --repo mi-api --json
 *   node scripts/check-semgrep.js --repo mi-api --write-baseline
 *   node scripts/check-semgrep.js --repo mi-api --baseline
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const assets = require('./lib/asset-roots');
const baseline = require('./lib/baseline');
const languages = require('./lib/languages');

const ROOT = config.ROOT;
const BASELINE_NAME = 'semgrep';
const RULES_SUBDIR = path.join('rules', 'semgrep');
const TIMEOUT_MS = 180000;

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

/** Archivos de regla del núcleo y de los packs que este repositorio tiene. */
function rulesFor(cfg, repo) {
  const files = [];

  for (const root of assets.rootsFor(cfg, repo)) {
    const dir = path.join(root.absDir, RULES_SUBDIR);
    if (!fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir)) {
      if (/\.ya?ml$/i.test(name)) files.push(path.join(dir, name));
    }
  }

  return files;
}

/**
 * Los identificadores que declaran esos archivos.
 *
 * Hacen falta porque `check_id` llega con el prefijo de la ruta del archivo de
 * reglas pegado con puntos, y el identificador propio **también puede tener
 * puntos**: `NET-2.1-get-que-escribe` quedaba recortado a `1-get-que-escribe`
 * al cortar por el último punto. Conociendo los declarados, se elige el que
 * calce como sufijo, que es exacto y no impone una convención de nombres a
 * quien escriba las reglas.
 *
 * Se leen con una expresión regular y no con un analizador de YAML a propósito:
 * traer una dependencia para sacar una lista de identificadores sería un costo
 * permanente por una línea. Si el archivo no se puede leer, se cae al recorte
 * por puntos, que acierta cuando el identificador no los tiene.
 */
function declaredIds(ruleFiles) {
  const ids = [];
  for (const file of ruleFiles) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(/^\s*-?\s*id:\s*["']?([\w.\-]+)["']?\s*$/gm)) {
      ids.push(m[1]);
    }
  }
  // Del más largo al más corto: con `NET-2` y `NET-2.1` declarados, el
  // identificador completo tiene que ganar sobre el que es prefijo suyo.
  return ids.sort((a, b) => b.length - a.length);
}

function ruleIdOf(checkId, ids) {
  const full = String(checkId || 'semgrep');
  const found = ids.find((id) => full === id || full.endsWith(`.${id}`));
  return found || full.split('.').pop();
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * Cuántos archivos se le pasan a semgrep por invocación.
 *
 * Hay un tope de longitud para la línea de comandos —en Windows, unos 32 000
 * caracteres— y un repositorio grande lo supera. Se corre por lotes: es
 * determinista y no depende de cuántos archivos tenga el proyecto.
 */
const BATCH_SIZE = 200;

/**
 * Corre semgrep sobre una lista de archivos. Devuelve `{ results }`, o
 * `{ error }` si no se pudo ejecutar.
 *
 * **Se le pasan los archivos, no el directorio.** Con un directorio, semgrep
 * analiza solo lo que git tiene versionado, y entonces un archivo recién creado
 * —exactamente lo que produce un agente mientras trabaja— no se analiza hasta
 * que alguien lo confirma. El gate salía limpio sobre código que nunca había
 * mirado. Enumerando desde el perfil de lenguaje, lo que se analiza es lo que
 * el proyecto declaró como fuente, sin importar el estado del control de
 * versiones.
 *
 * Tampoco se usa `--baseline-commit` de la propia herramienta: esa opción
 * aborta si hay cambios sin confirmar en el árbol de trabajo, que es la
 * situación normal mientras se trabaja. La baseline la maneja esta base, igual
 * que en los demás gates.
 */
function runSemgrep(ruleFiles, targets) {
  const args = ['--quiet', '--json', '--disable-version-check', '--metrics=off'];
  for (const file of ruleFiles) args.push('--config', path.relative(ROOT, file).split(path.sep).join('/'));
  args.push(...targets);

  const run = spawnSync('semgrep', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    // Sin esto, semgrep falla en Windows al leer un YAML de reglas con acentos:
    // interpreta el archivo como cp1252 en vez de UTF-8 y aborta.
    env: { ...process.env, PYTHONUTF8: '1' },
    shell: process.platform === 'win32',
  });

  if (run.error) {
    return {
      error:
        run.error.code === 'ENOENT'
          ? 'semgrep no está instalado'
          : `semgrep no se pudo ejecutar: ${run.error.message}`,
    };
  }

  const detail = () => String(run.stderr || '').trim().split('\n').slice(0, 3).join(' ');

  // El código de salida NO alcanza para saber si corrió.
  //
  // Semgrep usa 0 sin hallazgos y 1 con hallazgos. Pero acá se invoca a través
  // del shell —en Windows hace falta para resolver el ejecutable— y un shell
  // que no encuentra el comando devuelve **1**, el mismo código que "encontré
  // algo". Confiando en el código de salida, un equipo sin semgrep instalado
  // recibía una lista vacía y un 0: el gate reportaba "limpio" sin haber
  // ejecutado nada, que es el fallo exacto que este archivo dice evitar.
  //
  // Lo que decide es la salida: si no hay un JSON con `results`, no corrió.
  const out = String(run.stdout || '').trim();
  if (!out.startsWith('{')) {
    return {
      error: /not found|no se reconoce|not recognized/i.test(detail())
        ? 'semgrep no está instalado'
        : `semgrep no produjo salida${detail() ? `: ${detail()}` : ''}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (err) {
    return { error: `la salida de semgrep no es JSON válido: ${err.message}` };
  }

  if (!Array.isArray(parsed.results)) {
    return { error: `la salida de semgrep no trae resultados${detail() ? `: ${detail()}` : ''}` };
  }

  if (run.status !== 0 && run.status !== 1) {
    return { error: `semgrep terminó con código ${run.status}${detail() ? `: ${detail()}` : ''}` };
  }

  return { results: parsed.results };
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * La línea que disparó el hallazgo, leída del archivo.
 *
 * No se usa `extra.lines` de la propia herramienta: en la edición libre viene
 * con el texto `requires login` en lugar del código. Eso no rompería el informe
 * —se vería feo— pero sí la **baseline**, que identifica cada hallazgo por su
 * contenido: todos los hallazgos tendrían la misma huella, congelar uno
 * congelaría todos, y el gate quedaría callado sobre lo que vino a vigilar.
 */
function lineReader() {
  const cache = new Map();

  return (absPath, line) => {
    if (!line) return '';
    if (!cache.has(absPath)) {
      try {
        cache.set(absPath, fs.readFileSync(absPath, 'utf8').split(/\r?\n/));
      } catch {
        cache.set(absPath, null);
      }
    }
    const lines = cache.get(absPath);
    if (!lines || !lines[line - 1]) return '';
    return lines[line - 1].replace(/\s+/g, ' ').trim().slice(0, 120);
  };
}

function normalize(results, repoRoot, profile, ids) {
  const findings = [];
  const readLine = lineReader();

  for (const r of results) {
    const abs = path.resolve(ROOT, r.path);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');

    // Las rutas generadas y los tests los decide el perfil, igual que en los
    // demás gates: una regla no debería tener que repetir esas exclusiones.
    if (profile.isIgnoredPath(rel)) continue;
    if (profile.isTest(rel)) continue;

    const extra = r.extra || {};
    const line = (r.start && r.start.line) || 0;
    findings.push({
      rule: ruleIdOf(r.check_id, ids),
      file: rel,
      line,
      code: readLine(abs, line),
      severity: extra.severity || 'WARNING',
      message: String(extra.message || '').replace(/\s+/g, ' ').trim(),
    });
  }

  return findings;
}

/** Sin la línea: mover código no debe reintroducir un hallazgo congelado. */
function fingerprint(f) {
  return `${f.rule}|${f.file}|${f.code}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const useBaseline = argv.includes('--baseline');
  const writeBaseline = argv.includes('--write-baseline');

  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const repoName = arg('--repo');
  if (!repoName) {
    process.stderr.write(
      `\nUso: node scripts/check-semgrep.js --repo <${cfg.repos
        .map((r) => r.name)
        .join('|')}> [--json] [--baseline] [--write-baseline]\n\n`,
    );
    process.exit(2);
  }

  let repo;
  try {
    repo = config.repo(cfg, repoName);
  } catch (err) {
    return config.reportAndExit(err);
  }

  if (!fs.existsSync(repo.absPath)) {
    process.stderr.write(`\n  ${repo.name}: el repositorio no existe en ${repo.path}\n\n`);
    process.exit(2);
  }

  const ruleFiles = rulesFor(cfg, repo);

  // Sin reglas declaradas no hay nada que verificar, y eso no es un fallo: la
  // base no trae reglas estructurales propias, las aportan los packs. Se sale
  // con 0 porque "no hay nada que buscar" es distinto de "no pude buscar".
  if (ruleFiles.length === 0) {
    if (asJson) process.stdout.write('[]\n');
    else {
      console.log(`\n  ${repo.name}: ningún pack activo declara reglas de semgrep.`);
      console.log(`  Se declaran en ${RULES_SUBDIR.split(path.sep).join('/')} dentro del pack.\n`);
    }
    process.exit(0);
  }

  const profile = languages.forRepo(cfg, repo);
  for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);

  if (profile.empty) {
    process.stderr.write(
      `\n  ${repo.name}: ningún pack activo declara un perfil de lenguaje, ` +
        'no hay archivos que analizar.\n\n',
    );
    process.exit(2);
  }

  const srcRoot = path.join(repo.absPath, 'src');
  const scanRoot = fs.existsSync(srcRoot) ? srcRoot : repo.absPath;

  // Los archivos los enumera el perfil, no semgrep: ver `runSemgrep`.
  const files = languages
    .walk(profile, scanRoot)
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));

  if (files.length === 0) {
    if (asJson) process.stdout.write('[]\n');
    else console.log(`\n  ${repo.name}: no hay archivos fuente que analizar.\n`);
    process.exit(0);
  }

  const results = [];
  let error = null;

  for (let i = 0; i < files.length && !error; i += BATCH_SIZE) {
    const lote = runSemgrep(ruleFiles, files.slice(i, i + BATCH_SIZE));
    if (lote.error) error = lote.error;
    else results.push(...lote.results);
  }

  if (error) {
    process.stderr.write(
      `\n  ${repo.name}: ${error}.\n` +
        `  Hay ${ruleFiles.length} archivo(s) de reglas declarados que no se pudieron aplicar.\n` +
        '  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n' +
        '  Instalación: `pip install semgrep` (opcional; el resto de los gates no lo necesita).\n\n',
    );
    process.exit(2);
  }

  let findings = normalize(results, repo.absPath, profile, declaredIds(ruleFiles));

  if (writeBaseline) {
    const res = baseline.write(BASELINE_NAME, repo.name, findings.map(fingerprint));
    console.log(`\n  Baseline de "${repo.name}": ${res.written} hallazgos congelados`);
    console.log(`  Total en el archivo: ${res.total} (scopes: ${res.scopes.join(', ')})\n`);
    process.exit(0);
  }

  if (useBaseline) {
    findings = baseline.filter(findings, BASELINE_NAME, repo.name, fingerprint);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log(`\n  ${repo.name}: sin hallazgos estructurales nuevos (${ruleFiles.length} archivo(s) de reglas)\n`);
    process.exit(0);
  }

  console.log(`\n  ${repo.name}  —  ${findings.length} hallazgo(s) estructural(es)\n`);
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  for (const [id, list] of byRule) {
    console.log(`  [${id}]  (${list.length})`);
    if (list[0].message) console.log(`    ${list[0].message}`);
    for (const f of list.slice(0, 10)) console.log(`      ${f.file}:${f.line}  ${f.code}`);
    if (list.length > 10) console.log(`      … y ${list.length - 10} más`);
    console.log('');
  }

  process.exit(1);
}

main();
