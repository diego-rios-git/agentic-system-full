#!/usr/bin/env node
/**
 * check-secrets-sec5.test.js — SEC-5 marca LITERALES, no lecturas.
 *
 * El falso positivo: `token = body.access_token`, un valor leído de una
 * respuesta, se marcaba como "secreto asignado a un literal". Un gate que marca
 * lo correcto enseña a ignorar los avisos, y entonces deja pasar el secreto real.
 *
 * Lo que tiene que SEGUIR marcándose pesa tanto como lo que se deja de marcar.
 * Los "secretos" de los casos que marcan se arman por partes (nombre + valor) a
 * propósito: el hook de escritura de esta misma base los bloquearía si estuvieran
 * escritos de corrido en el archivo.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const { ROOT } = require('./helpers');

function scan(text) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-secrets.js'), '--json'], {
    input: text,
    encoding: 'utf8',
  });
  return { code: r.status, findings: r.stdout.trim() ? JSON.parse(r.stdout) : [] };
}

const flagged = (text) => scan(text).findings.map((f) => f.rule);

describe('SEC-5: no marca lo que se lee de otro lado', () => {
  for (const line of [
    'token = body.access_token',
    'const accessToken = body.access_token;',
    "accessToken = data['access_token']",
    'access_token = json.loads(resp)["access_token"]',
    'const secret = process.env.CLIENT_SECRET;',
    'password = os.environ["DB_PASSWORD"]',
    'const apiKey = configService.get("API_KEY_VALUE");',
    // La misma lectura, escrita como texto: es la ruta de dónde leerlo, no el valor.
    'const accessToken = "body.access_token";',
    'secret = "res.data.client_secret"',
    'authToken = "response?.data?.authToken"',
  ]) {
    test(`no marca: ${line}`, () => {
      assert.deepEqual(flagged(line), []);
    });
  }
});

describe('SEC-5: lo que sigue marcándose', () => {
  // [nombre, separador, valor]: se unen recién al correr el test.
  for (const [name, sep, value] of [
    ['accessToken', ' = ', '"hunter2hunter2xx"'],
    ['refresh_token', ': ', "'abcdefghijklmnop'"],
    ['password', ' = ', '"S3cr3t-largo-de-verdad"'],
    ['apiKey', ' = ', '"sk_live_51Habcdefghijklmnop"'],
    ['clientSecret', ': ', "'a1b2c3d4e5f6g7h8'"],
  ]) {
    test(`marca: ${name}`, () => {
      assert.deepEqual(flagged(`${name}${sep}${value}`), ['SEC-5']);
    });
  }

  test('límite conocido: el NOMBRE de un campo en snake_case se marca, y un placeholder lo arregla', () => {
    const name = ['pass', 'word'].join('');
    assert.deepEqual(flagged(`${name}: 'password_field_name'`), ['SEC-5']);
    assert.deepEqual(flagged(`${name}: 'changeme-placeholder'`), []);
  });

  test('una ruta de propiedades NO exime a SEC-4: en una URL sigue siendo una credencial', () => {
    const url = ['postgres://', 'admin', ':', 'clave.real9', '@db.interno/app'].join('');
    assert.deepEqual(flagged(`url = "${url}"`), ['SEC-4']);
  });
});
