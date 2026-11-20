#!/usr/bin/env node
/**
 * preflight.js
 *
 * Qué necesita la máquina para que la base funcione, comprobado en vez de
 * supuesto.
 *
 * Por qué existe: los hooks se registran como `node "<ruta>"` y los corre el
 * harness con el `node` que encuentre en el PATH, que no tiene por qué ser el que
 * corrió `init.js` (nvm, un instalador distinto, una sesión sin el PATH del
 * usuario). Sin `node` en el PATH cada hook sale con 127: el harness lo trata
 * como un error que no bloquea, y todos los guards quedan apagados a la vez, sin
 * que nada lo diga más que una línea de error en cada acción. Con un `node`
 * viejo, peor: pueden fallar al cargar.
 *
 * `git` no es obligatorio para que la base arranque, pero sin él los gates que
 * listan archivos versionados salen con 2 ("no verificado") y la status line
 * no muestra ramas: se avisa para que no sorprenda.
 *
 *   const pf = require('./lib/preflight');
 *   const { errors, warnings } = pf.check();
 */

'use strict';

const { spawnSync } = require('child_process');

const MIN_NODE_MAJOR = 18;

function major(version) {
  const m = /^v?(\d+)\./.exec(String(version || '').trim());
  return m ? Number(m[1]) : null;
}

/** La versión del ejecutable `name` en el PATH, o `null` si no se encuentra. */
function versionOf(name) {
  try {
    const r = spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {{versionOf?: Function, current?: string}} [deps] solo para los tests
 * @returns {{errors: string[], warnings: string[], node: string|null, git: string|null}}
 */
function check(deps = {}) {
  const probe = deps.versionOf || versionOf;
  const current = deps.current || process.versions.node;
  const errors = [];
  const warnings = [];

  if (major(current) < MIN_NODE_MAJOR) {
    errors.push(`Node ${current}: la base necesita ${MIN_NODE_MAJOR} o más.`);
  }

  const node = probe('node');
  if (!node) {
    errors.push(
      '`node` no está en el PATH. Los hooks se registran como `node "<ruta>"`: sin él, ' +
        'ninguno corre y el harness solo muestra un error por acción.',
    );
  } else if (major(node) !== null && major(node) < MIN_NODE_MAJOR) {
    errors.push(`El \`node\` del PATH es ${node}: los hooks necesitan ${MIN_NODE_MAJOR} o más.`);
  }

  const git = probe('git');
  if (!git) {
    warnings.push(
      '`git` no está en el PATH: los gates que listan archivos versionados van a salir ' +
        'como "no verificado" y la status line no va a mostrar ramas.',
    );
  }

  return { errors, warnings, node, git };
}

/** Las líneas para mostrar, con un prefijo. */
function report(result, write = (l) => process.stderr.write(`${l}\n`)) {
  for (const e of result.errors) write(`  ERROR: ${e}`);
  for (const w of result.warnings) write(`  aviso: ${w}`);
}

module.exports = { MIN_NODE_MAJOR, check, report, major };
