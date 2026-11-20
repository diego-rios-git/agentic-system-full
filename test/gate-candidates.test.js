#!/usr/bin/env node
/**
 * gate-candidates.test.js — el registro `ai/gate-candidates.md` se lintea.
 *
 * Un registro que se degrada miente de dos maneras: descartados sin motivo (la
 * próxima persona repite el análisis) e "implementados" que apuntan a una regla
 * que ya no existe (dice que el error está cubierto y no lo está).
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runGate, withTempDir } = require('./helpers');

const SCRIPT = 'scripts/check-gate-candidates.js';

const HEAD = `# Registro

## Formato

\`\`\`markdown
### sin estado, pero esto es el ejemplo del formato y está en un bloque
\`\`\`

## Candidatos

`;

function lint(body, head = HEAD) {
  return withTempDir((dir) => {
    const file = path.join(dir, 'registro.md');
    fs.writeFileSync(file, head + body, 'utf8');
    return runGate(SCRIPT, ['--file', file]);
  });
}

const rulesOfCodes = (r) => (r.findings || []).map((f) => f.rule);

describe('check-gate-candidates', () => {
  test('entradas válidas en los cuatro estados: limpio', () => {
    const r = lint(`### 🟡 Un candidato
- **Cuándo apareció**: revisión

### 🔵 Un analizado
Texto libre.

### ⛔ Un descartado
- **Por qué no es gate**: requiere ejecutar el código contra una base real, no hay forma de verlo leyendo texto.

### ✅ Uno implementado
- **Gate**: \`CORE-1.1\`, \`antipatterns\` y \`scripts/check-secrets.js\`
`);
    assert.equal(r.code, 0, JSON.stringify(r.findings));
    assert.deepEqual(r.findings, []);
  });

  test('GC-1: una entrada sin estado válido', () => {
    const r = lint('### Sin estado\ntexto\n\n### 🔴 Estado inventado\ntexto\n');
    assert.equal(r.code, 1);
    assert.deepEqual(rulesOfCodes(r), ['GC-1', 'GC-1']);
    assert.equal(r.findings[0].line, 11, 'cita la línea del encabezado');
  });

  test('GC-2: un descartado sin motivo, o con un motivo de relleno', () => {
    const sin = lint('### ⛔ Descartado a secas\n- **Cuándo apareció**: producción\n');
    assert.deepEqual(rulesOfCodes(sin), ['GC-2']);

    const corto = lint('### ⛔ Descartado\n- **Por qué no es gate**: no se pudo\n');
    assert.deepEqual(rulesOfCodes(corto), ['GC-2']);
  });

  test('GC-2: el motivo puede ocupar varias líneas', () => {
    const r = lint(`### ⛔ Descartado
- **Por qué no es gate**: la regla marcaba también el caso correcto
  porque el analizador no distingue la declaración dentro del bloque.
`);
    assert.equal(r.code, 0, JSON.stringify(r.findings));
  });

  test('GC-3: un implementado que referencia algo que no existe', () => {
    const r = lint('### ✅ Roto\n- **Gate**: `NO-EXISTE-9.9`\n\n### ✅ Ruta rota\n- **Gate**: `scripts/no-esta.js`\n');
    assert.deepEqual(rulesOfCodes(r), ['GC-3', 'GC-3']);
    assert.match(r.findings[0].message, /NO-EXISTE-9\.9/);
  });

  test('GC-3: un implementado sin ninguna referencia', () => {
    const r = lint('### ✅ Sin referencia\n- **Cuándo apareció**: revisión\n');
    assert.deepEqual(rulesOfCodes(r), ['GC-3']);
  });

  test('GC-3: basta que UNA de varias referencias no exista', () => {
    const r = lint('### ✅ Mixto\n- **Gate**: `CORE-1.1` y `FANTASMA-1`\n');
    assert.deepEqual(rulesOfCodes(r), ['GC-3']);
    assert.match(r.findings[0].message, /FANTASMA-1/);
  });

  test('lo que está antes de `## Candidatos` y dentro de bloques de código no se interpreta como entrada', () => {
    const r = lint('### 🟡 Entrada con un bloque\n```\n### esto no es una entrada\n```\n');
    assert.equal(r.code, 0, JSON.stringify(r.findings));
  });

  test('cada hallazgo se puede ubicar y congelar', () => {
    const r = lint('### Sin estado\n');
    for (const f of r.findings) assert.ok(f.file && f.message && f.code && f.line > 0);
  });

  test('un registro que no existe es no verificado, no limpio', () => {
    const r = runGate(SCRIPT, ['--file', path.join(__dirname, 'no-existe.md')]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), '');
  });

  test('el registro real de la base pasa el lint', () => {
    const r = runGate(SCRIPT, []);
    assert.equal(r.code, 0, JSON.stringify(r.findings));
  });
});
