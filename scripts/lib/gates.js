#!/usr/bin/env node
/**
 * gates.js
 *
 * Registro de verificaciones automáticas, declarado en datos y no en código.
 *
 * Cada gate se declara en el `manifest.json` del núcleo o de un pack, bajo la
 * clave `gates`. Instalar un pack instala sus verificaciones; no instalarlo las
 * deja fuera sin que nadie tenga que acordarse de nada.
 *
 * Por qué declarativo: el hook de escritura y el orquestador de review
 * necesitan la misma lista. Con la lista escrita en el código de cada uno,
 * agregar un gate obliga a tocar dos archivos y olvidarse de uno es silencioso
 * — el gate simplemente no corre en ese camino, y su ausencia no dice nada.
 *
 * Forma de un gate:
 *
 *   {
 *     "id": "context-links",
 *     "label": "rutas citadas",
 *     "script": "scripts/check-context-links.js",
 *     "source": "una ruta que no existe hace que el agente improvise",
 *     "scope": "workspace" | "repo",
 *     "appliesTo": {
 *       "extensions": [".md", ".json"],      // opcional
 *       "paths": ["ai/", "CLAUDE.md"],       // opcional: prefijos relativos al scope
 *       "packs": ["multi-tenant"]            // opcional: además del pack que lo declara
 *     },
 *     "args": ["--scope", "{scope}", "--baseline"],
 *     "fileArgs": ["--target", "{rel}", "--baseline"],  // opcional: barrido de un solo archivo
 *     "onWrite": false,                                 // opcional: excluirlo del hook de escritura
 *     "needs": ["imports"]                              // opcional: capacidades que el repo debe tener
 *   }
 *
 * `onWrite: false` es para el gate que no puede acotarse a un archivo y barre
 * el repositorio entero. En el hook eso se paga en cada edición y termina
 * excediendo su tiempo límite: el gate aparenta correr y no corre. Es preferible
 * declarar que no corre ahí a que corra mal.
 *
 * Placeholders admitidos en `args` y `fileArgs`: {repo}, {scope}, {rel}.
 *
 * `needs`: lo que el repositorio tiene que declarar para que el gate tenga algo
 * que mirar. Un gate que depende de un dato que el repo no declara (los imports
 * de su lenguaje, reglas `coChange`) NO corre ahí, y el orquestador lo muestra
 * como "NO CORRIÓ: <motivo>" — nunca como "sin hallazgos". Un gate que se salta
 * en silencio un repo que no puede mirar es el fallo que esta base existe para
 * evitar. Capacidades conocidas:
 *   imports    el perfil de lenguaje del repo declara cómo se ve un import
 *   coChange   algún manifest o la configuración declara reglas `coChange`
 *   gateCandidates   existe el registro `ai/gate-candidates.md`
 *   tenantDialect    el stack del repo consulta la base (un pack que declara `tenant.notApplicable` no)
 *   requirements     el proyecto declara un tablero de requisitos (`requirements` en ai-workspace.json)
 *
 * `AI_GATES_FILE` (solo para los tests de la base) reemplaza TODOS los gates
 * declarados por los de ese JSON (`{ "gates": [...] }`), con `origin: "local"`.
 * Los scripts se resuelven desde la raíz del workspace, como siempre.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspace-config');
const assets = require('./asset-roots');
const languages = require('./languages');

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/** Todos los gates declarados por el núcleo y los packs activos. */
function all(config) {
  const gates = [];

  if (process.env.AI_GATES_FILE) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(process.env.AI_GATES_FILE), 'utf8'));
    for (const gate of parsed.gates || []) {
      gates.push({ ...gate, origin: 'local', scriptExists: fs.existsSync(path.join(ROOT, gate.script)) });
    }
    return gates;
  }

  for (const root of assets.roots(config)) {
    const file = path.join(root.absDir, 'manifest.json');
    if (!fs.existsSync(file)) continue;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // asset-roots ya reporta el manifiesto inválido
    }

    for (const gate of parsed.gates || []) {
      if (!gate.id || !gate.script) continue;
      // Un gate que declara un script inexistente se omite en silencio sería
      // el mismo error que el hook viene a evitar: se marca para que quien lo
      // consuma pueda reportarlo.
      const exists = fs.existsSync(path.join(ROOT, gate.script));
      gates.push({ ...gate, origin: root.id, scriptExists: exists });
    }
  }

  return gates;
}

// ---------------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------------

function matchesExtension(gate, rel) {
  const exts = gate.appliesTo && gate.appliesTo.extensions;
  if (!exts || exts.length === 0) return true;
  return exts.some((e) => rel.toLowerCase().endsWith(e.toLowerCase()));
}

function matchesPath(gate, relWithinScope) {
  const prefixes = gate.appliesTo && gate.appliesTo.paths;
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => relWithinScope === p || relWithinScope.startsWith(p));
}

/**
 * Ubica un archivo del workspace: a qué repositorio pertenece, si es que
 * pertenece a alguno, y cómo se ve su ruta desde ahí.
 *
 * @returns {{rel: string, repo: object|null, relWithinScope: string}|null}
 *   `null` si el archivo cae fuera del workspace — ahí no es asunto nuestro.
 */
function locate(config, filePath) {
  const rel = path.relative(ROOT, path.resolve(filePath)).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;

  // El más específico gana: con un repositorio en "." y otro en "api", un
  // archivo de "api/" pertenece a "api".
  let repo = null;
  for (const r of config.repos) {
    if (r.path === '.') {
      if (!repo) repo = r;
      continue;
    }
    if (rel === r.path || rel.startsWith(`${r.path}/`)) {
      if (!repo || r.path.length > repo.path.length) repo = r;
    }
  }

  const relWithinScope = repo && repo.path !== '.' ? rel.slice(repo.path.length + 1) : rel;
  return { rel, repo, relWithinScope };
}

function packActiveFor(config, gate, repo) {
  // Un gate del núcleo aplica siempre; uno de pack, solo donde ese pack está.
  if (gate.origin === 'core' || gate.origin === 'local') return true;
  if (repo && repo.packs.includes(gate.origin)) return true;
  // Pack declarado a nivel workspace: aplica a todos los repositorios.
  return (config.raw.packs || []).includes(gate.origin);
}

/**
 * Gates que corresponden a un archivo concreto. Lo usa el hook de escritura.
 */
function forFile(config, filePath) {
  const at = locate(config, filePath);
  if (!at) return { at: null, gates: [] };

  const selected = all(config).filter((gate) => {
    if (!gate.scriptExists) return false;
    if (gate.onWrite === false) return false;
    if (!matchesExtension(gate, at.rel)) return false;

    if (gate.scope === 'repo') {
      if (!at.repo) return false;
      if (!packActiveFor(config, gate, at.repo)) return false;
      if (unmetNeed(config, gate, at.repo)) return false;
      return matchesPath(gate, at.relWithinScope);
    }

    // scope workspace: el archivo tiene que estar entre los prefijos
    // declarados, evaluados desde la raíz.
    if (unmetNeed(config, gate, null)) return false;
    return matchesPath(gate, at.rel);
  });

  return { at, gates: selected };
}

// ---------------------------------------------------------------------------
// Capacidades (`needs`)
// ---------------------------------------------------------------------------

/**
 * Cada capacidad devuelve `null` si el repositorio la tiene, o el motivo por el
 * que no. El motivo es lo que se le muestra a quien lee el bloque de gates.
 */
const CAPABILITIES = {
  imports(config, repo) {
    if (!repo) return 'esta capacidad se evalúa por repositorio y el gate es de alcance workspace';
    const profile = languages.forRepo(config, repo);
    if (profile.hasImports) return null;
    return (
      'el perfil de lenguaje de este repositorio no declara `imports`: no hay cómo ' +
      'saber quién importa a quién (ver scripts/lib/languages.js)'
    );
  },
  coChange(config, repo) {
    if (!repo) return 'esta capacidad se evalúa por repositorio y el gate es de alcance workspace';
    const cochange = require('./cochange');
    if (cochange.rulesFor(config, repo).rules.length > 0) return null;
    return 'ningún manifest ni ai-workspace.json declara reglas `coChange` para este repositorio';
  },
  tenantDialect(config, repo) {
    if (!repo) return 'esta capacidad se evalúa por repositorio y el gate es de alcance workspace';
    const assetsLib = require('./asset-roots');
    let reason = null;
    for (const root of assetsLib.rootsFor(config, repo)) {
      const m = assetsLib.rawManifest(root);
      if (!m || !m.tenant) continue;
      // Un dialecto declarado gana: el stack consulta y el gate tiene qué mirar.
      if (Array.isArray(m.tenant.readMethods) && m.tenant.readMethods.length > 0) return null;
      if (typeof m.tenant.notApplicable === 'string') reason = m.tenant.notApplicable;
    }
    return reason;
  },
  requirements(config) {
    if (config.requirements && config.requirements.dir) return null;
    return 'este proyecto no declara `requirements` en ai-workspace.json: no tiene tablero de requisitos';
  },
  gateCandidates() {
    if (fs.existsSync(path.join(ROOT, 'ai', 'gate-candidates.md'))) return null;
    return 'este proyecto no tiene ai/gate-candidates.md: no hay registro que revisar';
  },
};

/** Motivo por el que el gate no aplica a este repositorio, o `null` si aplica. */
function unmetNeed(config, gate, repo) {
  for (const need of gate.needs || []) {
    const check = CAPABILITIES[need];
    // Una capacidad desconocida no se asume cumplida: el gate no corre y se dice.
    if (!check) return `el gate declara \`needs: ${need}\`, que esta base no conoce`;
    const reason = check(config, repo);
    if (reason) return reason;
  }
  return null;
}

/**
 * Gates que corresponden a un repositorio completo, separando los que aplican de
 * los que NO aplican por una capacidad que falta. Lo usa el orquestador de
 * review, que muestra los segundos.
 *
 * @returns {{applicable: object[], skipped: Array<{gate: object, reason: string}>}}
 */
function forRepoDetailed(config, repo) {
  const candidates = all(config).filter(
    (gate) => gate.scriptExists && gate.scope === 'repo' && packActiveFor(config, gate, repo),
  );
  const applicable = [];
  const skipped = [];
  for (const gate of candidates) {
    const reason = unmetNeed(config, gate, repo);
    if (reason) skipped.push({ gate, reason });
    else applicable.push(gate);
  }
  return { applicable, skipped };
}

/** Gates que corresponden a un repositorio completo y aplican a él. */
function forRepo(config, repo) {
  return forRepoDetailed(config, repo).applicable;
}

/**
 * Gates de alcance workspace, sin filtrar por archivo, separando los que no
 * aplican por una capacidad que falta (`needs`).
 */
function forWorkspaceDetailed(config) {
  const candidates = all(config).filter((gate) => gate.scriptExists && gate.scope !== 'repo');
  const applicable = [];
  const skipped = [];
  for (const gate of candidates) {
    const reason = unmetNeed(config, gate, null);
    if (reason) skipped.push({ gate, reason });
    else applicable.push(gate);
  }
  return { applicable, skipped };
}

/** Gates de alcance workspace que aplican. */
function forWorkspace(config) {
  return forWorkspaceDetailed(config).applicable;
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

/**
 * Resuelve los placeholders de la línea de comandos del gate.
 * @param {{repo?: string, scope?: string, rel?: string}} vars
 * @param {boolean} perFile usar `fileArgs` si el gate lo declara
 */
function argsFor(gate, vars, perFile = false) {
  const template = perFile && gate.fileArgs ? gate.fileArgs : gate.args || [];
  return [
    gate.script,
    ...template.map((a) =>
      String(a)
        .replace('{repo}', vars.repo || '')
        .replace('{scope}', vars.scope || vars.repo || 'workspace')
        .replace('{rel}', vars.rel || ''),
    ),
  ];
}

/** ¿El gate puede acotarse a un solo archivo? Si no, el hook lo corre completo. */
function supportsSingleFile(gate) {
  return Array.isArray(gate.fileArgs) && gate.fileArgs.length > 0;
}

module.exports = {
  all,
  locate,
  forFile,
  forRepo,
  forRepoDetailed,
  forWorkspace,
  forWorkspaceDetailed,
  unmetNeed,
  argsFor,
  supportsSingleFile,
};
