#!/usr/bin/env node
/**
 * requirements.test.js — `scripts/check-requirements.js`, el gate del tablero
 * de requisitos y la derivación de sus estados.
 *
 * Corre el script real en un proceso aparte, sobre un workspace armado para cada
 * caso, y mira el código de salida además de los hallazgos: un 0 donde tocaba un
 * 2 es el gate roto que se lee como limpio.
 *
 * Los repositorios de `ai-workspace.json` son relativos a la raíz de la base y no
 * pueden salir de ella, así que el workspace de cada caso se arma en una carpeta
 * temporal DENTRO de `test/` y se borra al terminar.
 *
 * Cada regla tiene su caso positivo (el hallazgo aparece) y su caso negativo (lo
 * que tiene que seguir pasando: un gate que corta de más se desactiva).
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT } = require('./helpers');

// Estas pruebas viajan a cada proyecto, y `init` descarta los packs que no se
// eligieron: sin el pack openspec no hay nada que probar acá. Se omite con el
// motivo a la vista, no se deja fallar por una razón que no es un defecto.
const SIN_PACK = require('./helpers').packsMissing(['openspec']);
if (SIN_PACK) {
  test('check-requirements: se omite', { skip: SIN_PACK }, () => {});
  return;
}

const SCRIPT = path.join(ROOT, 'scripts', 'check-requirements.js');

// ---------------------------------------------------------------------------
// Armado del caso
// ---------------------------------------------------------------------------

/** El texto de una ficha. `extra` se agrega crudo al front matter. */
function ficha({ rf = 'RF-1.01', titulo = 'Reserva', estado = 'cerrado', extra = '', cuerpo = '' } = {}) {
  const lines = ['---', 'tipo: requisito'];
  if (rf !== null) lines.push(`rf: ${rf}`);
  lines.push(`titulo: "${titulo}"`);
  if (estado !== null) lines.push(`estado: ${estado}`);
  if (extra) lines.push(extra.trim());
  lines.push('actualizado: 2026-01-01', '---', '', `# ${titulo}`, '', cuerpo);
  return `${lines.join('\n')}\n`;
}

/** Un change: `meta` es el contenido de su archivo de metadatos. */
function change(name, { archived = false, date = '2026-09-01', meta = '' } = {}) {
  return { name, archived, date, meta };
}

/**
 * Arma el workspace y devuelve `{ run, read, cleanup }`.
 *
 * @param {object} spec
 * @param {Object<string,string>} [spec.fichas] nombre de archivo -> texto
 * @param {Object<string,object[]>} [spec.changes] repo -> changes
 * @param {object|null} [spec.req] bloque `requirements` (null = el proyecto no tiene)
 * @param {string[]} [spec.packs] packs del repo `api`
 * @param {boolean} [spec.cloned=true] si el repo existe en disco
 */
function build(spec = {}) {
  const id = `.tmp-req-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const base = path.join(ROOT, 'test', id);
  const relBase = `test/${id}`;
  fs.mkdirSync(path.join(base, 'requisitos'), { recursive: true });

  for (const [name, text] of Object.entries(spec.fichas || {})) {
    fs.mkdirSync(path.dirname(path.join(base, 'requisitos', name)), { recursive: true });
    fs.writeFileSync(path.join(base, 'requisitos', name), text);
  }

  if (spec.cloned !== false) {
    fs.mkdirSync(path.join(base, 'api', 'openspec', 'changes', 'archive'), { recursive: true });
    for (const [repo, list] of Object.entries(spec.changes || {})) {
      for (const c of list) {
        const dirName = c.archived ? `${c.date}-${c.name}` : c.name;
        const dir = c.archived
          ? path.join(base, repo, 'openspec', 'changes', 'archive', dirName)
          : path.join(base, repo, 'openspec', 'changes', dirName);
        fs.mkdirSync(dir, { recursive: true });
        if (c.meta !== null) fs.writeFileSync(path.join(dir, '.openspec.yaml'), c.meta);
      }
    }
  }

  const cfg = {
    version: 1,
    project: { name: 'prueba' },
    topology: 'multi-repo',
    repos: [{ name: 'api', path: `${relBase}/api`, packs: spec.packs || ['openspec'], baseBranch: 'main' }],
    harnesses: [],
  };
  if (spec.req !== null) cfg.requirements = { dir: `${relBase}/requisitos`, ...(spec.req || {}) };

  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-req-'));
  const cfgFile = path.join(cfgDir, 'ai-workspace.json');
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));

  return {
    base,
    run(args = [], { json = true } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args, ...(json ? ['--json'] : [])], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, AI_WORKSPACE_CONFIG: cfgFile },
      });
      let parsed = null;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        // salida de texto o vacía
      }
      return { code: r.status, stdout: String(r.stdout), stderr: String(r.stderr), json: parsed };
    },
    read: (name) => fs.readFileSync(path.join(base, 'requisitos', name), 'utf8'),
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(cfgDir, { recursive: true, force: true });
    },
  };
}

/** Corre `fn` con el workspace y lo borra al terminar, falle o no. */
function withWs(spec, fn) {
  const ws = build(spec);
  try {
    return fn(ws);
  } finally {
    ws.cleanup();
  }
}

const rules = (r) => [...new Set((r.json || []).map((f) => f.rule))].sort();

// ---------------------------------------------------------------------------
// Sin tablero, sin proveedor, sin repositorio
// ---------------------------------------------------------------------------

describe('cuando no hay qué verificar, o no se puede', () => {
  test('sin `requirements` dice "no aplica" y sale 0, sin simular una verificación', () => {
    withWs({ req: null }, (ws) => {
      const humano = ws.run([], { json: false });
      assert.equal(humano.code, 0);
      assert.match(humano.stdout, /No aplica/);
      assert.match(humano.stdout, /No se verificó nada/);
      assert.deepEqual(ws.run().json, []);
    });
  });

  test('sin `requirements`, los modos de escritura tampoco hacen nada ni fallan', () => {
    withWs({ req: null }, (ws) => {
      assert.equal(ws.run(['--sync-estados'], { json: false }).code, 0);
    });
  });

  test('`requirements.dir` ausente -> 2 y stdout vacío', () => {
    withWs({ req: { dir: undefined } }, (ws) => {
      const cfgOk = ws.run();
      // `dir: undefined` se pierde al serializar: el bloque queda sin `dir`.
      assert.equal(cfgOk.code, 2);
      assert.equal(cfgOk.stdout, '');
    });
  });

  test('la carpeta de fichas no existe -> 2', () => {
    withWs({ req: { dir: 'test/no-existe-jamas' } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
    });
  });

  test('repositorio con proveedor pero sin clonar -> 2, nunca "limpio"', () => {
    withWs({ cloned: false, fichas: { 'a.md': ficha() } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /no existe/);
    });
  });

  test('sin proveedor de especificación: se validan las fichas y no se deriva nada', () => {
    withWs({ packs: [], fichas: { 'a.md': ficha({ estado: 'validado' }) } }, (ws) => {
      const humano = ws.run([], { json: false });
      assert.equal(humano.code, 0);
      assert.match(humano.stdout, /Sin proveedor de especificación/);
      assert.deepEqual(ws.run().json, []);
    });
  });

  test('sin proveedor, las reglas de la ficha siguen corriendo', () => {
    withWs({ packs: [], fichas: { 'a.md': ficha({ estado: 'inventado' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-ESTADO-VOCAB']);
    });
  });

  test('sin proveedor, --sync-estados y --huerfanos salen 2: no tienen de dónde leer', () => {
    withWs({ packs: [], fichas: { 'a.md': ficha() } }, (ws) => {
      for (const modo of ['--sync-estados', '--huerfanos']) {
        const r = ws.run([modo]);
        assert.equal(r.code, 2, modo);
        assert.equal(r.stdout, '', modo);
      }
    });
  });

  test('una línea de front matter que no sabe leer -> 2 (no la saltea)', () => {
    withWs({ fichas: { 'a.md': '---\ntipo: requisito\nrf: RF-1.01\nestado: cerrado\n  raro: [a\n---\n\n# x\n' } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
    });
  });

  test('un front matter sin cerrar -> 2', () => {
    withWs({ fichas: { 'a.md': '---\ntipo: requisito\nrf: RF-1.01\nestado: cerrado\n' } }, (ws) => {
      assert.equal(ws.run().code, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Reglas de la ficha
// ---------------------------------------------------------------------------

describe('reglas de la ficha', () => {
  test('tablero correcto: 0 hallazgos', () => {
    withWs(
      {
        fichas: { 'RF-1.01.md': ficha() },
        changes: { api: [change('add-booking', { archived: true, meta: 'rf: RF-1.01\n' })] },
      },
      (ws) => {
        const r = ws.run();
        assert.equal(r.code, 0);
        assert.deepEqual(r.json, []);
      },
    );
  });

  test('REQ-FM: front matter con BOM', () => {
    withWs({ fichas: { 'a.md': `﻿${ficha()}` } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-FM']);
    });
  });

  test('REQ-FM: líneas en blanco antes del ---', () => {
    withWs({ fichas: { 'a.md': `\n\n${ficha()}` } }, (ws) => {
      assert.deepEqual(rules(ws.run()), ['REQ-FM']);
    });
  });

  test('REQ-FM negativo: una nota sin front matter no es una ficha ni un error', () => {
    withWs({ fichas: { 'README.md': '# Índice\n\nSolo texto.\n', 'a.md': ficha() } }, (ws) => {
      assert.equal(ws.run().code, 0);
    });
  });

  test('REQ-FICHA: ficha sin rf:', () => {
    withWs({ fichas: { 'a.md': ficha({ rf: null }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-FICHA']);
    });
  });

  test('REQ-FICHA: rf: que no cumple el patrón por defecto', () => {
    withWs({ fichas: { 'a.md': ficha({ rf: 'REQ-7' }) } }, (ws) => {
      assert.deepEqual(rules(ws.run()), ['REQ-FICHA']);
    });
  });

  test('REQ-FICHA negativo: idPattern propio, y la ficha que lo cumple pasa', () => {
    withWs({ req: { idPattern: '^REQ-\\d+$' }, fichas: { 'a.md': ficha({ rf: 'REQ-7' }), 'b.md': ficha({ rf: 'RF-1.01' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.equal(r.json.length, 1);
      assert.match(r.json[0].file, /b\.md$/);
    });
  });

  test('REQ-FICHA: dos fichas para el mismo id', () => {
    withWs({ fichas: { 'a.md': ficha({ titulo: 'Uno' }), 'b.md': ficha({ titulo: 'Dos' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-FICHA']);
      assert.match(r.json[0].message, /dos fichas/);
    });
  });

  test('REQ-ESTADO-VOCAB: estado fuera del vocabulario, y ficha sin estado', () => {
    withWs({ fichas: { 'a.md': ficha({ rf: 'RF-1.01', estado: 'hecho' }), 'b.md': ficha({ rf: 'RF-1.02', estado: null }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-ESTADO-VOCAB']);
      assert.equal(r.json.length, 2);
    });
  });

  test('REQ-ESTADO-VOCAB negativo: los siete estados del vocabulario pasan', () => {
    const estados = ['pendiente', 'analisis', 'validado', 'implementacion', 'testing', 'cerrado', 'descartado'];
    const fichas = Object.fromEntries(estados.map((e, i) => [`${e}.md`, ficha({ rf: `RF-1.0${i + 1}`, estado: e })]));
    withWs({ fichas }, (ws) => {
      assert.equal(ws.run().code, 0);
    });
  });

  test('REQ-MANUAL: estado_auto false sin estado_motivo', () => {
    withWs({ fichas: { 'a.md': ficha({ estado: 'implementacion', extra: 'estado_auto: false' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-MANUAL']);
    });
  });

  test('REQ-MANUAL negativo: con motivo pasa, y un comentario final no rompe la lectura', () => {
    withWs(
      {
        fichas: {
          'a.md': ficha({
            estado: 'implementacion',
            extra: 'estado_auto: false   # se entrega por partes\nestado_motivo: "Se entrega en dos partes; solo la primera tiene change."',
          }),
        },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });
});

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

describe('REQ-LINK', () => {
  test('formato obsidian: un wikilink roto es un hallazgo', () => {
    withWs({ req: { format: 'obsidian' }, fichas: { 'a.md': ficha({ cuerpo: 'Ver [[Nota que no existe]].' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-LINK']);
    });
  });

  test('formato obsidian negativo: resuelve por nombre, con alias y ancla, y salta el código', () => {
    withWs(
      {
        req: { format: 'obsidian' },
        fichas: {
          'a.md': ficha({ cuerpo: 'Ver [[politicas|las políticas]] y [[politicas#Cobros]].\n\nEjemplo de sintaxis: `[[no-es-un-enlace]]`\n\n```\n[[tampoco]]\n```\n' }),
          'politicas.md': '# Políticas\n',
        },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });

  test('formato plain: un enlace Markdown relativo roto es un hallazgo', () => {
    withWs({ fichas: { 'a.md': ficha({ cuerpo: 'Ver [las políticas](politicas.md).' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-LINK']);
    });
  });

  test('formato plain negativo: enlace que existe, URL externa, ancla y mailto pasan', () => {
    withWs(
      {
        fichas: {
          'a.md': ficha({ cuerpo: '[p](politicas.md) [web](https://example.com/x) [aqui](#seccion) [mail](mailto:a@b.c)' }),
          'politicas.md': '# P\n',
        },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });

  test('los wikilinks NO se validan en formato plain: no se inventan reglas de otro formato', () => {
    withWs({ fichas: { 'a.md': ficha({ cuerpo: 'Texto con [[algo]] literal.' }) } }, (ws) => {
      assert.equal(ws.run().code, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// El estado contra los changes
// ---------------------------------------------------------------------------

describe('REQ-ESTADO: el estado contra la evidencia', () => {
  const abierto = { api: [change('add-booking', { meta: 'rf: RF-1.01\n' })] };

  test('ficha cerrado con un change abierto: se cerró de más', () => {
    withWs({ fichas: { 'a.md': ficha({ estado: 'cerrado' }) }, changes: abierto }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-ESTADO']);
      assert.match(r.json[0].message, /dice cerrado pero queda trabajo/);
    });
  });

  test('ficha sin empezar con un change abierto', () => {
    for (const estado of ['pendiente', 'analisis', 'validado']) {
      withWs({ fichas: { 'a.md': ficha({ estado }) }, changes: abierto }, (ws) => {
        assert.deepEqual(rules(ws.run()), ['REQ-ESTADO'], estado);
      });
    }
  });

  test('negativo: implementacion y testing con un change abierto pasan', () => {
    for (const estado of ['implementacion', 'testing']) {
      withWs({ fichas: { 'a.md': ficha({ estado }) }, changes: abierto }, (ws) => {
        assert.equal(ws.run().code, 0, estado);
      });
    }
  });

  test('negativo: sin ningún change que lo declare, el estado no se discute', () => {
    withWs({ fichas: { 'a.md': ficha({ estado: 'cerrado' }) }, changes: { api: [change('otro', { meta: 'rf: RF-9.99\n' })] } }, (ws) => {
      // El change abierto apunta a un RF sin ficha: eso sí es un hallazgo, pero no sobre la ficha cerrada.
      const r = ws.run();
      assert.deepEqual(rules(r), ['REQ-RF-INEXISTENTE']);
    });
  });

  test('negativo: estado_auto false y descartado no se contrastan', () => {
    withWs(
      {
        fichas: {
          'a.md': ficha({ rf: 'RF-1.01', estado: 'cerrado', extra: 'estado_auto: false\nestado_motivo: "se entrega por partes"' }),
          'b.md': ficha({ rf: 'RF-1.02', estado: 'descartado' }),
        },
        changes: { api: [change('x', { meta: 'rf: RF-1.01 RF-1.02\n' })] },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });

  test('cierra_rf false en la última entrega: la ficha cerrado es un hallazgo con su pendiente', () => {
    withWs(
      {
        fichas: { 'a.md': ficha({ estado: 'cerrado' }) },
        changes: { api: [change('parte-1', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: false\npendiente_rf: "falta el comprobante"\n' })] },
      },
      (ws) => {
        const r = ws.run();
        assert.deepEqual(rules(r), ['REQ-ESTADO']);
        assert.match(r.json[0].message, /falta el comprobante/);
      },
    );
  });

  test('cierra_rf false con la ficha en implementacion: pasa', () => {
    withWs(
      {
        fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
        changes: { api: [change('parte-1', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: false\n' })] },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });

  test('--exigir-cerrados: todos archivados y la ficha atrasada es un hallazgo; sin la bandera, no', () => {
    const spec = {
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: { api: [change('listo', { archived: true, meta: 'rf: RF-1.01\n' })] },
    };
    withWs(spec, (ws) => {
      assert.equal(ws.run().code, 0, 'en la rama, antes del merge, no se exige');
      const r = ws.run(['--exigir-cerrados']);
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-ESTADO-ATRASADO']);
    });
  });
});

// ---------------------------------------------------------------------------
// Changes que declaran (o no) su requisito
// ---------------------------------------------------------------------------

describe('declarar el requisito en el change', () => {
  test('REQ-CHANGE-SIN-RF: un change abierto que no declara rf: queda a la vista', () => {
    withWs({ fichas: { 'a.md': ficha({ estado: 'cerrado' }) }, changes: { api: [change('implementa-algo', { meta: 'schema: spec-driven\n' })] } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.deepEqual(rules(r), ['REQ-CHANGE-SIN-RF']);
    });
  });

  test('REQ-CHANGE-SIN-RF: sin archivo de metadatos tampoco es invisible', () => {
    withWs({ changes: { api: [change('sin-meta', { meta: null })] } }, (ws) => {
      assert.deepEqual(rules(ws.run()), ['REQ-CHANGE-SIN-RF']);
    });
  });

  test('negativo: `rf: ninguno` es la declaración explícita de que no corresponde a un requisito', () => {
    withWs({ changes: { api: [change('re-skin', { meta: 'rf: ninguno\n' })] } }, (ws) => {
      assert.equal(ws.run().code, 0);
    });
  });

  test('negativo: un change archivado sin rf: es historia, no un hallazgo', () => {
    withWs({ changes: { api: [change('viejo', { archived: true, meta: '' })] } }, (ws) => {
      assert.equal(ws.run().code, 0);
    });
  });

  test('REQ-RF-INEXISTENTE: el change declara un requisito sin ficha', () => {
    withWs({ fichas: { 'a.md': ficha() }, changes: { api: [change('x', { meta: 'rf: RF-4.04\n' })] } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.ok(rules(r).includes('REQ-RF-INEXISTENTE'));
    });
  });

  test('un change puede declarar varios requisitos', () => {
    withWs(
      {
        fichas: { 'a.md': ficha({ rf: 'RF-1.01', estado: 'implementacion' }), 'b.md': ficha({ rf: 'RF-1.02', estado: 'implementacion' }) },
        changes: { api: [change('x', { meta: 'rf: RF-1.01 RF-1.02\n' })] },
      },
      (ws) => assert.equal(ws.run().code, 0),
    );
  });
});

// ---------------------------------------------------------------------------
// --sync-estados
// ---------------------------------------------------------------------------

describe('--sync-estados', () => {
  const sync = (spec, args = ['--sync-estados']) => withWs(spec, (ws) => {
    const r = ws.run(args, { json: false });
    return { ...r, ficha: ws.read('a.md'), ws };
  });

  test('ningún change declara el requisito: no toca', () => {
    const r = sync({ fichas: { 'a.md': ficha({ estado: 'validado' }) }, changes: { api: [change('otro', { meta: 'rf: ninguno\n' })] } });
    assert.equal(r.code, 0);
    assert.match(r.ficha, /^estado: validado$/m);
    assert.match(r.stdout, /Ningún estado para cambiar/);
  });

  test('un change abierto: validado -> implementacion, y actualiza `actualizado:`', () => {
    const r = sync({ fichas: { 'a.md': ficha({ estado: 'validado' }) }, changes: { api: [change('x', { meta: 'rf: RF-1.01\n' })] } });
    assert.equal(r.code, 0);
    assert.match(r.ficha, /^estado: implementacion$/m);
    assert.doesNotMatch(r.ficha, /actualizado: 2026-01-01/);
    assert.match(r.stdout, /validado -> implementacion/);
  });

  test('todos archivados: -> cerrado', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: { api: [change('uno', { archived: true, date: '2026-09-01', meta: 'rf: RF-1.01\n' }), change('dos', { archived: true, date: '2026-09-05', meta: 'rf: RF-1.01\n' })] },
    });
    assert.match(r.ficha, /^estado: cerrado$/m);
  });

  test('uno archivado y otro abierto: implementacion, no cerrado', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'validado' }) },
      changes: { api: [change('uno', { archived: true, meta: 'rf: RF-1.01\n' }), change('dos', { meta: 'rf: RF-1.01\n' })] },
    });
    assert.match(r.ficha, /^estado: implementacion$/m);
  });

  test('cierra_rf false en la última entrega: queda en implementacion y dice qué falta', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: { api: [change('parte-1', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: false\npendiente_rf: "CA-04 y CA-05 -> otro ticket"\n' })] },
    });
    assert.match(r.ficha, /^estado: implementacion$/m);
    assert.match(r.stdout, /cierra_rf: false/);
    assert.match(r.stdout, /CA-04 y CA-05 -> otro ticket/);
  });

  test('cierra_rf false sobre una ficha en cerrado: NO la retrocede, la reporta', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'cerrado' }) },
      changes: { api: [change('parte-1', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: false\n' })] },
    });
    assert.match(r.ficha, /^estado: cerrado$/m);
    assert.match(r.stdout, /va hacia atrás/);
    assert.match(r.stdout, /dice cerrado, derivado implementacion/);
  });

  test('manda la última fecha: una parcial vieja y una entrega posterior que completa -> cerrado', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: {
        api: [
          change('parte-1', { archived: true, date: '2026-09-01', meta: 'rf: RF-1.01\ncierra_rf: false\n' }),
          change('parte-2', { archived: true, date: '2026-09-20', meta: 'rf: RF-1.01\n' }),
        ],
      },
    });
    assert.match(r.ficha, /^estado: cerrado$/m);
  });

  test('manda la última fecha: una parcial posterior vuelve a dejarlo abierto', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: {
        api: [
          change('parte-1', { archived: true, date: '2026-09-01', meta: 'rf: RF-1.01\n' }),
          change('ajuste', { archived: true, date: '2026-09-20', meta: 'rf: RF-1.01\ncierra_rf: false\n' }),
        ],
      },
    });
    assert.match(r.ficha, /^estado: implementacion$/m);
  });

  test('cierra_rf como lista: el change declara dos requisitos y completa solo uno', () => {
    withWs(
      {
        fichas: {
          'a.md': ficha({ rf: 'RF-1.01', estado: 'implementacion' }),
          'b.md': ficha({ rf: 'RF-1.02', estado: 'implementacion' }),
        },
        changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01 RF-1.02\ncierra_rf: RF-1.02\npendiente_rf: "RF-1.01: el comprobante"\n' })] },
      },
      (ws) => {
        ws.run(['--sync-estados'], { json: false });
        assert.match(ws.read('a.md'), /^estado: implementacion$/m, 'RF-1.01 no está en la lista: sigue abierto');
        assert.match(ws.read('b.md'), /^estado: cerrado$/m, 'RF-1.02 sí');
      },
    );
  });

  test('cierra_rf true explícito cierra', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: true\n' })] },
    });
    assert.match(r.ficha, /^estado: cerrado$/m);
  });

  test('el par proveedor/consumidor de la misma fecha: si uno no cierra, no cierra', () => {
    const spec = {
      fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
      changes: {},
    };
    withWs(spec, (ws) => {
      // Segundo repositorio no declarado: se arma el par en el mismo `api` con dos changes de la misma fecha.
      fs.mkdirSync(path.join(ws.base, 'api', 'openspec', 'changes', 'archive', '2026-09-10-back'), { recursive: true });
      fs.mkdirSync(path.join(ws.base, 'api', 'openspec', 'changes', 'archive', '2026-09-10-front'), { recursive: true });
      fs.writeFileSync(path.join(ws.base, 'api', 'openspec', 'changes', 'archive', '2026-09-10-back', '.openspec.yaml'), 'rf: RF-1.01\n');
      fs.writeFileSync(path.join(ws.base, 'api', 'openspec', 'changes', 'archive', '2026-09-10-front', '.openspec.yaml'), 'rf: RF-1.01\ncierra_rf: false\n');
      ws.run(['--sync-estados'], { json: false });
      assert.match(ws.read('a.md'), /^estado: implementacion$/m);
    });
  });

  test('testing no se baja a implementacion con un change abierto', () => {
    const r = sync({ fichas: { 'a.md': ficha({ estado: 'testing' }) }, changes: { api: [change('x', { meta: 'rf: RF-1.01\n' })] } });
    assert.match(r.ficha, /^estado: testing$/m);
    assert.match(r.stdout, /Ningún estado para cambiar/);
  });

  test('testing sí avanza a cerrado cuando todo está archivado', () => {
    const r = sync({ fichas: { 'a.md': ficha({ estado: 'testing' }) }, changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] } });
    assert.match(r.ficha, /^estado: cerrado$/m);
  });

  test('estado_auto false: no se toca y se lista aparte con su motivo', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion', extra: 'estado_auto: false\nestado_motivo: "sub-entregables A y B"' }) },
      changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] },
    });
    assert.match(r.ficha, /^estado: implementacion$/m);
    assert.match(r.stdout, /Sin derivar/);
    assert.match(r.stdout, /sub-entregables A y B/);
  });

  test('estado_auto false sin motivo: se avisa en la salida', () => {
    const r = sync({
      fichas: { 'a.md': ficha({ estado: 'implementacion', extra: 'estado_auto: false' }) },
      changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] },
    });
    assert.match(r.stdout, /sin estado_motivo/);
  });

  test('dos fichas para el mismo id: no se toca ninguna', () => {
    withWs(
      {
        fichas: { 'a.md': ficha({ estado: 'implementacion' }), 'b.md': ficha({ estado: 'implementacion', titulo: 'Gemela' }) },
        changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] },
      },
      (ws) => {
        const r = ws.run(['--sync-estados'], { json: false });
        assert.match(ws.read('a.md'), /^estado: implementacion$/m);
        assert.match(ws.read('b.md'), /^estado: implementacion$/m);
        assert.match(r.stdout, /dos fichas para el mismo id/);
      },
    );
  });

  test('un descartado no se toca', () => {
    const r = sync({ fichas: { 'a.md': ficha({ estado: 'descartado' }) }, changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] } });
    assert.match(r.ficha, /^estado: descartado$/m);
  });

  test('--dry-run muestra y no escribe', () => {
    const r = sync(
      { fichas: { 'a.md': ficha({ estado: 'implementacion' }) }, changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] } },
      ['--sync-estados', '--dry-run'],
    );
    assert.match(r.ficha, /^estado: implementacion$/m);
    assert.match(r.stdout, /cambiaría/);
  });

  test('conserva las comillas del estado y no toca el resto de la ficha', () => {
    const texto = ficha({ estado: 'validado' }).replace('estado: validado', 'estado: "validado"');
    const r = sync({ fichas: { 'a.md': texto }, changes: { api: [change('x', { meta: 'rf: RF-1.01\n' })] } });
    assert.match(r.ficha, /^estado: "implementacion"$/m);
    assert.match(r.ficha, /^# Reserva$/m);
  });

  test('después del sync, el gate sale limpio con --exigir-cerrados', () => {
    withWs(
      {
        fichas: { 'a.md': ficha({ estado: 'implementacion' }) },
        changes: { api: [change('x', { archived: true, meta: 'rf: RF-1.01\n' })] },
      },
      (ws) => {
        assert.equal(ws.run(['--exigir-cerrados']).code, 1);
        ws.run(['--sync-estados'], { json: false });
        assert.equal(ws.run(['--exigir-cerrados']).code, 0);
      },
    );
  });

  test('--json devuelve la lista de lo aplicado', () => {
    withWs(
      { fichas: { 'a.md': ficha({ estado: 'validado' }) }, changes: { api: [change('x', { meta: 'rf: RF-1.01\n' })] } },
      (ws) => {
        const r = ws.run(['--sync-estados']);
        assert.equal(r.code, 0);
        assert.equal(r.json.aplicados.length, 1);
        assert.equal(r.json.aplicados[0].to, 'implementacion');
      },
    );
  });
});

// ---------------------------------------------------------------------------
// --tablero y --huerfanos
// ---------------------------------------------------------------------------

describe('--tablero y --huerfanos', () => {
  test('--tablero agrupa por estado y marca lo manual y lo pendiente', () => {
    withWs(
      {
        fichas: {
          'a.md': ficha({ rf: 'RF-1.01', titulo: 'Reserva', estado: 'implementacion' }),
          'b.md': ficha({ rf: 'RF-1.02', titulo: 'Cobro', estado: 'validado', extra: 'estado_auto: false\nestado_motivo: "x"' }),
          'c.md': ficha({ rf: 'RF-1.10', titulo: 'Aviso', estado: 'validado' }),
        },
        changes: { api: [change('parte', { archived: true, meta: 'rf: RF-1.01\ncierra_rf: false\npendiente_rf: "el comprobante"\n' })] },
      },
      (ws) => {
        const r = ws.run(['--tablero'], { json: false });
        assert.equal(r.code, 0);
        assert.match(r.stdout, /## implementacion \(1\)/);
        assert.match(r.stdout, /## validado \(2\)/);
        assert.match(r.stdout, /RF-1\.01  Reserva — pendiente: el comprobante/);
        assert.match(r.stdout, /RF-1\.02  Cobro \(estado manual\)/);
        // Orden numérico: 1.02 antes que 1.10.
        assert.ok(r.stdout.indexOf('RF-1.02') < r.stdout.indexOf('RF-1.10'));
      },
    );
  });

  test('--tablero --out escribe la vista en un archivo', () => {
    withWs({ fichas: { 'a.md': ficha() } }, (ws) => {
      const out = path.relative(ROOT, path.join(ws.base, 'tablero.md')).split(path.sep).join('/');
      const r = ws.run(['--tablero', '--out', out], { json: false });
      assert.equal(r.code, 0);
      assert.match(fs.readFileSync(path.join(ws.base, 'tablero.md'), 'utf8'), /# Tablero de requisitos/);
    });
  });

  test('--huerfanos lista los changes que ninguna ficha reclama, y marca los abiertos', () => {
    withWs(
      {
        fichas: { 'a.md': ficha() },
        changes: {
          api: [
            change('con-ficha', { archived: true, meta: 'rf: RF-1.01\n' }),
            change('sin-rf', { meta: '' }),
            change('ficha-ausente', { archived: true, meta: 'rf: RF-7.77\n' }),
          ],
        },
      },
      (ws) => {
        const r = ws.run(['--huerfanos'], { json: false });
        assert.equal(r.code, 0);
        assert.match(r.stdout, /api\/sin-rf {2}\(ABIERTO\)/);
        assert.match(r.stdout, /api\/2026-09-01-ficha-ausente/);
        assert.doesNotMatch(r.stdout, /con-ficha/);
        assert.match(r.stdout, /2 change\(s\) sin ficha/);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Contrato de salida
// ---------------------------------------------------------------------------

describe('contrato de gates', () => {
  test('con hallazgos: exit 1 y una lista de {rule,file,line,message}', () => {
    withWs({ fichas: { 'a.md': ficha({ estado: 'hecho' }) } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      for (const f of r.json) {
        assert.ok(f.rule && f.file && typeof f.line === 'number' && f.message);
      }
    });
  });

  test('cuando no se pudo verificar, stdout queda vacío (también con --json)', () => {
    withWs({ cloned: false, fichas: { 'a.md': ficha() } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
    });
  });
});
