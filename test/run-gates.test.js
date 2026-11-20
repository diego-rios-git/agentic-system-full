#!/usr/bin/env node
/**
 * run-gates.test.js — el orquestador de gates, contra todos los desenlaces.
 *
 * Los gates son de mentira (`fixtures/gates/fake-gate.js`) y los registra
 * `AI_GATES_FILE`: lo que se prueba acá no es qué detecta cada gate sino qué
 * hace el orquestador con lo que devuelve. Los repositorios y el slot, en cambio,
 * son de git de verdad.
 *
 * Lo central: JAMÁS leer "sin verificar" como "limpio". Un gate que sale con 3,
 * que devuelve JSON roto o que se cuelga es NO SE PUDO EJECUTAR; uno que dice
 * `{skipped}` es NO CORRIÓ; y ninguno de los dos puede dejar el código de salida
 * en 0.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { withWorkspace } = require('./workspace-helper');

const FAKE = 'test/fixtures/gates/fake-gate.js';

const FILES = { 'src/changed.ts': 'v1\n', 'src/other.ts': 'v1\n', 'src/second.ts': 'v1\n' };

/** Declara los gates de prueba en un JSON dentro del workspace temporal. */
function declare(ws, gates) {
  const file = path.join(ws.dir, 'gates.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      gates: gates.map((g) => ({
        id: g.id,
        label: g.label || g.id,
        script: FAKE,
        source: `fixture ${g.id}`,
        scope: g.scope || 'repo',
        args: ['--repo', '{repo}', '--mode', g.mode, '--id', g.id, ...(g.emit ? ['--emit', g.emit] : [])],
        ...(g.flatten ? { flatten: g.flatten } : {}),
        ...(g.needs ? { needs: g.needs } : {}),
      })),
    }),
  );
  return file;
}

const SPEC = { repos: [{ name: 'api', files: FILES }] };

function run(ws, gatesFile, args, env = {}) {
  return ws.run('scripts/run-gates.js', args, {
    env: { AI_GATES_FILE: gatesFile, AI_GATE_TIMEOUT_MS: '2500', ...env },
  });
}

const byId = (r, scope = 'api') => Object.fromEntries(r.json.find((b) => b.scope === scope).gates.map((g) => [g.id, g]));

describe('run-gates: los tres estados', () => {
  test('limpio, sucio, y tres formas de NO SE PUDO EJECUTAR; {skipped} es NO CORRIÓ', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [
        { id: 'g-ok', mode: 'ok' },
        { id: 'g-dirty', mode: 'dirty', emit: 'src/changed.ts' },
        { id: 'g-exit3', mode: 'exit3' },
        { id: 'g-badjson', mode: 'badjson' },
        { id: 'g-hang', mode: 'hang' },
        { id: 'g-skipped', mode: 'skipped' },
      ]);

      const r = run(ws, gates, ['--repo', 'api', '--json']);
      const g = byId(r);

      assert.equal(g['g-ok'].status, 'clean');
      assert.equal(g['g-dirty'].status, 'findings');
      assert.equal(g['g-exit3'].status, 'broken');
      assert.match(g['g-exit3'].reason, /código 3/);
      assert.equal(g['g-badjson'].status, 'broken');
      assert.match(g['g-badjson'].reason, /ilegible/);
      assert.equal(g['g-hang'].status, 'broken');
      assert.match(g['g-hang'].reason, /tope/);
      assert.equal(g['g-skipped'].status, 'skipped');
      assert.equal(g['g-skipped'].skipped, 'no se detectó ningún cambio', 'en --json NO se descarta `skipped`');

      // Lo roto gana sobre los hallazgos: sin verificar no es "con hallazgos".
      assert.equal(r.code, 2);
    });
  });

  test('el bloque de texto nombra cada estado y no deja a ninguno como "limpio"', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [
        { id: 'g-ok', label: 'Gate limpio', mode: 'ok' },
        { id: 'g-exit3', label: 'Gate código 3', mode: 'exit3' },
        { id: 'g-badjson', label: 'Gate JSON roto', mode: 'badjson0' },
        { id: 'g-hang', label: 'Gate colgado', mode: 'hang' },
        { id: 'g-skipped', label: 'Gate salteado', mode: 'skipped' },
      ]);

      const r = run(ws, gates, ['--repo', 'api']);
      assert.match(r.stdout, /Sin hallazgos[^\n]*Gate limpio/);
      assert.equal((r.stdout.match(/— NO SE PUDO EJECUTAR/g) || []).length, 3);
      assert.match(r.stdout, /Gate salteado — NO CORRIÓ \(no se detectó ningún cambio\)/);

      // Los que no corrieron NO figuran en la línea de los limpios.
      const limpios = /Sin hallazgos[^\n]*/.exec(r.stdout)[0];
      for (const n of ['código 3', 'JSON roto', 'colgado', 'salteado']) assert.doesNotMatch(limpios, new RegExp(n));
      assert.match(r.stdout, /sin verificar/);
    });
  });

  test('exit 1 sin hallazgos y salida JSON válida pero de forma desconocida: no se leen como limpio', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [
        { id: 'g-empty1', mode: 'empty1' },
        { id: 'g-unknown', mode: 'unknown' },
      ]);
      const r = run(ws, gates, ['--repo', 'api', '--json']);
      const g = byId(r);
      assert.equal(g['g-empty1'].status, 'broken');
      assert.equal(g['g-unknown'].status, 'broken');
      assert.equal(r.code, 2);
    });
  });

  test('un gate que devuelve un objeto se aplana: {findings} y rutas declaradas en `flatten`', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [
        { id: 'g-object', mode: 'object', emit: 'src/changed.ts' },
        { id: 'g-islas', mode: 'islas', emit: 'src/changed.ts', flatten: ['islas'] },
      ]);
      const r = run(ws, gates, ['--repo', 'api', '--json']);
      const g = byId(r);

      assert.equal(g['g-object'].status, 'findings', 'un objeto no se lee como "sin hallazgos"');
      assert.equal(g['g-object'].findings.length, 1);
      assert.equal(g['g-islas'].status, 'findings');
      assert.equal(g['g-islas'].findings[0].file, 'src/changed.ts');
      assert.equal(r.code, 1);
    });
  });
});

describe('run-gates: hallazgos del diff vs de afuera', () => {
  test('separa lo del diff de lo de afuera, y detalla solo lo del diff', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [{ id: 'g-dirty', label: 'Gate sucio', mode: 'dirty', emit: 'src/changed.ts,src/other.ts,src/second.ts' }]);

      const text = run(ws, gates, ['--repo', 'api']);
      assert.match(text.stdout, /1 hallazgo\(s\) en el diff/);
      assert.match(text.stdout, /\+2 fuera del diff/);
      assert.match(text.stdout, /src\/changed\.ts/);
      assert.doesNotMatch(text.stdout, /hallazgo en src\/other\.ts/, 'lo de afuera va en un conteo, no en el detalle');

      const json = run(ws, gates, ['--repo', 'api', '--json']);
      const g = byId(json)['g-dirty'];
      assert.equal(g.inDiff, 1);
      assert.equal(g.outside, 2);
      assert.equal(g.findings.length, 3, '--json conserva todo, marcado');
      assert.deepEqual(g.findings.filter((f) => f.inDiff).map((f) => f.file), ['src/changed.ts']);
    });
  });

  test('el exit 1 es solo por hallazgos del DIFF: la deuda ajena no lo dispara', () => {
    withWorkspace(SPEC, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [{ id: 'g-dirty', mode: 'dirty', emit: 'src/other.ts,src/second.ts' }]);

      const r = run(ws, gates, ['--repo', 'api']);
      assert.equal(r.code, 0, 'los 2 hallazgos son de archivos que la rama no toca');
      assert.match(r.stdout, /2 fuera del diff/);

      const todo = run(ws, gates, ['--repo', 'api', '--todo']);
      assert.equal(todo.code, 1, '--todo muestra todo y todo cuenta');
      assert.match(todo.stdout, /hallazgo en src\/other\.ts/);
    });
  });

  test('normaliza rutas con `\\`, con ./, con el nombre del repo y con el prefijo del slot', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      fs.writeFileSync(path.join(ws.slotDir('api', 'review'), 'src', 'changed.ts'), 'slot\n');
      const slotPrefix = `${ws.relDir}/worktrees/review/api/src/changed.ts`;
      const emit = ['src\\changed.ts', './src/changed.ts', 'api/src/changed.ts', slotPrefix, 'src/other.ts'].join(',');
      const gates = declare(ws, [{ id: 'g-dirty', mode: 'dirty', emit }]);

      const r = run(ws, gates, ['--repo', 'api', '--from', 'review', '--json']);
      const g = byId(r)['g-dirty'];
      assert.equal(g.inDiff, 4, JSON.stringify(g.findings.map((f) => [f.file, f.inDiff])));
      assert.equal(g.outside, 1);
    });
  });

  test('diff ilegible: no filtra nada y lo dice', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'g-dirty', mode: 'dirty', emit: 'src/other.ts' }]);
      const r = run(ws, gates, ['--repo', 'api', '--base', 'origin/no-existe']);
      assert.match(r.stdout, /NO se pudo leer/);
      assert.match(r.stdout, /hallazgo en src\/other\.ts/, 'sin diff, todo se muestra');
      assert.equal(r.code, 1);
    });
  });
});

describe('run-gates: cada gate UNA vez, desde donde corresponde', () => {
  test('un gate de repo corre una vez por repo y uno de workspace una sola vez', () => {
    withWorkspace({ repos: [{ name: 'api', files: FILES }, { name: 'web', files: FILES }] }, (ws) => {
      const log = path.join(ws.dir, 'runs.log');
      const gates = declare(ws, [
        { id: 'por-repo', mode: 'ok' },
        { id: 'de-workspace', mode: 'ok', scope: 'workspace' },
      ]);
      const r = run(ws, gates, ['--all', '--json'], { FAKE_GATE_LOG: log });
      assert.equal(r.code, 0, r.stderr);

      const runs = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
      assert.equal(runs.filter((x) => x === 'por-repo').length, 2);
      assert.equal(runs.filter((x) => x === 'de-workspace').length, 1);
    });
  });

  test('`--from <slot>` pasa la ruta del slot como --repo y lee el diff del slot', () => {
    withWorkspace(SPEC, (ws) => {
      ws.openSlot('api', 'review');
      // El cambio vive SOLO en el slot.
      fs.writeFileSync(path.join(ws.slotDir('api', 'review'), 'src', 'changed.ts'), 'slot\n');
      const gates = declare(ws, [{ id: 'g-dirty', mode: 'dirty', emit: 'src/changed.ts' }]);

      const main = run(ws, gates, ['--repo', 'api']);
      assert.equal(main.code, 0, 'en la principal no hay cambios: el hallazgo es de afuera del diff');

      const slot = run(ws, gates, ['--repo', 'api', '--from', 'review']);
      assert.equal(slot.code, 1, slot.stdout);
      assert.match(slot.stdout, /leído desde [^\n]*worktrees\/review\/api/);
      assert.match(slot.stdout, new RegExp(`repo=${ws.relDir.replace(/[.]/g, '\\.')}/worktrees/review/api`));

      // La ruta de un slot en --repo equivale a --from.
      const viaRepo = run(ws, gates, ['--repo', `${ws.relDir}/worktrees/review/api`]);
      assert.equal(viaRepo.code, 1);
    });
  });

  test('--from con un slot que no tiene el repositorio: exit 2, nunca cae a la principal', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'g-ok', mode: 'ok' }]);
      const r = run(ws, gates, ['--repo', 'api', '--from', 'review']);
      assert.equal(r.code, 2);
      assert.match(r.stdout, /NO SE VERIFICÓ/);
      assert.match(r.stdout, /no tiene el repositorio/);
    });
  });

  test('un repositorio sin clonar: exit 2 y NO SE VERIFICÓ', () => {
    withWorkspace(SPEC, (ws) => {
      const cfg = JSON.parse(fs.readFileSync(ws.cfgPath, 'utf8'));
      cfg.repos.push({ name: 'ghost', path: `${ws.relDir}/ghost`, packs: [], baseBranch: 'main' });
      fs.writeFileSync(ws.cfgPath, JSON.stringify(cfg));
      const gates = declare(ws, [{ id: 'g-ok', mode: 'ok' }]);

      const r = run(ws, gates, ['--repo', 'ghost']);
      assert.equal(r.code, 2);
      assert.match(r.stdout, /NO SE VERIFICÓ/);
    });
  });

  test('--base y --change se pasan a los gates solo si el operador los eligió', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'g-dirty', mode: 'dirty', emit: 'src/changed.ts' }]);
      ws.write('api', 'src/changed.ts', 'v2\n');

      const sin = run(ws, gates, ['--repo', 'api', '--json']);
      const argsSin = byId(sin)['g-dirty'].findings[0].message;
      assert.doesNotMatch(argsSin, /--base/);

      const con = run(ws, gates, ['--repo', 'api', '--base', 'origin/main', '--change', 'uno', '--change', 'dos', '--json']);
      const argsCon = byId(con)['g-dirty'].findings[0].message;
      assert.match(argsCon, /--base origin\/main/);
      assert.match(argsCon, /--change uno --change dos/);
    });
  });
});

describe('run-gates: gates que no aplican (needs)', () => {
  test('un gate que necesita `imports` en un repo sin perfil con imports: NO CORRIÓ, con el motivo', () => {
    // Un lenguaje propio SIN `imports`, y el repo restringido a él: el perfil
    // JavaScript del núcleo declara `imports` y haría correr el gate.
    const sinImports = { id: 'sin-imports', extensions: ['.ts'] };
    const spec = { repos: [{ name: 'api', files: FILES, extra: { language: sinImports, languages: ['sin-imports'] } }] };
    withWorkspace(spec, (ws) => {
      ws.write('api', 'src/changed.ts', 'v2\n');
      const gates = declare(ws, [
        { id: 'g-ok', mode: 'ok' },
        { id: 'g-needs', label: 'Inalcanzables', mode: 'ok', needs: ['imports'] },
      ]);
      const r = run(ws, gates, ['--repo', 'api']);
      assert.match(r.stdout, /Inalcanzables — NO CORRIÓ \(el perfil de lenguaje[^)]*imports/);
      const limpios = /Sin hallazgos[^\n]*/.exec(r.stdout)[0];
      assert.doesNotMatch(limpios, /Inalcanzables/);
      assert.equal(r.code, 0, 'no aplicar no es un fallo');

      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json)['g-needs'].status, 'skipped');
    });
  });

  test('con `imports` declarado en el perfil, el mismo gate corre', () => {
    const language = { id: 'x', extensions: ['.ts'], imports: { patterns: ["from\\s*'([^']+)'"] } };
    withWorkspace({ repos: [{ name: 'api', files: FILES, extra: { language } }] }, (ws) => {
      const gates = declare(ws, [{ id: 'g-needs', mode: 'ok', needs: ['imports'] }]);
      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json)['g-needs'].status, 'clean');
    });
  });

  test('un gate de workspace con una capacidad que no se cumple también figura como NO CORRIÓ', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [
        { id: 'w-ok', mode: 'ok', scope: 'workspace' },
        { id: 'w-needs', mode: 'ok', scope: 'workspace', needs: ['imports'] },
      ]);
      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json, 'workspace')['w-ok'].status, 'clean');
      assert.equal(byId(json, 'workspace')['w-needs'].status, 'skipped');
    });
  });

  test('el registro de candidatos a gate es una capacidad: existe en la base, así que el gate corre', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'w-reg', mode: 'ok', scope: 'workspace', needs: ['gateCandidates'] }]);
      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json, 'workspace')['w-reg'].status, 'clean');
    });
  });

  test('sin tablero de requisitos, el gate `requirements` figura como NO CORRIÓ y no como limpio', () => {
    // Antes salía 0 diciendo "No aplica", y en el resumen eso se leía "sin
    // hallazgos": un gate que no verificó nada con cara de verde.
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'w-req', mode: 'ok', scope: 'workspace', needs: ['requirements'] }]);
      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json, 'workspace')['w-req'].status, 'skipped');
    });
  });

  test('una capacidad desconocida no se asume cumplida', () => {
    withWorkspace(SPEC, (ws) => {
      const gates = declare(ws, [{ id: 'g-raro', mode: 'ok', needs: ['no-existe'] }]);
      const json = run(ws, gates, ['--repo', 'api', '--json']);
      assert.equal(byId(json)['g-raro'].status, 'skipped');
    });
  });
});

describe('run-gates: uso', () => {
  test('sin --repo ni --all sale con 2 y dice cómo se usa', () => {
    withWorkspace(SPEC, (ws) => {
      const r = run(ws, declare(ws, [{ id: 'g-ok', mode: 'ok' }]), []);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /Uso: node scripts\/run-gates\.js/);
    });
  });
});
