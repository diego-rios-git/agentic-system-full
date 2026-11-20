#!/usr/bin/env node
/**
 * init.js — bootstrap de un proyecto a partir de esta base.
 *
 * Pregunta lo mínimo, instala solo lo que corresponde y deja el workspace
 * funcionando: configuración, punteros de cada harness, documentos generados y
 * los baselines de los gates ya calibrados.
 *
 * Ese último paso es el que decide si el sistema se usa o se apaga. Al
 * instalarse sobre un proyecto que ya tiene código, los gates encontrarían
 * cientos de hallazgos preexistentes el primer día; eso se lee como ruido, el
 * equipo los desactiva, y no vuelven a prenderse nunca. Congelar la deuda al
 * instalar hace que el gate hable solo de lo que se agrega desde ahora.
 *
 * Uso:
 *   node init.js                       # interactivo
 *   node init.js --config plan.json    # desatendido, para pruebas y CI
 *   node init.js --dry-run             # muestra qué haría, no escribe nada
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const ROOT = __dirname;
const { render } = require('./scripts/lib/render');

const CONFIG_NAME = 'ai-workspace.json';

/**
 * Los harnesses que se ofrecen salen del catalogo de `template.manifest.json`,
 * no de una lista escrita aca. Asi, una herramienta agregada al catalogo
 * aparece sola en el instalador, y ninguna lista queda desactualizada respecto
 * de la otra.
 *
 * Se puede elegir ninguno: el contenido del sistema vive en `ai/` y los
 * punteros de harness son una proyeccion opcional.
 */
function knownHarnesses() {
  const catalog = require('./scripts/lib/harnesses').catalog();
  return Object.entries(catalog).map(([id, def]) => ({ id, label: def.title || id }));
}

// ---------------------------------------------------------------------------
// Utilidades de consola
// ---------------------------------------------------------------------------

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const step = (msg) => say(`\n  ${msg}`);
const ok = (msg) => say(`    ✓ ${msg}`);
const warn = (msg) => say(`    ! ${msg}`);

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'template.manifest.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Preguntas
// ---------------------------------------------------------------------------

async function ask(rl, question, fallback) {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`  ${question}${suffix}: `)).trim();
  return answer || fallback || '';
}

async function askYesNo(rl, question, fallback = true) {
  const answer = (await rl.question(`  ${question} [${fallback ? 'S/n' : 's/N'}]: `))
    .trim()
    .toLowerCase();
  if (!answer) return fallback;
  return answer.startsWith('s') || answer.startsWith('y');
}

async function askChoice(rl, question, options, fallbackIndex = 0) {
  say(`\n  ${question}`);
  options.forEach((o, i) => say(`    ${i + 1}. ${o.label}`));
  const answer = (await rl.question(`  Elegí [${fallbackIndex + 1}]: `)).trim();
  const index = answer ? Number(answer) - 1 : fallbackIndex;
  return options[Number.isInteger(index) && options[index] ? index : fallbackIndex];
}

async function askMulti(rl, question, options, defaults) {
  say(`\n  ${question}`);
  options.forEach((o, i) => {
    const marked = defaults.includes(o.id) ? '*' : ' ';
    say(`    ${i + 1}.${marked} ${o.label}`);
  });
  const answer = (await rl.question('  Números separados por coma [los marcados]: ')).trim();
  if (!answer) return defaults;

  const picked = answer
    .split(',')
    .map((n) => options[Number(n.trim()) - 1])
    .filter(Boolean)
    .map((o) => o.id);
  return picked.length > 0 ? picked : defaults;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

async function buildPlan(rl, packsAvailable) {
  say('\n  ── Proyecto ────────────────────────────────────────────');

  let name = '';
  while (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    name = (await ask(rl, 'Nombre del proyecto (minúsculas y guiones)')).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      warn('Solo minúsculas, números y guiones.');
    }
  }

  const title = await ask(rl, 'Título para mostrar', name);

  let ticketPrefix = '';
  if (await askYesNo(rl, '¿Usan identificadores de ticket en ramas y commits?', true)) {
    while (!/^[A-Z][A-Z0-9]*$/.test(ticketPrefix)) {
      ticketPrefix = (await ask(rl, 'Prefijo, en mayúsculas y sin el número (ej. ABC)')).toUpperCase();
      if (!/^[A-Z][A-Z0-9]*$/.test(ticketPrefix)) warn('Solo letras y números, en mayúsculas.');
    }
  }

  say('\n  ── Topología ───────────────────────────────────────────');
  const topology = (
    await askChoice(rl, '¿Cómo está organizado el código?', [
      { id: 'multi-repo', label: 'Varios repositorios, clonados dentro de este workspace' },
      { id: 'single-repo', label: 'Un solo repositorio: la base convive con el código' },
    ])
  ).id;

  const packOptions = Object.entries(packsAvailable)
    .filter(([, p]) => p.appliesTo === 'repo')
    .map(([id, p]) => ({ id, label: `${p.title} — ${p.description}` }));

  const repos = [];
  if (topology === 'single-repo') {
    repos.push(await askRepo(rl, packOptions, { name, path: '.' }));
  } else {
    say('\n  ── Repositorios ────────────────────────────────────────');
    say('  Declarás uno por vez. Enter en el nombre para terminar.\n');
    for (;;) {
      const repoName = await ask(rl, `Nombre del repositorio ${repos.length + 1} (Enter para terminar)`);
      if (!repoName) break;
      repos.push(await askRepo(rl, packOptions, { name: repoName, path: repoName }));
    }
    if (repos.length === 0) {
      warn('No declaraste ninguno: se asume un repositorio llamado "app".');
      repos.push({ name: 'app', path: 'app', packs: [], baseBranch: 'main' });
    }
  }

  const workspacePacks = Object.entries(packsAvailable)
    .filter(([, p]) => p.appliesTo === 'workspace')
    .map(([id, p]) => ({ id, label: `${p.title} — ${p.description}` }));

  let packs = [];
  if (workspacePacks.length > 0) {
    say('\n  ── Packs de todo el workspace ──────────────────────────');
    packs = await askMulti(rl, '¿Cuáles instalás?', workspacePacks, []);
  }

  say('\n  ── Harnesses ───────────────────────────────────────────');
  say('  El contenido vive en ai/ y funciona sin ninguno: lo que se genera acá');
  say('  son punteros para las herramientas que los necesiten.');
  say('');
  const harnesses = await askMulti(
    rl,
    '¿Qué herramientas de IA usa el equipo? (ninguna es una respuesta válida)',
    knownHarnesses(),
    ['claude', 'agents-md'],
  );

  say('\n  ── Trabajo paralelo ────────────────────────────────────');
  const worktreesEnabled = await askYesNo(
    rl,
    '¿Habilitar slots de worktree para trabajar en varias tareas a la vez?',
    true,
  );

  return {
    version: 1,
    project: { name, title, ticketPrefix: ticketPrefix || undefined, language: 'es' },
    topology,
    repos,
    packs,
    harnesses,
    worktrees: worktreesEnabled
      ? { enabled: true, dir: 'worktrees', slots: ['implementation-1', 'implementation-2', 'review'] }
      : { enabled: false, slots: [] },
  };
}

async function askRepo(rl, packOptions, base) {
  const repo = { name: base.name, path: base.path };

  if (base.path !== '.') {
    repo.path = await ask(rl, `  Directorio de "${repo.name}"`, base.path);
  }

  if (packOptions.length > 0) {
    repo.packs = await askMulti(rl, `  Stack de "${repo.name}"`, packOptions, []);
  } else {
    repo.packs = [];
  }

  // Un stack sin pack (Python, Angular, Go…) es un caso normal, no un error: la
  // base sirve igual. Se anota para que `project-loader` le declare el perfil de
  // lenguaje y los comandos del ecosistema; sin esa nota nadie se entera de que
  // los gates no están mirando el código de este repositorio.
  if (repo.packs.length === 0) {
    const stack = await ask(rl, `  Ningún pack cubre "${repo.name}". ¿Qué stack usa? (ej. python/fastapi, angular; Enter si no se sabe)`, '');
    if (stack) repo.stack = stack;
  }

  repo.baseBranch = await ask(rl, `  Rama base de "${repo.name}"`, 'main');

  const testCommand = await ask(rl, `  Comando de tests de "${repo.name}" (Enter si no hay)`, '');
  const typecheckCommand = await ask(rl, `  Comando de tipos de "${repo.name}" (Enter si no hay)`, '');
  const lintCommand = await ask(rl, `  Comando de análisis estático (Enter si no hay)`, '');

  if (testCommand) repo.testCommand = testCommand;
  if (typecheckCommand) repo.typecheckCommand = typecheckCommand;
  if (lintCommand) repo.lintCommand = lintCommand;

  return repo;
}

// ---------------------------------------------------------------------------
// Instalación
// ---------------------------------------------------------------------------

function activePacks(plan) {
  return [...new Set([...(plan.packs || []), ...plan.repos.flatMap((r) => r.packs || [])])];
}

/** Los packs no elegidos se eliminan: un activo que nadie va a usar es ruido. */
function removeUnusedPacks(plan, available, dryRun) {
  const keep = new Set(activePacks(plan));
  const removed = [];

  for (const id of Object.keys(available)) {
    if (keep.has(id)) continue;
    const dir = path.join(ROOT, 'ai', 'packs', id);
    if (!fs.existsSync(dir)) continue;
    if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
    removed.push(id);
  }
  return removed;
}

function renderDocuments(plan, available, dryRun) {
  const tpl = manifest().template;

  const ctx = {
    template: tpl,
    project: plan.project,
    topology: plan.topology,
    isMultiRepo: plan.topology === 'multi-repo',
    isSpanish: (plan.project.language || 'es') === 'es',
    repos: plan.repos.map((r) => ({
      ...r,
      packsLabel: (r.packs || []).length > 0 ? (r.packs || []).join(', ') : '—',
    })),
    packs: activePacks(plan).map((id) => ({ id, name: id, ...(available[id] || {}) })),
    worktrees: plan.worktrees,
    tenant: plan.tenant || {},
    hasMultiTenant: activePacks(plan).includes('multi-tenant'),
    hasMigrations: plan.repos.some((r) => (r.packs || []).includes('nestjs')),
    generatedAt: new Date().toISOString().slice(0, 10),
    agents: [],
    skills: [],
    gates: [],
  };

  const written = [];
  for (const [source, target] of [
    ['CLAUDE.md.tpl', 'CLAUDE.md'],
    ['AGENTS.md.tpl', 'AGENTS.md'],
    ['README.md.tpl', 'README.md'],
  ]) {
    const from = path.join(ROOT, 'templates', source);
    if (!fs.existsSync(from)) continue;
    const out = render(fs.readFileSync(from, 'utf8'), ctx);
    if (!dryRun) fs.writeFileSync(path.join(ROOT, target), out, 'utf8');
    written.push(target);
  }
  return written;
}

function installHarnessSettings(plan, dryRun) {
  if (!plan.harnesses.includes('claude')) return null;

  const from = path.join(ROOT, 'templates', 'claude-settings.json');
  if (!fs.existsSync(from)) return null;

  const dir = path.join(ROOT, '.claude');
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(from, path.join(dir, 'settings.json'));
    // El archivo de configuración personal se versiona solo como ejemplo: cada
    // persona decide su propio nivel de permisos, y compartirlo impondría el
    // criterio de riesgo de quien lo escribió primero.
    fs.writeFileSync(
      path.join(dir, 'settings.local.json.example'),
      JSON.stringify({ $schema: 'https://json.schemastore.org/claude-code-settings.json' }, null, 2) + '\n',
      'utf8',
    );
  }
  return '.claude/settings.json';
}

function writeLock(dryRun) {
  const { createHash } = require('crypto');
  const { templateFiles } = require('./scripts/lib/template-files');
  const m = manifest();

  // La misma lista que va a usar template-sync: si difieren, el sync ve
  // archivos sin registro y los reporta como modificados por el proyecto.
  const packs = activePacks(JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_NAME), 'utf8')));

  const files = {};
  for (const rel of templateFiles(ROOT, packs)) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    files[rel] = 'sha256:' + createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }

  const lock = {
    template: m.template.repository,
    version: m.template.version,
    installedAt: new Date().toISOString(),
    files,
  };

  if (!dryRun) {
    fs.writeFileSync(
      path.join(ROOT, 'template.lock.json'),
      JSON.stringify(lock, null, 2) + '\n',
      'utf8',
    );
  }
  return Object.keys(files).length;
}

/**
 * Reemplaza el `.gitignore` de la base por el que corresponde a un proyecto.
 *
 * No es un detalle: son archivos con dueños opuestos. En la base, la
 * configuración y los baselines son artefactos de prueba y no se versionan. En
 * un proyecto son **lo contrario** — la configuración es del equipo, y los
 * baselines tienen que ser los mismos para todos: si cada persona genera el
 * suyo, el gate le reporta cosas distintas a cada una y deja de ser un acuerdo.
 *
 * Sin este paso, quien clona el proyecto no recibe ni la configuración ni el
 * contexto cargado, y el trabajo del cargador se pierde.
 */
function writeProjectGitignore(plan, dryRun) {
  const lines = [
    '# Dependencias',
    'node_modules/',
    '',
    '# Configuración personal — cada persona decide su propio nivel de permisos',
    '**/settings.local.json',
    '',
    '# Secretos',
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '',
    '# Estado local de los gates y de los hooks (no se comparte entre personas)',
    '.ai-gates-log.jsonl',
    '.ai-gates-log.1.jsonl',
    '.ai-gates-cache.json',
    '.ai-gates-unverified.json',
    '.protected-edit-allow.json',
    '',
    '# Slots de worktree',
    `${plan.worktrees && plan.worktrees.dir ? plan.worktrees.dir : 'worktrees'}/`,
    '.tmp/',
    '',
    '# Sistema operativo y editores',
    '.DS_Store',
    'Thumbs.db',
    '.idea/',
  ];

  if (plan.topology === 'multi-repo') {
    lines.push(
      '',
      '# Repositorios de aplicación: cada uno tiene su propio git',
      ...plan.repos.map((r) => `${r.path}/`),
    );
  }

  lines.push(
    '',
    '# Lo que SÍ se versiona, dicho explícitamente porque suele dudarse:',
    '#   ai-workspace.json      la configuración del workspace, es del equipo',
    '#   template.lock.json     qué versión de la base está instalada',
    '#   *-baseline.json        la deuda congelada; tiene que ser la misma para todos',
    '#   ai/local/             el contexto del proyecto',
    '#   .claude/ .opencode/   punteros generados: así funciona al clonar, sin regenerar',
    '',
  );

  if (!dryRun) {
    fs.writeFileSync(path.join(ROOT, '.gitignore'), lines.join('\n'), 'utf8');
  }
  return '.gitignore';
}

/**
 * Deja el registro de candidatos a gate vacío en un proyecto nuevo.
 *
 * El archivo de la base trae las entradas con las que la propia base documentó
 * sus límites (casos de un stack concreto). En un proyecto son ruido ajeno, y
 * además se lintean: un registro que arranca con entradas que no son del
 * proyecto lo deja pasando por candidatos que nadie va a revisar. Se conserva la
 * leyenda —estados y qué exige cada uno— y se vacía la lista.
 */
function resetGateCandidates(dryRun) {
  const file = path.join(ROOT, 'ai', 'gate-candidates.md');
  if (!fs.existsSync(file)) return null;

  const text = fs.readFileSync(file, 'utf8');
  // El ENCABEZADO, no la primera mención: la leyenda también nombra la sección en
  // una frase, y cortar ahí dejaría el texto truncado a mitad de oración.
  const heading = /^## Candidatos[ \t]*$/m.exec(text);
  if (!heading) return null;
  const at = heading.index;

  if (!dryRun) {
    fs.writeFileSync(
      file,
      `${text.slice(0, at)}## Candidatos\n\n_Todavía no hay ninguno. Este archivo se llena a medida que el proyecto encuentra errores reales._\n`,
      'utf8',
    );
  }
  return 'ai/gate-candidates.md — registro vacío, con su leyenda';
}

function run(command, args) {
  const { spawnSync } = require('child_process');
  return spawnSync(process.execPath, [command, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Congela la deuda preexistente de cada gate. Sin esto, un proyecto con código
 * arranca con el gate en rojo desde el primer día.
 */
function calibrateBaselines(plan) {
  const gatesLib = require('./scripts/lib/gates');
  const config = require('./scripts/lib/workspace-config');

  let cfg;
  try {
    cfg = config.load();
  } catch {
    return [];
  }

  const done = [];

  // Un gate puede declarar `baseline: false` cuando congelar su deuda no tiene
  // sentido. Correrle --write-baseline igual no falla —el flag se ignora— pero
  // se reportaría como calibrado algo que nunca lo estuvo, y ese mensaje falso
  // es peor que la ausencia del paso.
  const calibrable = (gate) => gate.baseline !== false;

  for (const gate of gatesLib.forWorkspace(cfg).filter(calibrable)) {
    const args = gatesLib.argsFor(gate, { scope: 'workspace' });
    const result = run(args[0], [...args.slice(1).filter((a) => a !== '--baseline'), '--write-baseline']);
    if (result.status === 0) done.push(`${gate.id} (workspace)`);
  }

  for (const repo of cfg.repos) {
    if (!fs.existsSync(repo.absPath)) continue;
    for (const gate of gatesLib.forRepo(cfg, repo).filter(calibrable)) {
      const args = gatesLib.argsFor(gate, { repo: repo.name, scope: repo.name });
      const result = run(args[0], [...args.slice(1).filter((a) => a !== '--baseline'), '--write-baseline']);
      if (result.status === 0) done.push(`${gate.id} (${repo.name})`);
    }
  }

  return done;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const configIdx = argv.indexOf('--config');

  const m = manifest();
  const available = m.packs || {};

  say('\n  Base agéntica — instalación');
  say(`  ${m.template.repository} v${m.template.version}`);

  // Antes de escribir nada: una base instalada en una máquina sin `node` en el
  // PATH queda con todos los hooks apagados sin que nada lo diga.
  const pf = require('./scripts/lib/preflight').check();
  for (const w of pf.warnings) warn(w);
  if (pf.errors.length > 0) {
    for (const e of pf.errors) warn(e);
    process.exit(1);
  }

  const existing = path.join(ROOT, CONFIG_NAME);
  if (fs.existsSync(existing) && !dryRun) {
    warn(`Ya existe ${CONFIG_NAME}. Este proyecto ya fue inicializado.`);
    warn('Para actualizar la base, usá `node scripts/template-sync.js`.');
    process.exit(1);
  }

  let plan;
  if (configIdx !== -1 && argv[configIdx + 1]) {
    plan = JSON.parse(fs.readFileSync(path.resolve(argv[configIdx + 1]), 'utf8'));
    say(`\n  Plan leído de ${argv[configIdx + 1]}`);
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      plan = await buildPlan(rl, available);
    } finally {
      rl.close();
    }
  }

  say('\n  ── Instalando ──────────────────────────────────────────');

  step('Configuración');
  if (!dryRun) {
    fs.writeFileSync(existing, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  }
  ok(CONFIG_NAME);

  step('Packs');
  const removed = removeUnusedPacks(plan, available, dryRun);
  const kept = activePacks(plan);
  ok(kept.length > 0 ? `instalados: ${kept.join(', ')}` : 'ninguno: solo el núcleo');
  if (removed.length > 0) ok(`eliminados: ${removed.join(', ')}`);

  step('Documentos');
  for (const doc of renderDocuments(plan, available, dryRun)) ok(doc);
  ok(writeProjectGitignore(plan, dryRun));
  const registry = resetGateCandidates(dryRun);
  if (registry) ok(registry);

  step('Harnesses');
  const settings = installHarnessSettings(plan, dryRun);
  if (settings) ok(settings);
  if (!dryRun) {
    const result = run('scripts/consolidate-skills.js', ['--wrappers']);
    if (result.status === 0) ok('punteros generados');
    else warn('no se pudieron generar los punteros: revisá `node scripts/consolidate-skills.js --wrappers`');
  }

  step('Registro de versión');
  const tracked = writeLock(dryRun);
  ok(`template.lock.json — ${tracked} archivos bajo seguimiento`);

  if (!dryRun) {
    step('Calibrando los gates contra el código existente');
    const calibrated = calibrateBaselines(plan);
    if (calibrated.length > 0) {
      for (const c of calibrated) ok(c);
      say('\n    La deuda que ya estaba quedó congelada. Los gates solo van a');
      say('    reportar lo que se agregue desde ahora.');
    } else {
      warn('ningún gate pudo calibrarse — probablemente los repositorios todavía no están clonados');
      warn('cuando los clones, corré: node scripts/run-gates.js --all');
    }
  }

  say('\n  ── Listo ───────────────────────────────────────────────\n');
  if (dryRun) {
    say('  (dry-run: no se escribió nada)\n');
    return;
  }

  say('  Próximos pasos:');
  let n = 1;
  // Solo se listan los que faltan: al adoptar la base en un proyecto que ya
  // existe, decirle a alguien que clone lo que ya tiene delante hace dudar de
  // todo lo demás que dice el instalador.
  const pendientes = plan.repos.filter((r) => !fs.existsSync(path.join(ROOT, r.path)));
  if (plan.topology === 'multi-repo' && pendientes.length > 0) {
    say(`    ${n++}. Cloná los repositorios que faltan:`);
    for (const r of pendientes) say(`         git clone <url> ${r.path}`);
  }
  if (plan.harnesses.includes('claude')) {
    say(`    ${n++}. Copiá tu configuración personal:`);
    say('         cp .claude/settings.local.json.example .claude/settings.local.json');
  }
  const sinPack = plan.repos.filter((r) => (r.packs || []).length === 0);
  if (sinPack.length > 0) {
    say(`    ${n++}. Estos repositorios no tienen pack de stack: ${sinPack.map((r) => (r.stack ? `${r.name} (${r.stack})` : r.name)).join(', ')}.`);
    say('         La base sirve igual. En la carga del proyecto (skill project-loader)');
    say('         el agente te propone el perfil de lenguaje y las herramientas del');
    say('         ecosistema. Ver docs/stack-sin-pack.md.');
  }
  say(`    ${n++}. Verificá que todo esté en su lugar:`);
  say('         node scripts/run-gates.js --all');
  if (pendientes.length > 0) {
    // Va a salir con 2 hasta que estén los repositorios. Decirlo acá evita que
    // se lea como una instalación fallida: lo que falta verificar no se reporta
    // como verificado, y eso es deliberado.
    say('         (sale con código 2 mientras falten repositorios por clonar:');
    say('          lo que no se pudo verificar no se reporta como limpio)');
  }
  say('');
  say('  Abrí la sesión de IA desde esta raíz. Empezá por docs/onboarding.md.');
  say('');
}

main().catch((err) => {
  process.stderr.write(`\n  La instalación falló: ${err && err.message}\n\n`);
  process.exit(1);
});
