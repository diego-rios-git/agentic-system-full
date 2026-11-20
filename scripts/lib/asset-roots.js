#!/usr/bin/env node
/**
 * asset-roots.js
 *
 * Resuelve de dónde sale el contenido de los activos y fusiona los manifiestos.
 *
 * En un proyecto generado el contenido no vive en una sola carpeta: el núcleo
 * aporta lo transversal, cada pack lo suyo, y el proyecto puede agregar activos
 * propios. Este módulo produce una vista única de todo eso para que el resto de
 * los scripts no tenga que saber de dónde salió cada archivo.
 *
 *   ai/core/         ← siempre
 *   ai/packs/<pack>/ ← por cada pack activo
 *   ai/local/        ← del proyecto, opcional
 *
 * **El orden importa**: la última raíz gana. Un proyecto puede redefinir un
 * procedimiento del núcleo poniendo uno con el mismo nombre en `ai/local/`, y
 * eso es deliberado — es la vía de escape para no tener que bifurcar la base
 * entera por un procedimiento que no encaja.
 *
 * Cada raíz tiene la misma forma:
 *   <raíz>/manifest.json
 *   <raíz>/procedures/<nombre>.md
 *   <raíz>/agents/<nombre>.md
 *   <raíz>/rules/…  <raíz>/prompts/…  <raíz>/skills/…
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspace-config');

const CORE_DIR = 'ai/core';
const PACKS_DIR = 'ai/packs';
const LOCAL_DIR = 'ai/local';

// ---------------------------------------------------------------------------
// Raíces
// ---------------------------------------------------------------------------

/**
 * Devuelve las raíces activas en orden de precedencia ascendente.
 * @returns {Array<{id: string, kind: 'core'|'pack'|'local', dir: string, absDir: string}>}
 */
function roots(config) {
  const list = [{ id: 'core', kind: 'core', dir: CORE_DIR }];

  for (const pack of config.activePacks) {
    list.push({ id: pack, kind: 'pack', dir: `${PACKS_DIR}/${pack}` });
  }

  list.push({ id: 'local', kind: 'local', dir: LOCAL_DIR });

  return list
    .map((r) => ({ ...r, absDir: path.join(ROOT, r.dir) }))
    .filter((r) => fs.existsSync(r.absDir));
}

// ---------------------------------------------------------------------------
// Manifiestos
// ---------------------------------------------------------------------------

function readManifest(root) {
  const file = path.join(root.absDir, 'manifest.json');
  if (!fs.existsSync(file)) return { skills: [], agents: [] };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const e = new Error(`${root.dir}/manifest.json no es JSON válido: ${err.message}`);
    e.isAssetError = true;
    throw e;
  }

  return { skills: parsed.skills || [], agents: parsed.agents || [] };
}

/**
 * El manifiesto completo de una raíz, sin recortar.
 *
 * `readManifest` devuelve solo skills y agentes porque es lo único que necesita
 * el generador de punteros. Los gates y el perfil de lenguaje leen otras claves
 * del mismo archivo — `gates`, `language` — y filtrarlas acá las volvía
 * inalcanzables sin volver a leer y parsear el archivo en cada consumidor.
 *
 * Devuelve `null` si no hay manifiesto o si no se puede leer: quien pregunte
 * decide si eso es un problema. Para el perfil de lenguaje, un pack sin
 * manifiesto simplemente no aporta lenguaje.
 */
function rawManifest(root) {
  const file = path.join(root.absDir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fusiona los manifiestos de todas las raíces activas.
 *
 * A cada entrada se le agrega `root` (de dónde salió) y `contentPath` (la ruta
 * del archivo con el contenido real, relativa a la raíz del workspace). Esa
 * ruta es la que termina impresa en el puntero de cada harness, y por eso no
 * puede quedar hardcodeada: el mismo procedimiento vive en un lugar distinto
 * según venga del núcleo, de un pack o del proyecto.
 *
 * Un nombre repetido no es un error: la raíz posterior reemplaza a la anterior
 * y el reemplazo se registra en `overrides` para poder reportarlo.
 */
function merged(config) {
  const skills = new Map();
  const agents = new Map();
  const overrides = [];
  const missing = [];

  for (const root of roots(config)) {
    const manifest = readManifest(root);

    for (const skill of manifest.skills) {
      const contentRel = `${root.dir}/procedures/${skill.name}.md`;
      if (!fs.existsSync(path.join(ROOT, contentRel))) {
        missing.push({ kind: 'skill', name: skill.name, expected: contentRel });
        continue;
      }
      if (skills.has(skill.name)) {
        overrides.push({ kind: 'skill', name: skill.name, from: skills.get(skill.name).root.id, to: root.id });
      }
      skills.set(skill.name, { ...skill, root, contentPath: contentRel });
    }

    for (const agent of manifest.agents) {
      const contentRel = `${root.dir}/agents/${agent.name}.md`;
      if (!fs.existsSync(path.join(ROOT, contentRel))) {
        missing.push({ kind: 'agent', name: agent.name, expected: contentRel });
        continue;
      }
      if (agents.has(agent.name)) {
        overrides.push({ kind: 'agent', name: agent.name, from: agents.get(agent.name).root.id, to: root.id });
      }
      agents.set(agent.name, { ...agent, root, contentPath: contentRel });
    }
  }

  return {
    skills: [...skills.values()],
    agents: [...agents.values()],
    overrides,
    missing,
  };
}

module.exports = { CORE_DIR, PACKS_DIR, LOCAL_DIR, roots, readManifest, rawManifest, merged };
