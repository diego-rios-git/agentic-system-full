#!/usr/bin/env node
/**
 * check-deps.js — salud del directorio de dependencias compartido.
 *
 * Generaliza lo que en el sistema de origen era un chequeo de `node_modules`: el
 * directorio sale del perfil de dependencias del repositorio
 * (`scripts/lib/deps-profiles.js`) y la salud se lee de `profile.health`. Un
 * proyecto Python se verifica contra su `.venv`, uno PHP contra `vendor`, y un
 * repositorio sin perfil no se verifica (no comparte nada).
 *
 * ## Por qué existe
 *
 * El directorio de dependencias del repositorio principal se vació dos veces
 * por una operación que atravesó el enlace de un slot, y las dos veces se
 * descubrió horas después por un síntoma que no se parece a la causa
 * ("el comando no se reconoce", "no se encuentra el módulo X"). Lo que despista:
 * **el repositorio se ve sano**. El directorio existe y tiene las mismas
 * carpetas de siempre; lo que falta es el directorio de ejecutables y el
 * contenido de algunos paquetes, que es justo lo que nadie mira. Por eso NO se
 * cuentan carpetas de primer nivel (la cuenta no cambia cuando lo que se vació
 * es lo de adentro): se mira el CONTENIDO.
 *
 * ## Qué verifica (perfil `node-modules`; los otros, su equivalente)
 *
 *   1. `.bin` existe y tiene al menos `health.minBin` ejecutables.
 *   2. Cada dependencia declarada en el manifiesto —sin las opcionales, cuya
 *      ausencia es legítima (ej. un paquete que solo se instala en un sistema)—
 *      tiene su carpeta CON su manifiesto adentro.
 *   3. El directorio del principal NO es un enlace. Si lo fuera, el enlace está
 *      invertido: el principal quedó colgando de un slot.
 *
 * ## Uso
 *
 *     node scripts/check-deps.js [--repo <repo>] [--fix] [--json]
 *
 * `--fix` corre `profile.repair` en el repositorio. No repara un enlace
 * invertido (hay que quitarlo a mano) ni un reinstalador que "recrea enlaces
 * sin restaurar archivos": el comando de reparación del perfil es el que
 * reinstala de verdad.
 *
 * Salida: 0 sano · 1 roto · 2 no se pudo verificar (repo ausente, uso
 * incorrecto, perfil inválido).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const config = require('./lib/workspace-config');
const profiles = require('./lib/deps-profiles');
const link = require('./lib/deps-link');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function entries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Nombres declarados en un manifiesto de dependencias, sin las opcionales. */
function declaredNames(repoDir, health, kind) {
  if (kind === 'node-modules') {
    const pkg = readJson(path.join(repoDir, health.manifest || 'package.json'));
    if (!pkg) return [];
    const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].filter((n) => !optional.has(n));
  }
  if (kind === 'php-vendor') {
    const composer = readJson(path.join(repoDir, 'composer.json'));
    if (!composer) return [];
    // `php` y `ext-*` no son paquetes instalados en vendor.
    return [...Object.keys(composer.require || {}), ...Object.keys(composer['require-dev'] || {})].filter((n) => n.includes('/'));
  }
  return [];
}

function checkRepo(cfg, repo) {
  const result = { repo: repo.name, profile: null, dir: null, state: 'ok', problems: [], count: null, missing: [] };

  if (!fs.existsSync(repo.absPath)) {
    result.state = 'absent';
    result.problems.push(`${repo.path} no existe (¿sin clonar?)`);
    return result;
  }

  const profile = profiles.profileFor(cfg, repo);
  if (!profile) {
    result.state = 'skipped';
    return result;
  }
  result.profile = profile.id;
  result.dir = profile.dir;
  result.repair = profile.repair;

  const depsDir = path.join(repo.absPath, profile.dir);
  if (!link.exists(depsDir)) {
    result.state = 'broken';
    result.problems.push(`no hay ${profile.dir}: nunca se instaló o se borró entero`);
    return result;
  }

  if (link.isLink(depsDir)) {
    result.inverted = true;
    result.problems.push(
      `${profile.dir} del repositorio principal es un enlace. El enlace va del slot al principal, nunca al revés.`,
    );
  }

  const health = profile.health || {};
  const kind = health.kind;

  if (kind === 'node-modules') {
    const bin = entries(path.join(depsDir, health.binDir || '.bin')).length;
    result.count = bin;
    const min = health.minBin === undefined ? 20 : health.minBin;
    if (bin === 0) result.problems.push(`${profile.dir}/${health.binDir || '.bin'} no existe o está vacío`);
    else if (bin < min) result.problems.push(`${profile.dir}/${health.binDir || '.bin'} tiene solo ${bin} ejecutables (se esperan >= ${min})`);
  } else if (kind === 'python-venv') {
    if (!fs.existsSync(path.join(depsDir, 'pyvenv.cfg'))) result.problems.push(`${profile.dir}/pyvenv.cfg no existe: no es un entorno virtual válido`);
    result.count = link.healthCount(repo.absPath, profile);
    if (result.count === 0) result.problems.push(`${profile.dir}/${health.binDir || 'bin'} no existe o está vacío`);
  } else if (kind === 'php-vendor') {
    if (!fs.existsSync(path.join(depsDir, health.autoload || 'autoload.php'))) {
      result.problems.push(`${profile.dir}/${health.autoload || 'autoload.php'} no existe`);
    }
    result.count = link.healthCount(repo.absPath, profile);
  } else if (entries(depsDir).length === 0) {
    result.problems.push(`${profile.dir} está vacío`);
  }

  for (const name of declaredNames(repo.absPath, health, kind)) {
    const dest = path.join(depsDir, ...name.split('/'));
    // La carpeta sola no alcanza: lo que se vio fue la carpeta ahí y su
    // contenido borrado. Se pide el manifiesto del paquete (node) o contenido.
    const ok = kind === 'node-modules' ? fs.existsSync(path.join(dest, health.packageManifest || 'package.json')) : entries(dest).length > 0;
    if (!ok) result.missing.push(name);
  }
  if (result.missing.length > 0) result.problems.push(`${result.missing.length} dependencia(s) declarada(s) no están instaladas`);

  if (result.problems.length > 0) result.state = 'broken';
  return result;
}

function repair(r, repo, json) {
  process.stderr.write(`\n  Reparando ${r.repo} con \`${r.repair}\` …\n`);
  const run = spawnSync(r.repair, {
    cwd: repo.absPath,
    shell: true,
    stdio: json ? ['ignore', 2, 2] : 'inherit',
  });
  return run.status === 0;
}

function main() {
  const argv = process.argv.slice(2);
  const known = ['--fix', '--json', '--repo'];
  let only = null;
  let fix = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.includes(a)) {
      process.stderr.write(`Argumento desconocido: ${a}\nUso: node scripts/check-deps.js [--repo <repo>] [--fix] [--json]\n`);
      process.exit(2);
    }
    if (a === '--fix') fix = true;
    else if (a === '--json') json = true;
    else {
      only = argv[++i];
      if (!only || only.startsWith('--')) {
        process.stderr.write('--repo requiere un valor.\n');
        process.exit(2);
      }
    }
  }

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  let repos = cfg.repos;
  if (only) {
    repos = cfg.repos.filter((r) => r.name === only);
    if (repos.length === 0) {
      process.stderr.write(`El repositorio "${only}" no está declarado. Declarados: ${cfg.repos.map((r) => r.name).join(', ')}\n`);
      process.exit(2);
    }
  }

  let results;
  try {
    results = repos.map((repo) => checkRepo(cfg, repo));
    if (fix) {
      for (const r of results.filter((x) => x.state === 'broken')) {
        const repo = repos.find((x) => x.name === r.repo);
        if (r.inverted) {
          process.stderr.write(`  ${r.repo}: enlace invertido, no se repara solo. Quitá el enlace (rmdir/unlink, nunca un borrado recursivo) y volvé a correr --fix.\n`);
          continue;
        }
        if (!r.repair) {
          process.stderr.write(`  ${r.repo}: el perfil "${r.profile}" no declara \`repair\`.\n`);
          continue;
        }
        repair(r, repo, json);
        Object.assign(r, checkRepo(cfg, repo), { fixed: true });
      }
    }
  } catch (err) {
    process.stderr.write(`\n  ${err.message}\n\n`);
    process.exit(2);
  }

  const broken = results.filter((r) => r.state === 'broken');
  const absent = results.filter((r) => r.state === 'absent');
  const code = broken.length > 0 ? 1 : absent.length > 0 ? 2 : 0;

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: code === 0, results }, null, 2)}\n`);
    process.exit(code);
  }

  for (const r of results) {
    if (r.state === 'skipped') process.stdout.write(`--   ${r.repo} — sin perfil de dependencias compartidas\n`);
    else if (r.state === 'ok') process.stdout.write(`OK   ${r.repo} — ${r.dir}${r.count !== null ? ` (${r.count} en el directorio de ejecutables)` : ''}${r.fixed ? ', reparado' : ''}\n`);
    else {
      process.stdout.write(`${r.state === 'absent' ? 'N/D ' : 'ROTO'} ${r.repo}\n`);
      for (const p of r.problems) process.stdout.write(`     - ${p}\n`);
      if (r.missing.length > 0) {
        process.stdout.write(`     - faltan: ${r.missing.slice(0, 10).join(', ')}${r.missing.length > 10 ? ` (y ${r.missing.length - 10} más)` : ''}\n`);
      }
    }
  }
  if (broken.length > 0 && !fix) {
    process.stdout.write(
      '\nCómo se repara: parar lo que use ese directorio (dev server, watchers) y correr con --fix, que ejecuta el\n' +
        'comando de reinstalación del perfil. Una reparación "liviana" que solo recrea enlaces de ejecutables NO\n' +
        'restaura archivos de paquetes borrados: deja el repo pareciendo sano y fallando más adelante.\n' +
        'Qué lo causó, casi seguro: una operación que atravesó el enlace de un slot. Ver ai/core/procedures/shared-dependencies.md\n',
    );
  }
  process.exit(code);
  return undefined;
}

main();
