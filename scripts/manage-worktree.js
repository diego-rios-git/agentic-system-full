#!/usr/bin/env node
/**
 * manage-worktree.js
 *
 * Gestiona slots aislados de trabajo. Un slot es un worktree de git donde se
 * puede implementar o revisar una rama **sin mover la rama del repositorio
 * principal**.
 *
 * Por qué existe: revisar un PR haciendo `checkout` en el repositorio donde
 * alguien está trabajando le rompe el trabajo, y la alternativa habitual
 * —clonar de nuevo— duplica dependencias y configuración. Un worktree comparte
 * el historial y cuesta segundos.
 *
 * Está en Node y no en un script de shell a propósito: los slots hacen falta en
 * Windows, macOS y Linux, y mantener dos versiones de lo mismo garantiza que
 * una de las dos quede vieja.
 *
 * Uso:
 *   node scripts/manage-worktree.js status
 *   node scripts/manage-worktree.js open --slot review --repo mi-api --branch feat/x
 *   node scripts/manage-worktree.js clean --slot review
 *   node scripts/manage-worktree.js clean --slot review --repo mi-api
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');

const ROOT = config.ROOT;
const say = (msg = '') => process.stdout.write(`${msg}\n`);

function git(cwd, args, allowFail = false) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} falló: ${(err.stderr || err.message).trim()}`);
  }
}

function slotPath(cfg, slot, repo) {
  return path.join(ROOT, cfg.worktrees.dir, slot, repo.name);
}

// ---------------------------------------------------------------------------
// Preparación del slot
// ---------------------------------------------------------------------------

/**
 * Un worktree recién abierto tiene el código y **nada más**: las dependencias
 * no están, porque git no las versiona. Sin prepararlo, el slot compila en el
 * repositorio principal y no en el slot, y quien lo abrió pierde el rato
 * averiguando por qué.
 *
 * Qué significa "preparar" depende del stack y por eso lo declara el pack, en
 * su `manifest.json`, bajo `worktree.prepare`:
 *
 *   "worktree": {
 *     "prepare": [
 *       { "strategy": "link", "paths": ["node_modules"] },
 *       { "strategy": "command", "run": ["dotnet", "restore"] }
 *     ]
 *   }
 *
 *   link     enlaza un directorio del repositorio principal dentro del slot.
 *            Para lo que pesa mucho y no cambia entre ramas.
 *   command  ejecuta un comando dentro del slot, con sus argumentos ya
 *            separados: nunca pasa por un shell, así que una ruta con espacios
 *            o una barra invertida de Windows no lo rompen.
 *
 * Sin packs que declaren nada, no se prepara nada y se dice — que es lo
 * correcto para un proyecto cuyo stack no necesita ningún paso previo.
 */
function preparationsFor(cfg, repo) {
  const assets = require('./lib/asset-roots');
  const steps = [];

  for (const root of assets.roots(cfg)) {
    const applies =
      root.kind === 'core' ||
      root.kind === 'local' ||
      repo.packs.includes(root.id) ||
      (cfg.raw.packs || []).includes(root.id);
    if (!applies) continue;

    const manifest = assets.rawManifest(root);
    const declared = manifest && manifest.worktree && manifest.worktree.prepare;
    for (const step of declared || []) steps.push({ ...step, origin: root.id });
  }

  return steps;
}

/**
 * Deshace los enlaces antes de borrar el slot.
 *
 * **Sin esto se pierden datos.** Un enlace de directorio se borra siguiendo lo
 * que apunta: `git worktree remove` sobre un slot con `node_modules` enlazado
 * borra el `node_modules` **del repositorio principal**, no el enlace. Se
 * comprobó: cerrar el slot dejaba los dos repositorios sin dependencias, y el
 * mensaje decía "cerrado" con toda normalidad.
 *
 * Quitar primero el enlace deja al borrado sin nada que seguir.
 */
function unlinkPrepared(cfg, repo, dir) {
  for (const step of preparationsFor(cfg, repo)) {
    if (step.strategy !== 'link') continue;

    for (const rel of step.paths || []) {
      const target = path.join(dir, rel);

      let stat;
      try {
        stat = fs.lstatSync(target);
      } catch {
        continue; // no existe: nada que deshacer
      }
      // Solo se toca lo que es un enlace. Un directorio real dentro del slot es
      // contenido de quien lo abrió y no es asunto de este script.
      if (!stat.isSymbolicLink()) continue;

      try {
        fs.unlinkSync(target);
      } catch {
        // En Windows, un enlace de directorio a veces no acepta `unlink` y sí
        // `rmdir`; ninguno de los dos sigue el enlace.
        try {
          fs.rmdirSync(target);
        } catch (err) {
          say(`    aviso: no se pudo quitar el enlace ${rel} — ${err.message}`);
        }
      }
    }
  }
}

function prepare(cfg, repo, dir) {
  const steps = preparationsFor(cfg, repo);
  if (steps.length === 0) return;

  for (const step of steps) {
    if (step.strategy === 'link') {
      for (const rel of step.paths || []) {
        const from = path.join(repo.absPath, rel);
        const to = path.join(dir, rel);
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        try {
          // `junction` en Windows: un enlace de directorio normal exige
          // permisos de administrador ahí, y este script tiene que servir sin
          // pedirlos. En el resto de los sistemas se ignora el tipo.
          fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
          say(`    enlazado ${rel}`);
        } catch (err) {
          say(`    aviso: no se pudo enlazar ${rel} — ${err.message}`);
        }
      }
      continue;
    }

    if (step.strategy === 'command') {
      const [cmd, ...args] = step.run || [];
      if (!cmd) continue;
      say(`    ${[cmd, ...args].join(' ')} …`);
      const { spawnSync } = require('child_process');
      const run = spawnSync(cmd, args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 600000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      if (run.status !== 0) {
        // No se aborta: el slot ya está abierto y es utilizable. Se dice qué
        // falló para que quien lo abrió pueda terminar a mano.
        say(`    aviso: falló (código ${run.status}). El slot quedó abierto igual.`);
      }
      continue;
    }

    say(`    aviso: ${step.origin} declara una estrategia desconocida: ${step.strategy}`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function status(cfg) {
  say(`\n  Slots declarados: ${cfg.worktrees.slots.join(', ') || 'ninguno'}\n`);

  let abiertos = 0;

  for (const slot of cfg.worktrees.slots) {
    for (const repo of cfg.repos) {
      const dir = slotPath(cfg, slot, repo);
      if (!fs.existsSync(dir)) continue;

      abiertos++;
      const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], true) || '?';
      const dirty = git(dir, ['status', '--porcelain'], true);
      const estado = dirty ? `${dirty.split('\n').length} archivo(s) sin commitear` : 'limpio';

      say(`    ${slot}/${repo.name}`);
      say(`      rama:  ${branch}`);
      say(`      árbol: ${estado}`);
      say('');
    }
  }

  if (abiertos === 0) say('    No hay ningún slot abierto.\n');
}

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

function open(cfg, slot, repo, branch) {
  const dir = slotPath(cfg, slot, repo);

  if (fs.existsSync(dir)) {
    const actual = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], true);
    say(`\n  El slot ${slot}/${repo.name} ya está abierto en la rama "${actual}".`);
    say('  Cerralo antes de reutilizarlo:');
    say(`    node scripts/manage-worktree.js clean --slot ${slot} --repo ${repo.name}\n`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(repo.absPath, '.git'))) {
    throw new Error(`${repo.path} no es un repositorio git. ¿Está clonado?`);
  }

  say(`\n  Abriendo ${slot}/${repo.name} …`);

  git(repo.absPath, ['fetch', 'origin', '--quiet'], true);

  const localExists = git(repo.absPath, ['rev-parse', '--verify', '--quiet', branch], true);
  const remoteExists = git(
    repo.absPath,
    ['rev-parse', '--verify', '--quiet', `origin/${branch}`],
    true,
  );

  fs.mkdirSync(path.dirname(dir), { recursive: true });

  if (localExists) {
    // Una rama local ya existente no se puede tener en dos worktrees a la vez.
    // Se abre en modo desprendido: alcanza para revisar, y no le saca la rama
    // al repositorio principal, que es justamente lo que este script evita.
    git(repo.absPath, ['worktree', 'add', '--detach', dir, branch]);
    say(`    rama local "${branch}" — abierta en modo desprendido`);
  } else if (remoteExists) {
    git(repo.absPath, ['worktree', 'add', '-b', branch, dir, `origin/${branch}`]);
    say(`    creada desde origin/${branch}`);
  } else {
    // Se prefiere el remoto porque es lo que ve el resto del equipo, pero un
    // repositorio recién creado —o sin remoto configurado— solo tiene la rama
    // local, y ese caso es perfectamente válido.
    const base =
      git(repo.absPath, ['rev-parse', '--verify', '--quiet', `origin/${repo.baseBranch}`], true)
        ? `origin/${repo.baseBranch}`
        : git(repo.absPath, ['rev-parse', '--verify', '--quiet', repo.baseBranch], true)
          ? repo.baseBranch
          : null;

    if (!base) {
      throw new Error(
        `No existe la rama base "${repo.baseBranch}" en ${repo.path}, ni local ni en origin.\n` +
          `  Verificá \`repos[].baseBranch\` en ai-workspace.json.`,
      );
    }

    git(repo.absPath, ['worktree', 'add', '-b', branch, dir, base]);
    say(`    rama nueva desde ${base}`);
  }

  prepare(cfg, repo, dir);

  say(`\n  Listo: ${path.relative(ROOT, dir)}`);
  say('\n  El repositorio principal no se movió.');
  say('  Si el proyecto comparte servicios de infraestructura entre el workspace y');
  say('  los slots, no corras migraciones ni cargas de datos sin coordinarlo.\n');
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

function clean(cfg, slot, onlyRepo) {
  const targets = cfg.repos.filter((r) => !onlyRepo || r.name === onlyRepo.name);
  let cerrados = 0;

  for (const repo of targets) {
    const dir = slotPath(cfg, slot, repo);
    if (!fs.existsSync(dir)) continue;

    const dirty = git(dir, ['status', '--porcelain'], true);
    if (dirty) {
      // Nunca se fuerza. Un worktree con cambios sin commitear puede tener
      // trabajo de horas que nadie más tiene.
      say(`\n  ${slot}/${repo.name} tiene ${dirty.split('\n').length} archivo(s) sin commitear.`);
      say('  No se limpia. Commiteá o descartá esos cambios primero.\n');
      process.exit(1);
    }

    unlinkPrepared(cfg, repo, dir);

    git(repo.absPath, ['worktree', 'remove', dir]);
    say(`  cerrado: ${slot}/${repo.name}`);
    cerrados++;
  }

  // El directorio del slot queda si estaba vacío de worktrees.
  const slotDir = path.join(ROOT, cfg.worktrees.dir, slot);
  if (fs.existsSync(slotDir) && fs.readdirSync(slotDir).length === 0) {
    fs.rmdirSync(slotDir);
  }

  if (cerrados === 0) say(`\n  El slot "${slot}" no estaba abierto.\n`);
  else say('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const action = argv[0];

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

  if (!cfg.worktrees.enabled) {
    process.stderr.write(
      '\n  Los slots de worktree están desactivados en ai-workspace.json.\n' +
        '  Activalos con `"worktrees": { "enabled": true, "slots": [...] }`.\n\n',
    );
    process.exit(2);
  }

  const usage = () => {
    process.stderr.write(
      '\nUso:\n' +
        '  node scripts/manage-worktree.js status\n' +
        `  node scripts/manage-worktree.js open --slot <${cfg.worktrees.slots.join('|')}> --repo <${cfg.repos
          .map((r) => r.name)
          .join('|')}> --branch <rama>\n` +
        '  node scripts/manage-worktree.js clean --slot <slot> [--repo <repo>]\n\n',
    );
    process.exit(2);
  };

  const slot = arg('--slot');
  if (slot && !cfg.worktrees.slots.includes(slot)) {
    process.stderr.write(
      `\n  Slot desconocido: "${slot}". Declarados: ${cfg.worktrees.slots.join(', ')}\n\n`,
    );
    process.exit(2);
  }

  const repoName = arg('--repo');
  let repo = null;
  if (repoName) {
    try {
      repo = config.repo(cfg, repoName);
    } catch (err) {
      return config.reportAndExit(err);
    }
  }

  try {
    if (action === 'status') return status(cfg);
    if (action === 'open') {
      const branch = arg('--branch');
      if (!slot || !branch) return usage();

      // `--all` abre el slot en todos los repositorios declarados. Una tarea
      // que cruza el backend y el frontend necesita los dos en el mismo slot, y
      // abrirlos de a uno es donde se cuela el error de dejar uno en la rama
      // anterior — un slot a medio abrir se ve igual que uno completo.
      if (!repo && !argv.includes('--all')) return usage();

      const targets = repo ? [repo] : cfg.repos;
      let abiertos = 0;

      for (const target of targets) {
        // Con `--all`, un repositorio sin clonar no aborta el resto: se informa
        // y se sigue. Con `--repo` explícito sí es un error, porque quien lo
        // nombró espera ese.
        if (!fs.existsSync(path.join(target.absPath, '.git'))) {
          if (repo) throw new Error(`${target.path} no es un repositorio git. ¿Está clonado?`);
          say(`\n  ${target.name}: sin clonar, se omite.`);
          continue;
        }
        open(cfg, slot, target, branch);
        abiertos++;
      }

      if (abiertos === 0) {
        process.stderr.write('\n  No se abrió ningún slot: ningún repositorio está clonado.\n\n');
        process.exit(2);
      }
      return;
    }
    if (action === 'clean') {
      if (!slot) return usage();
      return clean(cfg, slot, repo);
    }
    return usage();
  } catch (err) {
    process.stderr.write(`\n  ${err.message}\n\n`);
    process.exit(1);
  }
}

main();
