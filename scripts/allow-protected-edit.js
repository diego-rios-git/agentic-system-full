#!/usr/bin/env node
/**
 * allow-protected-edit.js — autorización TEMPORAL del operador para editar un
 * archivo de una ruta protegida (por ejemplo, una migración ya generada).
 *
 * Existe porque `scripts/hooks/pre-write-protected.js` bloquea toda edición de
 * esos archivos. El bloqueo es correcto por defecto —lo generado no se retoca sin
 * que alguien lo decida—, pero a veces al archivo generado le falta algo real (un
 * `down()` que no revierte, un renombre que el generador convirtió en borrar y
 * crear). Para ese caso el agente avisa, el operador mira, y si está de acuerdo
 * abre la puerta con este comando.
 *
 * Lo corre el OPERADOR, no el agente. Un agente que se autoriza a sí mismo vacía
 * el sentido del bloqueo (y el hook tampoco lo deja escribir el archivo de la
 * autorización).
 *
 * Uso (desde la raíz del workspace):
 *   node scripts/allow-protected-edit.js <archivo> [--minutes N] [--note "texto"]
 *   node scripts/allow-protected-edit.js --status
 *   node scripts/allow-protected-edit.js --revoke [<archivo>]
 *
 * La autorización queda en `.protected-edit-allow.json` (gitignoreado), vale para
 * ese archivo y vence sola: 30 minutos por defecto, 480 como máximo. Se guarda el
 * NOMBRE del archivo, no la ruta: el mismo archivo se ve distinto desde la raíz y
 * desde un slot, y una comparación de rutas fallaría por eso sin ningún motivo
 * real. Puede haber varias autorizaciones a la vez, una por archivo.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ALLOW_NAME = '.protected-edit-allow.json';
const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 480;

/** La raíz del workspace: el ancestro más externo con `ai-workspace.json`. */
function workspaceRoot() {
  try {
    const found = require('./lib/worktree-paths').findWorkspaceRoot(process.cwd());
    if (found) return found;
  } catch {
    // sin el módulo: se cae a la raíz de este script
  }
  return path.resolve(__dirname, '..');
}

function allowPath() {
  return path.join(workspaceRoot(), ALLOW_NAME);
}

/** Las autorizaciones guardadas, ya vencidas incluidas. */
function readAllows() {
  try {
    const data = JSON.parse(fs.readFileSync(allowPath(), 'utf8'));
    if (Array.isArray(data.allows)) return data.allows;
    if (data && data.file) return [data];
  } catch {
    // no hay archivo, o no se entiende: se empieza de cero
  }
  return [];
}

function writeAllows(list) {
  if (list.length === 0) {
    try {
      fs.unlinkSync(allowPath());
    } catch {
      // ya no estaba
    }
    return;
  }
  fs.writeFileSync(allowPath(), JSON.stringify({ allows: list }, null, 2) + '\n');
}

const live = (a) => Number.isFinite(Date.parse(a.expiresAt || '')) && Date.parse(a.expiresAt) > Date.now();

function status() {
  const all = readAllows();
  if (all.length === 0) {
    console.log('No hay ninguna autorización. Los archivos protegidos están bloqueados para edición.');
    return 0;
  }
  for (const a of all) {
    console.log(`Archivo autorizado: ${a.file}`);
    console.log(`  Vence: ${a.expiresAt}${live(a) ? '' : '  (ya vencida: el bloqueo está activo)'}`);
    if (a.note) console.log(`  Motivo: ${a.note}`);
  }
  return 0;
}

function revoke(file) {
  const all = readAllows();
  if (all.length === 0) {
    console.log('No había ninguna autorización.');
    return 0;
  }
  const name = file ? path.basename(file) : null;
  const rest = name ? all.filter((a) => a.file !== name) : [];
  writeAllows(rest);
  console.log(
    name
      ? `Autorización de ${name} revocada.`
      : 'Autorizaciones revocadas. Los archivos protegidos vuelven a estar bloqueados para edición.',
  );
  return 0;
}

function usage() {
  console.error('Uso: node scripts/allow-protected-edit.js <archivo> [--minutes N] [--note "texto"]');
  console.error('     node scripts/allow-protected-edit.js --status');
  console.error('     node scripts/allow-protected-edit.js --revoke [<archivo>]');
  return 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) return usage();
  if (argv.includes('--status')) return status();

  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const skip = new Set();
  for (const flag of ['--minutes', '--note']) {
    const i = argv.indexOf(flag);
    if (i !== -1) skip.add(i + 1);
  }
  const target = argv.find((a, i) => !a.startsWith('-') && !skip.has(i));

  if (argv.includes('--revoke')) return revoke(target);
  if (!target) return usage();

  const minutesArg = valueOf('--minutes');
  const minutes = minutesArg === undefined ? DEFAULT_MINUTES : Number(minutesArg);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
    console.error(`--minutes debe ser un número entre 1 y ${MAX_MINUTES}.`);
    return 1;
  }

  // El nombre, no la ruta: ver el encabezado.
  const file = path.basename(target.split('\\').join('/'));
  if (!file || file === ALLOW_NAME) {
    console.error(`"${target}" no es un archivo que se pueda autorizar.`);
    return 1;
  }

  const note = valueOf('--note');
  const entry = {
    file,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    ...(note ? { note } : {}),
  };

  // Una autorización por archivo; las vencidas se limpian de paso.
  const list = readAllows().filter((a) => live(a) && a.file !== file);
  list.push(entry);
  writeAllows(list);

  console.log(`Autorizada la edición de ${file} durante ${minutes} minutos (hasta ${entry.expiresAt}).`);
  console.log('Para cerrarla antes: node scripts/allow-protected-edit.js --revoke ' + file);
  return 0;
}

process.exit(main());
