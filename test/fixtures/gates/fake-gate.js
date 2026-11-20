#!/usr/bin/env node
/**
 * fake-gate.js — un "gate" de mentira con el comportamiento que pide el test.
 *
 * Existe para probar a `run-gates.js` contra TODOS los desenlaces posibles de un
 * gate sin depender de que uno real los produzca: limpio, con hallazgos, código 3,
 * JSON roto, colgado, `{skipped}`, un objeto en vez de una lista.
 *
 *   --mode ok | dirty | exit3 | badjson | badjson0 | hang | skipped | object | unknown | islas | empty1
 *   --emit a,b,c      rutas de los hallazgos (modos dirty, object, islas)
 *   --repo <valor>    se devuelve en el mensaje: el test comprueba qué `--repo` recibió
 *
 * Si `FAKE_GATE_LOG` está definido, agrega una línea por ejecución: así el test
 * cuenta cuántas veces corrió cada gate.
 */

'use strict';

const fs = require('fs');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const mode = arg('--mode') || 'ok';
const emit = (arg('--emit') || '').split(',').filter(Boolean);
const id = arg('--id') || mode;

if (process.env.FAKE_GATE_LOG) fs.appendFileSync(process.env.FAKE_GATE_LOG, `${id}\n`);

const findings = () =>
  emit.map((file) => ({
    rule: 'FAKE-1',
    file,
    line: 1,
    message: `hallazgo en ${file} (repo=${arg('--repo')}; args=${argv.join(' ')})`,
  }));

switch (mode) {
  case 'ok':
    process.stdout.write('[]\n');
    process.exit(0);
    break;
  case 'dirty':
    process.stdout.write(JSON.stringify(findings()) + '\n');
    process.exit(1);
    break;
  case 'exit3':
    process.stderr.write('el gate se rompió\n');
    process.exit(3);
    break;
  case 'badjson':
    process.stdout.write('esto no es json');
    process.exit(1);
    break;
  case 'badjson0':
    process.stdout.write('{"cortado":');
    process.exit(0);
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    break;
  case 'skipped':
    process.stdout.write(JSON.stringify({ findings: [], skipped: 'no se detectó ningún cambio' }) + '\n');
    process.exit(0);
    break;
  case 'object':
    process.stdout.write(JSON.stringify({ findings: findings() }) + '\n');
    process.exit(emit.length > 0 ? 1 : 0);
    break;
  case 'unknown':
    process.stdout.write(JSON.stringify({ algo: 'que nadie sabe leer' }) + '\n');
    process.exit(0);
    break;
  case 'islas':
    process.stdout.write(JSON.stringify({ islas: emit, muertos: [] }) + '\n');
    process.exit(emit.length > 0 ? 1 : 0);
    break;
  case 'empty1':
    process.stdout.write('[]\n');
    process.exit(1);
    break;
  default:
    process.exit(3);
}
