#!/usr/bin/env node
/**
 * validar-ficha.test.js — el validador de estructura de fichas del pack
 * analisis-funcional (`ai/packs/analisis-funcional/scripts/validar-ficha.js`),
 * corrido como lo corre un proyecto: el script real, en un proceso aparte.
 *
 * Lo que importa es tanto que marque lo que falta como que deje pasar una ficha
 * bien armada (un validador que corta de más se deja de usar), y que nunca
 * salga 0 con algo que no es una ficha.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, withTempDir } = require('./helpers');

const SIN_PACK = require('./helpers').packsMissing(['analisis-funcional']);
if (SIN_PACK) {
  test('validar-ficha: se omite', { skip: SIN_PACK }, () => {});
  return;
}

const SCRIPT = path.join(ROOT, 'ai', 'packs', 'analisis-funcional', 'scripts', 'validar-ficha.js');

const BUENA = `---
tipo: requisito
rf: RF-2.04
titulo: "Cupo diario por sede"
estado: analisis
version: 2.0
perfil: calculo
actualizado: 2026-10-09
---

# RF-2.04 — Cupo diario por sede

> **En una línea:** el responsable de la sede ve cuántos turnos le quedan en el día para no sobrevender.

## Qué pide

Cada sede tiene un cupo diario de turnos. Hoy se controla a mano y se sobrevende.

## Reglas

- **R1.** Cuando se confirma un turno, el sistema debe descontarlo del cupo del día de la sede.
- **R2.** Si el cupo restante es menor o igual a 0, el sistema debe rechazar la confirmación.

\`\`\`text
cupo restante = cupo diario − turnos confirmados del día
\`\`\`

Sin redondeo: son unidades enteras.

| Caso | Datos | Resultado |
|---|---|---|
| Dentro | cupo 10, confirmados 8 | quedan 2, se confirma |
| Límite | cupo 10, confirmados 10 | quedan 0, se rechaza |
| Fuera | cupo 10, confirmados 11 | se rechaza y se avisa |

## Escenarios de aceptación

#### Escenario: se confirma con cupo
Verifica R1.
- **DADO** la sede Centro con cupo 10 y 8 turnos confirmados el martes 14
- **CUANDO** se confirma un turno para el martes 14
- **ENTONCES** quedan 1 turno de cupo

#### Escenario: se rechaza en el límite
Verifica R2.
- **DADO** la sede Centro con cupo 10 y 10 turnos confirmados el martes 14
- **CUANDO** se intenta confirmar otro turno
- **ENTONCES** se rechaza y el cupo sigue en 0

## Errores y casos borde

| Situación | Qué pasa | Qué ve quien lo vive |
|---|---|---|
| Dos confirmaciones a la vez con 1 de cupo | Se confirma una sola | La otra ve "sin cupo" |

## Fuera de alcance

- Cupos por profesional: es RF-2.05 — Cupo por profesional.

## Datos y reglas que toca

- Ninguno.

## Decisiones abiertas

- Ninguna.

## Cómo quedó

Todavía no se construyó nada.

## Historial

| Versión | Fecha | Qué cambió | Por qué | Quién decidió |
|---|---|---|---|---|
| 2.0 | 2026-10-09 | R2 rechaza en 0 | Q-02 | PM |

| Lugar de la v1.0 | Estado |
|---|---|
| R1 | preservado |
| R2 | corregido: antes rechazaba en negativo |
`;

function run(content) {
  return withTempDir((dir) => {
    const file = path.join(dir, 'ficha.md');
    fs.writeFileSync(file, content);
    const res = spawnSync(process.execPath, [SCRIPT, '--json', file], { cwd: dir, encoding: 'utf8' });
    const out = res.stdout ? JSON.parse(res.stdout) : null;
    return { code: res.status, out, stderr: res.stderr };
  });
}

const rules = (r) => r.out.errors.map((e) => e.rule);

describe('validar-ficha', () => {
  test('una ficha bien armada pasa sin errores', () => {
    const r = run(BUENA);
    assert.equal(r.code, 0, JSON.stringify(r.out && r.out.errors));
    assert.deepEqual(r.out.errors, []);
  });

  test('una regla sin escenario es un error', () => {
    const r = run(BUENA.replace('- **R2.** Si', '- **R3.** Cuando la sede cierra, el sistema debe liberar el cupo.\n- **R2.** Si'));
    assert.equal(r.code, 1);
    assert.ok(rules(r).includes('FICHA-COBERTURA'));
  });

  test('un escenario que no dice qué verifica es un error', () => {
    const r = run(BUENA.replace('Verifica R1.\n', ''));
    assert.equal(r.code, 1);
    assert.ok(rules(r).includes('FICHA-ESC'));
  });

  test('perfil cálculo sin la tabla dentro/límite/fuera es un error', () => {
    const r = run(BUENA.replace('| Límite | cupo 10, confirmados 10 | quedan 0, se rechaza |\n', ''));
    assert.equal(r.code, 1);
    assert.ok(rules(r).includes('FICHA-PERFIL'));
  });

  test('una versión nueva sin la matriz de no regresión es un error', () => {
    const r = run(BUENA.replace(/\| Lugar de la v1\.0[\s\S]*$/, ''));
    assert.equal(r.code, 1);
    assert.ok(rules(r).includes('FICHA-HISTORIAL'));
  });

  test('falta una sección de las de siempre', () => {
    const r = run(BUENA.replace('## Fuera de alcance', '## Otra cosa'));
    assert.equal(r.code, 1);
    assert.ok(rules(r).includes('FICHA-SECCION'));
  });

  test('una ficha en pendiente solo necesita Qué pide', () => {
    const r = run('---\ntipo: requisito\nrf: RF-2.09\ntitulo: "Reporte"\nestado: pendiente\nactualizado: 2026-10-09\n---\n\n# RF-2.09 — Reporte\n\n## Qué pide\n\nUn reporte mensual de turnos por sede.\n');
    assert.equal(r.code, 0);
  });

  test('un id sin su nombre es un aviso, no un error', () => {
    const r = run(BUENA.replace('es RF-2.05 — Cupo por profesional', 'es RF-2.05'));
    assert.equal(r.code, 0);
    assert.ok(r.out.warnings.some((w) => w.rule === 'AVISO-ID'));
  });

  test('algo que no es una ficha sale con 2', () => {
    const r = run('# Un README\n\nNada que validar.\n');
    assert.equal(r.code, 2);
  });
});
