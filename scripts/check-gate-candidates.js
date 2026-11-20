#!/usr/bin/env node
/**
 * check-gate-candidates.js
 *
 * Lintea el registro `ai/gate-candidates.md`: la lista de errores confirmados
 * que están (o no) convertidos en una verificación automática.
 *
 *   GC-1  la entrada no empieza con un estado válido
 *   GC-2  una entrada descartada (⛔) no dice el motivo
 *   GC-3  una entrada implementada (✅) no referencia nada que exista
 *
 * Por qué existe: el registro es la memoria del bucle "error → gate". Sin
 * control se degrada de dos maneras. Una, los descartados sin motivo: "no se
 * pudo" no le ahorra el análisis a la próxima persona, que lo repite desde cero.
 * Otra, los "implementados" que apuntan a una regla que ya se renombró o se
 * borró: el registro dice que el error está cubierto y no lo está, que es peor
 * que no tener registro.
 *
 * Estados (el primer carácter del encabezado de cada entrada, bajo `## Candidatos`):
 *   🟡 candidato     parece automatizable, sin verificar todavía
 *   🔵 analizado     se estudió cómo hacerlo; falta escribir la regla
 *   ⛔ descartado    no se puede automatizar hoy, CON el motivo
 *   ✅ implementado  ya es un gate; referencia el id de la regla o del gate
 *
 * Una entrada es un `###` y declara sus campos en negrita:
 *
 *   ### ⛔ Título corto del error
 *   - **Por qué no es gate**: el motivo concreto
 *   - **Gate**: `ID-DE-REGLA`        (solo ✅: ids de gate, regla, hook, coChange,
 *                                     o una ruta que exista)
 *
 * Los ids conocidos salen de los manifests (`gates`, `hooks`, `coChange`), de las
 * reglas de anti-patrones (núcleo, packs y `ai/local/`), de las reglas de Semgrep
 * y de los archivos `rules/*.md`.
 *
 * Uso:
 *   node scripts/check-gate-candidates.js [--json] [--file otro.md]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const cli = require('./lib/gate-cli');
const config = require('./lib/workspace-config');

const ROOT = config.ROOT;
const REGISTRY = 'ai/gate-candidates.md';
const STATES = ['🟡', '🔵', '⛔', '✅'];
const MIN_MOTIVE = 15;

// ---------------------------------------------------------------------------
// Ids conocidos
// ---------------------------------------------------------------------------

function assetDirs() {
  const dirs = [path.join(ROOT, 'ai', 'core'), path.join(ROOT, 'ai', 'local')];
  const packs = path.join(ROOT, 'ai', 'packs');
  if (fs.existsSync(packs)) {
    for (const e of fs.readdirSync(packs, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(packs, e.name));
    }
  }
  return dirs.filter((d) => fs.existsSync(d));
}

/** Todo id al que una entrada ✅ puede apuntar. */
function knownIds() {
  const ids = new Set();

  for (const dir of assetDirs()) {
    // Manifest: gates, hooks y reglas de co-cambio.
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      for (const key of ['gates', 'hooks', 'coChange']) {
        for (const item of manifest[key] || []) if (item && item.id) ids.add(String(item.id));
      }
    } catch {
      /* sin manifest o ilegible: sus ids no existen, y la entrada que los cite se marca */
    }

    // Anti-patrones del motor.
    const ap = path.join(dir, 'rules', 'antipatterns.js');
    if (fs.existsSync(ap)) {
      try {
        for (const rule of require(ap)) if (rule && rule.id) ids.add(String(rule.id));
      } catch {
        /* un archivo de reglas roto no aporta ids */
      }
    }

    // Reglas de Semgrep (yaml) y reglas escritas (md).
    const rulesDir = path.join(dir, 'rules');
    if (!fs.existsSync(rulesDir)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.ya?ml$/.test(e.name)) {
          for (const m of fs.readFileSync(full, 'utf8').matchAll(/^\s*-\s*id:\s*["']?([\w.-]+)/gm)) ids.add(m[1]);
        } else if (/\.md$/.test(e.name)) {
          ids.add(e.name.replace(/\.md$/, ''));
        }
      }
    };
    walk(rulesDir);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/** Las entradas (`###`) que siguen al encabezado `## Candidatos`. */
function parseEntries(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let inSection = false;
  let inFence = false;
  let current = null;

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    if (!inFence) {
      if (/^##\s+/.test(line)) {
        inSection = /^##\s+Candidatos\b/i.test(line);
        current = null;
        return;
      }
      if (inSection && /^###\s+/.test(line)) {
        current = { title: line.replace(/^###\s+/, '').trim(), line: i + 1, body: [] };
        entries.push(current);
        return;
      }
    }
    if (current) current.body.push(line);
  });

  return entries;
}

/** El texto de un campo `**Nombre**: valor` (hasta el siguiente campo o el fin). */
function field(entry, names) {
  const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*(?:${names.join('|')})\\*\\*\\s*:\\s*(.*)$`, 'i');
  const idx = entry.body.findIndex((l) => re.test(l));
  if (idx === -1) return null;

  const parts = [re.exec(entry.body[idx])[1]];
  for (let j = idx + 1; j < entry.body.length; j++) {
    if (/^\s*(?:[-*]\s*)?\*\*[^*]+\*\*\s*:/.test(entry.body[j]) || /^\s*$/.test(entry.body[j])) break;
    parts.push(entry.body[j]);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function lint(entries, ids) {
  const findings = [];
  const add = (entry, rule, message) =>
    findings.push({
      rule,
      file: REGISTRY,
      line: entry.line,
      code: entry.title.slice(0, 80),
      message,
    });

  for (const entry of entries) {
    const state = STATES.find((s) => entry.title.startsWith(s));
    if (!state) {
      add(
        entry,
        'GC-1',
        `La entrada no empieza con un estado válido (${STATES.join(' ')}). Ver la leyenda al inicio del registro.`,
      );
      continue;
    }

    if (state === '⛔') {
      const motive = field(entry, ['Por qué no es gate', 'Motivo', 'Descartado porque']);
      if (!motive || motive.length < MIN_MOTIVE) {
        add(
          entry,
          'GC-2',
          'Un candidato descartado va con el motivo concreto (`**Por qué no es gate**: …`): ' +
            'sin él, la próxima persona repite el análisis.',
        );
      }
    }

    if (state === '✅') {
      const ref = field(entry, ['Gate', 'Regla', 'Implementado en', 'Implementado']);
      const tokens = ref ? [...ref.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()) : [];

      if (tokens.length === 0) {
        add(entry, 'GC-3', 'Un candidato implementado referencia el id de su regla o gate: falta `**Gate**: \\`ID\\``.');
        continue;
      }
      for (const token of tokens) {
        const isPath = /[\\/]/.test(token) || /\.[A-Za-z]\w{0,4}$/.test(token);
        const exists = isPath ? fs.existsSync(path.join(ROOT, token)) : ids.has(token);
        if (!exists) {
          add(
            entry,
            'GC-3',
            `\`${token}\` no existe (${isPath ? 'no hay tal archivo' : 'ningún gate, regla o hook tiene ese id'}): ` +
              'el registro dice que el error está cubierto y ya no lo está, o se renombró.',
          );
        }
      }
    }
  }

  return findings;
}

cli.run({
  name: 'gate-candidates',
  script: 'scripts/check-gate-candidates.js',
  needsRepo: false,

  scan(ctx) {
    // `--file` lintea otro archivo con el mismo formato (lo usan los tests).
    const given = ctx.arg('--file');
    const file = given ? path.resolve(given) : path.join(ROOT, REGISTRY);
    if (!fs.existsSync(file)) {
      return cli.unverified(`no existe ${given || REGISTRY}`, 'Lo trae la base; template-sync lo restaura.');
    }

    const entries = parseEntries(fs.readFileSync(file, 'utf8'));
    const found = lint(entries, knownIds());
    return cli.findings(found, { emptyMessage: `${entries.length} entradas con estado y referencias válidos` });
  },
});
