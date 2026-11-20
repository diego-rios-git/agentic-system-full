#!/usr/bin/env node
/**
 * post-edit-checks.js — hook PostToolUse sobre Edit y Write.
 *
 * Da feedback inmediato en el mismo turno en que se escribe el archivo, en vez
 * de esperar a que un humano lo encuentre en la revisión del PR.
 *
 * Corre SOLO los gates que corresponden al archivo tocado: pagarlos todos en
 * cada edición sería lento, y un hook lento se termina desactivando. Qué gate
 * corresponde a qué archivo lo decide el registro de `scripts/lib/gates.js`, que
 * se arma con lo que declaran el núcleo y los packs instalados.
 *
 * Todos corren con baseline: la deuda preexistente está congelada y solo se
 * reporta lo que se introduce ahora. Sin eso el hook sería ruido permanente.
 *
 * Contrato del hook:
 *   - Recibe por stdin un JSON con `tool_input.file_path`.
 *   - exit 0 → todo bien, silencioso.
 *   - exit 2 → hallazgo: stderr vuelve al agente para que corrija.
 *
 * Nunca modifica código: solo lee y avisa. Y ante cualquier fallo propio —
 * configuración ausente, gate roto, JSON ilegible — deja pasar la escritura:
 * un bug en este script no puede frenar el trabajo.
 *
 * Los gates aplicables corren EN PARALELO, cada uno en su proceso: un gate es un
 * script con su propio contrato de salida (0/1/2) y puede venir de un pack o del
 * proyecto, así que no se importa. En serie, la espera era la suma de todos; en
 * paralelo es la del más lento.
 *
 * Contrato: ver `scripts/lib/guard-core.js`.
 */

'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const core = require('../lib/guard-core');
const gates = require('../lib/gates');

const CACHE_NAME = '.ai-gates-cache.json';
const GATE_TIMEOUT_MS = 20000;

/** Entradas máximas del caché. Por encima, se descartan las más viejas. */
const CACHE_MAX = 500;

// ---------------------------------------------------------------------------
// Caché por contenido
// ---------------------------------------------------------------------------

/**
 * Recuerda el resultado de un gate para un contenido exacto de archivo.
 *
 * Un agente edita el mismo archivo varias veces por tarea: corrige una línea,
 * agrega otra, deshace un cambio. Cada escritura vuelve a pagar el barrido
 * completo de cada gate aplicable, y un hook lento es un hook que alguien
 * termina desactivando — con lo cual se pierden todos, no solo el lento.
 *
 * La clave es el hash del **contenido**, no la ruta ni la fecha: si el archivo
 * volvió a un estado ya verificado —deshacer un cambio, aplicar y revertir un
 * formateo— el resultado sigue siendo válido y no hay nada que recalcular.
 *
 * Y se guarda el resultado, no solo el "estaba limpio": un archivo que vuelve a
 * un estado con hallazgos tiene que volver a mostrarlos.
 */
function cacheKey(gateId, content) {
  return `${gateId}:${crypto.createHash('sha1').update(content).digest('hex').slice(0, 16)}`;
}

function readCache(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, CACHE_NAME), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(root, cache) {
  try {
    const claves = Object.keys(cache);
    if (claves.length > CACHE_MAX) {
      // Se conservan las últimas: el orden de inserción de un objeto alcanza
      // para esto y evita guardar una marca de tiempo por entrada.
      const recortado = {};
      for (const k of claves.slice(-CACHE_MAX)) recortado[k] = cache[k];
      cache = recortado;
    }
    fs.writeFileSync(path.join(root, CACHE_NAME), JSON.stringify(cache), 'utf8');
  } catch {
    // Un fallo al escribir el caché no puede afectar la decisión del hook.
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/** Las líneas de los hallazgos que caen EN el archivo editado, o `null`. */
function formatMine(findings, relEdited) {
  if (!Array.isArray(findings) || findings.length === 0) return null;

  // Los gates que no aceptan acotarse a un archivo barren el repositorio entero.
  // Reportar todo sería ruido: al tocar un archivo nadie necesita enterarse de
  // un problema en otro módulo que no abrió. El aviso llega cuando alguien
  // edita el archivo que lo tiene.
  const mine = findings.filter((f) => {
    const p = String(f.file || '').split('\\').join('/');
    return p && (relEdited.endsWith(p) || p.endsWith(relEdited));
  });
  if (mine.length === 0) return null;

  return mine
    .map((f) => {
      const where = f.line ? `:${f.line}` : '';
      const what = f.message || f.target || f.code || '';
      const label = f.rule ? `[${f.rule}] ` : '';
      return `  ${label}${String(f.file).split('\\').join('/')}${where}\n    ${what}`;
    })
    .join('\n');
}

/**
 * Corre un gate y resuelve con los hallazgos en el archivo editado, o `null`.
 *
 * Salida 1 es "encontré algo". Cualquier otro código —2, un corte por tiempo, un
 * gate que revienta— es un fallo del gate: no se le reporta al agente como si
 * fuera culpa suya.
 */
function run(root, args, relEdited) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...args, '--json'],
      { cwd: root, encoding: 'utf8', timeout: GATE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err && err.code !== 1) return resolve(null);
        try {
          resolve(formatMine(JSON.parse(stdout || ''), relEdited));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/**
 * Una línea JSONL por corrida CON gate aplicable — no una por cada escritura,
 * para no meter ruido de archivos sin gate. Local y fuera del control de
 * versiones: sirve para saber más adelante si esto se usa de verdad, sin mandar
 * nada a ningún servicio.
 */
function logRun(root, relEdited, plan, findingCount, blocked) {
  core.appendLog(root, {
    file: relEdited,
    gates: plan.map((g) => g.id),
    gatesWithFindings: findingCount,
    blocked,
  });
}

core.defineHook(
  module,
  'post-edit-checks',
  async (ctx) => {
    // Sin configuración no hay proyecto todavía: nada que verificar, y en
    // silencio — este hook puede quedar activo en el repositorio de la base.
    if (!ctx.cfg || !ctx.filePath) return null;
    const { cfg, root } = ctx;
    const filePath = path.resolve(ctx.cwd, ctx.filePath);

    const { gates: plan, at } = gates.forFile(cfg, filePath);
    if (!at || plan.length === 0) return null;

    // El contenido del archivo recién escrito. Es la clave del caché: si este
    // gate ya vio este contenido exacto, su resultado no puede haber cambiado.
    let content = null;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      content = null;
    }
    const cache = content === null ? null : readCache(root);

    const results = await Promise.all(
      plan.map(async (gate) => {
        const key = cache && cacheKey(gate.id, content);
        if (key && Object.prototype.hasOwnProperty.call(cache, key)) {
          return { gate, output: cache[key], fresh: false };
        }
        const perFile = gates.supportsSingleFile(gate);
        const args = gates.argsFor(
          gate,
          { repo: at.repo ? at.repo.name : '', scope: at.repo ? at.repo.name : 'workspace', rel: at.rel },
          perFile,
        );
        return { gate, output: await run(root, args, at.rel), fresh: true, key };
      }),
    );

    // El caché se actualiza en el orden del plan: es el orden en que se recortan
    // las entradas viejas.
    let cacheChanged = false;
    for (const r of results) {
      if (r.fresh && r.key) {
        cache[r.key] = r.output || null;
        cacheChanged = true;
      }
    }
    if (cacheChanged) writeCache(root, cache);

    const findings = results.filter((r) => r.output);
    logRun(root, at.rel, plan, findings.length, findings.length > 0);
    if (findings.length === 0) return null;

    const lines = ['Los gates encontraron algo nuevo en lo que acabás de escribir:', ''];
    for (const { gate, output } of findings) {
      lines.push(`── ${gate.label} ──`);
      lines.push(output);
      lines.push(`Fuente de la regla: ${gate.source}`);
      lines.push('');
    }
    lines.push('Corregilo antes de seguir. Estos hallazgos son nuevos: la deuda');
    lines.push('preexistente está congelada en el baseline y no se reporta.');

    return { reason: 'gates-con-hallazgos', log: false, message: lines.join('\n') };
  },
  {
    // Sin configuración sale en silencio en vez de avisar que falta.
    config: 'optional',
  },
);
