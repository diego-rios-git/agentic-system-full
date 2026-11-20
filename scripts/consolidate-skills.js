#!/usr/bin/env node
/**
 * consolidate-skills.js
 *
 * Genera los punteros de cada harness a partir de una fuente única.
 *
 *   FUENTE                                  PUNTEROS
 *   ai/core/procedures/X.md      (200)      .claude/skills/X/SKILL.md    (18)
 *   ai/packs/nestjs/procedures/… (200)      .opencode/skills/X/SKILL.md  (18)
 *
 * El contenido vive UNA vez. Cada harness conserva su propio frontmatter, que
 * es lo único que realmente necesita ser distinto.
 *
 * A diferencia de una carpeta plana, acá el contenido puede venir del núcleo,
 * de un pack o del propio proyecto (`ai/local/`). La ruta que termina impresa
 * en el puntero sale de `asset-roots`, no de una constante: el mismo
 * procedimiento vive en un lugar distinto según su origen.
 *
 * Además de los punteros, registra en cada harness los HOOKS y la status line
 * que declaran los manifiestos (ver `scripts/lib/hooks.js`). Es la única vía:
 * editar a mano `.claude/settings.json` para agregar un hook de la base está
 * prohibido, porque la próxima actualización no lo sabría y el hook quedaría
 * huérfano o duplicado. Lo que el proyecto tenga en ese archivo por su cuenta
 * (permisos, hooks propios, su propia status line) no se toca.
 *
 * Uso:
 *   node scripts/consolidate-skills.js --wrappers   # genera punteros y registra hooks
 *   node scripts/consolidate-skills.js --check      # ¿algo fuera de sincronía?
 *   node scripts/consolidate-skills.js --list       # qué activos hay resueltos
 *   node scripts/consolidate-skills.js --wrappers --dry-run
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const assets = require('./lib/asset-roots');

const ROOT = config.ROOT;

/**
 * Los árboles de cada harness y el dialecto de su frontmatter ya no viven acá:
 * los declara `template.manifest.json`, y un proyecto agrega los suyos en
 * `harnessDefinitions` de `ai-workspace.json`. Ver `scripts/lib/harnesses.js`.
 *
 * Antes eran dos listas de código y un `if` por identificador. Agregar una
 * herramienta obligaba a tocar tres archivos y publicar una versión de la base,
 * con lo cual la respuesta a "mi equipo usa otra herramienta" era esperar.
 */
const harnesses = require('./lib/harnesses');
const hooks = require('./lib/hooks');

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function wrapText(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > width) {
      if (current) lines.push(current.trim());
      current = w;
    } else {
      current += ' ' + w;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function toTitle(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Punteros de skill
// ---------------------------------------------------------------------------

function renderSkillWrapper(skill, cfg, harnessLabels) {
  const desc = String(skill.description || '').replace(/\s+/g, ' ').trim();

  // Todos los harnesses comparten el mismo schema de frontmatter de skill.
  const lines = [
    '---',
    `name: ${skill.name}`,
    'description: >',
    ...wrapText(desc, 76).map((l) => `  ${l}`),
    'license: MIT',
    `compatibility: ${skill.compatibility || 'Run from the workspace root.'}`,
    'metadata:',
    `  author: ${cfg.project.name}`,
    `  version: "${skill.version || '1.0'}"`,
    `  source: ${skill.root.kind}`,
    '---',
    '',
    `# ${skill.title || toTitle(skill.name)}`,
    '',
    'Este archivo es un puntero. El procedimiento completo vive en una fuente',
    `única compartida por todos los harnesses (${harnessLabels.join(', ')}):`,
    '',
    `**\`${skill.contentPath}\`**`,
    '',
    'Leé ese archivo y seguí sus instrucciones exactamente.',
    '',
    '> No edites este puntero para cambiar el comportamiento del skill: el cambio',
    `> se perdería para los demás harnesses. Editá la fuente en \`${skill.contentPath}\`.`,
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Punteros de agente
// ---------------------------------------------------------------------------

/**
 * El frontmatter de agente es lo único que difiere de verdad entre harnesses, y
 * cada diferencia es un campo del dialecto que el harness declara:
 *
 *   description  "block"  → `description: >` con el texto indentado debajo
 *                "inline" → en la misma línea
 *   tools        "list"   → lista separada por comas de las permitidas
 *                "map"    → mapa de booleanos
 *   model        "alias"  → el tier tal cual ("opus")
 *                "mapped" → traducido con `modelMap` ("anthropic/claude-opus-5")
 */
function renderAgentWrapper(agent, tree) {
  const desc = String(agent.description || '').replace(/\s+/g, ' ').trim();
  const localName = (agent.filenames && agent.filenames[tree.id]) || agent.name;
  const fm = tree.frontmatter;
  const lines = ['---', `name: ${localName}`];

  if (fm.description === 'block') {
    lines.push('description: >');
    lines.push(...wrapText(desc, 76).map((l) => `  ${l}`));
  } else {
    lines.push(`description: ${desc}`);
  }

  if (fm.mode) lines.push(`mode: ${agent.mode || 'subagent'}`);

  // Solo los agentes `mode: subagent` fijan modelo. Un `mode: primary` es el
  // punto de entrada de toda una sesión: quien la abrió ya eligió el modelo, y
  // forzar un tier acá anularía esa elección para la sesión entera.
  if (agent.model && agent.mode !== 'primary' && fm.model !== 'none') {
    const value = fm.model === 'mapped' ? tree.modelMap[agent.model] : agent.model;
    if (value) lines.push(`model: ${value}`);
  }

  // Un agente que declara `edit: false` no debe poder editar en NINGÚN harness.
  // El mapa de booleanos lo expresa directo; con una lista hay que enumerar las
  // permitidas, porque un harness que no recibe `tools` suele darle todas y la
  // restricción quedaría como una sugerencia de texto.
  if (fm.tools === 'list') {
    if (agent.tools && agent.tools.edit === false) {
      lines.push(`tools: ${fm.readOnlyTools.join(', ')}`);
    }
  } else if (fm.tools === 'map') {
    const tools = agent.tools || { write: true, edit: true, bash: true };
    lines.push('tools:');
    for (const [k, v] of Object.entries(tools)) lines.push(`  ${k}: ${v}`);
  }

  lines.push(
    '---',
    '',
    `# ${agent.title || toTitle(agent.name)}`,
    '',
    'Este archivo es un puntero. La definición completa del agente vive en una',
    'fuente única compartida por todos los harnesses:',
    '',
    `**\`${agent.contentPath}\`**`,
    '',
    'Leé ese archivo y seguí sus instrucciones exactamente.',
    '',
    '> No edites este puntero para cambiar el comportamiento del agente: el',
    `> cambio se perdería para los demás harnesses. Editá \`${agent.contentPath}\`.`,
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------

function activeTrees(cfg) {
  return harnesses.resolve(cfg).trees;
}

function generate(cfg, resolved, opts) {
  const trees = activeTrees(cfg);
  const labels = trees.map((t) => t.label);
  const results = [];

  for (const skill of resolved.skills) {
    // `harnesses` en el manifiesto restringe a qué harnesses se expone el
    // skill; sin ese campo se expone a todos los que el proyecto usa.
    const targets = skill.harnesses || trees.map((t) => t.id);

    for (const tree of trees) {
      if (!tree.skillsDir) continue;
      const wrapperPath = path.join(ROOT, tree.skillsDir, skill.name, tree.skillFile);

      if (!targets.includes(tree.id)) {
        if (fs.existsSync(wrapperPath) && !opts.dryRun) {
          fs.rmSync(path.dirname(wrapperPath), { recursive: true, force: true });
        }
        results.push({ kind: 'skill', name: skill.name, harness: tree.id, action: 'eliminado' });
        continue;
      }

      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
        fs.writeFileSync(wrapperPath, renderSkillWrapper(skill, cfg, labels), 'utf8');
      }
      results.push({ kind: 'skill', name: skill.name, harness: tree.id, action: 'generado' });
    }
  }

  for (const agent of resolved.agents) {
    const targets = agent.harnesses || trees.map((t) => t.id);

    for (const tree of trees) {
      if (!tree.agentsDir) continue;
      if (!targets.includes(tree.id)) continue;

      const fileName = (agent.filenames && agent.filenames[tree.id]) || agent.name;
      const target = path.join(ROOT, tree.agentsDir, `${fileName}.md`);

      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, renderAgentWrapper(agent, tree), 'utf8');
      }
      results.push({ kind: 'agent', name: agent.name, harness: tree.id, action: 'generado' });
    }
  }

  return results;
}

/** Un puntero editado a mano es un cambio que los demás harnesses no ven. */
function check(cfg, resolved) {
  const trees = activeTrees(cfg);
  const labels = trees.map((t) => t.label);
  const drifted = [];

  for (const skill of resolved.skills) {
    const targets = skill.harnesses || trees.map((t) => t.id);
    for (const tree of trees) {
      if (!tree.skillsDir) continue;
      if (!targets.includes(tree.id)) continue;

      const wrapperPath = path.join(ROOT, tree.skillsDir, skill.name, tree.skillFile);
      const rel = `${tree.skillsDir}/${skill.name}/${tree.skillFile}`;

      if (!fs.existsSync(wrapperPath)) {
        drifted.push(`${rel} — falta`);
        continue;
      }
      if (fs.readFileSync(wrapperPath, 'utf8').trim() !== renderSkillWrapper(skill, cfg, labels).trim()) {
        drifted.push(`${rel} — editado a mano`);
      }
    }
  }

  for (const agent of resolved.agents) {
    const targets = agent.harnesses || trees.map((t) => t.id);
    for (const tree of trees) {
      if (!tree.agentsDir) continue;
      if (!targets.includes(tree.id)) continue;

      const fileName = (agent.filenames && agent.filenames[tree.id]) || agent.name;
      const target = path.join(ROOT, tree.agentsDir, `${fileName}.md`);
      const rel = `${tree.agentsDir}/${fileName}.md`;

      if (!fs.existsSync(target)) {
        drifted.push(`${rel} — falta`);
        continue;
      }
      if (fs.readFileSync(target, 'utf8').trim() !== renderAgentWrapper(agent, tree).trim()) {
        drifted.push(`${rel} — editado a mano`);
      }
    }
  }

  // Un activo declarado sin contenido no es drift de puntero, pero rompe igual:
  // el harness carga un puntero que remite a un archivo inexistente.
  for (const m of resolved.missing) {
    drifted.push(`${m.expected} — declarado en el manifiesto, falta el contenido`);
  }

  return drifted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const opts = { dryRun: argv.includes('--dry-run') };

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  let resolved;
  try {
    resolved = assets.merged(cfg);
  } catch (err) {
    process.stderr.write(`\n  ${err.message}\n\n`);
    process.exit(2);
  }

  if (argv.includes('--list')) {
    console.log(`\n  Proyecto: ${cfg.project.name}   packs: ${cfg.activePacks.join(', ') || '(ninguno)'}\n`);
    for (const root of assets.roots(cfg)) {
      const skills = resolved.skills.filter((s) => s.root.id === root.id);
      const agents = resolved.agents.filter((a) => a.root.id === root.id);
      console.log(`    ${root.dir.padEnd(28)} ${skills.length} skills · ${agents.length} agentes`);
    }
    for (const o of resolved.overrides) {
      console.log(`\n    ${o.kind} "${o.name}": ${o.to} reemplaza a ${o.from}`);
    }
    const decl = hooks.declared(cfg);
    console.log(`\n    hooks activos: ${decl.hooks.map((h) => h.id).join(', ') || '(ninguno)'}`);
    if (decl.statusLine) console.log(`    status line: ${decl.statusLine.script}`);
    for (const k of decl.skipped) console.log(`    no se registra ${k.id}: ${k.reason}`);
    console.log('');
    return;
  }

  if (argv.includes('--check')) {
    const drifted = [...check(cfg, resolved), ...hooks.check(cfg)];
    if (drifted.length === 0) {
      console.log('\n  Punteros y hooks sincronizados con la fuente.\n');
      process.exit(0);
    }
    console.log('\n  Fuera de sincronía:\n');
    for (const d of drifted) console.log(`    ${d}`);
    console.log('\n  Para cambiar el comportamiento de un activo, editá su fuente en ai/');
    console.log('  y regenerá con --wrappers. Los hooks se declaran en el manifest.json de su');
    console.log('  origen: no se editan a mano en .claude/settings.json.\n');
    process.exit(1);
  }

  if (argv.includes('--wrappers')) {
    console.log('\n  Generando punteros\n');

    for (const o of resolved.overrides) {
      console.log(`    aviso: ${o.kind} "${o.name}" de ${o.to} reemplaza al de ${o.from}`);
    }
    for (const m of resolved.missing) {
      console.log(`    aviso: ${m.kind} "${m.name}" declarado sin contenido en ${m.expected}`);
    }
    if (resolved.overrides.length || resolved.missing.length) console.log('');

    const results = generate(cfg, resolved, opts);
    const byName = new Map();
    for (const r of results) {
      const key = `${r.kind === 'agent' ? '[agente] ' : ''}${r.name}`;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(`${r.harness}:${r.action === 'eliminado' ? '−' : '✓'}`);
    }
    if (byName.size === 0) {
      // Distinguir las dos causas: sin harnesses no hay nada que generar y eso
      // es un estado válido; sin activos, en cambio, algo falta declarar.
      const trees = activeTrees(cfg);
      console.log(
        trees.length === 0
          ? '    Ningún harness con árbol propio declarado: no hay punteros que generar.\n' +
              '    El contenido del sistema vive en ai/ y funciona igual.'
          : '    (no hay activos declarados todavía)',
      );
    }
    for (const [name, items] of byName) {
      console.log(`    ${name.padEnd(30)} ${items.join('  ')}`);
    }

    // Hooks y status line: la misma fuente, el mismo comando.
    const hookReport = hooks.sync(cfg, opts);
    // Registrar hooks que esta máquina no puede correr es registrar guards
    // apagados: se avisa acá, que es donde se registran. No corta: los punteros
    // ya se generaron y la persona puede estar preparando el proyecto para otro.
    const pf = hooks.declared(cfg).hooks.length > 0 ? require('./lib/preflight').check() : null;
    if (hookReport.length > 0 || (pf && (pf.errors.length || pf.warnings.length))) {
      console.log('\n  Hooks\n');
      for (const line of hookReport) console.log(`    ${line}`);
      if (pf) require('./lib/preflight').report(pf, (l) => console.log(`  ${l}`));
    }

    console.log(opts.dryRun ? '\n  (dry-run: no se escribió nada)\n' : '');
    return;
  }

  console.log(
    '\nUso: node scripts/consolidate-skills.js [--wrappers] [--check] [--list] [--dry-run]\n',
  );
  process.exit(2);
}

main();
