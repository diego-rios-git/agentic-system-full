#!/usr/bin/env node
/**
 * start-worktree-session.js — abre una sesión del harness DENTRO de un slot.
 *
 *   node scripts/start-worktree-session.js --slot <slot> [--repo <repo> | --all] [--harness <id>] [--dry-run]
 *
 * Arma el cwd (la raíz del slot, o `<slot>/<repo>`), exporta `AI_WORKTREE_SLOT`
 * y `AI_WORKTREE_ROOT`, y lanza el harness elegido de `harnesses` en
 * ai-workspace.json.
 *
 * Por qué existe: una sesión con el cwd dentro de un slot (que es OTRO
 * repositorio git, anidado en el workspace) perdía las reglas y los agentes de
 * la raíz: la herramienta busca su configuración desde el cwd hacia arriba o
 * desde la raíz del repo que encuentra, y ahí no está. El lanzamiento le
 * entrega la raíz del workspace (cada harness lo expresa a su manera: ver abajo).
 *
 * El comando de lanzamiento es DATO del harness (`launch` en su definición, en
 * `template.manifest.json` o en `harnessDefinitions` de ai-workspace.json), no
 * código: cada herramienta se invoca distinto y la lista crece sin tocar este
 * script.
 *
 *   "launch": {
 *     "command": "opencode",
 *     "args": ["--dir", "{cwd}"],
 *     "env": { "OPENCODE_CONFIG": "{root}/opencode.json" }
 *   }
 *
 * Placeholders: {cwd} directorio de la sesión · {root} raíz del workspace ·
 * {slot} nombre del slot · {slotRoot} raíz del slot. Si el harness no declara
 * `launch`, el script imprime cómo hacerlo a mano y sale con 2: lanzar "a
 * ciegas" una herramienta cuyos argumentos no conocemos es peor que no lanzar.
 *
 * `--dry-run` imprime lo que lanzaría y sale 0 (útil para verificar el dato).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const config = require('./lib/workspace-config');
const paths = require('./lib/worktree-paths');
const harnesses = require('./lib/harnesses');

function die(msg, code = 2) {
  process.stderr.write(`\n  ${msg}\n\n`);
  process.exit(code);
}

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--slot', '--repo', '--harness'].includes(a)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) die(`${a} requiere un valor.`);
      args[a.slice(2)] = v;
    } else if (a === '--all' || a === '--dry-run') {
      args[a.slice(2).replace('-r', 'R')] = true;
    } else {
      die(`Argumento desconocido: ${a}\nUso: node scripts/start-worktree-session.js --slot <slot> [--repo <repo>|--all] [--harness <id>] [--dry-run]`);
    }
  }
  return args;
}

const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Un argumento con espacios, entre comillas, para `shell: true` en Windows. */
const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function main() {
  const args = parse(process.argv.slice(2));
  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  if (!cfg.worktrees.enabled) die('Los slots están desactivados en ai-workspace.json.');
  if (!args.slot) die('Falta --slot.');
  const names = paths.slots(cfg).map((s) => s.name);
  if (!names.includes(args.slot)) die(`Slot desconocido: "${args.slot}". Declarados: ${names.join(', ')}`);
  if (args.repo && args.all) die('--repo y --all son excluyentes.');

  const slotRoot = paths.slotRoot(cfg, args.slot);
  if (!fs.existsSync(slotRoot)) {
    die(`El slot "${args.slot}" no está abierto. Abrilo con: node scripts/manage-worktree.js open --slot ${args.slot} --repo <repo> --branch <rama>`);
  }

  let cwd = slotRoot;
  if (args.repo) {
    const repo = cfg.repos.find((r) => r.name === args.repo);
    if (!repo) die(`El repositorio "${args.repo}" no está declarado. Declarados: ${cfg.repos.map((r) => r.name).join(', ')}`);
    cwd = paths.slotRepoDir(cfg, args.slot, repo);
    if (!fs.existsSync(cwd)) die(`No existe ${args.slot}/${repo.name}: ese repositorio no está abierto en el slot.`);
  }

  const catalog = harnesses.catalog(cfg.raw);
  const declared = cfg.harnesses;
  let id = args.harness;
  if (id && !declared.includes(id)) {
    die(`El harness "${id}" no está en \`harnesses\` de ai-workspace.json. Declarados: ${declared.join(', ') || 'ninguno'}`);
  }
  if (!id) id = declared.find((h) => catalog[h] && catalog[h].launch) || declared[0];
  if (!id) die('El proyecto no declara ningún harness (`harnesses` está vacío): no hay herramienta que lanzar. Abrí tu herramienta desde el directorio de abajo.');

  const env = { AI_WORKTREE_SLOT: args.slot, AI_WORKTREE_ROOT: slotRoot };
  const launch = catalog[id] && catalog[id].launch;

  if (!launch || !launch.command) {
    process.stderr.write(
      `\n  El harness "${id}" no declara \`launch\`: no sé cómo lanzarlo.\n` +
        '  A mano:\n' +
        `    directorio:  ${cwd}\n` +
        `    variables:   AI_WORKTREE_SLOT=${args.slot}  AI_WORKTREE_ROOT=${slotRoot}\n` +
        `    la raíz del workspace (${cfg.root}) tiene que quedar visible para la herramienta, o la sesión pierde reglas y agentes.\n` +
        '  Para automatizarlo, declará `launch` en la definición del harness (`harnessDefinitions` de ai-workspace.json):\n' +
        '    "launch": { "command": "<ejecutable>", "args": ["..."], "env": { } }   // placeholders: {cwd} {root} {slot} {slotRoot}\n\n',
    );
    process.exit(2);
  }

  const vars = { cwd, root: cfg.root, slot: args.slot, slotRoot };
  const command = fill(launch.command, vars);
  const cmdArgs = (launch.args || []).map((a) => fill(a, vars));
  for (const [k, v] of Object.entries(launch.env || {})) env[k] = fill(v, vars);

  if (args.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ harness: id, cwd, command, args: cmdArgs, env }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(`\n  ${id} en ${path.relative(cfg.root, cwd) || '.'} (slot ${args.slot})\n\n`);
  const run =
    process.platform === 'win32'
      ? spawnSync([command, ...cmdArgs].map(quote).join(' '), { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: true })
      : spawnSync(command, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (run.error) die(`No se pudo lanzar "${command}": ${run.error.message}`, 1);
  process.exit(run.status === null ? 1 : run.status);
}

main();
