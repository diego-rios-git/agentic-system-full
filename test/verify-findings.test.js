#!/usr/bin/env node
/**
 * verify-findings.test.js — los hallazgos inventados se descartan solos.
 *
 * El caso que motiva el script: un agente reporta `archivo.ts:340` y el archivo
 * tiene 20 líneas. Antes eso lo tenía que atrapar el orquestador leyendo una
 * instrucción en prosa; ahora lo atrapa un script, gratis y sin excepción.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { ROOT, runGate } = require('./helpers');

const REPO = path.join(ROOT, 'test', 'fixtures', 'js-repo');
const { verify } = require(path.join(ROOT, 'scripts', 'verify-findings.js'));

const cache = () => new Map();

describe('verify-findings', () => {
  test('acepta un hallazgo que cita código real', () => {
    const res = verify({ file: 'src/malo.service.ts', line: 2 }, REPO, cache());
    assert.equal(res.ok, true);
  });

  test('descarta el que cita una línea más allá del final del archivo', () => {
    const res = verify({ file: 'src/malo.service.ts', line: 9999 }, REPO, cache());
    assert.equal(res.ok, false);
    assert.match(res.reason, /tiene \d+ líneas/);
  });

  test('descarta el que cita un archivo que no existe', () => {
    const res = verify({ file: 'src/inventado.ts', line: 1 }, REPO, cache());
    assert.equal(res.ok, false);
    assert.match(res.reason, /no existe/);
  });

  test('descarta el que cita un fragmento que no está en el archivo', () => {
    const res = verify(
      { file: 'src/malo.service.ts', line: 2, evidence: 'const jamasEscribiEsto = 42;' },
      REPO,
      cache(),
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /fragmento citado no está/);
  });

  test('acepta un fragmento real aunque la línea esté desfasada por poco', () => {
    // Un agente puede contar mal por uno o dos y eso no hace falso el hallazgo;
    // lo que lo hace falso es que el texto no exista en ningún lado.
    const res = verify(
      { file: 'src/malo.service.ts', line: 3, evidence: 'private base = "http://localhost:3000";' },
      REPO,
      cache(),
    );
    assert.equal(res.ok, true);
  });

  test('rechaza una ruta que sale del repositorio', () => {
    const res = verify({ file: '../../.ssh/id_rsa', line: 1 }, REPO, cache());
    assert.equal(res.ok, false);
    assert.match(res.reason, /sale del repositorio/);
  });

  test('acepta un hallazgo sobre el archivo entero, sin línea', () => {
    const res = verify({ file: 'src/malo.service.ts' }, REPO, cache());
    assert.equal(res.ok, true);
  });

  test('como script: sale con 1 y separa verificados de descartados', () => {
    const entrada = JSON.stringify([
      { file: 'src/malo.service.ts', line: 2, summary: 'real' },
      { file: 'src/malo.service.ts', line: 9999, summary: 'inventado' },
    ]);

    const { spawnSync } = require('child_process');
    const run = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'verify-findings.js'), '--repo', 'js-repo', '--json'],
      {
        input: entrada,
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, AI_WORKSPACE_CONFIG: require('./helpers').CONFIG },
      },
    );

    assert.equal(run.status, 1, 'hay hallazgos descartados');

    const salida = JSON.parse(run.stdout);
    assert.equal(salida.verificados.length, 1);
    assert.equal(salida.descartados.length, 1);
    assert.equal(salida.descartados[0].summary, 'inventado');
  });

  test('sale con 2 si la entrada no es JSON', () => {
    const { spawnSync } = require('child_process');
    const run = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'verify-findings.js'), '--repo', 'js-repo', '--json'],
      {
        input: 'esto no es json',
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, AI_WORKSPACE_CONFIG: require('./helpers').CONFIG },
      },
    );

    assert.equal(run.status, 2);
    assert.equal(run.stdout.trim(), '');
  });
});
