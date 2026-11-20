#!/usr/bin/env node
/**
 * run-gates.js
 *
 * Corre todas las verificaciones aplicables a un repositorio, UNA sola vez, y
 * emite un bloque compacto pensado para pegarse en el prompt de un subagente.
 *
 * Por qué existe: sin esto, cada subagente de revisión corre los gates por su
 * cuenta. Con dos o tres agentes en paralelo eso es el mismo trabajo
 * determinista repetido, pagado con tokens de razonamiento. El orquestador lo
 * corre una vez —gratis— y les pasa el resultado ya resuelto; cada agente gasta
 * tokens solo en lo que ningún script puede decidir.
 *
 * Qué gate corre para qué repositorio lo decide el registro de
 * `scripts/lib/gates.js`, que se arma con lo que declaran el núcleo y los packs
 * instalados. Este script no conoce ningún gate por nombre.
 *
 * El output es deliberadamente CORTO: un gate sin hallazgos ocupa media línea.
 * Un reporte largo pegado en tres prompts es justamente el gasto que esto viene
 * a evitar.
 *
 * Códigos de salida, que son la única parte que un CI puede leer:
 *   0 — todos los gates corrieron y ninguno encontró nada
 *   1 — algún gate encontró algo nuevo
 *   2 — algo NO se verificó: un gate caído, o un repositorio sin clonar
 *
 * El 2 no es un detalle de implementación. Contar solo los hallazgos haría que
 * una corrida donde ningún gate pudo ejecutarse saliera con 0, y ese 0 se lee
 * como "está limpio" — exactamente el error que este script viene a evitar en
 * el texto. El texto ya lo dice; el código de salida también tiene que decirlo.
 *
 * Uso:
 *   node scripts/run-gates.js --all
 *   node scripts/run-gates.js --repo mi-api
 *   node scripts/run-gates.js --repo mi-api --json
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

const config = require('./lib/workspace-config');
const gatesLib = require('./lib/gates');

const ROOT = config.ROOT;
const GATE_TIMEOUT_MS = 180000;
const MAX_FINDINGS_SHOWN = 20;

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * Corre un gate. Los scripts salen con 1 cuando encuentran algo — no es un
 * error. Cualquier otro código sí lo es, y se reporta como gate caído en vez de
 * como "sin hallazgos": **un gate roto que se lee como limpio es peor que no
 * tenerlo**.
 */
function runGate(gate, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args, '--json'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', () => {});

    const timer = setTimeout(() => {
      child.kill();
      finish({ ...gate, ok: false, findings: [] });
    }, GATE_TIMEOUT_MS);

    child.on('error', () => {
      clearTimeout(timer);
      finish({ ...gate, ok: false, findings: [] });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== 1) return finish({ ...gate, ok: false, findings: [] });
      try {
        const parsed = JSON.parse(out);
        finish({ ...gate, ok: true, findings: Array.isArray(parsed) ? parsed : [] });
      } catch {
        finish({ ...gate, ok: false, findings: [] });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

function describe(f) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const what = f.message || f.target || f.code || f.rule || '';
  const rule = f.rule ? `[${f.rule}] ` : '';
  return `    ${rule}${where}\n      ${String(what).replace(/\s+/g, ' ').trim()}`;
}

function render(label, results, missing) {
  const lines = [`## Gates deterministas — ${label} (ya ejecutados, NO volver a correrlos)`, ''];

  const clean = results.filter((r) => r.ok && !r.skipped && r.findings.length === 0);
  const dirty = results.filter((r) => r.ok && !r.skipped && r.findings.length > 0);
  const broken = results.filter((r) => !r.ok);

  if (missing) {
    lines.push(`NO SE VERIFICÓ: ${missing}`);
    lines.push('');
    lines.push(`Gates que habrían corrido: ${results.map((r) => r.label).join(' · ') || 'ninguno'}`);
    lines.push('Tratarlo como "sin verificar", no como "sin hallazgos".');
    return lines.join('\n');
  }

  if (results.length === 0) {
    lines.push('No hay ningún gate aplicable: no se verificó nada por este medio.');
    lines.push('Tratarlo como "sin verificar", no como "sin hallazgos".');
    return lines.join('\n');
  }

  if (clean.length) {
    lines.push(`Sin hallazgos nuevos: ${clean.map((r) => r.label).join(' · ')}`);
    lines.push('');
  }

  for (const r of dirty) {
    lines.push(`### ${r.label} — ${r.findings.length} hallazgo(s)`);
    lines.push(`Fuente: ${r.source}`);
    for (const f of r.findings.slice(0, MAX_FINDINGS_SHOWN)) lines.push(describe(f));
    if (r.findings.length > MAX_FINDINGS_SHOWN) {
      lines.push(
        `    … y ${r.findings.length - MAX_FINDINGS_SHOWN} más (correr el gate a mano para verlos)`,
      );
    }
    lines.push('');
  }

  // Un gate caído NO se omite en silencio. Que desaparezca del bloque es lo que
  // hace que nadie note que algo nunca se verificó: su ausencia no dice nada.
  for (const r of broken) {
    lines.push(`### ${r.label} — NO SE PUDO EJECUTAR`);
    lines.push('    Tratarlo como "sin verificar", no como "sin hallazgos".');
    lines.push('');
  }

  lines.push(
    'Estos hallazgos ya están confirmados por script: no los re-derives leyendo',
    'código. La deuda preexistente está congelada en baseline y no aparece acá.',
    'Tu trabajo es lo que ningún script puede decidir: correctitud de la lógica,',
    'coherencia con el diseño acordado, y si un hallazgo de arriba es un falso',
    'positivo.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const repoIdx = argv.indexOf('--repo');

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const names = cfg.repos.map((r) => r.name);
  let targets;

  if (argv.includes('--all')) {
    targets = cfg.repos;
  } else if (repoIdx >= 0 && names.includes(argv[repoIdx + 1])) {
    targets = [cfg.repos.find((r) => r.name === argv[repoIdx + 1])];
  } else {
    process.stderr.write(
      `\nUso: node scripts/run-gates.js (--all | --repo ${names.join('|')}) [--json]\n\n`,
    );
    process.exit(2);
  }

  // Los gates de alcance workspace corren una sola vez, no una por repositorio:
  // barren lo mismo y repetirlos duplicaría cada hallazgo.
  const workspaceGates = gatesLib.forWorkspace(cfg);
  const workspaceResults = await Promise.all(
    workspaceGates.map((g) => runGate(g, gatesLib.argsFor(g, { scope: 'workspace' }))),
  );

  const perRepo = await Promise.all(
    targets.map(async (repo) => {
      const gates = gatesLib.forRepo(cfg, repo);

      // Un repositorio que todavía no se clonó no es un gate roto: no hay nada
      // que verificar. Confundir las dos cosas hace que un "no se pudo
      // ejecutar" pierda su significado, y ese aviso es justamente el que no
      // puede volverse ruido de fondo.
      if (!fs.existsSync(repo.absPath)) {
        return {
          label: repo.name,
          missing: `el repositorio no está en ${repo.path} — ¿falta clonarlo?`,
          results: gates.map((g) => ({ ...g, ok: true, skipped: true, findings: [] })),
        };
      }

      const results = await Promise.all(
        gates.map((g) => runGate(g, gatesLib.argsFor(g, { repo: repo.name, scope: repo.name }))),
      );
      return { label: repo.name, results };
    }),
  );

  const blocks = [{ label: 'workspace', results: workspaceResults, missing: null }, ...perRepo];
  const total = blocks.reduce(
    (n, b) => n + b.results.reduce((m, r) => m + r.findings.length, 0),
    0,
  );

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        blocks.map((b) => ({
          scope: b.label,
          gates: b.results.map(({ id, label, ok, findings }) => ({ id, label, ok, findings })),
        })),
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(blocks.map((b) => render(b.label, b.results, b.missing)).join('\n\n') + '\n');
  }

  // Un gate caído y un repositorio sin clonar no son "sin hallazgos": son sin
  // verificar, y por eso ganan sobre el conteo de hallazgos.
  const broken = blocks.reduce((n, b) => n + b.results.filter((r) => !r.ok).length, 0);
  const unverified = blocks.filter((b) => b.missing).length;

  if (broken > 0 || unverified > 0) process.exit(2);
  process.exit(total > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`run-gates falló: ${err && err.message}\n`);
  process.exit(2);
});
