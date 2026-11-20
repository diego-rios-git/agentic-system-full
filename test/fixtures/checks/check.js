#!/usr/bin/env node
/**
 * check.js — un "typecheck / lint / test runner" de mentira para probar run-checks.
 *
 *   node check.js <modo> [argumentos...]
 *
 * Modos: ok, fail, hang, sleep, artifacts (solo errores de `.next/`), mixed
 * (artefacto + error real), args (registra lo que recibió).
 * Si `CHECK_LOG` está definido, agrega una línea JSON por ejecución con el modo,
 * el directorio de trabajo, los argumentos y cuándo empezó y terminó.
 */

'use strict';

const fs = require('fs');

const [mode, ...rest] = process.argv.slice(2);
const t0 = Date.now();

const log = (extra = {}) => {
  if (process.env.CHECK_LOG) {
    fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify({ mode, cwd: process.cwd(), args: rest, t0, t1: Date.now(), ...extra }) + '\n');
  }
};

switch (mode) {
  case 'ok':
  case 'args':
    process.stdout.write('todo bien\n');
    log();
    process.exit(0);
    break;
  case 'fail':
    process.stdout.write('FAIL src/a.test.ts\n  ● suite › caso que falla\n    expected 1 received 2\nTests: 1 failed, 3 passed, 4 total\n');
    log();
    process.exit(1);
    break;
  case 'hang':
    log();
    setInterval(() => {}, 1000);
    break;
  case 'sleep':
    setTimeout(() => {
      log();
      process.exit(0);
    }, 700);
    break;
  case 'artifacts':
    process.stdout.write(
      '.next/types/validator.ts(1,1): error TS1002: Unterminated string literal.\n' +
        '.next\\dev\\types\\routes.ts(2,1): error TS1005: ; expected.\n',
    );
    log();
    process.exit(2);
    break;
  case 'mixed':
    process.stdout.write(
      '.next/types/validator.ts(1,1): error TS1002: Unterminated string literal.\n' +
        "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    );
    log();
    process.exit(2);
    break;
  default:
    process.exit(9);
}
