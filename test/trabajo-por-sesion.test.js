#!/usr/bin/env node
/**
 * trabajo-por-sesion.test.js — `scripts/trabajo-por-sesion.js`, una sesión
 * headless por tarea del plan.
 *
 * Se prueba con un harness falso: un script de Node que simula el CLI del
 * agente. Recibe el pedido por la entrada estándar (o como último argumento),
 * anota cada llamada en un registro y, según `FAKE_MODE`, cierra la tarea en el
 * plan o no. Así se prueba lo que importa del script, que es qué hace según el
 * plan quede cerrado o no, sin depender de ningún agente real.
 *
 * El plan y los registros viven en una carpeta temporal DENTRO de `test/`: las
 * rutas de `ai-workspace.json` son relativas a la raíz y no pueden salir de
 * ella. La configuración va en otro lado (`AI_WORKSPACE_CONFIG`).
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT } = require('./helpers');

const SCRIPT = path.join(ROOT, 'scripts', 'trabajo-por-sesion.js');

/** El CLI falso. Se escribe a disco para que corra como un proceso de verdad. */
const FAKE = `
const fs = require('fs');
const args = process.argv.slice(2);
const log = process.env.FAKE_LOG;
const mode = process.env.FAKE_MODE || 'close';

function listo(prompt) {
  const m = /hacé solo la tarea (\\S+) /.exec(prompt) || [];
  const id = m[1] || null;
  fs.appendFileSync(log, JSON.stringify({ id, args, prompt }) + '\\n');
  if (id && mode !== 'noclose') {
    const plan = process.env.FAKE_PLAN;
    const marker = process.env.FAKE_MARKER || '✅';
    const text = fs.readFileSync(plan, 'utf8')
      .split('\\n')
      .map((l) => (new RegExp('^#+\\\\s+(Tarea\\\\s+)?' + id + '[ :]').test(l) && !l.includes(marker) ? l + ' ' + marker : l))
      .join('\\n');
    fs.writeFileSync(plan, text);
  }
  process.stdout.write('{"type":"result","subtype":"success","is_error":false}\\n');
  process.exit(mode === 'error' ? 3 : 0);
}

if (process.env.FAKE_PROMPT_VIA === 'arg') listo(args[args.length - 1]);
else {
  let data = '';
  process.stdin.on('data', (d) => (data += d));
  process.stdin.on('end', () => listo(data));
}
`;

const PLAN = [
  '# Plan',
  '',
  '## T1 — Primera tarea ✅',
  'texto',
  '',
  '## T2 — Segunda tarea',
  'texto',
  '',
  '## T3 — Tercera tarea',
  'texto',
  '',
].join('\n');

/**
 * Arma el caso. `autonomous` y `harnessDefs` reemplazan los valores por defecto
 * cuando se pasan (`null` = no declararlos).
 */
function build({ plan = PLAN, autonomous = {}, harnessDefs, harnesses = ['fake'], headless = {}, inline = false } = {}) {
  const id = `.tmp-ses-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const base = path.join(ROOT, 'test', id);
  const relBase = `test/${id}`;
  fs.mkdirSync(base, { recursive: true });

  const planFile = path.join(base, 'plan.md');
  if (plan !== null) fs.writeFileSync(planFile, plan);
  const fakeFile = path.join(base, 'fake-harness.js');
  fs.writeFileSync(fakeFile, FAKE);
  const logFile = path.join(base, 'llamadas.jsonl');

  const headlessBlock = {
    command: process.execPath,
    args: [fakeFile, '--modo-falso'],
    promptVia: 'stdin',
    budgetFlag: '--max-budget-usd',
    skipPermissionsFlag: '--saltear-permisos',
    ...headless,
  };

  const cfg = {
    version: 1,
    project: { name: 'prueba' },
    topology: 'single-repo',
    repos: [{ name: 'app', path: '.' }],
    harnesses,
    harnessDefinitions: harnessDefs === undefined ? { fake: { headless: headlessBlock } } : harnessDefs,
  };
  if (autonomous !== null) {
    cfg.autonomous = {
      plan: `${relBase}/plan.md`,
      taskHeading: '^##\\s+(\\S+)\\s+—\\s+(.+?)\\s*$',
      doneMarker: '✅',
      logDir: `${relBase}/sesiones`,
      ...(inline ? { headless: headlessBlock } : {}),
      ...autonomous,
    };
  }

  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-ses-'));
  const cfgFile = path.join(cfgDir, 'ai-workspace.json');
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));

  return {
    base,
    planFile,
    headlessBlock,
    run(args = [], env = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          AI_WORKSPACE_CONFIG: cfgFile,
          FAKE_LOG: logFile,
          FAKE_PLAN: planFile,
          ...env,
        },
      });
      return { code: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
    },
    calls: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    plan: () => fs.readFileSync(planFile, 'utf8'),
    sessionLogs: () => (fs.existsSync(path.join(base, 'sesiones')) ? fs.readdirSync(path.join(base, 'sesiones')) : []),
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(cfgDir, { recursive: true, force: true });
    },
  };
}

function withWs(spec, fn) {
  const ws = build(spec);
  try {
    return fn(ws);
  } finally {
    ws.cleanup();
  }
}

// ---------------------------------------------------------------------------

describe('el recorrido', () => {
  test('una sesión por tarea: lanza el harness una vez por cada tarea sin cerrar, en orden', () => {
    withWs({}, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(ws.calls().map((c) => c.id), ['T2', 'T3']);
      assert.match(ws.plan(), /## T2 — Segunda tarea ✅/);
      assert.match(ws.plan(), /## T3 — Tercera tarea ✅/);
      assert.match(r.stdout, /El plan está terminado/);
      assert.equal(ws.sessionLogs().length, 2, 'queda el registro de cada sesión');
    });
  });

  test('cada sesión recibe solo SU tarea y no la siguiente', () => {
    withWs({}, (ws) => {
      ws.run();
      const [primera] = ws.calls();
      assert.match(primera.prompt, /tarea T2 \(Segunda tarea\)/);
      assert.doesNotMatch(primera.prompt, /T3/);
      assert.match(primera.prompt, /No sigas con otra tarea/);
      assert.match(primera.prompt, /trabajo-autonomo/);
    });
  });

  test('el commit NO se pide salvo que la configuración lo autorice', () => {
    withWs({}, (ws) => {
      ws.run(['--una']);
      assert.match(ws.calls()[0].prompt, /No commitees ni pushees/);
    });
    withWs({ autonomous: { commit: true } }, (ws) => {
      ws.run(['--una']);
      const { prompt } = ws.calls()[0];
      assert.match(prompt, /commit y push con `git-commit-workflow`/);
      assert.doesNotMatch(prompt, /No commitees/);
    });
  });

  test('--una: cierra la próxima y se detiene', () => {
    withWs({}, (ws) => {
      const r = ws.run(['--una']);
      assert.equal(r.code, 0);
      assert.deepEqual(ws.calls().map((c) => c.id), ['T2']);
      assert.doesNotMatch(ws.plan(), /## T3 — Tercera tarea ✅/);
    });
  });

  test('plan ya terminado: no lanza nada y lo dice', () => {
    withWs({ plan: '## T1 — Única ✅\n' }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 0);
      assert.equal(ws.calls().length, 0);
      assert.match(r.stdout, /El plan está terminado/);
    });
  });
});

describe('frena si la tarea no quedó cerrada', () => {
  test('la sesión sale bien pero no cerró la tarea: exit 1 y no sigue con la próxima', () => {
    withWs({}, (ws) => {
      const r = ws.run([], { FAKE_MODE: 'noclose' });
      assert.equal(r.code, 1);
      assert.match(r.stdout, /Freno: T2 no quedó cerrada/);
      assert.deepEqual(ws.calls().map((c) => c.id), ['T2'], 'T3 nunca se lanzó');
      assert.doesNotMatch(ws.plan(), /## T2 — Segunda tarea ✅/);
    });
  });

  test('la sesión cierra la tarea pero termina con error: también frena', () => {
    withWs({}, (ws) => {
      const r = ws.run([], { FAKE_MODE: 'error' });
      assert.equal(r.code, 1);
      assert.match(r.stdout, /terminó con error \(código 3\)/);
      assert.deepEqual(ws.calls().map((c) => c.id), ['T2']);
    });
  });

  test('un harness que no se puede lanzar: frena con exit 1, no se queda colgado', () => {
    withWs({ headless: { command: path.join(os.tmpdir(), 'no-existe-este-comando.exe') } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 1);
      assert.match(r.stderr, /No pude lanzar/);
      assert.match(r.stdout, /Freno: T2/);
    });
  });

  test('el cierre lo decide el plan, no lo que diga la sesión: un "result" de éxito sin marca no alcanza', () => {
    withWs({}, (ws) => {
      const r = ws.run([], { FAKE_MODE: 'noclose' });
      assert.equal(r.code, 1);
    });
  });
});

describe('--ver', () => {
  test('muestra pendientes, comando y pedido sin correr ninguna sesión', () => {
    withWs({}, (ws) => {
      const r = ws.run(['--ver']);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /T2 — Segunda tarea/);
      assert.match(r.stdout, /T3 — Tercera tarea/);
      assert.match(r.stdout, /Pedido de la primera/);
      assert.match(r.stdout, /Permisos: los normales del harness/);
      assert.equal(ws.calls().length, 0);
    });
  });
});

describe('permisos y tope: opt-in explícito', () => {
  test('por defecto NO se saltean permisos', () => {
    withWs({}, (ws) => {
      ws.run(['--una']);
      assert.ok(!ws.calls()[0].args.includes('--saltear-permisos'));
    });
  });

  test('--sin-permisos agrega la bandera del harness', () => {
    withWs({}, (ws) => {
      const r = ws.run(['--una', '--sin-permisos']);
      assert.equal(r.code, 0);
      assert.ok(ws.calls()[0].args.includes('--saltear-permisos'));
    });
  });

  test('--sin-permisos con un harness que no declara cómo saltearlos: 1, sin lanzar la sesión', () => {
    withWs({ headless: { skipPermissionsFlag: undefined } }, (ws) => {
      const r = ws.run(['--una', '--sin-permisos']);
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /no declara `skipPermissionsFlag`/);
      assert.equal(ws.calls().length, 0);
    });
  });

  test('--tope-usd usa el `budgetFlag` del harness', () => {
    withWs({}, (ws) => {
      ws.run(['--una', '--tope-usd', '15']);
      const { args } = ws.calls()[0];
      assert.equal(args[args.indexOf('--max-budget-usd') + 1], '15');
    });
  });

  test('--tope-usd con un valor que no es número: 2', () => {
    withWs({}, (ws) => {
      const r = ws.run(['--una', '--tope-usd', 'mucho']);
      assert.equal(r.code, 2);
      assert.equal(ws.calls().length, 0);
    });
  });
});

describe('el adaptador es un dato', () => {
  test('el pedido puede ir como último argumento', () => {
    withWs({ headless: { promptVia: 'arg' } }, (ws) => {
      const r = ws.run(['--una'], { FAKE_PROMPT_VIA: 'arg' });
      assert.equal(r.code, 0, r.stderr);
      const { args, id } = ws.calls()[0];
      assert.equal(id, 'T2');
      assert.match(args[args.length - 1], /tarea T2/);
    });
  });

  test('sin ningún harness declarado, no hay con qué lanzar: 2', () => {
    withWs({ harnessDefs: {}, harnesses: [] }, (ws) => {
      assert.equal(ws.run(['--una']).code, 2);
      assert.equal(ws.calls().length, 0);
    });
  });

  test('`autonomous.headless` alcanza solo, sin harness declarado', () => {
    withWs({ harnessDefs: {}, harnesses: [], inline: true }, (ws) => {
      const r = ws.run(['--una']);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(ws.calls().map((c) => c.id), ['T2']);
    });
  });

  test('se puede elegir el harness con --harness', () => {
    withWs({ harnesses: ['fake', 'claude'] }, (ws) => {
      // `claude` está en el catálogo de la base; si no declara `headless` y se lo pide, no hay con qué.
      const r = ws.run(['--una', '--harness', 'fake']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(ws.calls().length, 1);
    });
  });

  test('un marcador de cierre propio y un patrón de encabezado propio', () => {
    const plan = '### Tarea 1: Uno [x]\n\n### Tarea 2: Dos\n\n### Tarea 3: Tres\n';
    withWs(
      { plan, autonomous: { taskHeading: '^###\\s+Tarea\\s+(\\d+):\\s+(.+?)\\s*$', doneMarker: '[x]' } },
      (ws) => {
        const r = ws.run(['--una'], { FAKE_MARKER: '[x]' });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(ws.calls()[0].prompt, /tarea 2 \(Dos\)/);
        assert.doesNotMatch(ws.calls()[0].prompt, /Tres/);
        assert.match(ws.plan(), /### Tarea 2: Dos \[x\]/);
        assert.doesNotMatch(ws.plan(), /Tres \[x\]/);
      },
    );
  });
});

describe('lo que no se puede verificar sale 2, nunca "plan terminado"', () => {
  test('sin `autonomous` en la configuración', () => {
    withWs({ autonomous: null }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.match(r.stderr, /falta `autonomous`/);
      assert.equal(ws.calls().length, 0);
    });
  });

  test('sin `autonomous.plan` o sin `taskHeading`', () => {
    withWs({ autonomous: { plan: undefined } }, (ws) => assert.equal(ws.run().code, 2));
    withWs({ autonomous: { taskHeading: undefined } }, (ws) => assert.equal(ws.run().code, 2));
  });

  test('un `taskHeading` con un solo grupo de captura', () => {
    withWs({ autonomous: { taskHeading: '^##\\s+(\\S+)' } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.match(r.stderr, /dos grupos/);
    });
  });

  test('el plan no existe', () => {
    withWs({ plan: null }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.match(r.stderr, /no encontré el plan/);
    });
  });

  test('un plan donde ningún encabezado coincide NO es "plan terminado"', () => {
    withWs({ plan: '# Nada que ver\n\nTexto.\n' }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.match(r.stderr, /ninguna tarea/);
      assert.doesNotMatch(r.stdout, /terminado/);
    });
  });

  test('ningún harness declara `headless`', () => {
    withWs({ harnessDefs: { fake: {} } }, (ws) => {
      const r = ws.run();
      assert.equal(r.code, 2);
      assert.match(r.stderr, /ningún harness declara `headless`/);
    });
  });
});
