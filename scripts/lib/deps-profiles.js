#!/usr/bin/env node
/**
 * deps-profiles.js
 *
 * Qué directorio de dependencias comparte un repositorio con sus slots, y qué
 * comandos lo destruyen. UNA resolución, para quien enlaza, quien verifica y
 * quien bloquea.
 *
 * Los perfiles son DATOS (`depsProfiles` en `ai/core/manifest.json`, ampliables
 * por un pack o por `ai/local`): el núcleo no sabe qué es `npm`, solo sabe que
 * hay un directorio, un lockfile, unos gestores que lo reescriben y un comando
 * que lo repara. Que Node, Python y PHP tengan su perfil no significa que el
 * proyecto use Node: un repositorio sin perfil no tiene nada compartido y ninguna
 * de estas piezas se activa para él.
 *
 * Resolución, de más a menos específica:
 *   1. `repos[].deps` en ai-workspace.json
 *        "node"                         → ese perfil
 *        { "profile": "node", ... }     → ese perfil con campos pisados
 *        { "dir": "...", ... }          → un perfil completo propio
 *   2. `worktree.deps.profile` del manifiesto de un pack activo del repositorio
 *   3. ninguno → `null`
 */

'use strict';

const assets = require('./asset-roots');

/** Todos los perfiles declarados por el núcleo, los packs activos y el proyecto. */
function catalog(cfg) {
  const profiles = {};
  for (const root of assets.roots(cfg)) {
    const m = assets.rawManifest(root);
    if (m && m.depsProfiles) Object.assign(profiles, m.depsProfiles);
  }
  return profiles;
}

function packProfileId(cfg, repo) {
  for (const root of assets.rootsFor(cfg, repo)) {
    const m = assets.rawManifest(root);
    const id = m && m.worktree && m.worktree.deps && m.worktree.deps.profile;
    if (id) return id;
  }
  return null;
}

/**
 * @returns {null | {id: string, source: 'repo'|'pack', dir: string, lockfile: string|null,
 *   managers: string[], destructiveSubcommands: string[], safeSubcommands: string[],
 *   health: object|null, repair: string|null}}
 */
function profileFor(cfg, repo) {
  const all = catalog(cfg);
  let id = null;
  let overrides = {};
  let source = 'pack';

  const own = repo.deps;
  if (typeof own === 'string') {
    id = own;
    source = 'repo';
  } else if (own && typeof own === 'object') {
    source = 'repo';
    if (own.profile) {
      id = own.profile;
      overrides = own;
    } else {
      return normalize('custom', own, source);
    }
  } else {
    id = packProfileId(cfg, repo);
  }

  if (!id) return null;
  const base = all[id];
  if (!base) {
    const e = new Error(
      `El repositorio "${repo.name}" usa el perfil de dependencias "${id}", que no está declarado. ` +
        `Declarados: ${Object.keys(all).join(', ') || 'ninguno'}. Se agrega en \`depsProfiles\` de un manifest.json.`,
    );
    e.isAssetError = true;
    throw e;
  }
  return normalize(id, { ...base, ...overrides }, source);
}

function normalize(id, def, source) {
  return {
    id,
    source,
    title: def.title || id,
    dir: def.dir,
    lockfile: def.lockfile || null,
    managers: def.managers || [],
    destructiveSubcommands: def.destructiveSubcommands || [],
    safeSubcommands: def.safeSubcommands || [],
    health: def.health || null,
    repair: def.repair || null,
  };
}

/** Perfiles de todos los repositorios que tienen uno: `[{ repo, profile }]`. */
function all(cfg) {
  const out = [];
  for (const repo of cfg.repos) {
    const profile = profileFor(cfg, repo);
    if (profile) out.push({ repo, profile });
  }
  return out;
}

module.exports = { catalog, profileFor, all };
