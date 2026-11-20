#!/usr/bin/env node
/**
 * pre-write-secrets.js — hook PreToolUse sobre Edit y Write.
 *
 * A diferencia de post-edit-checks.js (corre DESPUÉS de escribir y avisa
 * para corregir), este corre ANTES: si el contenido que se está por
 * escribir tiene forma de secreto, la escritura nunca llega a pasar.
 *
 * Convierte la regla de ai/core/rules/datos-sensibles.md en garantía ejecutada
 * en vez de una regla que depende de que alguien se acuerde de aplicarla.
 *
 * Contrato del hook (Claude Code), PreToolUse:
 *   - Recibe por stdin un JSON con tool_name y tool_input.
 *   - exit 0  → permite la escritura.
 *   - exit 2  → BLOQUEA la escritura; stderr vuelve al agente como motivo.
 *
 * Si el detector propio falla por cualquier motivo, se abre la puerta
 * (exit 0): un bug en este script no debe frenar un Write/Edit legítimo.
 *
 * Configurado en .claude/settings.json.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECKER = path.join(__dirname, '..', 'check-secrets.js');

function readStdin() {
  try {
    return require('fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Extrae el texto que se está por escribir, según la tool. */
function getContent(payload) {
  const name = payload.tool_name;
  const input = payload.tool_input || {};

  if (name === 'Write') return input.content || '';
  if (name === 'Edit') return input.new_string || '';
  return '';
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const content = getContent(payload);
  if (!content.trim()) process.exit(0);

  const filePath = payload.tool_input && payload.tool_input.file_path;
  const rel = filePath ? path.relative(ROOT, path.resolve(filePath)).split(path.sep).join('/') : '(desconocido)';

  let result;
  try {
    result = spawnSync(process.execPath, [CHECKER, '--json'], {
      cwd: ROOT,
      input: content,
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch {
    process.exit(0); // el detector falló: no bloqueamos por eso
  }

  if (!result || result.status === 0 || result.status === null) process.exit(0);
  if (result.status !== 1) process.exit(0); // 1 = hallazgos; cualquier otro código es un fallo del script

  let findings;
  try {
    findings = JSON.parse(result.stdout || '[]');
  } catch {
    process.exit(0);
  }
  if (!Array.isArray(findings) || findings.length === 0) process.exit(0);

  const lines = [
    `Escritura bloqueada en ${rel}: parece contener un secreto.`,
    '',
    ...findings.map((f) => `  [${f.rule}] línea ${f.line}: ${f.message}`),
    '',
    'Si es un secreto real: NO lo escribas acá. Describí el caso sin el valor,',
    'o si ya se compartió, seguí el procedimiento de ai/core/rules/datos-sensibles.md.',
    'Si es un falso positivo (un placeholder que no reconoció el detector),',
    'avisale al usuario — puede pedir que se agregue a la lista de exclusiones.',
  ];

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

main();
