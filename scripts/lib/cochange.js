#!/usr/bin/env node
/**
 * cochange.js
 *
 * Reglas "quien toca X regenera Y": el motor que lee `check-cochange.js`, y que
 * `gates.js` consulta para saber si un repositorio tiene algo que verificar.
 *
 * Una regla se declara en DATOS, en el `manifest.json` del núcleo, de un pack o
 * de `ai/local/`, bajo `coChange`, o en `ai-workspace.json` (a nivel raíz para
 * todos los repositorios, o en `repos[].coChange` para uno):
 *
 *   "coChange": [
 *     {
 *       "id": "lockfile",
 *       "whenTouched":   ["package.json"],
 *       "mustAlsoTouch": ["package-lock.json"],
 *       "message": "Se tocó package.json sin regenerar el lockfile.",
 *       "fixHint": "Correr el gestor de paquetes y commitear el lockfile."
 *     }
 *   ]
 *
 * Los globs son los de `globs.js` y se evalúan contra rutas relativas al
 * repositorio.
 *
 * Por qué existe: hay artefactos DERIVADOS que viven versionados — un lockfile,
 * una captura de referencia, un cliente generado, un esquema exportado — y que
 * quedan desactualizados en silencio cuando alguien toca su fuente. En el caso
 * que dio origen a esto, el archivo que define un menú compartido recibió cuatro
 * entradas nuevas en cuatro entregas y NINGUNA regeneró una sola captura: la
 * rama base quedó en rojo para toda vista previa, y cada rama que sincronizaba
 * heredaba capturas ajenas rotas que no podía distinguir de las propias. No es
 * un gate sobre el contenido de un archivo sino sobre el CONJUNTO de archivos
 * del cambio, por eso compara contra la base.
 */

'use strict';

const assets = require('./asset-roots');
const globs = require('./globs');

function problemsOfRule(rule) {
  const list = (v) => Array.isArray(v) && v.length > 0 && v.every((g) => typeof g === 'string' && g);
  if (!rule || typeof rule !== 'object') return 'no es un objeto';
  if (!rule.id || typeof rule.id !== 'string') return 'falta `id`';
  if (!list(rule.whenTouched)) return '`whenTouched` debe ser una lista no vacía de globs';
  if (!list(rule.mustAlsoTouch)) return '`mustAlsoTouch` debe ser una lista no vacía de globs';
  if (!rule.message || typeof rule.message !== 'string') return 'falta `message`';
  return null;
}

/**
 * Reglas aplicables a un repositorio: núcleo, packs activos, `ai/local/` y la
 * configuración del proyecto. Una regla con el mismo `id` en una fuente
 * posterior reemplaza a la anterior (el proyecto le gana al pack).
 *
 * @returns {{rules: object[], problems: string[]}}
 */
function rulesFor(cfg, repo) {
  const byId = new Map();
  const problems = [];

  const add = (list, origin) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) {
      problems.push(`${origin}: \`coChange\` debe ser una lista`);
      return;
    }
    for (const rule of list) {
      const bad = problemsOfRule(rule);
      if (bad) {
        problems.push(`${origin}: regla coChange inválida (${rule && rule.id ? rule.id : '?'}): ${bad}`);
        continue;
      }
      byId.set(rule.id, { ...rule, origin });
    }
  };

  for (const root of assets.rootsFor(cfg, repo)) {
    const raw = assets.rawManifest(root);
    if (raw) add(raw.coChange, `${root.dir}/manifest.json`);
  }

  const raw = cfg.raw || {};
  add(raw.coChange, 'ai-workspace.json');
  const own = (raw.repos || []).find((r) => r.name === repo.name);
  if (own) add(own.coChange, `ai-workspace.json (repos.${repo.name})`);

  return { rules: [...byId.values()], problems };
}

/**
 * Evalúa las reglas contra los archivos que toca el cambio.
 *
 * Un archivo BORRADO cuenta como tocado, en los dos lados: borrar la fuente sin
 * borrar su derivado deja el derivado huérfano, que es el mismo defecto.
 *
 * @param {object[]} rules
 * @param {Iterable<string>} touched rutas relativas al repositorio
 * @returns {object[]} hallazgos `{rule, file, line, message, fixHint, touched}`
 */
function evaluate(rules, touched) {
  const files = [...touched].map(globs.normalize).sort();
  const findings = [];

  for (const rule of rules) {
    const triggers = files.filter((f) => globs.matchesAny(rule.whenTouched, f));
    if (triggers.length === 0) continue;
    if (files.some((f) => globs.matchesAny(rule.mustAlsoTouch, f))) continue;

    const more = triggers.length > 1 ? ` (+${triggers.length - 1} archivo(s) más de la misma regla)` : '';
    findings.push({
      rule: rule.id,
      file: triggers[0],
      line: 1,
      message:
        `${rule.message}${more} Debe tocarse también: ${rule.mustAlsoTouch.join(' | ')}.` +
        (rule.fixHint ? ` ${rule.fixHint}` : ''),
      fixHint: rule.fixHint || null,
      touched: triggers.slice(0, 10),
      mustAlsoTouch: rule.mustAlsoTouch,
    });
  }

  return findings;
}

module.exports = { rulesFor, evaluate };
