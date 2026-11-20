#!/usr/bin/env node
/**
 * trabajo-por-sesion.js
 *
 * Una tarea del plan por sesión nueva de un agente headless.
 *
 * Lee el plan, toma la próxima tarea sin cerrar, abre UNA sesión del agente y le
 * pide solo esa tarea con el procedimiento `trabajo-autonomo`. Cuando la sesión
 * termina vuelve a leer el plan: si la tarea quedó cerrada sigue con la
 * próxima; si no, FRENA y dice por qué.
 *
 * Por qué una sesión por tarea y no un bucle dentro de una sola: el contexto de
 * una sesión larga se llena de lo que ya pasó. A la tarea diez el agente carga
 * con el razonamiento de las nueve anteriores, que no le sirve y le cuesta, y
 * una suposición equivocada de la tarea tres sigue viva en la ocho. Cada sesión
 * empieza de cero: lo que necesita saber está en el plan, el tablero de
 * requisitos y la bitácora, que es donde tiene que estar.
 *
 * Por qué frena si la tarea no quedó cerrada: marcarla sin haberla terminado le
 * haría seguir con la próxima sobre algo roto, y el error se propaga en
 * silencio. El cierre lo decide el plan, no la sesión: el script no cree en el
 * "terminé" del agente, lee el plan.
 *
 * Todo lo que varía es DATO, en `ai-workspace.json` → `autonomous`:
 *
 *   "autonomous": {
 *     "plan": "docs/plan.md",                       ruta del plan, relativa a la raíz
 *     "taskHeading": "^##\\s+(\\S+)\\s+—\\s+(.+?)\\s*$",   encabezado de tarea: grupo 1 = id, grupo 2 = título
 *     "doneMarker": "✅",                           lo que el encabezado lleva cuando la tarea está cerrada
 *     "skill": "trabajo-autonomo",                  procedimiento que se le pide (opcional)
 *     "commit": false,                              true = la sesión commitea y pushea al cerrar cada tarea
 *                                                   (por defecto NO: el commit solo con pedido explícito)
 *     "harness": "claude",                          qué harness lanza la sesión (opcional)
 *     "logDir": ".tmp/sesiones"                     dónde queda el registro de cada sesión (opcional)
 *   }
 *
 * El comando del agente es un adaptador por dato: el bloque `headless` del
 * harness (en `template.manifest.json` → `harnesses.<id>.headless`, o propio en
 * `harnessDefinitions`; también admitido en `autonomous.headless` para probarlo):
 *
 *   "headless": {
 *     "command": "claude",
 *     "args": ["-p", "--output-format", "stream-json", "--verbose"],
 *     "promptVia": "stdin",                         "stdin" | "arg" (el pedido va como último argumento)
 *     "budgetFlag": "--max-budget-usd",             opcional: lo usa --tope-usd
 *     "skipPermissionsFlag": "--dangerously-skip-permissions",   opcional: lo usa --sin-permisos
 *     "events": "claude-stream-json"                opcional: cómo mostrar lo que va diciendo la sesión
 *   }
 *
 * **Los permisos no se saltean salvo que se pida.** Una sesión headless no tiene
 * a quién preguntarle, y sin permisos suficientes se queda esperando o falla en
 * la primera escritura. Saltearlos es una decisión de quien lanza el script, en
 * esa máquina y mirando de vez en cuando, y por eso es un flag explícito
 * (`--sin-permisos`) y no un valor por defecto. Las reglas del proyecto siguen
 * valiendo con los permisos saltados (hooks, gates, commits sin atribución): lo
 * que se saltea es la pregunta, no la regla.
 *
 * Uso:
 *   node scripts/trabajo-por-sesion.js                  todas las que falten
 *   node scripts/trabajo-por-sesion.js --una            solo la próxima
 *   node scripts/trabajo-por-sesion.js --ver            qué correría, sin correr nada
 *   … --tope-usd 15          tope de gasto por sesión (si el harness declara `budgetFlag`)
 *   … --sin-permisos         opt-in: agrega `skipPermissionsFlag` del harness
 *   … --harness <id>         otro harness que el declarado
 *
 * Códigos: 0 plan terminado (o --una / --ver) · 1 frenó: la tarea no quedó
 * cerrada o la sesión terminó con error · 2 no se pudo (configuración
 * incompleta, plan ilegible, ningún harness con `headless`).
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const harnesses = require('./lib/harnesses');

const ROOT = config.ROOT;

class Unusable extends Error {}

// ---------------------------------------------------------------------------
// El plan
// ---------------------------------------------------------------------------

/**
 * Las tareas del plan, en orden, con si ya están cerradas.
 *
 * @param {string} text contenido del plan
 * @param {{taskHeading: RegExp, doneMarker: string}} spec
 */
function tareasDelPlan(text, spec) {
  const tareas = [];
  for (const line of text.split(/\r?\n/)) {
    const m = spec.taskHeading.exec(line);
    if (!m) continue;
    const cerrada = spec.doneMarker ? line.includes(spec.doneMarker) : false;
    const titulo = spec.doneMarker ? m[2].split(spec.doneMarker).join('').trim() : String(m[2]).trim();
    tareas.push({ id: m[1], titulo, cerrada });
  }
  return tareas;
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function settings(cfg, argv) {
  const raw = cfg.raw.autonomous;
  if (!raw || typeof raw !== 'object') {
    throw new Unusable(
      'falta `autonomous` en ai-workspace.json (plan, taskHeading, doneMarker). Sin saber dónde está el plan y cómo se ve una tarea no hay qué recorrer',
    );
  }
  if (!raw.plan || typeof raw.plan !== 'string' || path.isAbsolute(raw.plan) || raw.plan.includes('..')) {
    throw new Unusable('`autonomous.plan` es obligatorio y debe ser una ruta relativa dentro del workspace');
  }
  if (!raw.taskHeading) {
    throw new Unusable('`autonomous.taskHeading` es obligatorio: la expresión regular de un encabezado de tarea (grupo 1 = id, grupo 2 = título)');
  }
  let taskHeading;
  try {
    taskHeading = new RegExp(raw.taskHeading);
  } catch (err) {
    throw new Unusable(`\`autonomous.taskHeading\` inválido: ${err.message}`);
  }
  if (/[\u0000-\u001f]/.test(raw.taskHeading)) {
    throw new Unusable('`autonomous.taskHeading` tiene un carácter de control. En JSON las barras invertidas van dobles');
  }
  if (new RegExp(`${taskHeading.source}|`).exec('').length < 3) {
    throw new Unusable('`autonomous.taskHeading` necesita dos grupos de captura: el id y el título');
  }

  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };

  // Harness: el pedido, después lo declarado, después el primero que tenga `headless`.
  const catalog = harnesses.catalog(cfg.raw);
  const wanted = arg('--harness') || raw.harness || null;
  const candidates = wanted ? [wanted] : cfg.harnesses;
  let headless = raw.headless || null;
  let harnessId = wanted;
  if (!headless) {
    for (const id of candidates) {
      if (!catalog[id]) {
        throw new Unusable(`el harness "${id}" no está declarado (ver \`harnesses\` y \`harnessDefinitions\`)`);
      }
      if (catalog[id].headless) {
        headless = catalog[id].headless;
        harnessId = id;
        break;
      }
    }
  }
  if (!headless) {
    throw new Unusable(
      'ningún harness declara `headless` (el comando que lanza una sesión sin interfaz). ' +
        'Se declara en `harnesses.<id>.headless` o en `harnessDefinitions`; ver el encabezado de este script',
    );
  }
  if (!headless.command) throw new Unusable('`headless.command` es obligatorio');
  if (headless.promptVia && !['stdin', 'arg'].includes(headless.promptVia)) {
    throw new Unusable('`headless.promptVia` debe ser "stdin" o "arg"');
  }

  return {
    plan: path.resolve(ROOT, raw.plan),
    planRel: raw.plan,
    taskHeading,
    doneMarker: raw.doneMarker === undefined ? '✅' : raw.doneMarker,
    skill: raw.skill || 'trabajo-autonomo',
    commit: raw.commit === true,
    logDir: path.resolve(ROOT, raw.logDir || '.tmp/sesiones'),
    headless,
    harnessId: harnessId || 'headless',
  };
}

// ---------------------------------------------------------------------------
// La sesión
// ---------------------------------------------------------------------------

function pedidoPara(tarea, s) {
  const cierre = s.doneMarker
    ? `Al cerrarla, marcá su encabezado en \`${s.planRel}\` con ${s.doneMarker} y dejá el plan apuntando a la siguiente.`
    : `Al cerrarla, dejá su encabezado en \`${s.planRel}\` como cerrado, como indica el plan.`;
  return [
    `Usá el procedimiento \`${s.skill}\` en modo **una tarea por sesión**: hacé solo la tarea ${tarea.id} (${tarea.titulo}) del plan \`${s.planRel}\`.`,
    'De punta a punta, como dice el procedimiento: requisito, propuesta, tests en rojo, implementación, revisión sin contexto, prueba de punta a punta, archivo, bitácora y automejora.',
    s.commit
      ? 'Al cerrarla, commit y push con `git-commit-workflow`: la persona lo autorizó en la configuración (`autonomous.commit`).'
      : 'No commitees ni pushees: dejá el trabajo en el árbol y decilo en la bitácora. La persona no autorizó el commit.',
    cierre,
    'No sigas con otra tarea: la próxima sesión la empieza de cero.',
    'Si no la podés terminar, no la marques como cerrada: dejá en la bitácora qué falta y por qué.',
  ].join('\n');
}

function quote(a) {
  return /[\s"&|<>^%]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a);
}

/** Lo que vale la pena ver en pantalla de cada línea de un flujo de eventos JSON. */
function mostrar(evento, write) {
  if (evento.type === 'assistant') {
    for (const bloque of (evento.message && evento.message.content) || []) {
      if (bloque.type === 'text' && bloque.text && bloque.text.trim()) write(`\n${bloque.text.trim()}\n`);
      if (bloque.type === 'tool_use') write(`  · ${bloque.name}\n`);
    }
  }
  if (evento.type === 'result') {
    const costo = typeof evento.total_cost_usd === 'number' ? ` · USD ${evento.total_cost_usd.toFixed(2)}` : '';
    write(`\n— sesión terminada (${evento.subtype || 'fin'}${costo})\n`);
  }
}

function correrSesion(tarea, s, opts) {
  fs.mkdirSync(s.logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const registro = path.join(s.logDir, `${tarea.id}-${stamp}.log`);
  const archivo = fs.createWriteStream(registro);
  const h = s.headless;

  const args = [...(h.args || [])];
  if (opts.tope && h.budgetFlag) args.push(h.budgetFlag, opts.tope);
  if (opts.sinPermisos) {
    if (!h.skipPermissionsFlag) throw new Unusable(`el harness "${s.harnessId}" no declara \`skipPermissionsFlag\`: no hay forma de saltear permisos`);
    args.push(h.skipPermissionsFlag);
  }
  const pedido = pedidoPara(tarea, s);
  if (h.promptVia === 'arg') args.push(pedido);

  process.stdout.write(`\n=== ${tarea.id} — ${tarea.titulo}\n    registro: ${registro}\n`);

  return new Promise((listo) => {
    // En Windows un comando que no es una ruta absoluta suele ser un .cmd (el
    // shim de npm) y solo la shell lo resuelve. Con una ruta absoluta se lanza
    // directo: sin shell, el pedido no pasa por ninguna reinterpretación.
    const useShell = process.platform === 'win32' && !path.isAbsolute(h.command);
    const child = useShell
      ? spawn([h.command, ...args].map(quote).join(' '), { cwd: ROOT, shell: true, env: process.env })
      : spawn(h.command, args, { cwd: ROOT, env: process.env });

    let resto = '';
    let fallo = false;
    let ended = false;
    const fin = (r) => {
      if (ended) return;
      ended = true;
      archivo.end();
      listo(r);
    };

    child.on('error', (err) => {
      process.stderr.write(`No pude lanzar "${h.command}": ${err.message}\n`);
      fin({ ok: false, codigo: null, registro });
    });
    child.stdout.on('data', (datos) => {
      archivo.write(datos);
      if (h.events !== 'claude-stream-json') {
        process.stdout.write(datos);
        return;
      }
      resto += datos.toString('utf8');
      const lineas = resto.split('\n');
      resto = lineas.pop() || '';
      for (const linea of lineas) {
        try {
          const evento = JSON.parse(linea);
          if (evento.type === 'result' && evento.is_error) fallo = true;
          mostrar(evento, (t) => process.stdout.write(t));
        } catch {
          // Una línea que no es JSON queda en el registro.
        }
      }
    });
    child.stderr.on('data', (datos) => {
      archivo.write(datos);
      process.stderr.write(datos);
    });
    child.on('close', (codigo) => fin({ ok: codigo === 0 && !fallo, codigo, registro }));

    child.stdin.on('error', () => {
      // El agente puede cerrar la entrada antes de leer todo el pedido: no es un fallo.
    });
    if (h.promptVia === 'arg') child.stdin.end();
    else child.stdin.end(pedido);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    una: argv.includes('--una'),
    ver: argv.includes('--ver'),
    sinPermisos: argv.includes('--sin-permisos'),
    tope: argv.includes('--tope-usd') ? argv[argv.indexOf('--tope-usd') + 1] : null,
  };
  if (opts.tope !== null && !/^\d+(\.\d+)?$/.test(String(opts.tope))) {
    throw new Unusable('`--tope-usd` necesita un número (por ejemplo --tope-usd 15)');
  }

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }
  const s = settings(cfg, argv);

  if (!fs.existsSync(s.plan)) throw new Unusable(`no encontré el plan: ${s.planRel}`);
  const leer = () => tareasDelPlan(fs.readFileSync(s.plan, 'utf8'), s);
  const todas = leer();
  if (todas.length === 0) {
    // Un plan sin una sola tarea reconocible casi siempre es un `taskHeading` que no coincide.
    throw new Unusable(`el plan ${s.planRel} no tiene ninguna tarea que coincida con \`autonomous.taskHeading\`: ¿el patrón está bien?`);
  }
  const pendientes = () => leer().filter((t) => !t.cerrada);

  if (opts.ver) {
    const lista = pendientes();
    if (lista.length === 0) process.stdout.write('El plan está terminado.\n');
    else {
      process.stdout.write(`Pendientes, en orden:\n${lista.map((t) => `  ${t.id} — ${t.titulo}`).join('\n')}\n\n`);
      process.stdout.write(`Harness: ${s.harnessId}  ·  comando: ${[s.headless.command, ...(s.headless.args || [])].join(' ')}\n`);
      process.stdout.write(`Permisos: ${opts.sinPermisos ? 'SALTEADOS (--sin-permisos)' : 'los normales del harness'}\n\n`);
      process.stdout.write(`Pedido de la primera:\n${pedidoPara(lista[0], s)}\n`);
    }
    return 0;
  }

  for (;;) {
    const [proxima] = pendientes();
    if (!proxima) {
      process.stdout.write('\nEl plan está terminado: no queda ninguna tarea sin cerrar.\n');
      return 0;
    }

    const resultado = await correrSesion(proxima, s, opts);
    const despues = leer().find((t) => t.id === proxima.id);
    const cerrada = !!(despues && despues.cerrada);

    if (!resultado.ok || !cerrada) {
      const motivo = !cerrada
        ? despues
          ? 'no quedó cerrada'
          : 'ya no aparece en el plan'
        : 'terminó con error';
      process.stdout.write(
        `\nFreno: ${proxima.id} ${motivo}${resultado.codigo === null ? '' : ` (código ${resultado.codigo})`}.\n` +
          `Mirá el registro (${resultado.registro}) y la bitácora antes de volver a correr.\n`,
      );
      return 1;
    }

    process.stdout.write(`\nOK ${proxima.id} cerrada.\n`);
    if (opts.una) return 0;
  }
}

module.exports = { tareasDelPlan, pedidoPara };

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`\n  trabajo-por-sesion: ${err && err.message}\n\n`);
      process.exit(err instanceof Unusable ? 2 : 1);
    },
  );
}
