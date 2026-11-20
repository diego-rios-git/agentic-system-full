#!/usr/bin/env node
/**
 * verify-rules.js
 *
 * Toda regla activa del motor de anti-patrones (núcleo + packs + `ai/local/`)
 * tiene que traer sus dos fixtures —uno que MARCA y uno que NO marca— y
 * comportarse como declara. Si falta alguno, falla.
 *
 * Por qué existe: en el proyecto de origen un script de verificación listaba a
 * mano los casos de cada regla, y llegó a cubrir cuatro reglas de cuarenta: el
 * resto se escribía "con fixtures" en la prosa del procedimiento y nadie lo
 * comprobaba. Una regla probada solo contra código malo no se distingue de una
 * que marca todo, y esa es la que enseña al equipo a ignorar los avisos — con lo
 * cual se pierde el gate entero, no solo esa regla.
 *
 * Qué hace cada pieza (sin duplicar):
 *   - El motor (`check-antipatterns.js --validate-rules`) ejecuta los fixtures y
 *     dice si alguno no se comporta. Este script lo invoca; no los re-ejecuta.
 *   - Este script agrega lo que el motor NO exige: que existan los DOS lados.
 *     El motor acepta una regla con solo `bad` o solo `good`; acá, no.
 *   - Las reglas ESTRUCTURALES (`kind: 'structure'`) no tienen una línea que
 *     probar: su fixture es un árbol de archivos. Se declara así y este script
 *     lo materializa en un directorio temporal y corre `scan` sobre él:
 *
 *       fixtures: {
 *         bad:  [{ files: { 'src/modules/pagos/pagos.service.ts': 'export class P {}' } }],
 *         good: [{ files: { 'src/modules/pagos/pagos.errors.ts': 'export const X = 1;' } }],
 *       }
 *
 *     `bad` debe producir al menos un hallazgo; `good`, ninguno.
 *
 * Existe como comando para los PROYECTOS: los tests de la base (test/rules.test.js)
 * no viajan al proyecto, y las reglas que el proyecto agrega en `ai/local/` o en un
 * pack propio necesitan quién las vigile.
 *
 * Códigos de salida: 0 todas completas y correctas · 1 alguna incompleta o
 * incorrecta · 2 no se pudo verificar (reglas que no cargaron, ninguna regla).
 *
 * Uso:
 *   node scripts/verify-rules.js --repo mi-api [--json]
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const assets = require('./lib/asset-roots');
const config = require('./lib/workspace-config');

const ROOT = config.ROOT;

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/** Las reglas activas de un repositorio, con su origen. */
function loadRules(cfg, repo) {
  const rules = [];
  const problems = [];

  for (const root of assets.rootsFor(cfg, repo)) {
    const file = path.join(root.absDir, 'rules', 'antipatterns.js');
    if (!fs.existsSync(file)) continue;
    const rel = `${root.dir}/rules/antipatterns.js`;

    try {
      const loaded = require(file);
      if (!Array.isArray(loaded)) {
        problems.push(`${rel} no exporta un array`);
        continue;
      }
      for (const rule of loaded) rules.push({ ...rule, origin: root.id, source: rel });
    } catch (err) {
      problems.push(`${rel} falló al cargar: ${err.message}`);
    }
  }

  return { rules, problems };
}

// ---------------------------------------------------------------------------
// Verificación
// ---------------------------------------------------------------------------

function finding(rule, code, message) {
  return { rule: rule.id || '?', file: rule.source || 'rules/antipatterns.js', line: 1, code, message };
}

const isStructure = (rule) => rule.kind === 'structure';

/**
 * Los dos lados de los fixtures de cada regla. Función pura: no ejecuta nada.
 * @returns {object[]} hallazgos
 */
function completeness(rules) {
  const found = [];
  const HOW = 'Ver ai/core/procedures/gate-from-finding.md';

  for (const rule of rules) {
    const fx = rule.fixtures || {};
    const bad = Array.isArray(fx.bad) ? fx.bad : [];
    const good = Array.isArray(fx.good) ? fx.good : [];

    if (!isStructure(rule) && typeof rule.test !== 'function') {
      found.push(finding(rule, 'sin-test', `La regla no tiene \`test\` ni es estructural: no detecta nada. ${HOW}`));
      continue;
    }
    if (isStructure(rule) && typeof rule.scan !== 'function') {
      found.push(finding(rule, 'sin-scan', `La regla estructural no tiene \`scan\`. ${HOW}`));
      continue;
    }

    const kind = isStructure(rule) ? 'un árbol { files: {...} } ' : 'una línea ';
    if (bad.length === 0) {
      found.push(finding(rule, 'falta-bad', `Sin fixture que MARQUE: falta \`fixtures.bad\` (${kind}que debe marcar). ${HOW}`));
    }
    if (good.length === 0) {
      found.push(
        finding(
          rule,
          'falta-good',
          `Sin fixture que NO marque: falta \`fixtures.good\` (${kind}correcto, lo más parecido al malo). ` +
            `Sin él no hay forma de saber si la regla marca de más. ${HOW}`,
        ),
      );
    }
  }

  return found;
}

/** Materializa un árbol de fixture y corre el `scan` de la regla estructural. */
function runStructure(rule, tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rules-'));
  try {
    for (const [rel, content] of Object.entries((tree && tree.files) || {})) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content), 'utf8');
    }
    return rule.scan(dir) || [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Comportamiento de las reglas estructurales (el motor solo prueba las de línea). */
function structureBehavior(rules) {
  const found = [];

  for (const rule of rules.filter((r) => isStructure(r) && typeof r.scan === 'function')) {
    const fx = rule.fixtures || {};

    for (const [i, tree] of (Array.isArray(fx.bad) ? fx.bad : []).entries()) {
      try {
        if (runStructure(rule, tree).length === 0) {
          found.push(finding(rule, `bad-no-marca-${i}`, `NO marca el fixture \`bad[${i}]\`, que debería marcar.`));
        }
      } catch (err) {
        found.push(finding(rule, `bad-error-${i}`, `\`scan\` lanzó un error sobre \`bad[${i}]\`: ${err.message}`));
      }
    }
    for (const [i, tree] of (Array.isArray(fx.good) ? fx.good : []).entries()) {
      try {
        if (runStructure(rule, tree).length > 0) {
          found.push(finding(rule, `good-marca-${i}`, `Marca el fixture \`good[${i}]\`, que es correcto.`));
        }
      } catch (err) {
        found.push(finding(rule, `good-error-${i}`, `\`scan\` lanzó un error sobre \`good[${i}]\`: ${err.message}`));
      }
    }
  }

  return found;
}

/**
 * Comportamiento de las reglas de línea: lo ejecuta el motor, que es quien sabe
 * armar el contexto de cada regla (`envAccess` del pack que la aporta).
 *
 * @returns {{ok: true, messages: string[]}|{ok: false, reason: string}}
 */
function engineBehavior(repoName) {
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-antipatterns.js'), '--repo', repoName, '--validate-rules', '--json'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: process.env },
  );

  if (run.status !== 0 && run.status !== 1) {
    return { ok: false, reason: `el motor de anti-patrones salió con ${run.status}: ${String(run.stderr || '').trim().split('\n')[0]}` };
  }
  try {
    const list = JSON.parse(run.stdout);
    if (!Array.isArray(list)) throw new Error('no es una lista');
    return { ok: true, messages: list.map((f) => String(f.message)) };
  } catch (err) {
    return { ok: false, reason: `no se pudo leer la salida del motor: ${err.message}` };
  }
}

/** `R-1.1: marca un caso correcto — "..."` → id de regla. */
function ruleOfMessage(rules, message) {
  const id = message.split(':')[0].trim();
  return rules.find((r) => r.id === id) || { id, source: 'rules/antipatterns.js' };
}

/** Huella de un hallazgo en el baseline (ver `main`). */
function fingerprint(f) {
  return `${f.rule}|${f.file}|${String(f.code || f.message || '').slice(0, 80)}`;
}

function main() {
  const cli = require('./lib/gate-cli');

  cli.run({
    name: 'verify-rules',
    script: 'scripts/verify-rules.js',

    // Una regla local sin fixtures es deuda que un proyecto que actualiza ya
    // tiene el día que adopta este gate, y dejarlo en rojo sin salida intermedia
    // es forzar a desactivarlo. Se puede congelar (`--write-baseline`) y pagar
    // de a una. La huella lleva el motivo para que congelar "falta el fixture que
    // marca" de una regla no silencie "falta el que no marca" de la misma.
    fingerprint,

    scan(ctx) {
      const { rules, problems } = loadRules(ctx.cfg, ctx.repo);

      // Un archivo de reglas que no cargó deja sus reglas sin verificar, y decir
      // "todas están completas" sobre las que sí cargaron es la mentira que este
      // gate existe para no contar.
      if (problems.length > 0) {
        return cli.unverified(`${ctx.repo.name}: reglas que no cargaron\n  - ${problems.join('\n  - ')}`);
      }
      if (rules.length === 0) {
        return cli.unverified(
          `${ctx.repo.name}: no hay reglas de anti-patrones activas, no hay nada que verificar`,
          'Las aportan el núcleo y los packs instalados.',
        );
      }

      const behavior = engineBehavior(ctx.repo.name);
      if (!behavior.ok) return cli.unverified(`${ctx.repo.name}: ${behavior.reason}`);

      const found = [
        ...completeness(rules),
        ...structureBehavior(rules),
        ...behavior.messages
          // "no declara fixtures" ya lo dijo `completeness`, con más detalle.
          .filter((m) => !/no declara fixtures/.test(m))
          .map((m) => finding(ruleOfMessage(rules, m), m.slice(0, 80), m)),
      ];

      return cli.findings(found, {
        emptyMessage: `${rules.length} reglas: todas traen fixtures que marcan y que no marcan, y se comportan`,
      });
    },
  });
}

if (require.main === module) main();

module.exports = { loadRules, completeness, structureBehavior, fingerprint };
