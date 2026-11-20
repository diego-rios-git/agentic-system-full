#!/usr/bin/env node
/**
 * hooks.js
 *
 * Registro declarativo de hooks y de la status line, y su proyección a cada
 * harness.
 *
 * Por qué existe: hasta 1.1.0 los hooks eran un bloque que `init.js` copiaba UNA
 * vez a `.claude/settings.json`, y `.claude/**` es del proyecto — la actualización
 * de la base nunca lo tocaba. Un hook nuevo de la base no llegaba a ningún
 * proyecto existente, y cada proyecto que necesitaba uno lo registraba a mano
 * (y de ahí los hooks de Appo con una ruta distinta a la de la plantilla).
 * Además los comandos eran relativos (`node scripts/hooks/x.js`): con la sesión
 * abierta dentro de un repositorio el hook salía con 1 y el comando pasaba SIN
 * revisar. Un hook que no corre debe ser ruidoso, no silencioso.
 *
 * Ahora cada hook se declara en el `manifest.json` de su origen (núcleo, pack o
 * proyecto), con un evento NEUTRAL, y cada harness declara en
 * `template.manifest.json` cómo se traduce ese evento. Un hook de un pack solo
 * se instala si el pack está activo; uno condicionado a un campo de la
 * configuración solo si el campo existe.
 *
 *   "hooks": [{
 *     "id": "pre-bash-slot-deps",
 *     "event": "pre-bash",                      // pre-write | post-write | pre-bash
 *     "script": "scripts/hooks/pre-bash-slot-deps.js",
 *     "timeout": 10,                            // opcional
 *     "matcher": "Bash",                        // opcional: pisa el del harness
 *     "source": "por qué existe, en una línea",
 *     "when": {                                 // opcional; TODAS deben cumplirse
 *       "worktrees": true,                      //   los slots están habilitados
 *       "packs": ["nestjs"],                    //   alguno de estos packs está activo
 *       "config": "commits.forbidAiAttribution",//   ese campo de la config es verdadero
 *       "repoField": "database",                //   algún repo declara ese campo
 *       "manifest": "protectedPaths"            //   alguna raíz activa declara esa clave
 *     },
 *     "harnesses": ["claude"]                   // opcional: restringe
 *   }],
 *   "statusLine": { "script": "scripts/statusline.js", "when": { "worktrees": true } }
 *
 * **Qué se administra y qué no.** Lo que este módulo escribe lleva la marca
 * `--ai-managed` en el comando (o `ai-managed` en el encabezado de un plugin).
 * Todo lo demás del archivo del harness es del proyecto y no se toca: sus
 * permisos, sus hooks propios, su status line si ya tiene una. Regenerar es
 * idempotente.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const assets = require('./asset-roots');
const harnesses = require('./harnesses');

const MARK = '--ai-managed';
const PLUGIN_MARK = 'ai-managed';
const PLUGIN_PREFIX = 'ai-';

const EVENTS = ['pre-write', 'post-write', 'pre-bash'];

// ---------------------------------------------------------------------------
// Declaración
// ---------------------------------------------------------------------------

function get(obj, dotted) {
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

/** ¿Se cumplen todas las condiciones de `when`? Devuelve `null` o el motivo. */
function unmet(cfg, when, manifestKeys) {
  if (!when) return null;
  if (when.manifest && !manifestKeys.has(when.manifest)) {
    return `ningún pack ni el proyecto declara \`${when.manifest}\``;
  }
  if (when.worktrees && !cfg.worktrees.enabled) return 'los slots están deshabilitados';
  if (when.packs && !when.packs.some((p) => cfg.activePacks.includes(p))) {
    return `ningún pack de [${when.packs.join(', ')}] está activo`;
  }
  if (when.config && !get(cfg, when.config)) return `\`${when.config}\` no está habilitado`;
  if (when.repoField && !cfg.repos.some((r) => r[when.repoField])) {
    return `ningún repositorio declara \`${when.repoField}\``;
  }
  return null;
}

/**
 * Los hooks y la status line declarados por el núcleo, los packs activos y el
 * proyecto, ya filtrados por `when`.
 *
 * @returns {{hooks: object[], statusLine: object|null, skipped: {id: string, reason: string}[]}}
 */
function declared(cfg) {
  const hooks = new Map();
  const skipped = [];
  let statusLine = null;

  // Claves que alguna raíz activa declara con contenido: alimenta `when.manifest`.
  const manifestKeys = new Set();
  for (const root of assets.roots(cfg)) {
    const m = assets.rawManifest(root) || {};
    for (const [k, v] of Object.entries(m)) {
      const filled = Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v;
      if (filled) manifestKeys.add(k);
    }
  }
  if (cfg.protectedPaths && cfg.protectedPaths.length) manifestKeys.add('protectedPaths');

  for (const root of assets.roots(cfg)) {
    const manifest = assets.rawManifest(root);
    if (!manifest) continue;

    for (const hook of manifest.hooks || []) {
      if (!hook.id || !hook.script || !EVENTS.includes(hook.event)) {
        skipped.push({ id: hook.id || '(sin id)', reason: `declaración inválida en ${root.dir}/manifest.json` });
        continue;
      }
      // El proyecto puede apagar cualquier hook: `hooks.<id>.enabled: false`.
      const own = cfg.hooks && cfg.hooks[hook.id];
      const reason =
        own && own.enabled === false ? 'deshabilitado en ai-workspace.json' : unmet(cfg, hook.when, manifestKeys);
      if (reason) {
        skipped.push({ id: hook.id, reason });
        hooks.delete(hook.id); // la raíz posterior que lo desactiva gana
        continue;
      }
      // Un hook que apunta a un script inexistente no se registra: el harness
      // lo ejecutaría, fallaría con 1 y el comando pasaría sin revisar.
      if (!fs.existsSync(path.join(cfg.root, hook.script))) {
        skipped.push({ id: hook.id, reason: `falta el script ${hook.script}` });
        continue;
      }
      hooks.set(hook.id, { ...hook, origin: root.id });
    }

    if (manifest.statusLine && manifest.statusLine.script) {
      const reason = unmet(cfg, manifest.statusLine.when, manifestKeys);
      if (reason) {
        skipped.push({ id: 'statusLine', reason });
      } else if (!fs.existsSync(path.join(cfg.root, manifest.statusLine.script))) {
        skipped.push({ id: 'statusLine', reason: `falta el script ${manifest.statusLine.script}` });
      } else {
        statusLine = { ...manifest.statusLine, origin: root.id };
      }
    }
  }

  return { hooks: [...hooks.values()], statusLine, skipped };
}

/** Harnesses activos que saben recibir hooks, con su bloque `hooks`. */
function targets(cfg) {
  const catalog = harnesses.catalog(cfg.raw);
  const list = [];
  for (const id of cfg.harnesses || []) {
    const def = catalog[id];
    if (def && def.hooks && def.hooks.format) list.push({ id, label: def.title || id, hooks: def.hooks });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Claude Code: .claude/settings.json
// ---------------------------------------------------------------------------

function commandFor(def, script) {
  return String(def.command).replace('{script}', script);
}

function isManagedEntry(hook) {
  return !!(hook && typeof hook.command === 'string' && hook.command.includes(MARK));
}

function readJson(file) {
  if (!fs.existsSync(file)) return { exists: false, data: null, error: null };
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (err) {
    return { exists: true, data: null, error: err.message };
  }
}

/**
 * Calcula cómo debería quedar el `settings.json` (solo la parte administrada) y
 * lo fusiona con lo que ya tiene el proyecto.
 *
 * @returns {{next: object, conflicts: string[]}}
 */
/**
 * Un registro HEREDADO: un comando escrito a mano (o por una versión anterior de
 * la base) que ejecuta el mismo script que un hook declarado ahora.
 *
 * Por qué se adopta en vez de dejarlo: si el hook se registra de nuevo con la
 * marca de administrado y el viejo queda, el mismo script corre dos veces en cada
 * acción (los de la base eran `node scripts/hooks/x.js` relativos, y los
 * proyectos que los registraron a mano tienen variantes). Y el viejo es justo el
 * que falla con la sesión abierta dentro de un repositorio. Se reconoce por el
 * NOMBRE del script, no por la ruta: un proyecto puede haber movido el suyo.
 */
function legacyIdsIn(command, activeNames) {
  const found = [];
  for (const m of String(command || '').matchAll(/([\w-]+)\.js\b/g)) {
    if (activeNames.has(m[1])) found.push(m[1]);
  }
  return found;
}

function planClaudeSettings(current, target, decl) {
  const def = target.hooks;
  const next = JSON.parse(JSON.stringify(current || {}));
  const conflicts = [];
  const adopted = [];

  const activeNames = new Set(
    decl.hooks
      .filter((h) => !h.harnesses || h.harnesses.includes(target.id))
      .map((h) => path.basename(h.script, '.js')),
  );

  // 1. Quitar lo administrado que ya no corresponde y adoptar los registros
  // heredados de hooks que ahora se declaran, conservando todo lo demás.
  const events = next.hooks && typeof next.hooks === 'object' ? next.hooks : {};
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    events[event] = groups
      .map((g) => ({
        ...g,
        hooks: (g.hooks || []).filter((h) => {
          if (isManagedEntry(h)) return false;
          const legacy = legacyIdsIn(h.command, activeNames);
          if (legacy.length === 0) return true;
          adopted.push(`${legacy[0]} (${String(h.command).trim()})`);
          return false;
        }),
      }))
      .filter((g) => g.hooks.length > 0);
    if (events[event].length === 0) delete events[event];
  }

  // 2. Agregar lo declarado, agrupado por evento y matcher.
  for (const hook of decl.hooks) {
    if (hook.harnesses && !hook.harnesses.includes(target.id)) continue;
    const map = def.events && def.events[hook.event];
    if (!map) continue; // sin equivalente en este harness
    const matcher = hook.matcher || map.matcher;

    events[map.event] = events[map.event] || [];
    let group = events[map.event].find((g) => g.matcher === matcher && (g.hooks || []).some(isManagedEntry));
    if (!group) {
      group = { matcher, hooks: [] };
      events[map.event].push(group);
    }
    group.hooks.push({
      type: 'command',
      command: commandFor(def, hook.script),
      timeout: hook.timeout || 15,
    });
  }

  if (Object.keys(events).length > 0) next.hooks = events;
  else delete next.hooks;

  // 3. La status line: solo se escribe si no hay una ajena. Pisar la que la
  // persona eligió para sí sería una descortesía que nadie pidió.
  if (def.statusLine) {
    const existing = next.statusLine;
    if (decl.statusLine) {
      if (!existing || isManagedEntry(existing)) {
        next.statusLine = {
          type: 'command',
          command: commandFor(def, decl.statusLine.script),
          padding: 0,
        };
      } else {
        conflicts.push(
          'statusLine: el proyecto ya tiene una propia; no se pisa. ' +
            `Para usar la de la base: \`node "$CLAUDE_PROJECT_DIR/${decl.statusLine.script}"\`.`,
        );
      }
    } else if (existing && isManagedEntry(existing)) {
      delete next.statusLine; // la base dejó de declararla
    }
  }

  return { next, conflicts, adopted };
}

// ---------------------------------------------------------------------------
// OpenCode: .opencode/plugins/ai-<id>.js
// ---------------------------------------------------------------------------

function pluginName(hook) {
  return `${PLUGIN_PREFIX}${hook.id}.js`;
}

function pluginSource(hook, def) {
  const map = def.events[hook.event];
  const tools = JSON.stringify(map.tools);
  const exportName = hook.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/\W/g, '') + 'Hook';
  return [
    '/**',
    ` * ${pluginName(hook)} — plugin de OpenCode GENERADO (${PLUGIN_MARK}). No lo edites.`,
    ' *',
    ` * Delega en \`${hook.script}\`, el mismo hook que usa Claude Code, con el mismo`,
    ' * JSON por stdin y el mismo contrato: salida 2 bloquea. La decisión vive en UN',
    ' * solo lugar; duplicarla en dos archivos es como una de las dos copias se queda',
    ' * vieja. Se regenera con `node scripts/consolidate-skills.js --wrappers`.',
    ' *',
    ` * ${hook.source ? hook.source : 'Ver el manifest.json que lo declara.'}`,
    ' *',
    ' * Fail-open: un fallo propio del plugin deja pasar la acción.',
    ' */',
    '',
    "import { spawnSync } from 'node:child_process';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    'const here = path.dirname(fileURLToPath(import.meta.url));',
    `const HOOK = path.join(here, '..', '..', ${JSON.stringify(hook.script)});`,
    `const TOOLS = ${tools};`,
    "const CLAUDE_NAME = { bash: 'Bash', write: 'Write', edit: 'Edit' };",
    '',
    'function toolInput(tool, args = {}) {',
    "  if (tool === 'bash') return { command: args.command || '' };",
    "  if (tool === 'write') return { file_path: args.filePath, content: args.content };",
    '  return { file_path: args.filePath, old_string: args.oldString, new_string: args.newString };',
    '}',
    '',
    `export const ${exportName} = async ({ directory }) => ({`,
    `  '${map.hook}': async (input, output) => {`,
    '    if (!TOOLS.includes(input.tool)) return;',
    '    let result;',
    '    try {',
    '      result = spawnSync(process.execPath, [HOOK], {',
    '        input: JSON.stringify({',
    '          tool_name: CLAUDE_NAME[input.tool],',
    '          cwd: directory || process.cwd(),',
    '          tool_input: toolInput(input.tool, output && output.args),',
    '        }),',
    "        encoding: 'utf8',",
    `        timeout: ${(hook.timeout || 15) * 1000},`,
    '      });',
    '    } catch {',
    '      return;',
    '    }',
    '    if (!result || result.status !== 2) return;',
    `    throw new Error(result.stderr || 'Bloqueado por ${hook.id}.');`,
    '  },',
    '});',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Sincronización
// ---------------------------------------------------------------------------

/**
 * Qué escribiría `sync` y qué hay hoy, por harness. Sirve a `sync` y a `check`.
 *
 * @returns {Array<{target: object, file: string, writes: Array<{rel: string, content: string|null}>,
 *   remove: string[], notes: string[], error: string|null}>}
 */
function plan(cfg) {
  const decl = declared(cfg);
  const out = [];

  for (const target of targets(cfg)) {
    const entry = { target, notes: [], writes: [], remove: [], error: null };
    const unsupported = decl.hooks.filter(
      (h) => (!h.harnesses || h.harnesses.includes(target.id)) && !(target.hooks.events || {})[h.event],
    );
    for (const h of unsupported) {
      entry.notes.push(`${h.id}: ${target.label} no tiene un evento equivalente a "${h.event}"; no se registra.`);
    }

    if (target.hooks.format === 'claude-settings') {
      const rel = target.hooks.file;
      const file = path.join(cfg.root, rel);
      const cur = readJson(file);
      if (cur.error) {
        entry.error = `${rel} no es JSON válido (${cur.error}); no se toca.`;
      } else {
        const { next, conflicts, adopted } = planClaudeSettings(cur.data, target, decl);
        entry.notes.push(...conflicts);
        for (const a of adopted) {
          entry.notes.push(`adoptado el registro heredado de ${a}: ahora lo administra la base.`);
        }
        const body = JSON.stringify(next, null, 2) + '\n';
        const before = cur.exists ? fs.readFileSync(file, 'utf8') : null;
        // Si el proyecto no tiene settings.json y no hay nada que registrar,
        // no se crea un archivo vacío.
        const nothing = !cur.exists && !next.hooks && !next.statusLine;
        entry.writes.push({ rel, content: nothing ? null : body, current: before });
      }
    } else if (target.hooks.format === 'opencode-plugin') {
      const dir = target.hooks.dir;
      const wanted = new Map();
      for (const hook of decl.hooks) {
        if (hook.harnesses && !hook.harnesses.includes(target.id)) continue;
        if (!(target.hooks.events || {})[hook.event]) continue;
        wanted.set(pluginName(hook), pluginSource(hook, target.hooks));
      }
      for (const [name, content] of wanted) {
        const rel = `${dir}/${name}`;
        const abs = path.join(cfg.root, rel);
        entry.writes.push({ rel, content, current: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null });
      }
      const absDir = path.join(cfg.root, dir);
      if (fs.existsSync(absDir)) {
        for (const name of fs.readdirSync(absDir)) {
          if (!name.startsWith(PLUGIN_PREFIX) || wanted.has(name)) continue;
          const abs = path.join(absDir, name);
          // Solo se borra lo que este módulo generó.
          if (fs.readFileSync(abs, 'utf8').includes(PLUGIN_MARK)) entry.remove.push(`${dir}/${name}`);
        }
      }
    }
    out.push(entry);
  }

  return { entries: out, skipped: decl.skipped, declared: decl };
}

/** Escribe los hooks en cada harness. @returns {string[]} líneas de reporte */
function sync(cfg, { dryRun = false } = {}) {
  const report = [];
  const { entries } = plan(cfg);

  for (const e of entries) {
    if (e.error) {
      report.push(`${e.target.label}: ${e.error}`);
      continue;
    }
    for (const w of e.writes) {
      if (w.content === null || w.content === w.current) continue;
      if (!dryRun) {
        const abs = path.join(cfg.root, w.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, w.content, 'utf8');
      }
      report.push(`${w.rel} ${w.current === null ? 'creado' : 'actualizado'}`);
    }
    for (const rel of e.remove) {
      if (!dryRun) fs.rmSync(path.join(cfg.root, rel), { force: true });
      report.push(`${rel} eliminado (el hook ya no está declarado)`);
    }
    for (const n of e.notes) report.push(`aviso: ${n}`);
  }

  return report;
}

/** Diferencias entre lo declarado y lo registrado. Vacío = sincronizado. */
function check(cfg) {
  const drift = [];
  const { entries } = plan(cfg);

  for (const e of entries) {
    if (e.error) {
      drift.push(`${e.target.label}: ${e.error}`);
      continue;
    }
    for (const w of e.writes) {
      if (w.content === null) continue;
      if (w.current === null) drift.push(`${w.rel} — falta`);
      else if (w.content !== w.current) drift.push(`${w.rel} — fuera de sincronía con los hooks declarados`);
    }
    for (const rel of e.remove) drift.push(`${rel} — sobra: el hook ya no está declarado`);
  }

  return drift;
}

module.exports = {
  MARK,
  PLUGIN_MARK,
  EVENTS,
  declared,
  targets,
  plan,
  planClaudeSettings,
  sync,
  check,
};
