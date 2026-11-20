#!/usr/bin/env node
/**
 * unreachable.test.js — ¿alguien puede llegar a lo que cambió?
 *
 *   UNREACH-1  archivo nuevo que nadie importa fuera del cambio (isla)
 *   UNREACH-2  archivo editado que solo importan los tests (muerto editado)
 *
 * El perfil de lenguaje se declara en la configuración del repositorio de prueba
 * (`repos[].language`): el gate no sabe nada de ningún lenguaje, lee qué es un
 * import, un test y una raíz de lo que el perfil declara.
 *
 * Los casos que tienen que SEGUIR pasando pesan tanto como los que marcan: un
 * gate que marca de más (el hijo montado por un padre integrado, la raíz de un
 * framework) se termina ignorando.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { withWorkspace } = require('./workspace-helper');

const LANGUAGE = {
  id: 'ts-test',
  extensions: ['.ts', '.tsx'],
  testPatterns: ['\\.test\\.tsx?$'],
  imports: {
    patterns: [
      '\\bfrom\\s*[\'"]([^\'"\\n]+)[\'"]',
      '\\bimport\\s*[\'"]([^\'"\\n]+)[\'"]',
      '\\b(?:import|require)\\s*\\(\\s*[\'"]([^\'"\\n]+)[\'"]',
    ],
    aliases: [{ prefix: '@/', to: 'src/' }],
  },
  // Lo que un framework monta por convención, sin que nadie lo importe.
  entrypoints: ['(^|/)pages/', '(^|/)main\\.ts$'],
};

const BASE_FILES = {
  'src/main.ts': "import { s } from './screen';\nexport const app = s;\n",
  'src/pool/filters.ts': 'export const filtroViejo = 1;\n',
  'src/pool/movements/filters.ts': 'export const filtro = 1;\n',
  'src/screen.ts': "import { filtro } from './pool/movements/filters';\nexport const s = filtro;\n",
  'src/lib/index.ts': 'export const lib = 1;\n',
  'src/pool/filters.test.ts': "import { filtroViejo } from './filters';\n",
};

const SPEC = { repos: [{ name: 'app', files: BASE_FILES, extra: { language: LANGUAGE } }] };

const gate = (ws, args = ['--repo', 'app']) => ws.run('scripts/check-unreachable-code.js', [...args, '--json']);
const filesOf = (r, rule) => (r.json || []).filter((f) => f.rule === rule).map((f) => f.file).sort();

describe('check-unreachable-code', () => {
  test('marca una isla: archivo nuevo que nadie importa', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/isla.ts', 'export const x = 1;\n');
      const r = gate(ws);
      assert.equal(r.code, 1, r.stderr);
      assert.deepEqual(filesOf(r, 'UNREACH-1'), ['src/isla.ts']);
    });
  });

  test('no marca: un archivo nuevo que importa uno existente de afuera del cambio', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/feature.ts', 'export const f = 1;\n');
      ws.write('app', 'src/main.ts', "import { f } from './feature';\nexport const app = f;\n");
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
      assert.deepEqual(r.json, []);
    });
  });

  test('cierre transitivo: un hijo montado por un padre integrado no es isla', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/padre.ts', "import { h } from './hijo';\nexport const p = h;\n");
      ws.write('app', 'src/hijo.ts', "import { n } from './nieto';\nexport const h = n;\n");
      ws.write('app', 'src/nieto.ts', 'export const n = 1;\n');
      ws.write('app', 'src/main.ts', "import { p } from './padre';\nexport const app = p;\n");
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('marca el grupo entero cuando nadie de afuera llega a la raíz del grupo', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/padre.ts', "import { h } from './hijo';\nexport const p = h;\n");
      ws.write('app', 'src/hijo.ts', "import { p } from './padre';\nexport const h = 1; export const q = p;\n");
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(filesOf(r, 'UNREACH-1'), ['src/hijo.ts', 'src/padre.ts']);
    });
  });

  test('un test que importa al archivo nuevo no lo vuelve alcanzable', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/capa.ts', 'export const c = 1;\n');
      ws.write('app', 'src/capa.test.ts', "import { c } from './capa';\n");
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(filesOf(r, 'UNREACH-1'), ['src/capa.ts']);
    });
  });

  test('un test nuevo solo, o un archivo de test editado, no se marca', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/otro.test.ts', "import { app } from './main';\n");
      ws.write('app', 'src/pool/filters.test.ts', "import { filtroViejo } from './filters';\n// editado\n");
      assert.equal(gate(ws).code, 0);
    });
  });

  test('marca un muerto editado: el archivo modificado lo importa solo un test', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/pool/filters.ts', 'export const filtroViejo = 2;\n');
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(filesOf(r, 'UNREACH-2'), ['src/pool/filters.ts']);
    });
  });

  test('un archivo editado que sí monta una pantalla no se marca', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/pool/movements/filters.ts', 'export const filtro = 2;\n');
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('resuelve imports de verdad: un homónimo en otra carpeta no salva al muerto', () => {
    // `pool/filters.ts` y `pool/movements/filters.ts` se llaman igual. La pantalla
    // importa SOLO el segundo; por nombre de archivo, el primero parecería usado.
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/pool/filters.ts', 'export const filtroViejo = 3;\n');
      ws.write('app', 'src/pool/movements/filters.ts', 'export const filtro = 3;\n');
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(filesOf(r, 'UNREACH-2'), ['src/pool/filters.ts']);
    });
  });

  test('resuelve alias del perfil y la carpeta con índice', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/lib/util.ts', 'export const u = 1;\n');
      ws.write('app', 'src/lib/index.ts', "export const lib = 1;\nexport * from './util';\n");
      ws.write('app', 'src/screen.ts', "import { lib } from '@/lib';\nimport { filtro } from './pool/movements/filters';\nexport const s = lib + filtro;\n");
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('un import de varias líneas y un import de efecto cuentan', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/a.ts', 'export const a = 1;\n');
      ws.write('app', 'src/b.ts', 'export const b = 1;\n');
      ws.write(
        'app',
        'src/screen.ts',
        "import {\n  a,\n} from './a';\nimport './b';\nimport { filtro } from './pool/movements/filters';\nexport const s = a + filtro;\n",
      );
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('un import dentro de un comentario no cuenta', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'src/isla.ts', 'export const x = 1;\n');
      ws.write('app', 'src/screen.ts', "// import { x } from './isla';\nimport { filtro } from './pool/movements/filters';\nexport const s = filtro;\n");
      const r = gate(ws);
      assert.equal(r.code, 1);
      assert.deepEqual(filesOf(r, 'UNREACH-1'), ['src/isla.ts']);
    });
  });

  test('las raíces por convención no se marcan, y lo que montan queda alcanzable', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('app', 'pages/home.ts', "import { w } from '../src/widget';\nexport default w;\n");
      ws.write('app', 'src/widget.ts', 'export const w = 1;\n');
      const r = gate(ws);
      assert.equal(r.code, 0, r.stdout);
    });
  });

  test('sin diff: limpio', () => {
    withWorkspace(SPEC, (ws) => {
      const r = gate(ws);
      assert.equal(r.code, 0);
      assert.deepEqual(r.json, []);
    });
  });

  test('lenguaje sin `imports` declarado: sale con 2, no con 0', () => {
    const { imports, ...sinImports } = LANGUAGE;
    // `languages` restringe el repo a ESTE perfil: sin eso aplicaría también el
    // perfil JavaScript del núcleo, que sí declara `imports`.
    const extra = { language: sinImports, languages: [sinImports.id] };
    withWorkspace({ repos: [{ name: 'app', files: BASE_FILES, extra }] }, (ws) => {
      ws.write('app', 'src/isla.ts', 'export const x = 1;\n');
      const r = gate(ws);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
      assert.match(r.stderr, /imports/);
    });
  });

  test('base ilegible: sale con 2', () => {
    withWorkspace(SPEC, (ws) => {
      const r = gate(ws, ['--repo', 'app', '--base', 'origin/no-existe']);
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('desde un slot: el cambio del slot se evalúa, la principal queda limpia', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('app', 'review');
      fs.writeFileSync(path.join(ws.slotDir('app', 'review'), 'src', 'isla.ts'), 'export const x = 1;\n');

      assert.equal(gate(ws).code, 0, 'la principal no tiene el cambio');

      const slot = gate(ws, ['--repo', `${ws.relDir}/worktrees/review/app`]);
      assert.equal(slot.code, 1, slot.stderr);
      assert.deepEqual(filesOf(slot, 'UNREACH-1'), ['src/isla.ts']);
    });
  });
});
