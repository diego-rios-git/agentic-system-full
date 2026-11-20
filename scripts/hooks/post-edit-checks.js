#!/usr/bin/env node
/**
 * post-edit-checks.js — hook PostToolUse sobre Edit y Write.
 *
 * Da feedback inmediato en el mismo turno en que se escribe el archivo, en vez
 * de esperar a que un humano lo encuentre en la revisión del PR.
 *
 * Corre SOLO los gates que corresponden al archivo tocado: pagarlos todos en
 * cada edición sería lento, y un hook lento se termina desactivando. Qué gate
 * corresponde a qué archivo lo decide el registro de `scripts/lib/gates.js`, que
 * se arma con lo que declaran el núcleo y los packs instalados.
 *
 * Todos corren con baseline: la deuda preexistente está congelada y solo se
 * reporta lo que se introduce ahora. Sin eso el hook sería ruido permanente.
 *
 * Contrato del hook:
 *   - Recibe por stdin un JSON con `tool_input.file_path`.
 *   - exit 0 → todo bien, silencioso.
 *   - exit 2 → hallazgo: stderr vuelve al agente para que corrija.
 *
 * Nunca modifica código: solo lee y avisa. Y ante cualquier fallo propio —
 * configuración ausente, gate roto, JSON ilegible — deja pasar la escritura:
 * un bug en este script no puede frenar el trabajo.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('../lib/workspace-config');
const gates = require('../lib/gates');

const ROOT = config.ROOT;
const LOG_PATH = path.join(ROOT, '.ai-gates-log.jsonl');

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function getEditedPath(raw) {
  if (!raw.trim()) return null;
  try {
    const payload = JSON.parse(raw);
    const input = payload.tool_input || {};
    return input.file_path || input.notebook_path || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * Corre un gate y devuelve solo los hallazgos que caen EN el archivo editado.
 *
 * Los gates que no aceptan acotarse a un archivo barren el repositorio entero.
 * Reportar todo sería ruido: al tocar un archivo nadie necesita enterarse de un
 * problema en otro módulo que no abrió. El aviso llega cuando alguien edita el
 * archivo que lo tiene.
 */
function run(gate, args, relEdited) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [...args, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
  } catch (err) {
    // exit 1 es "encontré algo". Cualquier otro código es un fallo del gate:
    // no se le reporta al agente como si fuera culpa suya.
    if (err.status !== 1) return null;
    raw = err.stdout || '';
  }

  let findings;
  try {
    findings = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(findings) || findings.length === 0) return null;

  const mine = findings.filter((f) => {
    const p = String(f.file || '').split('\\').join('/');
    return p && (relEdited.endsWith(p) || p.endsWith(relEdited));
  });
  if (mine.length === 0) return null;

  return mine
    .map((f) => {
      const where = f.line ? `:${f.line}` : '';
      const what = f.message || f.target || f.code || '';
      const label = f.rule ? `[${f.rule}] ` : '';
      return `  ${label}${String(f.file).split('\\').join('/')}${where}\n    ${what}`;
    })
    .join('\n');
}

/**
 * Una línea JSONL por corrida CON gate aplicable — no una por cada escritura,
 * para no meter ruido de archivos sin gate. Local y fuera del control de
 * versiones: sirve para saber más adelante si esto se usa de verdad, sin mandar
 * nada a ningún servicio.
 *
 * Si escribir el registro falla, no interrumpe el hook: la decisión de bloquear
 * o no ya se tomó antes.
 */
function logRun(relEdited, plan, findingCount, blocked) {
  try {
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        ts: new Date().toISOString(),
        file: relEdited,
        gates: plan.map((g) => g.id),
        gatesWithFindings: findingCount,
        blocked,
      }) + '\n',
    );
  } catch {
    // no bloquear el hook por un fallo de registro
  }
}

function main() {
  const filePath = getEditedPath(readStdin());
  if (!filePath) process.exit(0);

  // Sin configuración no hay proyecto todavía: nada que verificar. Se sale en
  // silencio en vez de fallar, porque este hook puede quedar activo en el
  // repositorio de la propia base.
  let cfg;
  try {
    cfg = config.load({ optional: true });
  } catch {
    process.exit(0);
  }
  if (!cfg) process.exit(0);

  let plan;
  let at;
  try {
    const selected = gates.forFile(cfg, filePath);
    plan = selected.gates;
    at = selected.at;
  } catch {
    process.exit(0);
  }
  if (!at || plan.length === 0) process.exit(0);

  const findings = [];
  for (const gate of plan) {
    const perFile = gates.supportsSingleFile(gate);
    const args = gates.argsFor(
      gate,
      { repo: at.repo ? at.repo.name : '', scope: at.repo ? at.repo.name : 'workspace', rel: at.rel },
      perFile,
    );
    const output = run(gate, args, at.rel);
    if (output) findings.push({ gate, output });
  }

  if (findings.length === 0) {
    logRun(at.rel, plan, 0, false);
    process.exit(0);
  }

  const lines = ['Los gates encontraron algo nuevo en lo que acabás de escribir:', ''];
  for (const { gate, output } of findings) {
    lines.push(`── ${gate.label} ──`);
    lines.push(output);
    lines.push(`Fuente de la regla: ${gate.source}`);
    lines.push('');
  }
  lines.push('Corregilo antes de seguir. Estos hallazgos son nuevos: la deuda');
  lines.push('preexistente está congelada en el baseline y no se reporta.');

  logRun(at.rel, plan, findings.length, true);
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

main();
