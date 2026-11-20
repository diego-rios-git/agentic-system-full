#!/usr/bin/env node
/**
 * dispatch.js — corre TODOS los hooks de un evento en un solo proceso.
 *
 *   node scripts/hooks/dispatch.js <evento> <script> [<script>...] --ai-managed
 *
 * Es lo que `scripts/lib/hooks.js` registra en el harness: una entrada por evento
 * en vez de una por hook.
 *
 * ## Por qué
 *
 * Cada hook registrado por separado es un `node` que arranca en cada acción del
 * agente: con todos encendidos, cinco por cada comando de shell y tres por cada
 * escritura, y cada uno vuelve a leer y validar `ai-workspace.json`. El arranque
 * de `node` es lo que domina —50 a 70 ms en una máquina normal, más en Windows
 * con antivirus—, no lo que el hook decide. Acá se paga una vez, la configuración
 * se carga una vez, y los hooks que no les interesa el comando (un `ls`, un `git
 * status`) se descartan antes de cargarla.
 *
 * ## Contrato
 *
 * El mismo de cada hook (ver `scripts/lib/guard-core.js`): JSON por stdin, salida
 * 0 permite, 2 bloquea con el motivo en stderr. Si bloquea más de uno, van todos
 * los motivos.
 *
 * Un script que declara su hook con `core.defineHook` se carga como módulo. Uno
 * que no (un hook propio de un proyecto, escrito a mano) se corre como antes,
 * en su propio proceso y con la misma entrada: el despachador no le exige nada.
 *
 * Fail-open, como cada hook: un script que no carga o que revienta deja una línea
 * de diagnóstico y no bloquea. Un script que falta sí se reporta, porque un hook
 * registrado que no corre es justo el silencio que este sistema evita.
 *
 * Las rutas de los scripts se resuelven contra la raíz donde vive este archivo,
 * no contra el directorio de trabajo: con la sesión abierta dentro de un
 * repositorio, una ruta relativa al cwd no existe.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OWN_ROOT = path.resolve(__dirname, '..', '..');
const MIN_NODE_MAJOR = 18;

function diag(message) {
  try {
    fs.writeSync(2, `[dispatch] ${message}\n`);
  } catch {
    // sin dónde escribir
  }
}

/** Los scripts pedidos, sin el evento, sin flags y sin repetidos. */
function scriptsFrom(argv) {
  const [, ...rest] = argv.filter((a) => !a.startsWith('--'));
  return [...new Set(rest)];
}

/** ¿El archivo declara su hook con `defineHook`? Requerir uno que no, lo ejecutaría. */
function isHookModule(abs) {
  try {
    return fs.readFileSync(abs, 'utf8').includes('defineHook(');
  } catch {
    return false;
  }
}

/** Corre un hook que no es módulo en su propio proceso. Devuelve su motivo si bloqueó. */
function runLegacy(abs, raw, rel) {
  const r = spawnSync(process.execPath, [abs, '--ai-managed'], { input: raw, encoding: 'utf8', windowsHide: true });
  if (r.status === 2) return String(r.stderr || `Bloqueado por ${rel}.`);
  if (r.status !== 0) diag(`${rel} salió con ${r.status === null ? 'un corte' : r.status}; se deja pasar`);
  else if (r.stderr) fs.writeSync(2, r.stderr);
  return null;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    // Con un `node` viejo los hooks pueden no cargar; se dice una vez y claro.
    diag(`Node ${process.versions.node}: la base necesita ${MIN_NODE_MAJOR} o más; los hooks no corren`);
    process.exit(0);
  }

  const scripts = scriptsFrom(process.argv.slice(2));
  if (scripts.length === 0) process.exit(0);

  const core = require('../lib/guard-core');
  const raw = core.readStdin();
  const payload = core.parsePayload(raw);
  if (!payload) process.exit(0);

  const modules = [];
  const legacy = [];
  for (const rel of scripts) {
    const abs = path.resolve(OWN_ROOT, rel);
    if (!fs.existsSync(abs)) {
      diag(`falta ${rel}: ese hook NO está corriendo (regenerá con node scripts/consolidate-skills.js --wrappers)`);
      continue;
    }
    if (!isHookModule(abs)) {
      legacy.push({ abs, rel });
      continue;
    }
    try {
      const { hook } = require(abs);
      if (hook && typeof hook.handler === 'function') modules.push(hook);
      else legacy.push({ abs, rel });
    } catch (err) {
      diag(`${rel} no cargó (${err && err.message}); se deja pasar`);
    }
  }

  const results = await core.evaluate(modules, payload);

  const extra = [];
  for (const { abs, rel } of legacy) {
    const message = runLegacy(abs, raw, rel);
    if (message) extra.push(message);
  }

  core.finish(results, extra);
}

main().catch((err) => {
  diag(`error propio (${err && err.message}); se deja pasar`);
  process.exit(0);
});
