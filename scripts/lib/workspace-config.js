#!/usr/bin/env node
/**
 * workspace-config.js
 *
 * Lee y valida `ai-workspace.json`, que es lo que hace que esta base sirva en
 * cualquier proyecto: todo lo que varía — nombres de repositorios, prefijo de
 * ticket, rama base, stacks, harnesses — vive acá y en ningún otro lado.
 *
 * Regla que este módulo existe para sostener: ningún script, agente o
 * procedimiento puede nombrar un repositorio concreto. Si un script necesita
 * saber cómo se llama el backend, lo pregunta acá.
 *
 * La validación es estricta y falla temprano con un mensaje accionable. Una
 * configuración a medias produce gates que corren sobre rutas inexistentes y
 * reportan "sin hallazgos" — un gate roto que se lee como limpio es peor que
 * no tenerlo.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_NAME = 'ai-workspace.json';
const CONFIG_PATH = path.join(ROOT, CONFIG_NAME);

const CONFIG_VERSION = 1;
const TOPOLOGIES = ['multi-repo', 'single-repo'];
/**
 * Los harnesses conocidos ya no son una constante: los declara
 * `template.manifest.json` y los amplia el proyecto en `harnessDefinitions`.
 * Ver `scripts/lib/harnesses.js`.
 */

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

class ConfigError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ConfigError';
    this.hint = hint;
  }
}

function fail(message, hint) {
  throw new ConfigError(message, hint);
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function knownPacks() {
  const manifestPath = path.join(ROOT, 'template.manifest.json');
  if (!fs.existsSync(manifestPath)) return null; // sin manifiesto no se valida
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Object.keys(manifest.packs || {});
  } catch {
    return null;
  }
}

function validateProject(raw) {
  const project = raw.project;
  if (!project || typeof project !== 'object') {
    fail(`\`project\` es obligatorio en ${CONFIG_NAME}.`);
  }
  if (!project.name || !/^[a-z0-9][a-z0-9-]*$/.test(project.name)) {
    fail(
      `\`project.name\` debe ser un identificador en minúsculas y guiones. Recibido: ${JSON.stringify(project.name)}`,
    );
  }
  if (project.ticketPrefix && !/^[A-Z][A-Z0-9]*$/.test(project.ticketPrefix)) {
    fail(
      `\`project.ticketPrefix\` debe ser mayúsculas, sin el número. Recibido: ${JSON.stringify(project.ticketPrefix)}`,
      'Ejemplo: "ABC" produce ramas y commits con el formato ABC-123.',
    );
  }
}

function validateRepos(raw, packs) {
  const repos = raw.repos;
  if (!Array.isArray(repos) || repos.length === 0) {
    fail('`repos` debe declarar al menos un repositorio.');
  }

  if (raw.topology === 'single-repo' && repos.length !== 1) {
    fail(
      `La topología \`single-repo\` admite exactamente un repositorio, se declararon ${repos.length}.`,
      'Si el proyecto tiene varios repositorios, usá `"topology": "multi-repo"`.',
    );
  }

  const seen = new Set();
  for (const [i, repo] of repos.entries()) {
    const at = `repos[${i}]`;
    if (!repo.name) fail(`${at}.name es obligatorio.`);
    if (seen.has(repo.name)) fail(`${at}.name duplicado: ${repo.name}`);
    seen.add(repo.name);

    if (typeof repo.path !== 'string' || repo.path === '') {
      fail(
        `${at}.path es obligatorio.`,
        'En topología single-repo el valor es "."; en multi-repo, el directorio relativo a la raíz.',
      );
    }
    if (path.isAbsolute(repo.path) || repo.path.includes('..')) {
      fail(
        `${at}.path debe ser relativo a la raíz del workspace y no salir de ella. Recibido: ${repo.path}`,
      );
    }

    for (const pack of repo.packs || []) {
      if (packs && !packs.includes(pack)) {
        fail(`${at} declara el pack desconocido "${pack}".`, `Packs disponibles: ${packs.join(', ')}`);
      }
    }
  }
}

/**
 * Harnesses del proyecto.
 *
 * **Declarar cero es válido.** El contenido del sistema vive en `ai/` y los
 * gates, los packs y el ciclo de trabajo no dependen de que exista ningún
 * `.claude/` ni `.opencode/`: esos árboles son una proyección de `ai/` para una
 * herramienta concreta. Un proyecto sin ninguna herramienta configurada, o con
 * una que lea `AGENTS.md` y nada más, sigue teniendo el sistema completo.
 *
 * Antes se exigía al menos uno y la lista de válidos era una constante de este
 * archivo. Las dos cosas eran supuestos: que todo proyecto usa una herramienta
 * de IA con árbol propio, y que esa herramienta es una de las tres que la base
 * conocía el día que se escribió.
 */
function validateHarnesses(raw) {
  const harnesses = raw.harnesses;
  if (harnesses === undefined || harnesses === null) return;

  if (!Array.isArray(harnesses)) {
    fail(
      '`harnesses` debe ser una lista.',
      'Una lista vacía es válida: el sistema funciona sin ningún harness configurado.',
    );
  }

  // El catálogo se lee acá y no arriba para no crear un ciclo entre módulos:
  // `harnesses.js` no depende de este archivo, y este solo lo necesita al
  // validar.
  const catalog = require('./harnesses').catalog(raw);
  const known = Object.keys(catalog);

  for (const h of harnesses) {
    if (!catalog[h]) {
      fail(
        `Harness desconocido: "${h}".`,
        `Declarados: ${known.join(', ') || 'ninguno'}. ` +
          'Uno propio se declara en `harnessDefinitions`, sin tocar la plantilla. ' +
          'Ver docs/agregar-un-harness.md.',
      );
    }
  }

  for (const [id, def] of Object.entries(raw.harnessDefinitions || {})) {
    const problems = require('./harnesses').problemsOf(id, def);
    if (problems.length > 0) {
      fail(problems[0], 'Ver docs/agregar-un-harness.md para la forma completa de un harness.');
    }
  }
}

function validate(raw) {
  if (raw.version !== CONFIG_VERSION) {
    fail(
      `\`version\` debe ser ${CONFIG_VERSION}, se encontró ${JSON.stringify(raw.version)}.`,
      'Una versión distinta significa que el proyecto quedó atrás respecto de la base. Corré `node scripts/template-sync.js`.',
    );
  }

  validateProject(raw);

  if (!TOPOLOGIES.includes(raw.topology)) {
    fail(
      `\`topology\` debe ser uno de: ${TOPOLOGIES.join(', ')}. Recibido: ${JSON.stringify(raw.topology)}`,
    );
  }

  const packs = knownPacks();
  validateRepos(raw, packs);

  for (const pack of raw.packs || []) {
    if (packs && !packs.includes(pack)) {
      fail(`\`packs\` declara el pack desconocido "${pack}".`, `Packs disponibles: ${packs.join(', ')}`);
    }
  }

  validateHarnesses(raw);
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * Devuelve la configuración con los valores derivados ya resueltos, para que
 * ningún script tenga que recalcularlos — y, sobre todo, para que ninguno los
 * recalcule distinto.
 */
function normalize(raw) {
  const repos = raw.repos.map((r) => ({
    name: r.name,
    path: r.path,
    absPath: path.join(ROOT, r.path),
    packs: r.packs || [],
    baseBranch: r.baseBranch || raw.defaultBaseBranch || 'main',
    // Comandos de verificación. `null` significa "el proyecto no declaró
    // ninguno": un agente debe reportarlo como no verificado, nunca inventar
    // un comando ni asumir que no hay nada que correr.
    testCommand: r.testCommand || null,
    typecheckCommand: r.typecheckCommand || null,
    lintCommand: r.lintCommand || null,
    buildCommand: r.buildCommand || null,
    // Perfil de lenguaje. `languages` restringe cuáles de los perfiles que
    // aportan los packs aplican a este repositorio; `language` declara uno a
    // mano, para el lenguaje que todavía no tiene pack. Los consume
    // `scripts/lib/languages.js`.
    //
    // Van explícitos y no por propagación del objeto crudo a propósito: este
    // módulo existe para que ningún script tenga que adivinar qué campos hay, y
    // un campo que se agrega arriba pero no acá llega siempre como `undefined`
    // — el filtro parece declarado y no filtra nada, sin un solo aviso.
    languages: Array.isArray(r.languages) ? r.languages : null,
    language: r.language || null,
  }));

  // Los packs activos son la unión de los del workspace y los de cada
  // repositorio: `multi-tenant` puede aplicar a todo el proyecto mientras `nestjs`
  // aplica a un solo repositorio.
  const activePacks = [...new Set([...(raw.packs || []), ...repos.flatMap((r) => r.packs)])];

  return {
    root: ROOT,
    version: raw.version,
    project: {
      name: raw.project.name,
      title: raw.project.title || raw.project.name,
      ticketPrefix: raw.project.ticketPrefix || null,
      language: raw.project.language || 'es',
    },
    topology: raw.topology,
    repos,
    activePacks,
    harnesses: Array.isArray(raw.harnesses) ? raw.harnesses : [],
    worktrees: {
      enabled: raw.worktrees ? raw.worktrees.enabled !== false : false,
      slots: (raw.worktrees && raw.worktrees.slots) || [],
      dir: (raw.worktrees && raw.worktrees.dir) || 'worktrees',
    },
    tenant: { column: (raw.tenant && raw.tenant.column) || null },
    raw,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

let cached = null;

/**
 * @param {{optional?: boolean}} [opts] `optional: true` devuelve null en vez de
 *   fallar cuando no hay configuración. Lo usa el propio repositorio de la
 *   base, donde `ai-workspace.json` no existe porque todavía no es un proyecto.
 */
function load(opts = {}) {
  if (cached) return cached;

  if (!fs.existsSync(CONFIG_PATH)) {
    if (opts.optional) return null;
    fail(
      `No se encontró ${CONFIG_NAME} en la raíz del workspace.`,
      'Si acabás de generar el proyecto desde la plantilla, corré `node init.js`.',
    );
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    fail(`${CONFIG_NAME} no es JSON válido: ${err.message}`);
  }

  validate(raw);
  cached = normalize(raw);
  return cached;
}

/** Busca un repositorio por nombre. Falla con la lista disponible si no existe. */
function repo(config, name) {
  const found = config.repos.find((r) => r.name === name);
  if (!found) {
    fail(
      `El repositorio "${name}" no está declarado en ${CONFIG_NAME}.`,
      `Declarados: ${config.repos.map((r) => r.name).join(', ')}`,
    );
  }
  return found;
}

/** ¿Está activo este pack, en el workspace o en algún repositorio? */
function hasPack(config, pack) {
  return config.activePacks.includes(pack);
}

/** Repositorios que tienen activo un pack determinado. */
function reposWithPack(config, pack) {
  if ((config.raw.packs || []).includes(pack)) return config.repos;
  return config.repos.filter((r) => r.packs.includes(pack));
}

/**
 * Imprime un error de configuración en formato legible y termina con código 2.
 * Código 2 y no 1: 1 significa "el gate encontró algo", 2 significa "el gate no
 * pudo correr". Confundirlos hace que una configuración rota se lea como
 * verificación limpia.
 */
function reportAndExit(err) {
  if (!(err instanceof ConfigError)) throw err;
  process.stderr.write(`\n  Configuración inválida: ${err.message}\n`);
  if (err.hint) process.stderr.write(`  ${err.hint}\n`);
  process.stderr.write('\n');
  process.exit(2);
}

module.exports = {
  ROOT,
  CONFIG_NAME,
  CONFIG_PATH,
  CONFIG_VERSION,
  TOPOLOGIES,
  ConfigError,
  load,
  repo,
  hasPack,
  reposWithPack,
  reportAndExit,
};
