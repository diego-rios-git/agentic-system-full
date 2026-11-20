#!/usr/bin/env node
/**
 * manage-worktree.js
 *
 * Gestiona los slots de trabajo: worktrees de git donde se implementa o se
 * revisa una rama SIN mover la rama del repositorio principal.
 *
 * Por qué existe el modelo (procedimiento completo: ai/core/procedures/worktree-slots.md):
 * la base de datos y los puertos son UNO solo por máquina. El código sí se puede
 * paralelizar; migrar, correr e2e, revisar el PR y abrirlo, no. Entonces el
 * trabajo vive en los slots y la rama pasa a la principal solo para esos pasos:
 *
 *   slot  → código, tests, migración GENERADA (no corrida), review → commit + push
 *   turn     pedir el turno de la principal; si está tomada, queda en cola
 *   promote  la principal pasa a la rama; el slot se libera (exige el turno)
 *   principal → migrar, e2e
 *   release  la principal vuelve a la rama base, actualizada, y suelta el turno
 *   (PR y merge no necesitan la principal)
 *
 * Uso:
 *   node scripts/manage-worktree.js status [--json]
 *   node scripts/manage-worktree.js open --slot <S> --repo <R>|--all --branch <B> [--base <X>] [--link-deps]
 *   node scripts/manage-worktree.js turn --slot <S> [--session <nombre>] [--leave]
 *   node scripts/manage-worktree.js promote --slot <S> [--repo <R>]
 *   node scripts/manage-worktree.js release [--repo <R>]
 *   node scripts/manage-worktree.js clean --slot <S> [--repo <R>]
 *   node scripts/manage-worktree.js clean --orphans
 *
 * Reglas que NO se simplifican (cada una nació de un incidente):
 *
 * - `open` de una rama NUEVA usa `--no-track`. Con `branch.autoSetupMerge` (el
 *   valor de fábrica), una rama creada desde `origin/<base>` heredaba como
 *   upstream la propia base, y el "Sync Changes" del editor —que publica contra
 *   el upstream, no contra el nombre de la rama— empujaba trabajo en curso a la
 *   rama base. Sin upstream el primer push falla y pregunta: del lado seguro.
 *   Tras crear, se VERIFICA que el upstream quedó vacío.
 *
 * - Un slot de implementación ocupado no se reutiliza (tiene una rama con
 *   trabajo). El slot `review` sí, con `checkout --detach` DENTRO del worktree y
 *   cuatro guardas previas: cada review de una rama nueva quedaba trabado
 *   porque se exigía `clean` (que requiere orden del operador) aunque no
 *   hubiera nada que perder. Reusar no borra nada, así que no hay borrado que
 *   pueda atravesar un enlace.
 *
 * - `clean` y `promote` borran un worktree por el MISMO y único camino
 *   (`removeSlotWorktree`): las guardas contra enlaces viven en un solo lugar.
 *   Orden de esas guardas: contar ejecutables del directorio de dependencias del
 *   principal → quitar el enlace → barrer enlaces ANIDADOS → recién ahí
 *   `git worktree remove` → comparar el conteo. Una build dejó un enlace anidado
 *   (dentro de un directorio de salida del bundler) y `git worktree remove` lo
 *   atravesó: el principal quedó sin dependencias, con el mensaje "cerrado".
 *   La comparación final va en un `finally`: el daño ocurre justo en el camino
 *   de fallo, y un guardián que solo corre cuando todo salió bien no guarda nada.
 *
 * - En Windows `git worktree remove` falla con "Permission denied" si algo tiene
 *   abierta la carpeta, pero para entonces git ya borró el contenido y ya
 *   desregistró el worktree: se verifica que git lo soltó y se borra el residuo,
 *   en vez de abortar y hacer parecer que se perdió trabajo.
 *
 * - `clean` de un directorio SIN `.git` no lee estado con `git -C`: sin `.git`,
 *   git sube al repositorio padre y reporta cambios que no son de ese
 *   directorio. Se mira `.git` primero.
 *
 * - `promote` cambia la rama de la principal con `git switch`, que en Windows
 *   puede fallar al escribir HEAD (otro proceso lo tiene abierto) DESPUÉS de
 *   haber llevado índice y archivos a la rama destino: la principal queda "sucia"
 *   con el contenido de otra rama. Si índice y archivos ya son los de la rama se
 *   reintenta solo `symbolic-ref` con pausas crecientes; si no coinciden, se
 *   frena sin adivinar.
 *
 * - `promote` y `release` verifican TODO antes de tocar nada, en todos los
 *   repositorios pedidos: un promote a medias deja un slot sin su rama y una
 *   principal sin la suya.
 *
 * - `promote` exige el turno, y lo toma recién DESPUÉS de verificar: un promote
 *   que falla una precondición no se queda con el turno. Cuando la principal se
 *   tomaba en el promote y se devolvía después del merge, cada ticket la tenía
 *   ~40 minutos, casi todos esperando una respuesta del operador, y los slots ya
 *   terminados esperaban detrás.
 *
 * Nada acá nombra un repositorio, una rama ni un gestor de dependencias: salen
 * de ai-workspace.json (`repos[]`, `worktrees`) y de los perfiles de
 * `scripts/lib/deps-profiles.js`.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = '.ai-worktree.json';

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stdout.write(`  AVISO: ${msg}\n`);

class Fail extends Error {
  constructor(message, code = 1) {
    super(message);
    this.exitCode = code;
  }
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function run(cwd, args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: r.error ? 127 : r.status,
    stdout: String(r.stdout || '').replace(/\s+$/, ''),
    stderr: String(r.stderr || '').trim() || (r.error ? r.error.message : ''),
  };
}

/** Salida de git; lanza si falla. */
function git(cwd, args) {
  const r = run(cwd, args);
  if (r.status !== 0) throw new Fail(`git ${args.join(' ')} falló: ${r.stderr}`);
  return r.stdout;
}

/** Salida de git, o `null` si falla. */
function gitTry(cwd, args) {
  const r = run(cwd, args);
  return r.status === 0 ? r.stdout : null;
}

const refExists = (cwd, ref) => run(cwd, ['show-ref', '--verify', '--quiet', ref]).status === 0;

/** Rama del worktree, o `null` si el HEAD está desprendido. */
function branchOf(dir) {
  const r = run(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return r.status === 0 && r.stdout ? r.stdout : null;
}

/**
 * Upstream de una rama. Se lee con `for-each-ref` y no con `rev-parse @{u}`:
 * este último escribe un error cuando no hay upstream, y devolver vacío es lo
 * que el llamador necesita.
 */
function upstreamOf(dir, branch) {
  return gitTry(dir, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]) || '';
}

const same = (a, b) => {
  const norm = (p) => path.resolve(p).split('\\').join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * ¿`dir` es la raíz de un worktree/repositorio de git? No alcanza con que
 * `git -C dir` responda: si `dir` no tiene `.git`, git sube al repositorio padre
 * y contesta igual. Se mira que `.git` exista y que el toplevel sea `dir`.
 */
function isWorktreeRoot(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  const top = gitTry(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return false;
  try {
    return same(fs.realpathSync(top), fs.realpathSync(dir));
  } catch {
    return same(top, dir);
  }
}

function isRegistered(repo, dir) {
  const list = gitTry(repo.absPath, ['worktree', 'list', '--porcelain']);
  if (!list) return false;
  return list
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .some((l) => same(l.slice('worktree '.length), dir));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadModules() {
  const config = require('./lib/workspace-config');
  return {
    config,
    paths: require('./lib/worktree-paths'),
    profiles: require('./lib/deps-profiles'),
    link: require('./lib/deps-link'),
  };
}

function hasGit(repo) {
  return fs.existsSync(path.join(repo.absPath, '.git'));
}

// ---------------------------------------------------------------------------
// Estado de un worktree
// ---------------------------------------------------------------------------

/**
 * Líneas de `git status --porcelain`, sin el enlace de dependencias del propio
 * slot: si el `.gitignore` del proyecto no lo cubre (`node_modules/` con barra
 * final no ignora un enlace en Unix), el enlace aparecería como "cambio sin
 * commitear" y ningún slot con dependencias enlazadas se podría cerrar.
 */
function dirtyLines(ctx, repo, dir) {
  const r = run(dir, ['status', '--porcelain']);
  if (r.status !== 0) throw new Fail(`No se pudo leer el estado de ${dir}: ${r.stderr}`);
  const profile = ctx.profiles.profileFor(ctx.cfg, repo);
  const rels = ctx.link.linkedPaths(ctx.cfg, repo, profile);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).replace(/^"|"$/g, '').replace(/\/+$/, '');
      return !(rels.includes(file) && ctx.link.isLink(path.join(dir, file)));
    });
}

// ---------------------------------------------------------------------------
// Manifiesto del slot
// ---------------------------------------------------------------------------

function manifestPath(ctx, slot) {
  return path.join(ctx.paths.slotRoot(ctx.cfg, slot), MANIFEST_NAME);
}

/**
 * Deja el manifiesto del slot (`.ai-worktree.json`: slot, kind, createdAt,
 * repos) al día con lo que hay en disco; si el slot quedó vacío lo borra, y
 * borra la carpeta del slot si ya no queda nada.
 */
function syncManifest(ctx, slot) {
  const root = ctx.paths.slotRoot(ctx.cfg, slot);
  if (!fs.existsSync(root)) return;
  const repos = ctx.cfg.repos.filter((r) => fs.existsSync(path.join(root, r.name))).map((r) => r.name);
  const file = manifestPath(ctx, slot);

  if (repos.length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    return;
  }

  let createdAt = new Date().toISOString();
  try {
    createdAt = JSON.parse(fs.readFileSync(file, 'utf8')).createdAt || createdAt;
  } catch {
    /* manifiesto nuevo */
  }
  fs.writeFileSync(
    file,
    `${JSON.stringify({ slot, kind: ctx.paths.slotKind(ctx.cfg, slot), createdAt, repos }, null, 2)}\n`,
  );
}

// ---------------------------------------------------------------------------
// Preparación al abrir
// ---------------------------------------------------------------------------

/**
 * Un worktree recién abierto tiene el código y NADA más: las dependencias no
 * están porque git no las versiona. Qué significa "preparar" lo declara el pack
 * (`worktree.prepare` de su manifest.json) y el perfil de dependencias del
 * repositorio decide el directorio que se comparte:
 *
 *   link     enlaza un directorio del principal dentro del slot
 *   command  corre un comando dentro del slot (argumentos separados, sin shell
 *            propio: una ruta con espacios o una barra de Windows no lo rompen)
 *
 * Con `--link-deps` también se enlaza el directorio del perfil si ningún paso
 * `link` lo cubría. Siempre con la guarda de lockfile.
 */
function prepare(ctx, repo, dir, ref, linkDeps) {
  const { link } = ctx;
  const profile = ctx.profiles.profileFor(ctx.cfg, repo);
  const steps = link.preparationsFor(ctx.cfg, repo);
  const covered = new Set();

  const report = (rel, res) => {
    if (res.status === 'linked') say(`    enlazado ${rel}`);
    else if (res.status === 'skipped') warn(`${repo.name}: ${res.reason}`);
  };

  for (const step of steps) {
    if (step.strategy === 'link') {
      for (const rel of step.paths || []) {
        covered.add(rel);
        report(rel, link.linkDir(repo.absPath, dir, rel, { profile, ref }));
      }
    } else if (step.strategy === 'command') {
      const [cmd, ...args] = step.run || [];
      if (!cmd) continue;
      say(`    ${[cmd, ...args].join(' ')} …`);
      const r = spawnSync(cmd, args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 600000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      // No se aborta: el slot ya está abierto y sirve. Se dice qué falló.
      if (r.status !== 0) warn(`${cmd} falló (código ${r.status}). El slot quedó abierto igual.`);
    } else {
      warn(`${step.origin} declara una estrategia de preparación desconocida: ${step.strategy}`);
    }
  }

  if (linkDeps) {
    if (!profile) {
      warn(`${repo.name} no declara un perfil de dependencias (repos[].deps): no hay nada que enlazar.`);
    } else if (!covered.has(profile.dir)) {
      report(profile.dir, link.linkDir(repo.absPath, dir, profile.dir, { profile, ref }));
    }
  }
}

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

function baseRefOf(repo, base) {
  if (refExists(repo.absPath, `refs/remotes/origin/${base}`)) return `origin/${base}`;
  if (refExists(repo.absPath, `refs/heads/${base}`)) return base;
  throw new Fail(
    `No existe la rama base "${base}" en ${repo.path}, ni local ni en origin.\n` +
      '  Verificá `repos[].baseBranch` en ai-workspace.json o pasá --base.',
  );
}

/**
 * Reutiliza el slot review para otra rama: `checkout --detach` dentro del
 * worktree. Solo si no hay nada que perder; cada guarda corta ANTES de mover.
 */
function switchReview(ctx, repo, dir, targetRef, linkDeps) {
  const { link } = ctx;

  // 1. Es un worktree de git y está desprendido.
  if (!isWorktreeRoot(dir)) {
    throw new Fail(`${dir} existe pero no es un worktree de git. No se reutiliza: revisalo a mano.`);
  }
  const current = branchOf(dir);
  if (current) {
    throw new Fail(`${dir} tiene la rama "${current}" checkouteada. El slot review es desprendido: no se mueve una rama desde acá.`);
  }

  // 2. Sin cambios ni archivos sin trackear.
  const dirty = dirtyLines(ctx, repo, dir);
  if (dirty.length > 0) {
    throw new Fail(`${dir} tiene cambios sin commit o archivos sin trackear (${dirty.length}). No se reutiliza: se perderían.`);
  }

  // 3. Su HEAD está contenido en alguna rama: si no, mover el HEAD deja commits
  //    huérfanos (recuperables solo por reflog).
  const head = git(dir, ['rev-parse', 'HEAD']);
  const holders = gitTry(dir, ['for-each-ref', '--contains', head, '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  if (!holders) {
    throw new Fail(`El HEAD de ${dir} (${head.slice(0, 10)}) no está en ninguna rama. No se reutiliza: sus commits quedarían huérfanos.`);
  }

  // 4. Con dependencias enlazadas, las del principal tienen que servirle a la rama nueva.
  const profile = ctx.profiles.profileFor(ctx.cfg, repo);
  if (profile && link.isLink(path.join(dir, profile.dir))) {
    const differs = link.lockfileDiffers(repo.absPath, targetRef, profile.lockfile);
    if (differs !== false) {
      throw new Fail(
        `${profile.lockfile} de "${targetRef}" ${differs ? 'no coincide con el del principal' : 'no se pudo comparar'}: ` +
          `con ${profile.dir} enlazado no se puede mover el slot. Queda donde estaba.`,
      );
    }
  }

  git(dir, ['checkout', '--quiet', '--detach', targetRef]);
  say(`    review reutilizado: ahora en ${targetRef}`);
  prepare(ctx, repo, dir, targetRef, linkDeps);
}

function openOne(ctx, slot, repo, args) {
  const { cfg, paths } = ctx;
  const kind = paths.slotKind(cfg, slot);
  const dir = paths.slotRepoDir(cfg, slot, repo);
  const branch = args.branch;
  const base = args.base || repo.baseBranch;
  const exists = ctx.link.exists(dir);

  if (exists && kind !== 'review') {
    const actual = isWorktreeRoot(dir) ? branchOf(dir) || 'desprendido' : '?';
    throw new Fail(
      `El slot ${slot}/${repo.name} ya está ocupado (rama: ${actual}). Los slots de implementación no se reutilizan:\n` +
        `  usá otro slot, \`promote\` para llevar su rama a la principal, o \`clean\` por orden explícita del operador.`,
    );
  }

  say(`\n  Abriendo ${slot}/${repo.name} …`);
  run(repo.absPath, ['fetch', 'origin', '--quiet']);

  if (kind === 'review') {
    run(repo.absPath, ['fetch', 'origin', branch, '--quiet']);
    let targetRef;
    if (refExists(repo.absPath, `refs/remotes/origin/${branch}`)) targetRef = `origin/${branch}`;
    else if (refExists(repo.absPath, `refs/heads/${branch}`)) targetRef = branch;
    else throw new Fail(`No existe la rama "${branch}" en ${repo.path}, ni local ni en origin.`);

    if (exists) return switchReview(ctx, repo, dir, targetRef, args.linkDeps);

    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(repo.absPath, ['worktree', 'add', '--detach', dir, targetRef]);
    say(`    desprendido en ${targetRef}`);
    prepare(ctx, repo, dir, targetRef, args.linkDeps);
    return undefined;
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  let ref;
  if (refExists(repo.absPath, `refs/heads/${branch}`)) {
    const r = run(repo.absPath, ['worktree', 'add', dir, branch]);
    if (r.status !== 0) {
      throw new Fail(
        `No se pudo abrir la rama local "${branch}": ${r.stderr}\n` +
          '  Si está checkouteada en la principal o en otro slot, git no la deja en dos lugares: ' +
          '`promote`/`release` la mueven, nunca un checkout a mano.',
      );
    }
    ref = branch;
    say(`    rama local "${branch}"`);
  } else if (refExists(repo.absPath, `refs/remotes/origin/${branch}`)) {
    git(repo.absPath, ['worktree', 'add', '--track', '-b', branch, dir, `origin/${branch}`]);
    ref = `origin/${branch}`;
    say(`    desde origin/${branch}, siguiéndola`);
  } else {
    ref = baseRefOf(repo, base);
    git(repo.absPath, ['worktree', 'add', '--no-track', '-b', branch, dir, ref]);
    say(`    rama nueva desde ${ref}, sin upstream`);
    // Se VERIFICA: un valor de fábrica o una config global de git podrían
    // haberle puesto upstream igual, y de ahí sale el push a la base.
    let up = upstreamOf(repo.absPath, branch);
    if (up) {
      run(repo.absPath, ['branch', '--unset-upstream', branch]);
      up = upstreamOf(repo.absPath, branch);
    }
    if (up) throw new Fail(`La rama nueva "${branch}" quedó con upstream "${up}" y no se pudo quitar. Quitalo con: git -C ${repo.path} branch --unset-upstream ${branch}`);
  }

  prepare(ctx, repo, dir, ref, args.linkDeps);
  return undefined;
}

// ---------------------------------------------------------------------------
// Avisos tras mover la principal
// ---------------------------------------------------------------------------

/**
 * Lo que la principal tiene que hacer después de cambiar de rama y que este
 * script NO hace solo: reinstalar dependencias y migrar son decisiones del
 * operador. Solo avisa.
 */
function principalNotices(ctx, repo, range) {
  const profile = ctx.profiles.profileFor(ctx.cfg, repo);
  if (profile && profile.lockfile) {
    const r = run(repo.absPath, ['diff', '--quiet', range, '--', profile.lockfile]);
    if (r.status === 1) {
      warn(
        `${repo.name}: ${profile.lockfile} cambió en "${range}". Reinstalá en la PRINCIPAL antes de los checks` +
          `${profile.repair ? ` (${profile.repair})` : ''}.`,
      );
    }
  }
  const dir = repo.database && repo.database.migrationsDir;
  if (dir) {
    const out = gitTry(repo.absPath, ['diff', '--name-only', '--diff-filter=A', range, '--', dir]);
    const n = out ? out.split(/\r?\n/).filter(Boolean).length : 0;
    if (n > 0) warn(`${repo.name}: ${n} migración(es) nueva(s) en "${range}". Correrlas en la principal, y solo por orden del operador.`);
  }
}

// ---------------------------------------------------------------------------
// Cambio de rama de la principal
// ---------------------------------------------------------------------------

function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `git switch` con recuperación del fallo al escribir HEAD. `io` existe para
 * probar la lógica sin tener que bloquear `.git/HEAD` de verdad.
 *
 * @param {string} dir
 * @param {string} branch
 * @param {{run?: Function, sleep?: Function, pauseMs?: number}} [io]
 */
function switchPrincipalBranch(dir, branch, io = {}) {
  const exec = io.run || ((args) => run(dir, args));
  const sleep = io.sleep || sleepMs;
  const pause = io.pauseMs === undefined ? 500 : io.pauseMs;

  const first = exec(['switch', '--quiet', branch]);
  if (first.status === 0) return { recovered: false };

  const exists = exec(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
  const indexSame = exec(['diff', '--cached', '--quiet', branch]).status === 0;
  const filesSame = exec(['diff', '--quiet']).status === 0;
  if (!exists || !indexSame) {
    throw new Fail(
      `git switch a "${branch}" falló en ${dir} y el índice no coincide con la rama (${first.stderr}). ` +
        'No se adivina: revisalo a mano (git status) antes de seguir.',
    );
  }
  if (!filesSame) {
    throw new Fail(`git switch a "${branch}" falló en ${dir} y hay archivos distintos del índice. Revisalo a mano (git status).`);
  }

  for (let i = 1; i <= 5; i++) {
    sleep(pause * i);
    if (exec(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]).status === 0) {
      warn(`${dir}: git switch falló al escribir HEAD (archivo bloqueado). Índice y archivos ya eran los de "${branch}"; HEAD se apuntó en el intento ${i}.`);
      return { recovered: true, attempt: i };
    }
  }
  throw new Fail(
    `No se pudo escribir HEAD de ${dir}. Índice y archivos ya son los de "${branch}": cerrá lo que tenga abierto .git/HEAD y corré ` +
      `git -C "${dir}" symbolic-ref HEAD refs/heads/${branch}`,
  );
}

// ---------------------------------------------------------------------------
// Borrado de un slot: el ÚNICO camino
// ---------------------------------------------------------------------------

/**
 * Libera `<slot>/<repo>`. Lo usan `clean` y `promote`. Devuelve `true` si
 * quitó algo, `false` si no había nada.
 */
function removeSlotWorktree(ctx, slot, repo) {
  const { cfg, paths, link } = ctx;
  const dir = paths.slotRepoDir(cfg, slot, repo);
  if (!link.exists(dir)) return false;

  // Sin `.git`: no se lee estado con git (subiría al repo padre). Vacío → se
  // borra; con archivos → se nombran y se rechaza.
  if (!fs.existsSync(path.join(dir, '.git'))) {
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) {
      fs.rmdirSync(dir);
      say(`  quitado el directorio vacío ${slot}/${repo.name} (no era un worktree)`);
      return true;
    }
    throw new Fail(
      `${slot}/${repo.name} no es un worktree (no tiene .git) y contiene archivos: ${entries.slice(0, 10).join(', ')}` +
        `${entries.length > 10 ? ` (+${entries.length - 10})` : ''}. No se borra: revisalo a mano.`,
    );
  }

  if (!isWorktreeRoot(dir) || !isRegistered(repo, dir)) {
    throw new Fail(`${slot}/${repo.name} tiene .git pero no es un worktree registrado de ${repo.name}. No se borra: revisalo a mano.`);
  }

  // Nunca se fuerza: cambios sin commit pueden ser horas de trabajo que nadie más tiene.
  const dirty = dirtyLines(ctx, repo, dir);
  if (dirty.length > 0) {
    throw new Fail(`${slot}/${repo.name} tiene ${dirty.length} archivo(s) sin commitear. No se limpia: commiteá o descartá esos cambios primero.`);
  }

  const profile = ctx.profiles.profileFor(cfg, repo);
  // Cuántos ejecutables tiene el principal ANTES de tocar nada: si al terminar
  // tiene menos, algo atravesó un enlace, y hay que decirlo ahora.
  const before = link.healthCount(repo.absPath, profile);

  try {
    for (const rel of link.linkedPaths(cfg, repo, profile)) link.removeLink(path.join(dir, rel));

    const { removed, survivors } = link.sweepLinks(dir);
    for (const l of removed) say(`    enlace anidado quitado: ${path.relative(dir, l)}`);
    if (survivors.length > 0) {
      throw new Fail(
        `Queda un enlace sin remover en ${survivors[0]}. No se borra nada por encima: un borrado recursivo lo ` +
          'atravesaría y vaciaría su destino. Quitalo a mano (rmdir/unlink, nunca un borrado recursivo).',
      );
    }

    const r = run(repo.absPath, ['worktree', 'remove', dir]);
    if (r.status !== 0) {
      // Bloqueo del sistema: git ya pudo haber soltado el worktree. Se verifica
      // antes de borrar nada a mano.
      run(repo.absPath, ['worktree', 'prune']);
      if (isRegistered(repo, dir)) {
        throw new Fail(
          `No se pudo eliminar el worktree ${slot}/${repo.name} y git lo sigue registrando: ${r.stderr}\n` +
            '  Cerrá lo que lo tenga abierto y reintentá. Git pudo borrar parte del contenido antes de fallar; ' +
            'no había trabajo sin commitear (se verificó al entrar).',
        );
      }
      if (link.exists(dir)) {
        const again = link.sweepLinks(dir);
        if (again.survivors.length > 0) throw new Fail(`Quedó un enlace sin remover en ${again.survivors[0]}: no se borra el residuo.`);
        fs.rmSync(dir, { recursive: true, force: true });
        if (link.exists(dir)) warn(`${slot}/${repo.name}: git lo desregistró pero la carpeta no se pudo borrar. Es residuo, no trabajo; borrala cuando se libere.`);
        else say(`  ${slot}/${repo.name}: git lo desregistró y la carpeta residual se borró (git no pudo por un bloqueo del sistema).`);
      }
    }
    say(`  cerrado: ${slot}/${repo.name}`);
    return true;
  } finally {
    const after = link.healthCount(repo.absPath, profile);
    if (before !== null && after !== null && after < before) {
      process.exitCode = 1;
      process.stderr.write(
        `\n  ATENCIÓN: ${profile.dir} de ${repo.name} perdió ejecutables durante la limpieza: ${before} -> ${after}.\n` +
          '  Algo atravesó un enlace. NO sigas trabajando sobre ese repo: repará primero.\n' +
          `    node scripts/check-deps.js --repo ${repo.name} --fix\n` +
          '  Detalle: ai/core/procedures/shared-dependencies.md\n\n',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Turno de la principal
// ---------------------------------------------------------------------------

/*
 * La principal es una sola (base de datos, puertos, servicios) y la usan de a
 * un ticket por vez solo los pasos que la necesitan: migrar y probar de punta a
 * punta. El turno dice quién la tiene y qué slots esperan, en orden de llegada.
 * Vive en `<worktrees.dir>/.turno/turno.json`, local de esta máquina como los
 * slots. Procedimiento: ai/core/procedures/worktree-slots.md, "El turno de la
 * principal".
 *
 * Varias sesiones leen y escriben el archivo a la vez, así que cada lectura y
 * escritura va bajo un lock: un archivo creado en exclusiva (`wx`) con el pid
 * de quien lo tiene. Si ese proceso ya no existe, el lock quedó abandonado y se
 * toma igual; esperar a que alguien lo borre a mano trabaría a todos.
 */

const TURN_WAIT = 3;
const TURN_DIR = '.turno';

function turnPaths(ctx) {
  const dir = path.join(ctx.cfg.root, ctx.cfg.worktrees.dir, TURN_DIR);
  return { dir, file: path.join(dir, 'turno.json'), lock: path.join(dir, 'turno.lock') };
}

function lockIsStale(lock) {
  let content;
  let mtime;
  try {
    content = fs.readFileSync(lock, 'utf8').trim();
    mtime = fs.statSync(lock).mtimeMs;
  } catch {
    return false;
  }
  // Vacío: el dueño lo creó y todavía no escribió el pid, o murió en ese medio.
  if (!content) return Date.now() - mtime > 30000;
  try {
    process.kill(Number(content), 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

function withTurnLock(ctx, body) {
  const p = turnPaths(ctx);
  fs.mkdirSync(p.dir, { recursive: true });
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const fd = fs.openSync(p.lock, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (lockIsStale(p.lock)) {
        try {
          fs.unlinkSync(p.lock);
        } catch {
          /* otro lo borró primero */
        }
        continue;
      }
      if (Date.now() > deadline) throw new Fail('No se pudo tomar el lock del turno en 15 s: otra sesión lo está usando. Reintentar.');
      sleepMs(100);
    }
  }
  try {
    return body(p);
  } finally {
    try {
      fs.unlinkSync(p.lock);
    } catch {
      /* nada */
    }
  }
}

function readTurn(ctx) {
  const { file } = turnPaths(ctx);
  if (!fs.existsSync(file)) return { holder: null, queue: [] };
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { holder: raw.holder || null, queue: Array.isArray(raw.queue) ? raw.queue.filter(Boolean) : [] };
}

function writeTurn(ctx, state) {
  const { dir, file } = turnPaths(ctx);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ holder: state.holder, queue: state.queue }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEntry(e) {
  return `${e.slot} (desde ${e.since}${e.session ? `, sesión ${e.session}` : ''})`;
}

/** El turno cubre la principal entera: la prueba de punta a punta levanta todos los repos. */
function principalOnBase(ctx) {
  return ctx.cfg.repos
    .filter((r) => hasGit(r))
    .every((r) => branchOf(r.absPath) === r.baseBranch && dirtyLines(ctx, r, r.absPath).length === 0);
}

/**
 * `turn`: pide el turno para un slot. Sale 0 si el turno es del slot y 3 si
 * queda esperando. La sesión que espera NO repite el pedido en un loop: termina
 * y la despierta la sesión que haga `release` (ver TURNO-AVISAR).
 */
function cmdTurn(ctx, args) {
  const slot = needSlot(ctx, args);
  if (ctx.paths.slotKind(ctx.cfg, slot) !== 'implementation') {
    throw new Fail(`turn vale solo para un slot de implementación: "${slot}" es de revisión.`, 2);
  }

  return withTurnLock(ctx, () => {
    const state = readTurn(ctx);

    if (args.leave) {
      state.queue = state.queue.filter((e) => e.slot !== slot);
      if (state.holder && state.holder.slot === slot) {
        state.holder = null;
        say(`TURNO: ${slot} devolvió el turno sin release. Verificar que la principal quedó en la base y limpia.`);
      } else {
        say(`TURNO: ${slot} salió de la cola.`);
      }
      writeTurn(ctx, state);
      return 0;
    }

    if (state.holder && state.holder.slot === slot) {
      say(`TURNO: es de ${slot} (lo tiene desde ${state.holder.since}).`);
      return 0;
    }

    const now = nowStamp();
    const mine = state.queue.find((e) => e.slot === slot);
    if (!mine) state.queue.push({ slot, since: now, session: args.session || null });
    else if (args.session) mine.session = args.session;

    const free = principalOnBase(ctx);
    if (!state.holder && free && state.queue[0].slot === slot) {
      state.holder = { slot, since: now, session: args.session || (mine && mine.session) || null };
      state.queue = state.queue.filter((e) => e.slot !== slot);
      writeTurn(ctx, state);
      say(`TURNO: es de ${slot}. Seguir con promote.`);
      return 0;
    }

    writeTurn(ctx, state);
    const position = state.queue.findIndex((e) => e.slot === slot) + 1;
    let reason;
    if (state.holder) reason = `lo tiene ${formatEntry(state.holder)}`;
    else if (!free) reason = 'nadie lo tiene, pero la principal no está en la base y limpia: alguien la movió sin turno, o un ticket grande vive ahí. Revisarla';
    else reason = `antes está ${formatEntry(state.queue[0])}`;
    say(`TURNO: ${slot} espera, puesto ${position} de ${state.queue.length}; ${reason}.`);
    return TURN_WAIT;
  });
}

/** `promote` sin turno pisaría al ticket que está en la principal o se colaría en la cola. */
function grantTurnForPromote(ctx, slot) {
  withTurnLock(ctx, () => {
    const state = readTurn(ctx);
    if (state.holder) {
      if (state.holder.slot === slot) return;
      throw new Fail(`La principal es de ${formatEntry(state.holder)}. Pedí turno con \`turn --slot ${slot}\`.`);
    }
    const first = state.queue[0];
    if (first && first.slot !== slot) {
      throw new Fail(`Hay cola para la principal y el siguiente es ${formatEntry(first)}. Pedí turno con \`turn --slot ${slot}\`.`);
    }
    const mine = state.queue.find((e) => e.slot === slot);
    state.holder = { slot, since: nowStamp(), session: (mine && mine.session) || null };
    state.queue = state.queue.filter((e) => e.slot !== slot);
    writeTurn(ctx, state);
  });
}

/**
 * La llama `release` con la principal entera en la base. Es también la salida
 * para un turno colgado de una sesión que murió: si la principal ya está en la
 * base, `release` no cambia nada en git y solo libera el turno.
 */
function clearTurnHolder(ctx) {
  withTurnLock(ctx, () => {
    const state = readTurn(ctx);
    if (state.holder) {
      say(`TURNO: ${state.holder.slot} devolvió la principal.`);
      state.holder = null;
      writeTurn(ctx, state);
    }
    const next = state.queue[0];
    if (next) {
      say(`TURNO: sigue ${formatEntry(next)}; su sesión lo toma con \`turn\`.`);
      say(`TURNO-AVISAR: ${next.session || '(sin sesión)'} ${next.slot}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

function selectRepos(ctx, args, { requireClone = true } = {}) {
  const { cfg } = ctx;
  if (args.repo) {
    const repo = cfg.repos.find((r) => r.name === args.repo);
    if (!repo) throw new Fail(`El repositorio "${args.repo}" no está declarado. Declarados: ${cfg.repos.map((r) => r.name).join(', ')}`, 2);
    if (requireClone && !hasGit(repo)) throw new Fail(`${repo.path} no es un repositorio git. ¿Está clonado?`, 2);
    return [repo];
  }
  return cfg.repos.filter((r) => hasGit(r));
}

function needSlot(ctx, args) {
  if (!args.slot) throw new Fail('Falta --slot.', 2);
  const names = ctx.paths.slots(ctx.cfg).map((s) => s.name);
  if (!names.includes(args.slot)) throw new Fail(`Slot desconocido: "${args.slot}". Declarados: ${names.join(', ')}`, 2);
  return args.slot;
}

function cmdOpen(ctx, args) {
  const slot = needSlot(ctx, args);
  if (!args.branch) {
    const review = ctx.paths.slotKind(ctx.cfg, slot) === 'review';
    throw new Fail(
      review
        ? `El slot ${slot} es de revisión: hace falta --branch con la rama a revisar (la de otra persona, existente).`
        : 'Falta --branch.',
      2,
    );
  }
  if (!args.repo && !args.all) throw new Fail('Falta --repo <repo> o --all.', 2);

  let opened = 0;
  for (const repo of ctx.cfg.repos.filter((r) => args.all || r.name === args.repo)) {
    if (!hasGit(repo)) {
      if (args.repo) throw new Fail(`${repo.path} no es un repositorio git. ¿Está clonado?`, 2);
      say(`\n  ${repo.name}: sin clonar, se omite.`);
      continue;
    }
    openOne(ctx, slot, repo, args);
    opened++;
  }
  if (opened === 0) throw new Fail('No se abrió ningún slot: ningún repositorio está clonado.', 2);

  syncManifest(ctx, slot);
  say(`\n  Listo: ${ctx.paths.posix(path.relative(ctx.cfg.root, ctx.paths.slotRoot(ctx.cfg, slot)))}`);
  say('  La principal no se movió. La base de datos y los puertos son compartidos: no migres ni levantes servicios desde un slot.\n');
}

function cmdPromote(ctx, args) {
  const { cfg, paths } = ctx;
  const slot = needSlot(ctx, args);
  if (paths.slotKind(cfg, slot) !== 'implementation') {
    throw new Fail(`promote vale solo para un slot de implementación: "${slot}" es de revisión y está desprendido, no tiene rama que llevar.`, 2);
  }

  // Todo se verifica ANTES de tocar nada, en todos los repositorios pedidos.
  const plan = [];
  for (const repo of selectRepos(ctx, args)) {
    const dir = paths.slotRepoDir(cfg, slot, repo);
    if (!ctx.link.exists(dir)) continue;
    if (!isWorktreeRoot(dir)) throw new Fail(`${slot}/${repo.name} no es un worktree de git.`);
    const branch = branchOf(dir);
    if (!branch) throw new Fail(`${slot}/${repo.name} está desprendido: no hay rama que llevar a la principal.`);
    const dirty = dirtyLines(ctx, repo, dir);
    if (dirty.length > 0) throw new Fail(`${slot}/${repo.name} tiene ${dirty.length} archivo(s) sin commitear. Commiteá y pusheá en el slot antes de llevarlo a la principal.`);

    const base = args.base || repo.baseBranch;
    if (dirtyLines(ctx, repo, repo.absPath).length > 0) {
      throw new Fail(`La principal de ${repo.name} tiene cambios sin commitear: no está libre. No se toca nada.`);
    }
    const principalBranch = branchOf(repo.absPath);
    if (principalBranch !== base) {
      throw new Fail(`La principal de ${repo.name} está en "${principalBranch || 'HEAD desprendido'}", no en "${base}". Liberala primero con \`release\`.`);
    }
    if (!upstreamOf(dir, branch)) {
      warn(`${repo.name}: "${branch}" no tiene upstream. Pusheá con \`git push -u origin ${branch}\` antes del PR.`);
    }
    plan.push({ repo, dir, branch, base });
  }
  if (plan.length === 0) throw new Fail(`El slot "${slot}" no tiene abierto ninguno de los repositorios pedidos.`);

  // Después de verificar y antes de tocar.
  grantTurnForPromote(ctx, slot);

  for (const item of plan) {
    run(item.repo.absPath, ['fetch', 'origin', item.base, '--quiet']);
    // El slot se libera antes del switch: git no deja la misma rama en dos worktrees.
    removeSlotWorktree(ctx, slot, item.repo);
    switchPrincipalBranch(item.repo.absPath, item.branch);
    say(`  ${item.repo.name}: la principal está en "${item.branch}"; el slot quedó libre.`);
    const baseRef = refExists(item.repo.absPath, `refs/remotes/origin/${item.base}`) ? `origin/${item.base}` : item.base;
    principalNotices(ctx, item.repo, `${baseRef}...HEAD`);
  }
  syncManifest(ctx, slot);
}

function cmdRelease(ctx, args) {
  const plan = [];
  for (const repo of selectRepos(ctx, args)) {
    const base = args.base || repo.baseBranch;
    if (dirtyLines(ctx, repo, repo.absPath).length > 0) {
      throw new Fail(`La principal de ${repo.name} tiene cambios sin commitear. Commiteá y pusheá antes de liberarla.`);
    }
    const branch = branchOf(repo.absPath);
    if (!branch) throw new Fail(`La principal de ${repo.name} está desprendida. Revisala a mano: release no mueve un HEAD que no está en una rama.`);

    if (branch !== base) {
      const up = upstreamOf(repo.absPath, branch);
      if (!up) throw new Fail(`"${branch}" en ${repo.name} no tiene upstream: no está pusheada. Pusheá con \`git push -u origin ${branch}\`.`);
      if (up !== `origin/${branch}`) {
        throw new Fail(`El upstream de "${branch}" es "${up}", no "origin/${branch}". Corregilo antes de liberar la principal (el "Sync Changes" del editor publicaría ahí).`);
      }
      run(repo.absPath, ['fetch', 'origin', branch, '--quiet']);
      const ahead = Number(gitTry(repo.absPath, ['rev-list', '--count', `${up}..HEAD`]) || 0);
      if (ahead > 0) throw new Fail(`"${branch}" tiene ${ahead} commit(s) sin pushear en ${repo.name}. Pusheá antes de liberar la principal.`);
    }
    plan.push({ repo, branch, base });
  }
  if (plan.length === 0) throw new Fail('No hay ningún repositorio clonado para liberar.', 2);

  for (const item of plan) {
    const previous = git(item.repo.absPath, ['rev-parse', 'HEAD']);
    run(item.repo.absPath, ['fetch', 'origin', item.base, '--quiet']);
    if (item.branch !== item.base) switchPrincipalBranch(item.repo.absPath, item.base);
    if (refExists(item.repo.absPath, `refs/remotes/origin/${item.base}`)) {
      git(item.repo.absPath, ['merge', '--ff-only', '--quiet', `origin/${item.base}`]);
    } else {
      warn(`${item.repo.name}: no existe origin/${item.base}; no se actualizó la base.`);
    }
    say(`  ${item.repo.name}: la principal quedó libre en "${item.base}" (antes: "${item.branch}").`);
    principalNotices(ctx, item.repo, `${previous}..HEAD`);
  }

  // Con --repo, otro repo puede seguir en la rama del ticket: el turno se
  // devuelve solo cuando la principal entera está en la base.
  if (principalOnBase(ctx)) clearTurnHolder(ctx);
  else warn('Otro repositorio de la principal no está en su base y limpio: el turno sigue tomado. Liberalo con `release` sin --repo.');
}

function cmdClean(ctx, args) {
  const { cfg, paths } = ctx;
  if (args.orphans) return cleanOrphans(ctx);
  const slot = needSlot(ctx, args);

  let closed = 0;
  for (const repo of selectRepos(ctx, args, { requireClone: false })) {
    if (!hasGit(repo)) {
      // Sin el repo principal no se puede desregistrar nada: solo el caso vacío.
      const dir = paths.slotRepoDir(cfg, slot, repo);
      if (ctx.link.exists(dir) && fs.readdirSync(dir).length > 0) throw new Fail(`${repo.path} no está clonado y ${slot}/${repo.name} tiene archivos: revisalo a mano.`);
    }
    if (removeSlotWorktree(ctx, slot, repo)) closed++;
  }
  syncManifest(ctx, slot);
  if (closed === 0) say(`\n  El slot "${slot}" no estaba abierto.\n`);
  return undefined;
}

/**
 * `clean --orphans`: restos que `clean` no alcanza —registros de worktrees cuyo
 * directorio ya no existe, directorios vacíos que no son worktrees, manifiestos
 * de slots vacíos—. Lo que tiene contenido NO se borra: se nombra.
 */
function cleanOrphans(ctx) {
  const { cfg } = ctx;
  let blocked = 0;

  for (const repo of cfg.repos.filter((r) => hasGit(r))) {
    run(repo.absPath, ['worktree', 'prune']);
  }

  const base = path.join(cfg.root, cfg.worktrees.dir);
  if (!fs.existsSync(base)) {
    say('\n  No hay restos: no existe el directorio de slots.\n');
    return;
  }

  for (const slot of fs.readdirSync(base)) {
    if (slot === TURN_DIR) continue;
    const root = path.join(base, slot);
    if (!fs.statSync(root).isDirectory()) continue;
    for (const entry of fs.readdirSync(root)) {
      if (entry === MANIFEST_NAME) continue;
      const dir = path.join(root, entry);
      const repo = cfg.repos.find((r) => r.name === entry);
      if (!repo) {
        say(`  ${slot}/${entry}: no es un repositorio declarado; no se toca.`);
        continue;
      }
      if (!fs.existsSync(path.join(dir, '.git'))) {
        const files = fs.readdirSync(dir);
        if (files.length === 0) {
          fs.rmdirSync(dir);
          say(`  quitado el directorio vacío ${slot}/${entry}`);
        } else {
          blocked++;
          say(`  ${slot}/${entry}: no es un worktree (sin .git) y tiene archivos: ${files.slice(0, 10).join(', ')}. No se borra.`);
        }
      } else if (!isRegistered(repo, dir)) {
        blocked++;
        say(`  ${slot}/${entry}: tiene .git pero git no lo registra como worktree. No se borra: revisalo a mano.`);
      }
    }
    syncManifest(ctx, slot);
  }
  say('');
  if (blocked > 0) throw new Fail(`${blocked} resto(s) con contenido: nombrados arriba, no se borraron.`);
  return undefined;
}

function cmdStatus(ctx, args) {
  const { cfg, paths, link } = ctx;
  const out = { slots: [], principals: [], orphans: [], turn: readTurn(ctx) };

  for (const repo of cfg.repos) {
    if (!hasGit(repo)) {
      out.principals.push({ repo: repo.name, cloned: false });
      continue;
    }
    const branch = branchOf(repo.absPath);
    out.principals.push({
      repo: repo.name,
      cloned: true,
      branch: branch || 'detached',
      base: repo.baseBranch,
      free: branch === repo.baseBranch,
      dirty: dirtyLines(ctx, repo, repo.absPath).length,
    });
  }

  for (const def of paths.slots(cfg)) {
    for (const repo of cfg.repos) {
      const dir = paths.slotRepoDir(cfg, def.name, repo);
      if (!link.exists(dir)) continue;
      if (!isWorktreeRoot(dir)) {
        out.orphans.push({ slot: def.name, repo: repo.name, reason: 'sin .git (resto)' });
        continue;
      }
      const profile = ctx.profiles.profileFor(cfg, repo);
      const branch = branchOf(dir);
      out.slots.push({
        slot: def.name,
        kind: def.kind,
        repo: repo.name,
        branch: branch || `detached@${gitTry(dir, ['rev-parse', '--short', 'HEAD']) || '?'}`,
        detached: !branch,
        dirty: dirtyLines(ctx, repo, dir).length,
        depsLinked: profile ? link.isLink(path.join(dir, profile.dir)) : null,
      });
    }
  }

  if (args.json) return say(JSON.stringify(out, null, 2));

  say(`\n  Slots declarados: ${paths.slots(cfg).map((s) => `${s.name} (${s.kind})`).join(', ') || 'ninguno'}\n`);
  say('  Principal:');
  for (const p of out.principals) {
    if (!p.cloned) say(`    ${p.repo}: sin clonar`);
    else say(`    ${p.repo}: ${p.branch} · ${p.free ? 'libre' : `OCUPADA (la base es ${p.base})`} · ${p.dirty ? `${p.dirty} cambio(s)` : 'limpia'}`);
  }
  say('');
  if (out.slots.length === 0) say('  No hay ningún slot abierto.');
  for (const s of out.slots) {
    say(`  ${s.slot}/${s.repo}  [${s.kind}]`);
    say(`    rama:  ${s.branch}`);
    say(`    árbol: ${s.dirty ? `${s.dirty} archivo(s) sin commitear` : 'limpio'}`);
    if (s.depsLinked !== null) say(`    deps:  ${s.depsLinked ? 'enlazadas al principal' : 'propias o sin instalar'}`);
  }
  for (const o of out.orphans) say(`  ${o.slot}/${o.repo}: ${o.reason} — \`clean --orphans\``);
  say('');
  say(`  Turno de la principal: ${out.turn.holder ? formatEntry(out.turn.holder) : 'nadie'}`);
  out.turn.queue.forEach((e, i) => say(`    ${i + 1}. ${formatEntry(e)}`));
  say('');
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const VALUE_FLAGS = ['--slot', '--repo', '--branch', '--base', '--session'];
const BOOL_FLAGS = ['--all', '--link-deps', '--orphans', '--json', '--leave'];

function parseArgs(argv) {
  const args = { action: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') throw new Fail('No existe --force: un worktree con cambios sin commitear no se limpia a la fuerza.', 2);
    if (VALUE_FLAGS.includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Fail(`${a} requiere un valor.`, 2);
      args[a.slice(2)] = v;
      i++;
    } else if (BOOL_FLAGS.includes(a)) {
      args[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true;
    } else {
      throw new Fail(`Argumento desconocido: ${a}`, 2);
    }
  }
  return args;
}

const USAGE =
  '\nUso:\n' +
  '  node scripts/manage-worktree.js status [--json]\n' +
  '  node scripts/manage-worktree.js open --slot <slot> --repo <repo>|--all --branch <rama> [--base <rama>] [--link-deps]\n' +
  '  node scripts/manage-worktree.js turn --slot <slot> [--session <nombre>] [--leave]\n' +
  '  node scripts/manage-worktree.js promote --slot <slot> [--repo <repo>]\n' +
  '  node scripts/manage-worktree.js release [--repo <repo>]\n' +
  '  node scripts/manage-worktree.js clean --slot <slot> [--repo <repo>] | --orphans\n';

function main() {
  const mods = loadModules();
  let cfg;
  try {
    cfg = mods.config.load();
  } catch (err) {
    return mods.config.reportAndExit(err);
  }

  try {
    const args = parseArgs(process.argv.slice(2));
    if (!cfg.worktrees.enabled) {
      throw new Fail('Los slots están desactivados en ai-workspace.json. Activalos con `"worktrees": { "enabled": true, "slots": [...] }`.', 2);
    }
    const ctx = { cfg, ...mods };
    const actions = { status: cmdStatus, open: cmdOpen, turn: cmdTurn, promote: cmdPromote, release: cmdRelease, clean: cmdClean };
    if (!actions[args.action]) throw new Fail(`Acción desconocida: ${args.action || '(ninguna)'}\n${USAGE}`, 2);
    const code = actions[args.action](ctx, args);
    if (typeof code === 'number') process.exitCode = code;
  } catch (err) {
    if (err.isAssetError) {
      process.stderr.write(`\n  ${err.message}\n\n`);
      process.exit(2);
    }
    process.stderr.write(`\n  ${err.message}\n\n`);
    process.exit(err instanceof Fail ? err.exitCode : 1);
  }
}

if (require.main === module) main();

module.exports = { switchPrincipalBranch, Fail };
