'use strict';

/**
 * El pack odd conectado al núcleo: su adaptador (`changeLayout: file`) lo leen el
 * gate de cobertura de escenarios y el tablero de requisitos sin saber que es ODD.
 *
 * Viajan con la base a cada proyecto; si `init` descartó el pack, se omiten con
 * el motivo a la vista.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT, packsMissing } = require('./helpers');

const SIN_PACK = packsMissing(['odd']);

/**
 * Un workspace con un repositorio `api` que usa el pack odd. Los repositorios
 * se resuelven relativos a la raíz, así que vive en `test/` y se borra siempre;
 * la configuración va al temporal del sistema.
 */
function withWorkspace({ files = {}, fichas = null }, fn) {
  const id = `.tmp-odd-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const base = path.join(ROOT, 'test', id);
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-odd-'));
  try {
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
      fs.writeFileSync(path.join(base, rel), text);
    };
    fs.mkdirSync(path.join(base, 'api'), { recursive: true });
    for (const [rel, text] of Object.entries(files)) write(path.join('api', rel), text);
    for (const [rel, text] of Object.entries(fichas || {})) write(path.join('requisitos', rel), text);

    const cfg = {
      version: 1,
      project: { name: 'prueba' },
      topology: 'multi-repo',
      repos: [{ name: 'api', path: `test/${id}/api`, packs: [], baseBranch: 'main' }],
      packs: ['odd'],
      harnesses: [],
    };
    if (fichas) cfg.requirements = { dir: `test/${id}/requisitos` };
    const cfgFile = path.join(cfgDir, 'ai-workspace.json');
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));

    const run = (script, args) => {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, AI_WORKSPACE_CONFIG: cfgFile },
      });
      let json = null;
      try {
        json = JSON.parse(r.stdout);
      } catch {
        // salida de texto
      }
      return { code: r.status, stdout: String(r.stdout), stderr: String(r.stderr), json };
    };
    const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8');

    return fn({ run, read });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
}

const DOC = (rf = 'RF-1.01') =>
  [
    '# Límite diario de transferencias',
    'Objetivo: que nadie transfiera más de su límite diario · Rama: `feat/limite` · Tests: `npm test`',
    `rf: ${rf}`,
    '',
    '## Specs',
    'S1. Rechaza lo que supera el límite del día: "una de 20 mil me la tiene que rechazar"',
    '  - Acepta: 422 y el saldo sin cambios',
    'S2. El límite se reinicia a la medianoche: "el límite es por día, no por operación"',
    'S3. Registra el rechazo en la auditoría',
    '',
    '## Tasks',
    '- [x] T1 (S1) directa · validación · RED→GREEN',
    '',
    '## Log',
    'L1 2026-11-03 pedido (textual): > quiero un límite diario',
    '',
  ].join('\n');

function ficha(estado) {
  return ['---', 'tipo: requisito', 'rf: RF-1.01', 'titulo: "Límite diario"', `estado: ${estado}`, 'actualizado: 2026-01-01', '---', '', '# Límite diario', ''].join('\n');
}

describe('pack odd', { skip: SIN_PACK }, () => {
  test('el gate de cobertura lee las specs del documento y marca la que no tiene test', () => {
    withWorkspace(
      {
        files: {
          'odd/tasks/limite.md': DOC(),
          'limite.test.js': [
            "test('rechaza lo que supera el límite del día', () => {});",
            "test('el límite se reinicia a la medianoche', () => {});",
            '',
          ].join('\n'),
        },
      },
      ({ run }) => {
        const r = run('check-scenario-coverage.js', ['--repo', 'api', '--change', 'limite', '--json']);
        assert.equal(r.code, 1, r.stderr);
        assert.equal(r.json.length, 1, 'dos specs cubiertas, una no');
        assert.match(r.json[0].message, /Registra el rechazo en la auditoría/);
        assert.match(r.json[0].file, /odd\/tasks\/limite\.md$/);
        assert.doesNotMatch(r.stderr, /aviso/, 'el adaptador del pack es válido');
      },
    );
  });

  test('`--change` con extensión verifica igual; uno que no existe sale con 2, no con "cubierto"', () => {
    withWorkspace({ files: { 'odd/tasks/limite.md': DOC(), 'limite.test.js': '' } }, ({ run }) => {
      const conExtension = run('check-scenario-coverage.js', ['--repo', 'api', '--change', 'limite.md', '--json']);
      assert.equal(conExtension.code, 1, conExtension.stderr);
      assert.equal(conExtension.json.length, 3, 'las tres specs, ninguna con test');

      const mal = run('check-scenario-coverage.js', ['--repo', 'api', '--change', 'limte', '--json']);
      assert.equal(mal.code, 2, mal.stdout);
      assert.match(mal.stderr, /no hay documentos para limte/);
    });
  });

  test('un README en la carpeta no hace fallar el tablero por no declarar `rf:`', () => {
    withWorkspace(
      { files: { 'odd/tasks/limite.md': DOC(), 'odd/tasks/README.md': '# Cómo usar esta carpeta\n' }, fichas: { 'limite.md': ficha('implementacion') } },
      ({ run }) => {
        const r = run('check-requirements.js', ['--json']);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.deepEqual(r.json, []);
      },
    );
  });

  test('el tablero deriva `implementacion` de un documento abierto', () => {
    withWorkspace(
      { files: { 'odd/tasks/limite.md': DOC() }, fichas: { 'limite.md': ficha('validado') } },
      ({ run, read }) => {
        const r = run('check-requirements.js', ['--sync-estados']);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(read('requisitos/limite.md'), /^estado: implementacion$/m);
      },
    );
  });

  test('el tablero deriva `cerrado` de un documento archivado con fecha', () => {
    withWorkspace(
      {
        files: { 'odd/tasks/archive/2026-11-04-limite.md': DOC() },
        fichas: { 'limite.md': ficha('testing') },
      },
      ({ run, read }) => {
        const r = run('check-requirements.js', ['--sync-estados']);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(read('requisitos/limite.md'), /^estado: cerrado$/m);
      },
    );
  });

  test('`cierra_rf: false` en el documento archivado deja el requisito abierto', () => {
    withWorkspace(
      {
        files: { 'odd/tasks/archive/2026-11-04-limite.md': DOC().replace('rf: RF-1.01', 'rf: RF-1.01\ncierra_rf: false\npendiente_rf: "S3 -> otro ticket"') },
        fichas: { 'limite.md': ficha('validado') },
      },
      ({ run, read }) => {
        // Desde `validado` avanza a `implementacion` y no a `cerrado`: así la
        // prueba falla tanto si no se lee el documento como si se ignora el campo.
        const r = run('check-requirements.js', ['--sync-estados']);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(read('requisitos/limite.md'), /^estado: implementacion$/m);
      },
    );
  });
});
