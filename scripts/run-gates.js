#!/usr/bin/env node
/**
 * run-gates.js
 *
 * Corre todas las verificaciones aplicables a un repositorio, UNA sola vez, y
 * emite un bloque compacto pensado para pegarse en el prompt de cada subagente
 * de revisión.
 *
 * Por qué existe: sin esto, cada subagente corre los gates por su cuenta. Con
 * dos o tres agentes en paralelo eso es el mismo trabajo determinista repetido,
 * pagado con tokens de razonamiento. El orquestador lo corre una vez —gratis— y
 * les pasa el resultado ya resuelto; cada agente gasta tokens solo en lo que
 * ningún script puede decidir.
 *
 * Qué gate corre para qué repositorio lo decide el registro de
 * `scripts/lib/gates.js`, que se arma con lo que declaran el núcleo y los packs
 * instalados. Este script no conoce ningún gate por nombre.
 *
 * TRES estados, y los dos últimos significan "sin verificar", JAMÁS "limpio":
 *
 *   sin hallazgos        el gate corrió y no encontró nada
 *   NO CORRIÓ            el gate no aplica o dijo que no pudo mirar (`{skipped}`,
 *                        o le falta una capacidad: `needs`)
 *   NO SE PUDO EJECUTAR  salió con un código distinto de 0/1, devolvió un JSON
 *                        ilegible o de forma desconocida, o se colgó (timeout)
 *
 * Un gate que desaparece del bloque se lee como "pasó": por eso ninguno se
 * omite en silencio.
 *
 * Hallazgos del DIFF vs de afuera. Se detalla solo lo que cae en archivos del
 * cambio; lo demás es deuda que esta rama no introdujo y va en una línea con el
 * conteo ("N fuera del diff"). En una revisión real el bloque traía 137
 * hallazgos y ninguno era de los 7 archivos del cambio: tapaban lo único que
 * importaba. `--todo` muestra todo. Si el diff no se puede leer NO se filtra
 * nada: ocultar hallazgos sin saber qué toca la rama es peor que mostrar de más.
 *
 * Lo mismo vale para el código de salida: el 1 es solo por hallazgos del diff.
 * (Antes salía 1 por todos, incluida la deuda ajena, y un CI no podía usarlo.)
 *
 * Normalización. Cada gate escribe la ruta a su manera —con `\` de Windows, con
 * el nombre del repositorio adelante, con la ruta del slot— y algunos devuelven
 * un objeto en vez de una lista (`{findings}`). Un objeto que se lee como "lista
 * vacía" es un gate roto que figura limpio: acá se aplana, y una forma que no se
 * reconoce es NO SE PUDO EJECUTAR.
 *
 * `--from <slot>` lee el código de un slot en vez de la principal: el diff, los
 * gates y los archivos salen de ESA rama. Sin esto, una revisión en un slot
 * auditaba en silencio lo que estuviera checkouteado en la principal. Si el slot
 * no tiene ese repositorio se dice; nunca se cae a la principal.
 *
 * La base es `origin/<baseBranch>` del repositorio (`--base` la cambia) y el diff
 * incluye lo commiteado, lo modificado y lo sin trackear: ver `lib/review-base.js`.
 *
 * Códigos de salida (lo único que un CI puede leer):
 *   0 — nada que reportar en el diff
 *   1 — algún gate encontró algo en el diff
 *   2 — algo NO se verificó: un gate no pudo ejecutarse, o un repositorio (o su
 *       slot) no está. Gana sobre el 1: sin verificar no es "con hallazgos".
 *   `NO CORRIÓ` por sí solo no cambia el código (es lo normal cuando un gate no
 *   aplica), pero queda escrito en el bloque y en `--json` (`status: "skipped"`).
 *
 * Uso:
 *   node scripts/run-gates.js --all
 *   node scripts/run-gates.js --repo mi-api [--from review] [--base origin/main]
 *   node scripts/run-gates.js --repo mi-api --change mi-cambio --json
 *   node scripts/run-gates.js --repo mi-api --todo      # también lo de fuera del diff
 *
 * Solo para los tests de la base: `AI_GATE_TIMEOUT_MS` cambia el tope de 180 s
 * por gate y `AI_GATES_CONCURRENCY` el paralelismo (6).
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const gatesLib = require('./lib/gates');
const repoLocation = require('./lib/repo-location');
const reviewBase = require('./lib/review-base');
const wt = require('./lib/worktree-paths');

const ROOT = config.ROOT;
const GATE_TIMEOUT_MS = Number(process.env.AI_GATE_TIMEOUT_MS) || 180000;
const CONCURRENCY = Number(process.env.AI_GATES_CONCURRENCY) || 6;
const MAX_FINDINGS_SHOWN = 20;

// ---------------------------------------------------------------------------
// Normalización de la salida de un gate
// ---------------------------------------------------------------------------

/** Lee `a.b.c` de un objeto. */
function pick(obj, dotted) {
  return String(dotted)
    .split('.')
    .reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/**
 * Lleva la salida de un gate a `{findings}`, `{skipped}` o `{unreadable}`.
 *
 *   lista                          → hallazgos
 *   `{skipped: "motivo"}`          → NO CORRIÓ
 *   `{findings: [...]}`            → hallazgos
 *   `gate.flatten` (función)       → lo que devuelva (lista de hallazgos)
 *   `gate.flatten` (ruta o rutas)  → lo que haya en esas rutas del objeto; un
 *                                    texto suelto pasa a `{rule: <id>, file: texto}`
 *   cualquier otra forma           → ilegible: sin verificar, nunca "limpio"
 */
function flatten(payload, gate = {}) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && payload.skipped) {
    return { skipped: String(payload.skipped) };
  }

  if (typeof gate.flatten === 'function') {
    const list = gate.flatten(payload);
    return Array.isArray(list) ? { findings: list } : { unreadable: '`flatten` no devolvió una lista' };
  }

  if (Array.isArray(payload)) return { findings: payload };

  if (payload && typeof payload === 'object') {
    const paths = [].concat(gate.flatten || []).filter((p) => typeof p === 'string');
    if (paths.length > 0) {
      const out = [];
      for (const p of paths) {
        const value = pick(payload, p);
        if (value === undefined) continue;
        if (!Array.isArray(value)) return { unreadable: `\`${p}\` no es una lista en la salida del gate` };
        for (const item of value) {
          out.push(
            typeof item === 'string'
              ? { rule: gate.id, file: item, message: gate.label || gate.id }
              : item,
          );
        }
      }
      return { findings: out };
    }
    if (Array.isArray(payload.findings)) return { findings: payload.findings };
  }

  return { unreadable: 'la salida JSON no es una lista ni `{findings}` ni `{skipped}`' };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * Corre un gate. Los scripts salen con 1 cuando encuentran algo —no es un
 * error—. Cualquier otro código sí lo es, y se reporta como NO SE PUDO EJECUTAR
 * en vez de como "sin hallazgos": **un gate roto que se lee como limpio es peor
 * que no tenerlo**.
 *
 * @returns {Promise<{status: 'clean'|'findings'|'skipped'|'broken', findings: object[], reason: string|null}>}
 */
function runGate(gate, args) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status, findings, reason) => {
      if (settled) return;
      settled = true;
      resolve({ status, findings: findings || [], reason: reason || null });
    };

    let child;
    try {
      child = spawn(process.execPath, [...args, '--json'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return finish('broken', [], `no se pudo lanzar: ${err.message}`);
    }

    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
      if (err.length > 20000) err = err.slice(-20000);
    });

    const timer = setTimeout(() => {
      child.kill();
      finish('broken', [], `superó el tope de ${Math.round(GATE_TIMEOUT_MS / 1000)} s y se dio de baja`);
    }, GATE_TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      finish('broken', [], `no se pudo lanzar: ${e.message}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const lastErr = err.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
      const why = lastErr ? ` — ${lastErr.slice(0, 200)}` : '';

      if (code !== 0 && code !== 1) return finish('broken', [], `salió con código ${code}${why}`);

      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return finish('broken', [], `su salida JSON es ilegible${why}`);
      }

      const norm = flatten(parsed, gate);
      if (norm.unreadable) return finish('broken', [], norm.unreadable);
      if (norm.skipped) return finish('skipped', [], norm.skipped);

      // Exit 1 sin hallazgos es incoherente: no se lee como limpio.
      if (code === 1 && norm.findings.length === 0) {
        return finish('broken', [], 'salió con 1 pero no informó ningún hallazgo');
      }
      return finish(norm.findings.length > 0 ? 'findings' : 'clean', norm.findings, null);
    });
  });
}

/** Corre tareas con un tope de concurrencia, conservando el orden. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Lleva la ruta de un hallazgo a la forma del diff (relativa al repositorio).
 * Cada gate la escribe distinto: con barras de Windows, absoluta, con el nombre
 * del repositorio adelante o con la ruta del slot.
 */
function relToRepo(cfg, repo, dir, file) {
  let f = String(file).split('\\').join('/');

  const absDir = wt.posix(dir);
  if (f.toLowerCase().startsWith(`${absDir.toLowerCase()}/`)) f = f.slice(absDir.length + 1);

  const slot = wt.parseSlotPath(cfg, f);
  if (slot && slot.repo === repo.name) f = slot.rest;

  f = f.replace(/^\.\//, '');
  const prefixes = [repo.name, repo.path !== '.' ? repo.path : null].filter(Boolean);
  for (const p of prefixes) {
    if (f.startsWith(`${wt.posix(p)}/`)) {
      f = f.slice(wt.posix(p).length + 1);
      break;
    }
  }
  return f;
}

/** Un hallazgo sin archivo (p. ej. uno por cambio) cuenta como del diff. */
function inDiff(finding, relOf, diff) {
  if (!diff || !finding.file) return true;
  const rel = relOf(finding.file);
  if (diff.files.has(rel)) return true;
  if (process.platform === 'win32') {
    const lower = rel.toLowerCase();
    for (const f of diff.files) if (f.toLowerCase() === lower) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/**
 * Una línea por hallazgo. El mensaje va solo la primera vez que aparece
 * (`seen`): los de una herramienta externa rondan los 600 caracteres y se
 * repetirían idénticos en cada ubicación.
 */
function describe(f, seen) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const what = String(f.message || f.target || f.code || f.rule || '').replace(/\s+/g, ' ').trim();
  const rule = f.rule ? `[${f.rule}] ` : '';
  if (seen.has(what)) return `    ${rule}${where}`;
  seen.add(what);
  return `    ${rule}${where}\n      ${what}`;
}

function render(block) {
  const { label, from, base, diff, missing, results } = block;
  const where = from ? ` — leído desde ${from}` : '';
  const lines = [`## Gates deterministas — ${label}${where} (ya ejecutados, NO volver a correrlos)`, ''];

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

  if (base) {
    lines.push(
      diff
        ? `Diff contra \`${base}\`: ${diff.files.size} archivo(s) del cambio (commiteado + sin commitear + sin trackear).`
        : `El diff contra \`${base}\` NO se pudo leer: no se filtra nada, se muestra todo.`,
    );
    lines.push('');
  }

  const clean = results.filter((r) => r.status === 'clean' || (r.status === 'findings' && r.inDiffCount === 0));
  const dirty = results.filter((r) => r.status === 'findings' && r.inDiffCount > 0);
  const skipped = results.filter((r) => r.status === 'skipped');
  const broken = results.filter((r) => r.status === 'broken');

  if (clean.length) {
    const tag = (r) => (r.outside ? `${r.label} (${r.outside} fuera del diff)` : r.label);
    lines.push(`Sin hallazgos${diff ? ' en el diff' : ''}: ${clean.map(tag).join(' · ')}`);
    lines.push('');
  }

  // Ni un gate que no corrió ni uno que se cayó se omite en silencio: que
  // desaparezca del bloque es lo que hace que nadie note que algo nunca se
  // verificó. Su ausencia no dice nada.
  for (const r of skipped) {
    lines.push(`### ${r.label} — NO CORRIÓ (${r.reason})`);
    lines.push('    Tratarlo como "sin verificar", no como "sin hallazgos".');
    lines.push('');
  }

  for (const r of dirty) {
    lines.push(`### ${r.label} — ${r.inDiffCount} hallazgo(s)${diff ? ' en el diff' : ''}`);
    lines.push(`Fuente: ${r.source}`);
    const seen = new Set();
    const mine = r.findings.filter((f) => f.inDiff);
    for (const f of mine.slice(0, MAX_FINDINGS_SHOWN)) lines.push(describe(f, seen));
    if (mine.length > MAX_FINDINGS_SHOWN) {
      lines.push(`    … y ${mine.length - MAX_FINDINGS_SHOWN} más (correr el gate a mano para verlos)`);
    }
    if (r.outside) lines.push(`    (+${r.outside} fuera del diff: no los introdujo esta rama)`);
    lines.push('');
  }

  for (const r of broken) {
    lines.push(`### ${r.label} — NO SE PUDO EJECUTAR (${r.reason})`);
    lines.push('    Tratarlo como "sin verificar", no como "sin hallazgos".');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/** El cierre del bloque, UNA vez: pegado por cada repositorio sería el gasto que esto evita. */
function footer(blocks) {
  const withDiff = blocks.some((b) => b.diff);
  return [
    '---',
    'Estos hallazgos ya están confirmados por script: no los re-derives leyendo código.',
    withDiff
      ? 'Solo se detalla lo que cae en archivos del diff; lo de afuera es deuda que esta rama no introdujo.'
      : 'La deuda preexistente congelada en baseline no aparece acá.',
    'Lo que figura NO CORRIÓ o NO SE PUDO EJECUTAR está sin verificar: decirlo en el informe.',
    'Tu trabajo es lo que ningún script puede decidir: correctitud de la lógica, coherencia con',
    'el diseño acordado, y si un hallazgo de arriba es un falso positivo.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  return {
    all: argv.includes('--all'),
    repo: value('--repo'),
    from: value('--from'),
    base: value('--base'),
    changes: argv.reduce(
      (acc, a, i) => (a === '--change' && argv[i + 1] && !argv[i + 1].startsWith('--') ? [...acc, argv[i + 1]] : acc),
      [],
    ),
    todo: argv.includes('--todo'),
    json: argv.includes('--json'),
  };
}

function usage(cfg) {
  const names = cfg.repos.map((r) => r.name);
  process.stderr.write(
    `\nUso: node scripts/run-gates.js (--all | --repo ${names.join('|')}) [--from <slot>] ` +
      '[--base <ref>] [--change <id>]… [--todo] [--json]\n\n',
  );
  process.exit(2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  // Qué repositorios, y desde dónde se lee cada uno. `--repo` acepta también la
  // ruta de un slot (equivale a `--repo <nombre> --from <slot>`).
  let from = repoLocation.slotNameFrom(cfg, opts.from);
  let repos;
  if (opts.all) {
    repos = cfg.repos;
  } else if (opts.repo) {
    const located = repoLocation.resolve(cfg, opts.repo);
    if (!located) return usage(cfg);
    if (located.isSlot) from = from || located.slot;
    repos = [cfg.repos.find((r) => r.name === located.name)];
  } else {
    return usage(cfg);
  }

  // Los gates de alcance workspace corren una sola vez, no una por repositorio:
  // barren lo mismo y repetirlos duplicaría cada hallazgo.
  const jobs = [];
  const workspaceBlock = { label: 'workspace', from: null, base: null, diff: null, missing: null, results: [] };
  const workspaceGates = gatesLib.forWorkspaceDetailed(cfg);
  for (const gate of workspaceGates.applicable) {
    const result = { gate, label: gate.label || gate.id, source: gate.source || gate.script, status: null };
    workspaceBlock.results.push(result);
    jobs.push(async () => Object.assign(result, await runGate(gate, gatesLib.argsFor(gate, { scope: 'workspace' }))));
  }
  // Uno al que le falta una capacidad no corre, y se dice (nunca "sin hallazgos").
  for (const { gate, reason } of workspaceGates.skipped) {
    workspaceBlock.results.push({
      gate,
      label: gate.label || gate.id,
      source: gate.source || gate.script,
      status: 'skipped',
      reason,
      findings: [],
    });
  }

  const blocks = [workspaceBlock];

  for (const repo of repos) {
    const dir = from ? wt.slotRepoDir(cfg, from, repo) : repo.absPath;
    const repoArg = repoLocation.repoArgFrom(cfg, repo.name, from);
    const { applicable, skipped } = gatesLib.forRepoDetailed(cfg, repo);
    const label = repo.name;
    const fromLabel = from ? wt.slotRepoRel(cfg, from, repo) : null;

    const results = [
      ...applicable.map((gate) => ({ gate, label: gate.label || gate.id, source: gate.source || gate.script, status: null })),
      // Un gate al que le falta una capacidad no corre, y se dice.
      ...skipped.map(({ gate, reason }) => ({
        gate,
        label: gate.label || gate.id,
        source: gate.source || gate.script,
        status: 'skipped',
        reason,
        findings: [],
      })),
    ];

    // Un repositorio que todavía no se clonó —o un slot que no lo trae— no es un
    // gate roto: no hay nada que verificar. Nunca se cae a la principal.
    if (!fs.existsSync(dir)) {
      blocks.push({
        label,
        from: fromLabel,
        base: null,
        diff: null,
        results: results.map((r) => ({ ...r, status: 'skipped', findings: [] })),
        missing: from
          ? `el slot "${from}" no tiene el repositorio (${fromLabel}) — abrirlo con ese repositorio o sacar --from`
          : `el repositorio no está en ${repo.path} — ¿falta clonarlo?`,
      });
      continue;
    }

    const base = reviewBase.baseFor(repo, opts.base, dir);
    reviewBase.warnIfStaleBase(dir, base, label);
    const diff = opts.todo ? null : reviewBase.diffFiles(dir, base);

    const block = { label, from: fromLabel, base, diff, missing: null, results, repo, dir };
    blocks.push(block);

    // Lo que se le pasa a cada gate de repo: la base y los changes solo si el
    // operador los eligió; si no, cada gate usa los suyos por defecto.
    const extra = [
      ...(opts.base ? ['--base', opts.base] : []),
      ...opts.changes.flatMap((c) => ['--change', c]),
    ];
    for (const r of results.filter((x) => x.status === null)) {
      const args = [...gatesLib.argsFor(r.gate, { repo: repoArg, scope: repo.name }), ...extra];
      jobs.push(async () => Object.assign(r, await runGate(r.gate, args)));
    }
  }

  // Todos los gates de todos los repos a la vez, con tope: son procesos
  // independientes y el más lento marca el total.
  await pool(jobs, CONCURRENCY);

  // Separar lo del diff de lo de afuera.
  for (const block of blocks) {
    const relOf = block.repo ? (f) => relToRepo(cfg, block.repo, block.dir, f) : (f) => f;
    for (const r of block.results) {
      r.findings = (r.findings || []).map((f) => ({ ...f, inDiff: inDiff(f, relOf, block.diff) }));
      r.inDiffCount = r.findings.filter((f) => f.inDiff).length;
      r.outside = r.findings.length - r.inDiffCount;
    }
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        blocks.map((b) => ({
          scope: b.label,
          from: b.from,
          base: b.base,
          diffRead: b.base ? b.diff !== null : null,
          missing: b.missing,
          gates: b.results.map((r) => ({
            id: r.gate.id,
            label: r.label,
            // `ok` es "pudo mirar"; `status` distingue limpio, hallazgos, no corrió y no se pudo.
            ok: r.status !== 'broken' && !b.missing,
            status: b.missing ? 'skipped' : r.status === 'findings' && r.inDiffCount === 0 ? 'clean' : r.status,
            // `skipped` NO se descarta: es el motivo por el que no corrió.
            skipped: r.status === 'skipped' ? r.reason || b.missing : null,
            reason: r.reason || null,
            inDiff: r.inDiffCount,
            outside: r.outside,
            findings: r.findings,
          })),
        })),
        null,
        2,
      ) + '\n',
    );
  } else {
    // Sin gates de workspace no hay bloque de workspace (no es un "sin verificar").
    const shown = blocks.filter((b) => b !== workspaceBlock || b.results.length > 0);
    process.stdout.write(`${shown.map(render).join('\n\n')}\n\n${footer(blocks)}\n`);
  }

  // Un gate caído y un repositorio sin clonar no son "sin hallazgos": son sin
  // verificar, y por eso ganan sobre el conteo. El 1, solo por hallazgos del diff.
  const broken = blocks.reduce((n, b) => n + b.results.filter((r) => r.status === 'broken').length, 0);
  const unverified = blocks.filter((b) => b.missing).length;
  const inDiffTotal = blocks.reduce((n, b) => n + b.results.reduce((m, r) => m + r.inDiffCount, 0), 0);

  if (broken > 0 || unverified > 0) process.exit(2);
  process.exit(inDiffTotal > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`run-gates falló: ${err && err.message}\n`);
    process.exit(2);
  });
}

module.exports = { flatten, relToRepo };
