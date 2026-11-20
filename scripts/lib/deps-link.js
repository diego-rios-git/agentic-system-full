#!/usr/bin/env node
/**
 * deps-link.js
 *
 * Enlazar, desenlazar y medir el directorio de dependencias que un slot comparte
 * con el repositorio principal. Lo usan `manage-worktree.js` (abrir / cerrar) y
 * `check-deps.js` (salud); ninguno de los dos reimplementa nada de esto.
 *
 * Por qué se comparte en vez de reinstalar: instalar de nuevo en cada slot
 * cuesta minutos y cientos de megas por slot. El precio es que lo que escriba
 * ADENTRO del enlace le escribe al principal, así que acá viven las tres reglas
 * que lo hacen seguro:
 *
 *   1. Solo se enlaza si el lockfile del slot es el del principal. Con otro
 *      lockfile el slot necesita otro árbol, y enlazar uno ajeno compila con
 *      versiones equivocadas sin que nada avise.
 *   2. Un enlace se QUITA como enlace (`unlink` / `rmdir`), jamás con un borrado
 *      recursivo: lo que atraviesa un enlace depende de la operación y del
 *      sistema, y se mide (ver ai/core/procedures/shared-dependencies.md). Una
 *      limpieza que se apoya en "este borrado no atraviesa" funciona hasta el
 *      día que lo hace.
 *   3. Se quitan TODOS los enlaces del árbol, no solo el de la raíz. Una build
 *      dejó un enlace anidado (dentro de un directorio de salida del bundler) y
 *      `git worktree remove` lo atravesó: el principal quedó sin dependencias y
 *      el mensaje decía "cerrado" con toda normalidad.
 *
 * El directorio no es `node_modules` fijo: sale del perfil
 * (`scripts/lib/deps-profiles.js`). Un proyecto Python comparte `.venv`, uno PHP
 * `vendor`, y uno sin perfil no comparte nada.
 *
 * En Windows el enlace es una junction (un symlink de directorio exige
 * privilegios de administrador ahí); en el resto, un symlink 'dir'.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const assets = require('./asset-roots');

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

/** ¿Es un enlace (junction o symlink)? Sin seguirlo: `lstat`, nunca `stat`. */
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Quita UN enlace sin tocar su destino. `unlink` primero; en Windows una
 * junction a veces solo acepta `rmdir`. Ninguno de los dos sigue el enlace.
 * Si el enlace sobrevive, lanza: quien llama decide frenar.
 */
function removeLink(p) {
  if (!isLink(p)) return;
  try {
    fs.unlinkSync(p);
  } catch {
    try {
      fs.rmdirSync(p);
    } catch {
      /* se verifica abajo */
    }
  }
  if (exists(p)) throw new Error(`No se pudo quitar el enlace ${p}.`);
}

/** Todos los enlaces bajo `dir`, sin entrar en ninguno. */
function findLinks(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isFile()) continue;
      // lstat y no `entry.isSymbolicLink()`: según la versión de Node, una
      // junction llega como directorio o como tipo desconocido.
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        found.push(full);
      } else if (stat.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(dir);
  return found;
}

/**
 * Barrido: quita todo enlace del árbol. Devuelve `{ removed, survivors }`;
 * si `survivors` no está vacío, NO se debe borrar nada recursivamente por encima.
 */
function sweepLinks(dir) {
  const removed = [];
  for (const link of findLinks(dir)) {
    try {
      removeLink(link);
      removed.push(link);
    } catch {
      /* queda en survivors */
    }
  }
  return { removed, survivors: findLinks(dir) };
}

// ---------------------------------------------------------------------------
// Perfil y medición
// ---------------------------------------------------------------------------

/**
 * Cuántas entradas "ejecutables" tiene un directorio de dependencias sano. Es la
 * medida que se toma antes y después de cerrar un slot: si baja, algo atravesó
 * un enlace. Cuenta CONTENIDO, no carpetas de primer nivel — el conteo de
 * carpetas no cambia cuando lo que se vació es lo de adentro.
 *
 * `null` si el perfil no declara cómo medirlo.
 */
function healthCount(repoDir, profile) {
  if (!profile || !profile.health) return null;
  const base = path.join(repoDir, profile.dir);
  const h = profile.health;
  const count = (d) => {
    try {
      return fs.readdirSync(d).length;
    } catch {
      return 0;
    }
  };
  if (h.kind === 'node-modules') return count(path.join(base, h.binDir || '.bin'));
  if (h.kind === 'python-venv') {
    return Math.max(count(path.join(base, h.binDir || 'bin')), count(path.join(base, h.altBinDir || 'Scripts')));
  }
  if (h.kind === 'php-vendor') return count(path.join(base, 'composer'));
  return count(base);
}

/**
 * `true` si el lockfile del repositorio principal difiere del que tiene `ref`;
 * `false` si coinciden; `null` si no se pudo comparar (sin lockfile, ref
 * inexistente). El `null` NO es "coincide": quien llama no enlaza.
 */
function lockfileDiffers(repoDir, ref, lockfile) {
  if (!lockfile) return null;
  if (!fs.existsSync(path.join(repoDir, lockfile))) return null;
  const run = spawnSync('git', ['-C', repoDir, 'diff', '--quiet', ref, '--', lockfile], { encoding: 'utf8' });
  if (run.status === 0) return false;
  if (run.status === 1) return true;
  return null;
}

/**
 * Enlaza `<repoDir>/<rel>` dentro de `slotDir`.
 *
 * @param {{profile?: object|null, ref?: string|null, guard?: boolean}} opts
 *   `guard` (por defecto, si hay perfil y `rel` es su directorio): exige que el
 *   lockfile coincida con `ref`.
 * @returns {{status: 'linked'|'present'|'skipped', reason?: string}}
 */
function linkDir(repoDir, slotDir, rel, opts = {}) {
  const from = path.join(repoDir, rel);
  const to = path.join(slotDir, rel);
  if (!fs.existsSync(from)) {
    return { status: 'skipped', reason: `no existe ${rel} en el repositorio principal: instalá las dependencias ahí primero` };
  }
  if (exists(to)) return { status: 'present' };

  const profile = opts.profile;
  if (profile && profile.dir === rel && profile.lockfile && opts.guard !== false) {
    const differs = lockfileDiffers(repoDir, opts.ref || 'HEAD', profile.lockfile);
    if (differs === true) {
      return {
        status: 'skipped',
        reason:
          `${profile.lockfile} de "${opts.ref}" no coincide con el del principal: no se enlazó ${rel}. ` +
          'Ese slot necesita su propio árbol de dependencias y lo decide el operador.',
      };
    }
    if (differs === null) {
      return { status: 'skipped', reason: `no se pudo comparar ${profile.lockfile} contra "${opts.ref}": no se enlazó ${rel}.` };
    }
  }

  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(from, to, LINK_TYPE);
    return { status: 'linked' };
  } catch (err) {
    return { status: 'skipped', reason: `no se pudo enlazar ${rel}: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Preparación declarada por los packs
// ---------------------------------------------------------------------------

/**
 * Pasos de `worktree.prepare` que declaran los packs activos del repositorio:
 *   { strategy: 'link', paths: [...] }     enlaza directorios del principal
 *   { strategy: 'command', run: [...] }    corre un comando en el slot
 */
function preparationsFor(cfg, repo) {
  const steps = [];
  for (const root of assets.rootsFor(cfg, repo)) {
    const manifest = assets.rawManifest(root);
    const declared = manifest && manifest.worktree && manifest.worktree.prepare;
    for (const step of declared || []) steps.push({ ...step, origin: root.id });
  }
  return steps;
}

/** Directorios relativos que este repo enlaza en un slot: los de los pasos `link` y el del perfil. */
function linkedPaths(cfg, repo, profile) {
  const rels = new Set();
  for (const step of preparationsFor(cfg, repo)) {
    if (step.strategy === 'link') for (const rel of step.paths || []) rels.add(rel);
  }
  if (profile) rels.add(profile.dir);
  return [...rels];
}

module.exports = {
  LINK_TYPE,
  isLink,
  exists,
  removeLink,
  findLinks,
  sweepLinks,
  healthCount,
  lockfileDiffers,
  linkDir,
  preparationsFor,
  linkedPaths,
};
