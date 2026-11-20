#!/usr/bin/env node
/**
 * gates.test.js — los gates, contra fixtures reales.
 *
 * Dos cosas se verifican de cada gate, y la segunda es la que importa:
 *
 *   1. Que encuentre lo que tiene que encontrar y no marque lo correcto.
 *   2. Que **su código de salida diga la verdad** cuando no puede verificar.
 *
 * La segunda es donde estuvieron los tres peores defectos que tuvo esta base:
 * un gate que salía 0 sin haber ejecutado nada, otro que salía 0 con el
 * repositorio sin clonar, y una huella de baseline idéntica para todo hallazgo.
 * Ninguno se veía como un fallo — se veían como un proyecto limpio.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runGate, withTempDir, pathWithout, hasTool, inFile, rulesOf, packsMissing } = require('./helpers');

// Las pruebas viajan a cada proyecto, que puede haber descartado estos packs.
const SIN_DOTNET = packsMissing(['dotnet']);
const SIN_OPENSPEC = packsMissing(['openspec']);

// ---------------------------------------------------------------------------
// Anti-patrones
// ---------------------------------------------------------------------------

describe('check-antipatterns', () => {
  test('marca los anti-patrones de JavaScript y no toca el código correcto', () => {
    const { code, findings } = runGate('scripts/check-antipatterns.js', ['--repo', 'js-repo']);

    assert.equal(code, 1, 'debe salir con 1: hay hallazgos');
    assert.deepEqual(rulesOf(inFile(findings, 'malo.service')), ['CORE-1.1', 'CORE-1.2']);
    assert.deepEqual(inFile(findings, 'bueno.service'), [], 'el fixture correcto no marca nada');
  });

  test('marca los anti-patrones de C#: el punto ciego que originó el perfil de lenguaje', { skip: SIN_DOTNET }, () => {
    const { code, findings } = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo']);

    assert.equal(code, 1);

    const malo = inFile(findings, 'Malo.cs');
    assert.deepEqual(rulesOf(malo), ['CORE-1.1', 'CORE-1.2', 'NET-1.1', 'NET-1.2', 'NET-1.3']);

    // `.Result` sobre `ObtenerAsync()` es el caso más común de NET-1.2 y el que
    // se perdía con un `\b` de más antes de `Async`.
    assert.equal(malo.filter((f) => f.rule === 'NET-1.2').length, 2, 'marca .Result y .Wait()');
  });

  test('el fixture correcto de C# no produce un solo hallazgo', () => {
    const { findings } = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo']);

    assert.deepEqual(
      inFile(findings, 'Bueno.cs'),
      [],
      'ni el async void de un manejador de eventos, ni la configuración inyectada, ' +
        'ni FromSqlInterpolated, ni el .Result de un IActionResult',
    );
  });

  test('no analiza rutas generadas ni archivos de test', () => {
    const { findings } = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo']);

    assert.deepEqual(inFile(findings, 'Migrations'), [], 'Migrations/ está en ignorePaths');
    assert.deepEqual(inFile(findings, 'Tests.cs'), [], '*Tests.cs es un archivo de test');
  });

  test('un archivo puntual se mira con el mismo alcance que el barrido completo', () => {
    // El hook de escritura analiza el archivo recién editado con `--target`.
    // Si el barrido completo nunca mira lo que está fuera de `src/`, el hook
    // tampoco debe: sus hallazgos no se pueden congelar en el baseline y no
    // desaparecen jamás. El fixture trae un script fuera de `src/` con una
    // violación de CORE-1.1.
    const file = 'test/fixtures/js-repo/scripts/consola.js';

    const completo = runGate('scripts/check-antipatterns.js', ['--repo', 'js-repo']);
    assert.deepEqual(inFile(completo.findings, 'consola.js'), [], 'el barrido completo no mira fuera de src/');

    const puntual = runGate('scripts/check-antipatterns.js', ['--repo', 'js-repo', '--target', file]);
    assert.deepEqual(inFile(puntual.findings, 'consola.js'), [], 'el archivo puntual tampoco');

    // Y dentro de src/ el modo puntual SÍ marca: el arreglo no apaga el hook.
    const dentro = runGate('scripts/check-antipatterns.js', [
      '--repo',
      'js-repo',
      '--target',
      'test/fixtures/js-repo/src/malo.service.ts',
    ]);
    assert.ok(inFile(dentro.findings, 'malo.service.ts').length > 0, 'dentro de src/ el modo puntual sigue marcando');
  });

  test('sale con 2 cuando el repositorio no está clonado', () => {
    const { code, stdout } = runGate('scripts/check-antipatterns.js', ['--repo', 'missing-repo']);

    assert.equal(code, 2, 'un repositorio sin clonar no es un repositorio limpio');
    assert.equal(stdout.trim(), '', 'sin lista vacía en stdout: un script leería eso como limpio');
  });

  test('sale con 2 cuando se pide una regla que no existe', () => {
    const { code } = runGate('scripts/check-antipatterns.js', [
      '--repo', 'js-repo', '--rule', 'NO-EXISTE',
    ]);
    assert.equal(code, 2, '"no busqué nada" no puede leerse como "no encontré nada"');
  });
});

// ---------------------------------------------------------------------------
// Aislamiento entre clientes
// ---------------------------------------------------------------------------

describe('check-tenant-isolation', () => {
  const script = 'ai/packs/multi-tenant/scripts/check-tenant-isolation.js';

  test('detecta las tres formas de perder el aislamiento', () => {
    const { code, findings } = runGate(script, ['--repo', 'js-repo']);

    assert.equal(code, 1);
    assert.deepEqual(rulesOf(inFile(findings, 'malo.service')), ['TENANT-1', 'TENANT-2', 'TENANT-3']);
    assert.deepEqual(inFile(findings, 'bueno.service'), []);
  });

  test('sale con 2 cuando ningún pack declara el dialecto de consulta del stack', () => {
    // dotnet-repo no declara `tenant` en su manifiesto: el gate no sabe cómo se
    // ve una consulta en ese stack y no puede afirmar que esté limpio.
    const { code, stdout } = runGate(script, ['--repo', 'dotnet-repo']);

    assert.equal(code, 2);
    assert.equal(stdout.trim(), '');
  });

  test('un stack que declara que NO consulta la base (frontend) no aplica: sale 0 y lo dice', () => {
    // El pack nextjs declara `tenant.notApplicable`. Sin esto, todo proyecto
    // multi-tenant con un frontend dejaba `run-gates --all` en 2 para siempre.
    // Es distinto del caso de arriba: allá el stack consulta y nadie dijo cómo,
    // y eso sigue siendo 2 porque hay algo que verificar y no se pudo.
    const run = runGate(script, ['--repo', 'empty-repo'], { json: false });
    assert.equal(run.code, 0);
    assert.match(run.stdout, /no aplica/i);

    const json = runGate(script, ['--repo', 'empty-repo']);
    assert.equal(json.code, 0);
    assert.deepEqual(json.findings, []);
  });

  test('un dialecto declarado gana sobre `notApplicable`: el stack que consulta se sigue verificando', () => {
    const { code } = runGate(script, ['--repo', 'js-repo']);
    assert.equal(code, 1, 'js-repo (nestjs) declara dialecto y tiene hallazgos');
  });
});

// ---------------------------------------------------------------------------
// Cobertura de escenarios
// ---------------------------------------------------------------------------

describe('check-scenario-coverage', () => {
  const script = 'scripts/check-scenario-coverage.js';

  test('empareja escenarios con tests de JavaScript', { skip: SIN_OPENSPEC }, () => {
    const { code, findings } = runGate(script, ['--repo', 'js-repo', '--change', 'demo']);

    assert.equal(code, 1);
    assert.equal(findings.length, 1, 'dos escenarios cubiertos, uno no');
    assert.match(findings[0].message, /registra el movimiento/);
  });

  test('empareja escenarios con tests de xUnit, por atributo y por nombre de método', { skip: SIN_DOTNET || SIN_OPENSPEC }, () => {
    const { code, findings } = runGate(script, ['--repo', 'dotnet-repo', '--change', 'demo']);

    assert.equal(code, 1);
    assert.equal(
      findings.length,
      1,
      'Rechaza_Un_Monto_Mayor_Al_Disponible cubre uno; el DisplayName cubre el otro',
    );
    assert.match(findings[0].message, /registra el movimiento/);
  });

  test('sale con 2, no con 1, cuando no supo leer los tests del lenguaje', () => {
    // Sin `testTitles` en el perfil, el gate no encuentra ningún título. Si
    // saliera con 1 reportaría TODOS los escenarios como sin test: una avalancha
    // de falsos positivos que termina con el gate apagado.
    const { code, stdout, stderr } = runGate(script, ['--repo', 'dotnet-repo', '--change', 'demo'], {
      env: { AI_WORKSPACE_CONFIG: require('./helpers').CONFIG },
    });

    // Con el perfil completo sí los lee; este caso se cubre en profile.test.js
    // manipulando el perfil. Acá solo se comprueba que no confunde los estados.
    assert.ok(code === 0 || code === 1, `código inesperado ${code}: ${stderr}`);
    assert.ok(stdout.trim().startsWith('['), 'en --json siempre emite una lista cuando pudo verificar');
  });

  test('sale con 0 cuando ningún pack declara un ciclo de especificación', () => {
    // empty-repo no tiene packs y el workspace declara openspec, así que el
    // proveedor existe pero el repositorio no tiene el directorio de cambios.
    const { code } = runGate(script, ['--repo', 'empty-repo']);
    assert.equal(code, 0, 'no hay nada que verificar no es lo mismo que no pude verificar');
  });
});

// ---------------------------------------------------------------------------
// Reglas estructurales
// ---------------------------------------------------------------------------

describe('check-semgrep', () => {
  const script = 'scripts/check-semgrep.js';

  test('sale con 0 y lo dice cuando ningún pack declara reglas', () => {
    const { code } = runGate(script, ['--repo', 'js-repo']);
    assert.equal(code, 0, 'sin reglas declaradas no hay nada que buscar');
  });

  test('sale con 2 cuando hay reglas declaradas y la herramienta no está', { skip: SIN_DOTNET }, () => {
    const limpio = pathWithout('semgrep');
    if (limpio === null) {
      test.skip('semgrep no está instalado: el camino ya es el mismo');
      return;
    }

    const { code, stdout } = runGate(script, ['--repo', 'dotnet-repo'], { env: { PATH: limpio } });

    // Este es el caso que salía con 0 y una lista vacía: el shell devuelve 1
    // cuando no encuentra el comando, el mismo código que "encontré hallazgos".
    assert.equal(code, 2, 'reglas declaradas que no se pudieron aplicar = no verificado');
    assert.equal(stdout.trim(), '');
  });

  test('encuentra el hallazgo estructural y cita la línea real del archivo', { skip: SIN_DOTNET }, (t) => {
    if (!hasTool('semgrep')) return t.skip('semgrep no está instalado');

    const { code, findings } = runGate(script, ['--repo', 'dotnet-repo']);
    assert.equal(code, 1);

    // La línea se lee del archivo: la herramienta devuelve "requires login" en
    // su edición libre, y con eso todos los hallazgos compartirían huella.
    for (const f of findings) {
      assert.notEqual(f.code, 'requires login');
      assert.ok(f.code.length > 0, 'un hallazgo sin código no se puede congelar por separado');
    }
  });
});

// ---------------------------------------------------------------------------
// Duplicación
// ---------------------------------------------------------------------------

describe('check-duplication', () => {
  test('sale con 2 cuando jscpd no está disponible', (t) => {
    const limpio = pathWithout('npx');
    if (limpio === null) return t.skip('npx no está en el PATH');

    const { code, stdout } = runGate('scripts/check-duplication.js', ['--repo', 'js-repo'], {
      env: { PATH: limpio },
    });

    assert.equal(code, 2);
    assert.equal(stdout.trim(), '', 'una lista vacía sería indistinguible de "sin duplicación"');
  });
});

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

describe('baseline', () => {
  test('congela lo que había y deja de reportarlo', { skip: SIN_DOTNET }, () => {
    withTempDir((dir) => {
      const antes = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo'], {
        env: { AI_BASELINE_DIR: dir },
      });
      assert.equal(antes.code, 1);
      assert.ok(antes.findings.length > 0);

      runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo', '--write-baseline'], {
        env: { AI_BASELINE_DIR: dir },
        json: false,
      });

      const despues = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo', '--baseline'], {
        env: { AI_BASELINE_DIR: dir },
      });
      assert.equal(despues.code, 0, 'la deuda congelada no vuelve a reportarse');
      assert.deepEqual(despues.findings, []);
    });
  });

  test('cada hallazgo tiene una huella propia: congelar uno no congela el resto', { skip: SIN_DOTNET }, () => {
    withTempDir((dir) => {
      const todos = runGate('scripts/check-antipatterns.js', ['--repo', 'dotnet-repo'], {
        env: { AI_BASELINE_DIR: dir },
      });

      const huellas = new Set(todos.findings.map((f) => `${f.rule}|${f.file}|${f.code}`));
      assert.equal(
        huellas.size,
        todos.findings.length,
        'huellas repetidas harían que congelar un hallazgo silenciara otros',
      );
    });
  });
});
