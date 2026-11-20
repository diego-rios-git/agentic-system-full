#!/usr/bin/env node
/**
 * e2e-scripts.test.js — el linter de scripts de pruebas de punta a punta
 * (`ai/packs/e2e/scripts/check-e2e-scripts.js`), corrido como lo corre un proyecto:
 * el script real, en un proceso aparte, mirando su código de salida y su salida.
 *
 * Lo que se verifica no es solo que marque lo que tiene que marcar, sino lo otro:
 * que no marque lo que tiene que dejar pasar (un linter que corta de más se
 * desactiva), y que NUNCA salga 0 cuando no pudo mirar.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, CONFIG, withTempDir, hasTool } = require('./helpers');

// Estas pruebas viajan a cada proyecto, y `init` descarta los packs que no se
// eligieron: sin el pack e2e no hay nada que probar acá. Se omite con el
// motivo a la vista, no se deja fallar por una razón que no es un defecto.
const SIN_PACK = require('./helpers').packsMissing(['e2e']);
if (SIN_PACK) {
  test('check-e2e-scripts: se omite', { skip: SIN_PACK }, () => {});
  return;
}

const SCRIPT = path.join(ROOT, 'ai', 'packs', 'e2e', 'scripts', 'check-e2e-scripts.js');
const HAS_PYTHON = hasTool(process.platform === 'win32' ? 'python' : 'python3') || hasTool('python');

/** Corre el linter. `config` es un objeto (se escribe a un archivo temporal) o `null` (sin config). */
function run(args, { config, dir } = {}) {
  const env = { ...process.env };
  let configPath;

  if (config === null) {
    configPath = path.join(dir, 'no-existe.json'); // un archivo que no existe: config ausente
  } else {
    const base = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    configPath = path.join(dir, 'ai-workspace.json');
    fs.writeFileSync(configPath, JSON.stringify({ ...base, ...(config ? { e2e: config } : {}) }));
  }
  env.AI_WORKSPACE_CONFIG = configPath;

  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env, timeout: 60000 });
  let findings = null;
  if (args.includes('--json') && String(r.stdout).trim().startsWith('[')) {
    try {
      findings = JSON.parse(r.stdout);
    } catch {
      findings = null;
    }
  }
  return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), findings };
}

const rulesOf = (res) => [...new Set((res.findings || []).map((f) => f.rule))].sort();

function write(dir, name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

describe('check-e2e-scripts: autoprueba', () => {
  test('todos los casos dan como se esperaba, y son al menos 25', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--autoprueba'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    const ok = (r.stdout.match(/^ {2}OK /gm) || []).length;
    const mal = (r.stdout.match(/^ {2}MAL /gm) || []).length;
    assert.equal(mal, 0, r.stdout);
    assert.ok(ok >= 25, `solo ${ok} casos`);
  });

  test('los casos incluyen, por cada regla, uno que marca y uno que no', () => {
    const { CASOS } = require(SCRIPT);
    const reglas = new Set(CASOS.map((c) => c[0]));
    for (const regla of ['E2E-1', 'E2E-2', 'E2E-3', 'E2E-4', 'E2E-5', 'E2E-6', 'DATO-1']) {
      assert.ok(reglas.has(regla), `falta ${regla}`);
      assert.ok(CASOS.some((c) => c[0] === regla && c[4] >= 1), `${regla}: ningún caso que marque`);
      assert.ok(CASOS.some((c) => c[0] === regla && c[4] === 0), `${regla}: ningún caso que NO marque`);
    }
  });
});

describe('check-e2e-scripts: config ausente', () => {
  test('sin config y sin archivos: NO APLICA, dicho explícitamente, y sale 0', () => {
    withTempDir((dir) => {
      const r = run([], { config: null, dir });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /NO APLICA/);
    });
  });

  test('sin config y con --json: lista vacía en stdout y el aviso en stderr', () => {
    withTempDir((dir) => {
      const r = run(['--json'], { config: null, dir });
      assert.equal(r.code, 0);
      assert.deepEqual(r.findings, []);
      assert.match(r.stderr, /NO APLICA/);
    });
  });

  test('config válida pero sin la sección e2e: también NO APLICA', () => {
    withTempDir((dir) => {
      const r = run([], { config: undefined, dir });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /NO APLICA/);
    });
  });

  test('con un archivo explícito se aplican las reglas portables, y E2E-6 queda "no aplica"', () => {
    withTempDir((dir) => {
      const file = write(dir, 's.js', "await page.waitForTimeout(3000);\nawait db.query(\"INSERT INTO t (a) VALUES (1)\");\n");
      const r = run(['--json', file], { config: null, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(rulesOf(r), ['E2E-1']);
      assert.match(r.stderr, /no aplica E2E-6/);
    });
  });
});

describe('check-e2e-scripts: con config', () => {
  test('un script limpio sale 0', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/limpio.py', "page.get_by_text('Guardado').wait_for(state='visible')\nelegir(page, '#x', 'a')\n");
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e') }, dir });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.findings, []);
    });
  });

  test('un script con un error conocido sale 1 y lista {rule,file,line,message}', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/malo.py', 'import time\ntime.sleep(5)\n');
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e') }, dir });
      assert.equal(r.code, 1);
      assert.equal(r.findings.length, 1);
      const f = r.findings[0];
      assert.equal(f.rule, 'E2E-1');
      assert.equal(f.line, 2);
      assert.ok(f.file.endsWith('malo.py'));
      assert.ok(f.message);
    });
  });

  test('la misma línea con su `espera:` justificada pasa', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/ok.py', 'import time\ntime.sleep(5)  # espera: ventana del límite de frecuencia\n');
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e') }, dir });
      assert.equal(r.code, 0, r.stderr);
    });
  });

  test('E2E-6: la escritura directa se marca, y por el helper autorizado pasa', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/a.py', 'uno("INSERT INTO t (a) VALUES (1)")\n');
      write(dir, 'e2e/b.py', 'escribir_autorizado(r, "INSERT INTO t (a) VALUES (1)", motivo="x", autorizacion="y")\n');
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e'), authorizedWriteHelper: 'escribir_autorizado' }, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(r.findings.map((f) => path.basename(f.file)), ['a.py']);
      assert.equal(r.findings[0].rule, 'E2E-6');
    });
  });

  test('DATO-1: forbiddenData marca scripts y guías (.md)', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/a.js', "entrar('jugador@miempresa.local');\n");
      write(dir, 'e2e/guia.md', 'Entrar con `otro@miempresa.local`.\n');
      write(dir, 'e2e/limpio.js', "entrar(persona('admin'));\n");
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e'), forbiddenData: ['@miempresa\\.local'] }, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(r.findings.map((f) => path.basename(f.file)).sort(), ['a.js', 'guia.md']);
      assert.ok(r.findings.every((f) => f.rule === 'DATO-1'));
    });
  });

  test('un script TypeScript se revisa por reglas y su sintaxis no se afirma', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/a.ts', "await page.getByRole('combobox').selectOption('x');\n");
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e') }, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(rulesOf(r), ['E2E-2']);
      assert.match(r.stderr, /sintaxis de \.ts no se comprueba/);
    });
  });

  test('`paths` agrega archivos y globs', () => {
    withTempDir((dir) => {
      write(dir, 'otros/uno.js', 'await page.waitForTimeout(10);\n');
      const r = run(['--json'], { config: { paths: [path.join(dir, 'otros')] }, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(rulesOf(r), ['E2E-1']);
    });
  });
});

describe('check-e2e-scripts: lo que no se pudo verificar sale 2 con stdout vacío', () => {
  test('la carpeta declarada no existe', () => {
    withTempDir((dir) => {
      const r = run(['--json'], { config: { dir: path.join(dir, 'no-existe') }, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('la config e2e no declara ni dir ni paths', () => {
    withTempDir((dir) => {
      const r = run(['--json'], { config: { authorizedWriteHelper: 'x' }, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('una expresión regular inválida en forbiddenData', () => {
    withTempDir((dir) => {
      write(dir, 'e2e/a.js', 'x();\n');
      const r = run(['--json'], { config: { dir: path.join(dir, 'e2e'), forbiddenData: ['(sin cerrar'] }, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('un archivo explícito que no existe', () => {
    withTempDir((dir) => {
      const r = run(['--json', path.join(dir, 'nada.py')], { config: null, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });

  test('e2e con un tipo equivocado', () => {
    withTempDir((dir) => {
      const r = run(['--json'], { config: { dir: ['no', 'es', 'un', 'texto'] }, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });
});

describe('check-e2e-scripts: un archivo con error de sintaxis', () => {
  test('JavaScript: E2E-0, y no se siguen aplicando las demás reglas sobre él', () => {
    withTempDir((dir) => {
      const file = write(dir, 'roto.js', 'await page.waitForTimeout(5);\nconst a = ;\n');
      const r = run(['--json', file], { config: null, dir });
      assert.equal(r.code, 1);
      assert.deepEqual(rulesOf(r), ['E2E-0']);
      assert.equal(r.findings[0].line, 2);
    });
  });

  test('un .js que es módulo (await de nivel superior) no es un error de sintaxis', () => {
    withTempDir((dir) => {
      const file = write(dir, 'modulo.js', "import { x } from './kit.js';\nawait x();\n");
      const r = run(['--json', file], { config: null, dir });
      assert.equal(r.code, 0, r.stderr);
    });
  });

  test('Python: E2E-0 (si hay intérprete)', { skip: !HAS_PYTHON && 'no hay Python instalado' }, () => {
    withTempDir((dir) => {
      const file = write(dir, 'roto.py', 'import time\ndef x(:\n    pass\n');
      const r = run(['--json', file], { config: null, dir });
      assert.equal(r.code, 1, r.stderr);
      assert.deepEqual(rulesOf(r), ['E2E-0']);
      assert.equal(r.findings[0].line, 2);
    });
  });

  test('Python sin intérprete: NO se da por limpio, sale 2', { skip: HAS_PYTHON && 'hay Python instalado' }, () => {
    withTempDir((dir) => {
      const file = write(dir, 'x.py', 'x = 1\n');
      const r = run(['--json', file], { config: null, dir });
      assert.equal(r.code, 2);
      assert.equal(r.stdout.trim(), '');
    });
  });
});
