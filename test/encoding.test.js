#!/usr/bin/env node
/**
 * encoding.test.js — mojibake en cualquier archivo de texto versionado.
 *
 * El incidente: un test pasaba en VERDE porque el matcher con la tilde rota
 * nunca podía coincidir. Por eso la regla mira también comentarios y archivos
 * que no son código, y por eso importa tanto lo que NO tiene que marcar:
 * `√` sola es la raíz cuadrada, y un texto bien codificado en cualquier idioma
 * es texto.
 *
 * Los caracteres rotos se escriben como escapes `\uXXXX`: este archivo no puede
 * contener el defecto que busca (y lo marcaría a sí mismo).
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { withWorkspace } = require('./workspace-helper');

const ch = (...codes) => String.fromCharCode(...codes);
const A_TILDE = ch(0xc3); // A mayuscula con tilde
const A_CIRC = ch(0xc2);
const SUP3 = ch(0xb3); // superindice tres
const INV = ch(0xbf);  // signo de apertura
const DEG = ch(0xb0);  // grados // A mayuscula con circunflejo

// Rotos (lo que produce leer UTF-8 como latin-1 o MacRoman), por escapes:
const BAD = {
  'A-tilde + 0xB3 (o con tilde)': `diagn${A_TILDE}${SUP3}stico`,
  'A-circunflejo + 0xBF (signo de apertura)': `${A_CIRC}${INV}`,
  'cancion con la o rota': `canci${A_TILDE}${SUP3}n`,
  'comilla simple rota (a, euro, tm)': ch(0xe2, 0x20ac, 0x2122),
  'comillas dobles rotas (a, euro, comillas)': `${ch(0xe2, 0x20ac, 0x201c)} y ${ch(0xe2, 0x20ac, 0x201d)}`,
  'MacRoman: raiz + mayor o igual': ch(0x221a, 0x2265),
  'MacRoman: raiz + copyright': ch(0x221a, 0xa9),
  'grados rotos': `25${A_CIRC}${DEG}`,
};

// Correctos (tienen que seguir pasando):
const GOOD = [
  'diagnóstico', // bien codificado
  'qué canción ¿verdad?',
  'la raíz es √ y el área √2', // √ sola
  `${A_TILDE}B`, // A con tilde seguida de letra ASCII (una sigla)
  `${A_CIRC}C`,
  'これは日本語です',
  'emoji \u{1F600} y ✓',
  'comillas “bien” y ’apóstrofe’',
];

const gate = (ws, args = ['--repo', 'api']) => ws.run('scripts/check-encoding.js', [...args, '--json']);

describe('check-encoding', () => {
  for (const [name, text] of Object.entries(BAD)) {
    test(`marca ${JSON.stringify(name.trim())}`, () => {
      withWorkspace({ repos: [{ name: 'api', files: { 'doc.md': `texto ${text} fin\n` } }] }, (ws) => {
        const r = gate(ws);
        assert.equal(r.code, 1, r.stderr);
        assert.equal(r.json[0].rule, 'ENC-1.1');
        assert.equal(r.json[0].file, 'doc.md');
      });
    });
  }

  test('no marca el texto correcto: bien codificado, √ sola, Ã+ASCII, japonés, emoji', () => {
    withWorkspace({ repos: [{ name: 'api', files: { 'bien.md': `${GOOD.join('\n')}\n` } }] }, (ws) => {
      const r = gate(ws);
      assert.equal(r.code, 0, `marcó: ${r.stdout}`);
      assert.deepEqual(r.json, []);
    });
  });

  test('mira todo archivo de texto versionado, no solo .ts', () => {
    const roto = `// diagn${A_TILDE}${SUP3}stico\n`;
    const files = {};
    for (const ext of ['md', 'py', 'cs', 'json', 'ts', 'yml', 'txt', 'sql']) files[`f.${ext}`] = roto;
    withWorkspace({ repos: [{ name: 'api', files }] }, (ws) => {
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(r.json.map((f) => f.file).sort(), Object.keys(files).sort());
    });
  });

  test('un comentario sí cuenta', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'x.ts': `const a = 1; // ${BAD['cancion con la o rota']}\n` } }] },
      (ws) => {
        assert.equal(gate(ws).code, 1);
      },
    );
  });

  test('no abre binarios ni archivos ignorados por git', () => {
    withWorkspace(
      {
        repos: [
          {
            name: 'api',
            files: {
              '.gitignore': 'ignorado.md\n',
              'ok.md': 'limpio\n',
            },
          },
        ],
      },
      (ws) => {
        ws.write('api', 'ignorado.md', `diagn${A_TILDE}${SUP3}stico\n`);
        fs.writeFileSync(
          path.join(ws.repoDir('api'), 'img.dat'),
          Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`diagn${A_TILDE}${SUP3}stico`, 'utf8')]),
        );
        const r = gate(ws);
        assert.equal(r.code, 0, `marcó: ${r.stdout}`);
      },
    );
  });

  test('un archivo nuevo sin commitear también se revisa', () => {
    withWorkspace({ repos: [{ name: 'api', files: { 'ok.md': 'limpio\n' } }] }, (ws) => {
      assert.equal(gate(ws).code, 0);
      ws.write('api', 'nuevo.md', `diagn${A_TILDE}${SUP3}stico\n`);
      assert.deepEqual(gate(ws).json.map((f) => f.file), ['nuevo.md']);
    });
  });

  test('baseline: congela lo que había y no depende del número de línea', () => {
    withWorkspace({ repos: [{ name: 'api', files: { 'doc.md': `diagn${A_TILDE}${SUP3}stico\n` } }] }, (ws) => {
      assert.equal(ws.run('scripts/check-encoding.js', ['--repo', 'api', '--write-baseline']).code, 0);
      assert.equal(ws.run('scripts/check-encoding.js', ['--repo', 'api', '--baseline', '--json']).code, 0);

      // Mover la línea no la reintroduce.
      ws.write('api', 'doc.md', `una línea nueva arriba\ndiagn${A_TILDE}${SUP3}stico\n`);
      assert.equal(ws.run('scripts/check-encoding.js', ['--repo', 'api', '--baseline', '--json']).code, 0);

      // Una línea rota distinta sí sale.
      ws.write('api', 'otro.md', `canci${A_TILDE}${SUP3}n\n`);
      const r = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--baseline', '--json']);
      assert.equal(r.code, 1);
      assert.deepEqual(r.json.map((f) => f.file), ['otro.md']);
    });
  });

  test('--target revisa un solo archivo', () => {
    withWorkspace(
      { repos: [{ name: 'api', files: { 'a.md': `canci${A_TILDE}${SUP3}n\n`, 'b.md': 'limpio\n' } }] },
      (ws) => {
        const b = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--target', 'b.md', '--json']);
        assert.equal(b.code, 0);
        const a = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--target', 'a.md', '--json']);
        assert.equal(a.code, 1);
        const none = ws.run('scripts/check-encoding.js', ['--repo', 'api', '--target', 'no-esta.md', '--json']);
        assert.equal(none.code, 2);
      },
    );
  });
});
