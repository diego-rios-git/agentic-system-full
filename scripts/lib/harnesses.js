#!/usr/bin/env node
/**
 * harnesses.js
 *
 * Catálogo de harnesses, declarado en datos.
 *
 * **El harness no es indispensable.** El contenido del sistema vive una sola
 * vez en `ai/` — procedimientos, agentes, reglas — y los gates, los packs y el
 * ciclo de trabajo funcionan sin que exista ningún `.claude/` ni `.opencode/`.
 * Lo que un harness recibe es una **proyección**: un archivo corto, con el
 * frontmatter que esa herramienta espera, que remite al archivo real. Un
 * proyecto que trabaje sin ninguna herramienta de IA configurada, o con una que
 * lea `AGENTS.md` y nada más, es un proyecto válido: declara `"harnesses": []` y
 * no se genera ni un puntero.
 *
 * Por qué esto es un módulo y no una constante: antes los harnesses estaban en
 * dos listas de código —`KNOWN_HARNESSES` en la configuración y `HARNESS_TREES`
 * en el generador— y el frontmatter de cada uno se decidía con un `if` por
 * identificador. Agregar una herramienta significaba tocar tres archivos y
 * publicar una versión de la base. Con eso, la respuesta a "mi equipo usa otra
 * herramienta" era esperar.
 *
 * Ahora un harness es un bloque de datos, y hay dos lugares donde declararlo:
 *
 *   template.manifest.json → `harnesses`          el catálogo que trae la base
 *   ai-workspace.json      → `harnessDefinitions` los que agrega el proyecto
 *
 * El del proyecto gana sobre el de la base con el mismo identificador. Es la
 * vía para trabajar con una herramienta que la plantilla todavía no conoce sin
 * bifurcarla ni esperar a que la incorpore.
 *
 * Forma de un harness:
 *
 *   "cursor": {
 *     "title": "Cursor",
 *     "skillsDir": ".cursor/rules",         // omitido: no genera punteros de skill
 *     "skillFile": "SKILL.md",              // nombre del archivo dentro de cada skill
 *     "agentsDir": ".cursor/agents",        // omitido: no genera punteros de agente
 *     "frontmatter": {
 *       "description": "block",             // "block" (| >) o "inline"
 *       "mode": false,                      // ¿emite `mode:`?
 *       "tools": "list",                    // "list" | "map" | "none"
 *       "readOnlyTools": ["Read", "Grep"],  // con "list": qué permitir cuando edit: false
 *       "model": "alias"                    // "alias" | "mapped" | "none"
 *     },
 *     "modelMap": { "opus": "anthropic/claude-opus-5" },
 *     "hooks": {                              // opcional: cómo recibe hooks
 *       "format": "claude-settings",          // "claude-settings" | "opencode-plugin"
 *       "file": ".claude/settings.json",
 *       "events": { "pre-write": { "event": "PreToolUse", "matcher": "Edit|Write" } },
 *       "command": "node \"$CLAUDE_PROJECT_DIR/{script}\" --ai-managed",
 *       "statusLine": true
 *     }
 *   }
 *
 * El bloque `hooks` lo consume `scripts/lib/hooks.js`. Un harness sin él no
 * recibe hooks, y eso es válido: los gates corren igual con `run-gates.js`.
 *
 * Un harness sin `skillsDir` ni `agentsDir` es legítimo: describe una
 * herramienta que lee `AGENTS.md` de la raíz y no tiene árbol propio. Es el
 * caso de `agents-md`, y por eso no lleva directorios.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Cómo se emite cada parte del frontmatter, si el harness no lo declara. */
const DEFAULT_FRONTMATTER = {
  description: 'block',
  mode: false,
  tools: 'none',
  readOnlyTools: [],
  model: 'none',
};

const DESCRIPTION_STYLES = ['block', 'inline'];
const TOOLS_STYLES = ['list', 'map', 'none'];
const MODEL_STYLES = ['alias', 'mapped', 'none'];

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Todas las definiciones disponibles: las de la base más las del proyecto.
 *
 * @param {object} [raw] contenido crudo de `ai-workspace.json`. Se acepta suelto
 *   para que `init.js` pueda listar los harnesses **antes** de que exista una
 *   configuración válida.
 */
function catalog(raw) {
  const manifest = readJson(path.join(ROOT, 'template.manifest.json')) || {};
  const own = (raw && raw.harnessDefinitions) || {};

  const merged = {};
  for (const [id, def] of Object.entries(manifest.harnesses || {})) merged[id] = { ...def, source: 'base' };
  for (const [id, def] of Object.entries(own)) {
    merged[id] = { ...(merged[id] || {}), ...def, source: 'proyecto' };
  }

  return merged;
}

/** Identificadores declarables, para mensajes de error y para el instalador. */
function known(raw) {
  return Object.keys(catalog(raw));
}

/**
 * Valida una definición. Devuelve la lista de problemas, vacía si está bien.
 *
 * Se valida con nombres de campo concretos porque el error típico es de
 * tipeo, y un harness mal declarado no falla: simplemente no genera nada, y
 * quien lo declaró concluye que la herramienta no funciona con la base.
 */
function problemsOf(id, def) {
  const problems = [];
  const at = `harness "${id}"`;

  if (!def || typeof def !== 'object') return [`${at}: la definición no es un objeto.`];

  const fm = { ...DEFAULT_FRONTMATTER, ...(def.frontmatter || {}) };

  if (!DESCRIPTION_STYLES.includes(fm.description)) {
    problems.push(`${at}: \`frontmatter.description\` debe ser ${DESCRIPTION_STYLES.join(' o ')}.`);
  }
  if (!TOOLS_STYLES.includes(fm.tools)) {
    problems.push(`${at}: \`frontmatter.tools\` debe ser ${TOOLS_STYLES.join(', ')}.`);
  }
  if (!MODEL_STYLES.includes(fm.model)) {
    problems.push(`${at}: \`frontmatter.model\` debe ser ${MODEL_STYLES.join(', ')}.`);
  }
  if (fm.model === 'mapped' && (!def.modelMap || Object.keys(def.modelMap).length === 0)) {
    problems.push(`${at}: \`frontmatter.model\` es "mapped" pero no declara \`modelMap\`.`);
  }
  if (fm.tools === 'list' && (!Array.isArray(fm.readOnlyTools) || fm.readOnlyTools.length === 0)) {
    // Sin la lista, un agente declarado de solo lectura hereda todas las
    // herramientas del harness y la restricción queda como sugerencia de texto.
    problems.push(
      `${at}: \`frontmatter.tools\` es "list" pero no declara \`readOnlyTools\`; ` +
        'un agente de solo lectura quedaría sin restricción real.',
    );
  }

  if (def.hooks !== undefined) {
    const h = def.hooks;
    const FORMATS = ['claude-settings', 'opencode-plugin'];
    if (!h || typeof h !== 'object' || !FORMATS.includes(h.format)) {
      problems.push(`${at}: \`hooks.format\` debe ser ${FORMATS.join(' o ')}.`);
    } else {
      if (!h.events || typeof h.events !== 'object' || Object.keys(h.events).length === 0) {
        // Sin eventos no se registra ningún hook, y nada avisa: el proyecto
        // cree que está protegido.
        problems.push(`${at}: \`hooks.events\` debe mapear al menos un evento (pre-write, post-write, pre-bash).`);
      }
      if (h.format === 'claude-settings') {
        if (!h.file || path.isAbsolute(h.file) || h.file.includes('..')) {
          problems.push(`${at}: \`hooks.file\` debe ser una ruta relativa dentro del workspace.`);
        }
        if (!h.command || !String(h.command).includes('{script}') || !String(h.command).includes('--ai-managed')) {
          problems.push(`${at}: \`hooks.command\` debe incluir {script} y la marca --ai-managed.`);
        }
      }
      if (h.format === 'opencode-plugin' && (!h.dir || path.isAbsolute(h.dir) || h.dir.includes('..'))) {
        problems.push(`${at}: \`hooks.dir\` debe ser una ruta relativa dentro del workspace.`);
      }
    }
  }

  // `launch` (abrir una sesión en un slot) y `headless` (una sesión sin
  // interacción por tarea) son DATOS del harness: el comando que la herramienta
  // espera. Un harness sin ellos es válido; el script que los necesita sale 2 y
  // dice qué falta, en vez de adivinar un ejecutable.
  for (const key of ['launch', 'headless']) {
    const b = def[key];
    if (b === undefined) continue;
    if (!b || typeof b !== 'object' || typeof b.command !== 'string' || !b.command) {
      problems.push(`${at}: \`${key}.command\` debe ser el nombre del ejecutable.`);
      continue;
    }
    if (b.args !== undefined && !(Array.isArray(b.args) && b.args.every((a) => typeof a === 'string'))) {
      problems.push(`${at}: \`${key}.args\` debe ser una lista de textos.`);
    }
    if (key === 'headless' && b.promptVia !== undefined && !['stdin', 'arg'].includes(b.promptVia)) {
      problems.push(`${at}: \`headless.promptVia\` debe ser stdin o arg.`);
    }
  }

  for (const dir of ['skillsDir', 'agentsDir']) {
    const value = def[dir];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === '' || path.isAbsolute(value) || value.includes('..')) {
      problems.push(`${at}: \`${dir}\` debe ser una ruta relativa dentro del workspace.`);
    }
  }

  return problems;
}

/**
 * Los harnesses activos de un proyecto, resueltos y normalizados.
 *
 * @returns {{trees: Array, labels: string[], problems: string[]}}
 *   `trees` son los que tienen árbol propio — los únicos para los que se genera
 *   un puntero. Un harness declarado sin `skillsDir` ni `agentsDir` cuenta como
 *   activo y aporta su nombre a los documentos, pero no produce archivos.
 */
function resolve(cfg) {
  const all = catalog(cfg.raw);
  const problems = [];
  const trees = [];
  const labels = [];

  for (const id of cfg.harnesses || []) {
    const def = all[id];
    if (!def) {
      problems.push(
        `Harness desconocido: "${id}". Declarados: ${Object.keys(all).join(', ') || 'ninguno'}. ` +
          'Uno propio se declara en `harnessDefinitions` de ai-workspace.json.',
      );
      continue;
    }

    const found = problemsOf(id, def);
    if (found.length > 0) {
      problems.push(...found);
      continue;
    }

    const label = def.title || id;
    labels.push(label);

    if (!def.skillsDir && !def.agentsDir) continue;

    trees.push({
      id,
      label,
      skillsDir: def.skillsDir || null,
      skillFile: def.skillFile || 'SKILL.md',
      agentsDir: def.agentsDir || null,
      frontmatter: { ...DEFAULT_FRONTMATTER, ...(def.frontmatter || {}) },
      modelMap: def.modelMap || {},
    });
  }

  return { trees, labels, problems };
}

module.exports = {
  ROOT,
  DEFAULT_FRONTMATTER,
  catalog,
  known,
  problemsOf,
  resolve,
};
