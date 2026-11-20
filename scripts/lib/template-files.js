#!/usr/bin/env node
/**
 * template-files.js
 *
 * Qué archivos pertenecen a la base agéntica, según su manifiesto.
 *
 * Vive acá y no en cada script porque el `init` y el `template-sync` tienen que
 * responder **exactamente lo mismo**. Cuando cada uno lo calculaba por su
 * cuenta, el registro que escribía el `init` no incluía el manifiesto ni la
 * versión, y el sync los veía sin registro y los reportaba como modificados por
 * el proyecto: un falso divergente en cada actualización, sobre archivos que
 * nadie había tocado.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'template.manifest.json';

/**
 * @param {string} dir raíz de la base — la local, o una copia de la versión nueva
 * @param {string[]} activePacks packs que el proyecto tiene instalados
 * @returns {string[]} rutas relativas, en formato POSIX
 */
function templateFiles(dir, activePacks) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  const files = new Set();

  const add = (list) => {
    for (const rel of list || []) files.add(String(rel).split('\\').join('/'));
  };

  for (const group of Object.values(manifest.core || {})) add(group);

  // Un pack que el proyecto no instaló no se trae: instalarlo es una decisión
  // del proyecto, no un efecto secundario de actualizar la base.
  for (const [id, pack] of Object.entries(manifest.packs || {})) {
    if (!activePacks.includes(id)) continue;
    for (const key of ['procedures', 'agents', 'rules', 'scripts', 'prompts', 'references']) add(pack[key]);
  }

  // Los manifiestos declaran los activos y los gates: quedarse con uno viejo
  // dejaría el contenido nuevo instalado pero invisible.
  files.add('ai/core/manifest.json');
  for (const id of activePacks) files.add(`ai/packs/${id}/manifest.json`);
  files.add(MANIFEST_NAME);
  files.add('VERSION');

  return [...files].filter((rel) => fs.existsSync(path.join(dir, rel)));
}

/** Packs instalados según la configuración del proyecto. */
function activePacksOf(root) {
  const configPath = path.join(root, 'ai-workspace.json');
  if (!fs.existsSync(configPath)) return [];
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const fromRepos = (cfg.repos || []).flatMap((r) => r.packs || []);
  return [...new Set([...(cfg.packs || []), ...fromRepos])];
}

module.exports = { MANIFEST_NAME, templateFiles, activePacksOf };
