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

/**
 * `AI_WORKSPACE_CONFIG` apunta a otra configuración.
 *
 * Existe para que la base pueda probarse a sí misma: un test declara
 * repositorios que viven en `test/fixtures/` y corre los gates de verdad contra
 * ellos, sin tocar la configuración del proyecto. Las rutas de `repos[].path`
 * siguen siendo relativas a la raíz del workspace.
 *
 * Fuera de los tests no se define, y entonces esto es exactamente lo que era.
 */
const CONFIG_PATH = process.env.AI_WORKSPACE_CONFIG
  ? path.resolve(process.env.AI_WORKSPACE_CONFIG)
  : path.join(ROOT, CONFIG_NAME);

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

// ---------------------------------------------------------------------------
// Campos del circuito de trabajo (1.2.0)
//
// Todos son opcionales y aditivos: un `ai-workspace.json` de 1.1.0 sigue siendo
// válido y se comporta igual. Cada campo que falta significa "este proyecto no
// usa esa pieza", nunca "usá el valor de linxdash": ningún default nombra una
// rama, un prefijo ni una herramienta concreta.
// ---------------------------------------------------------------------------

const TRACKER_KINDS = ['none', 'jira', 'github'];
const FORGE_KINDS = ['none', 'github', 'bitbucket', 'gitlab'];
const SLOT_KINDS = ['implementation', 'review'];
const SLOT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Un slot se declara como texto o como `{ name, kind }`. */
function slotDefOf(entry) {
  if (typeof entry === 'string') {
    // Sin `kind`, el slot cuyo nombre empieza con "review" es de revisión.
    return { name: entry, kind: /^review/.test(entry) ? 'review' : 'implementation' };
  }
  return { name: entry && entry.name, kind: (entry && entry.kind) || null };
}

function validateWorkflowFields(raw) {
  const kindOf = (field, allowed) => {
    const block = raw[field];
    if (block === undefined) return;
    if (!block || typeof block !== 'object' || !allowed.includes(block.kind)) {
      fail(
        `\`${field}.kind\` debe ser uno de: ${allowed.join(', ')}. Recibido: ${JSON.stringify(block && block.kind)}`,
        `Sin el campo \`${field}\`, el proyecto no usa ninguno ("none").`,
      );
    }
  };
  kindOf('tracker', TRACKER_KINDS);
  kindOf('forge', FORGE_KINDS);

  const slots = (raw.worktrees && raw.worktrees.slots) || [];
  if (!Array.isArray(slots)) fail('`worktrees.slots` debe ser una lista.');
  const seen = new Set();
  for (const [i, entry] of slots.entries()) {
    const def = slotDefOf(entry);
    if (!def.name || !SLOT_NAME.test(def.name)) {
      fail(
        `worktrees.slots[${i}]: el nombre del slot debe ser minúsculas, números y guiones. Recibido: ${JSON.stringify(def.name)}`,
        'Un slot es un texto ("review") o un objeto { "name": "review", "kind": "review" }.',
      );
    }
    if (seen.has(def.name)) fail(`worktrees.slots[${i}]: slot duplicado "${def.name}".`);
    seen.add(def.name);
    if (!SLOT_KINDS.includes(def.kind)) {
      fail(`worktrees.slots[${i}].kind debe ser ${SLOT_KINDS.join(' o ')}. Recibido: ${JSON.stringify(def.kind)}`);
    }
  }

  for (const [i, repo] of (raw.repos || []).entries()) {
    const db = repo.database;
    if (db === undefined) continue;
    const at = `repos[${i}].database`;
    if (!db || typeof db !== 'object') fail(`${at} debe ser un objeto.`);
    for (const key of ['writeCommands', 'generateCommands', 'readOnlyAllowed']) {
      if (db[key] !== undefined && !(Array.isArray(db[key]) && db[key].every((c) => typeof c === 'string'))) {
        fail(`${at}.${key} debe ser una lista de textos.`);
      }
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
  validateWorkflowFields(raw);
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
    // Variantes acotadas al diff (`{files}` = archivos cambiados, separados por
    // espacio): sin ellas, `run-checks` corre el comando completo.
    testRelatedCommand: r.testRelatedCommand || null,
    lintRelatedCommand: r.lintRelatedCommand || null,
    // El chequeo de tipos que SÍ mira los tests. Muchos runners transpilan los
    // specs sin chequear tipos y el typecheck normal los excluye: un test con la
    // firma vieja llega al remoto y rompe la compilación. `null` = no aplica.
    typecheckTestCommand: r.typecheckTestCommand || null,
    // Directorios de artefactos de build que un typecheck puede leer a medio
    // escribir (ver `scripts/run-checks.js`), y reglas "quien toca X regenera Y"
    // propias del repositorio (ver `scripts/check-cochange.js`).
    artifactPaths: Array.isArray(r.artifactPaths) ? r.artifactPaths : [],
    coChange: Array.isArray(r.coChange) ? r.coChange : [],
    // Repositorios de los que este depende (su contrato manda): define el orden de
    // merge, proveedores primero. Sin esto, el cierre le pregunta a la persona.
    consumes: Array.isArray(r.consumes) ? r.consumes : [],
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
    // Dependencias compartidas entre el repositorio y sus slots. `null` = lo que
    // declare el pack (`worktree.deps` del manifiesto); un objeto lo reemplaza.
    // Ver `ai/core/manifest.json` → `depsProfiles` y `scripts/lib/worktree-paths.js`.
    deps: r.deps || null,
    // Base de datos compartida entre el repositorio principal y los slots. `null`
    // = el proyecto no tiene una base única que proteger: los hooks de migración
    // no se instalan.
    database: r.database
      ? {
          shared: r.database.shared !== false,
          migrationsDir: r.database.migrationsDir || null,
          writeCommands: r.database.writeCommands || [],
          generateCommands: r.database.generateCommands || [],
          readOnlyAllowed: r.database.readOnlyAllowed || [],
          generateAlternative: r.database.generateAlternative || null,
          // Comando de SOLO LECTURA que lista las migraciones pendientes.
          statusCommand: r.database.statusCommand || null,
        }
      : null,
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
      // `slots` sigue siendo la lista de nombres (lo que siempre fue); `slotDefs`
      // trae el tipo de cada uno. Ver `scripts/lib/worktree-paths.js`.
      slots: ((raw.worktrees && raw.worktrees.slots) || []).map((s) => slotDefOf(s).name),
      slotDefs: ((raw.worktrees && raw.worktrees.slots) || []).map(slotDefOf),
      dir: (raw.worktrees && raw.worktrees.dir) || 'worktrees',
    },
    // Sistema de tickets y host de PRs. "none" es un valor legítimo: el proyecto
    // no mueve tarjetas ni abre PRs desde el agente, y los pasos que lo harían
    // se omiten (o mueven la ficha del tablero de requisitos, si lo hay).
    tracker: { kind: 'none', ...(raw.tracker || {}) },
    forge: { kind: 'none', ...(raw.forge || {}) },
    // Tablero de requisitos: carpeta de fichas. `null` = el proyecto no tiene.
    requirements: raw.requirements ? { ...raw.requirements } : null,
    // Política de commits. `forbidAiAttribution` instala el hook que bloquea
    // atribución de IA en el mensaje.
    commits: {
      forbidAiAttribution: !!(raw.commits && raw.commits.forbidAiAttribution),
      format: (raw.commits && raw.commits.format) || null,
    },
    // Trabajo autónomo (`scripts/trabajo-por-sesion.js`): `plan`, `taskHeading`,
    // `doneMarker`, `skill`, `harness`, `commit`, `logDir`, `logbook`, `headless`.
    autonomous: raw.autonomous && typeof raw.autonomous === 'object' ? raw.autonomous : null,
    // Pruebas e2e (pack `e2e`): `dir`, `paths`, `forbiddenData`, `authorizedWriteHelper`.
    e2e: raw.e2e && typeof raw.e2e === 'object' ? raw.e2e : null,
    // Review: `outputDir` es la carpeta del informe del modo C (rama ajena).
    review: { outputDir: (raw.review && raw.review.outputDir) || null },
    // Opciones por hook: `hooks.<id>.enabled` enciende (los opcionales) o apaga
    // (cualquiera) un hook. Ver `scripts/lib/hooks.js`.
    hooks: raw.hooks && typeof raw.hooks === 'object' ? raw.hooks : {},
    // Rutas que el agente no puede escribir sin autorización del operador, además
    // de las que declaran los packs. Ver el hook `pre-write-protected`.
    protectedPaths: Array.isArray(raw.protectedPaths) ? raw.protectedPaths : [],
    statusline: {
      costWarnUsd: (raw.statusline && raw.statusline.costWarnUsd) || 10,
      costAlertUsd: (raw.statusline && raw.statusline.costAlertUsd) || 20,
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

/** Slot desde el que se resolvió el último `repo()`, o `null`. Ver `repo()`. */
let resolvedFromSlot = null;

/**
 * Busca un repositorio por nombre. Falla con la lista disponible si no existe.
 *
 * Acepta también la ruta de un slot (`worktrees/review/mi-api`): devuelve el
 * repositorio LÓGICO —el nombre que va en los hallazgos y en el baseline— con
 * `absPath` apuntando al slot. Así todo gate que resuelve su `--repo` por acá
 * puede leer el código de un slot sin tocarlo. Por qué importa: un gate que arma
 * la ruta como `<raíz>/<repo>` audita lo que esté checkouteado en la principal
 * mientras el revisor mira otro slot, y el resultado sale igual de prolijo.
 *
 * Deja registrado que se leyó desde un slot (`readFromSlot()`): `baseline.write`
 * lo consulta para negarse a congelar deuda de una rama que todavía no se mergeó.
 */
function repo(config, name) {
  const found = config.repos.find((r) => r.name === name);
  if (found) return found;

  const loc = require('./repo-location').resolve(config, name);
  if (loc && loc.isSlot) {
    resolvedFromSlot = loc.slot;
    return loc.repo;
  }

  fail(
    `El repositorio "${name}" no está declarado en ${CONFIG_NAME}.`,
    `Declarados: ${config.repos.map((r) => r.name).join(', ')}`,
  );
}

/** El slot desde el que se leyó el repositorio de este proceso, o `null`. */
function readFromSlot() {
  return resolvedFromSlot;
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
  TRACKER_KINDS,
  FORGE_KINDS,
  SLOT_KINDS,
  slotDefOf,
  ConfigError,
  load,
  repo,
  readFromSlot,
  hasPack,
  reposWithPack,
  reportAndExit,
};
