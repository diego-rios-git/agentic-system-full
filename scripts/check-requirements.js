#!/usr/bin/env node
/**
 * check-requirements.js
 *
 * Gate y herramienta del tablero de requisitos: una ficha por requisito, con su
 * `estado:` en el front matter, y los changes del ciclo dirigido por
 * especificación que lo construyen.
 *
 * El estado lo lee la persona en el tablero y lo lee el agente para saber qué
 * sigue. Si miente, los dos deciden mal. Por eso la mitad de los estados no se
 * escriben: se DERIVAN de la evidencia del repositorio (los changes que
 * declaran `rf:`), y esta herramienta es lo que lo hace verificable.
 *
 * Generaliza dos piezas que nacieron en proyectos concretos: un validador de
 * bóveda de Obsidian y un gate de bóveda escrito a mano. Lo que las dos
 * aprendieron a golpes está en las reglas de abajo; cada una conserva su porqué
 * para que nadie la "simplifique".
 *
 * Reglas (columna `rule` de los hallazgos):
 *
 *   REQ-FM        El front matter no arranca en el byte 0 (BOM o líneas en
 *                 blanco antes de `---`): las herramientas que leen fichas lo
 *                 ven como texto y la ficha desaparece del tablero sin un error.
 *   REQ-LINK      Un enlace que no resuelve. Con `requirements.format:
 *                 "obsidian"` son wikilinks `[[nota]]`; en otro caso, enlaces
 *                 Markdown relativos.
 *   REQ-FICHA     Una ficha sin `rf:`, con un `rf:` que no cumple `idPattern`, o
 *                 repetido en dos fichas. Con dos fichas para el mismo id la
 *                 derivación no sabe a cuál aplicarse: se reporta y no se toca
 *                 ninguna (la salida es `estado_auto: false`).
 *   REQ-ESTADO-VOCAB   `estado:` fuera del vocabulario.
 *   REQ-MANUAL    `estado_auto: false` sin `estado_motivo:`. Sin el motivo el
 *                 campo se vuelve la forma silenciosa de tapar un estado
 *                 incorrecto.
 *   REQ-ESTADO    El estado contradice lo que dicen sus changes: ficha `cerrado`
 *                 con un change abierto o con una última entrega que declara
 *                 `cierra_rf: false` (se cerró un requisito con trabajo
 *                 pendiente); o ficha sin empezar (`pendiente`/`analisis`/
 *                 `validado`) con un change abierto.
 *   REQ-ESTADO-ATRASADO  (solo con `--exigir-cerrados`) todos los changes están
 *                 archivados y la ficha no dice `cerrado`.
 *   REQ-CHANGE-SIN-RF    Un change ABIERTO que no declara `rf:`. Un change que
 *                 implementaba un requisito y olvidó declararlo es invisible para
 *                 la derivación: la ficha queda en `cerrado` con trabajo
 *                 pendiente. Si de verdad no corresponde a ningún requisito (un
 *                 re-skin, una refactorización), lo declara con `rf: ninguno`:
 *                 la omisión deja de ser silenciosa.
 *   REQ-RF-INEXISTENTE   Un change abierto declara un `rf:` que no tiene ficha.
 *
 * Por qué REQ-ESTADO-ATRASADO no corre por defecto: el change se archiva DENTRO
 * del PR, antes del merge, y el estado `cerrado` se escribe DESPUÉS del merge
 * (`--sync-estados`). Si el gate lo exigiera en la rama, fallaría justo después
 * de archivar, por hacer lo correcto. Se exige en la rama base, ya mergeado.
 *
 * Modos:
 *
 *   (sin modo)        valida; 0 limpio · 1 hallazgos · 2 no se pudo verificar
 *   --sync-estados    deriva el estado de cada ficha de los changes que declaran
 *                     su `rf:` y lo escribe (`--dry-run` solo muestra):
 *                       - ningún change declara el RF  -> no toca
 *                       - alguno abierto                -> implementacion
 *                       - todos archivados              -> cerrado, SALVO que la
 *                         última entrega diga `cierra_rf: false` (o una lista
 *                         de RF que no lo incluye): queda en implementacion y
 *                         `pendiente_rf` anota qué falta
 *                     Manda la última fecha de archivado: un requisito
 *                     entregado por partes tiene changes viejos sin el campo.
 *                     Nunca retrocede un estado: si lo derivado va hacia atrás
 *                     (change abierto con la ficha en `cerrado`) lo reporta sin
 *                     escribir, para que una persona decida si es trabajo nuevo
 *                     o un change abandonado. No toca `testing` (no se deriva),
 *                     `descartado` ni las fichas con `estado_auto: false`.
 *                     Correrlo SOLO después del merge: recorre todas las fichas,
 *                     y tras sincronizar con la base puede cerrar requisitos de
 *                     otras ramas cuyos changes acaban de llegar. Un salto de
 *                     `analisis` a `cerrado` es la señal de alarma.
 *   --tablero         la vista del tablero por estado (stdout, o `--out <archivo>`)
 *   --huerfanos       changes que ninguna ficha reclama
 *
 * Salida y códigos: ver `scripts/lib/gate-cli.js`. 0 limpio · 1 hallazgos (con
 * `--json`, lista de `{rule,file,line,message}`) · 2 no se pudo verificar
 * (stdout vacío). Sin `requirements` en `ai-workspace.json` NO hay tablero: sale
 * 0 diciendo "no aplica", y no simula verificación. Con tablero pero sin ningún
 * proveedor de especificación, se validan las fichas y no se deriva nada (no hay
 * ciclo instalado); `--sync-estados` y `--huerfanos` salen 2 porque no tienen
 * de dónde leer.
 *
 * Configuración (`requirements` en ai-workspace.json):
 *   dir        carpeta de fichas, relativa a la raíz (obligatorio)
 *   idPattern  forma válida del id; por defecto ^RF-\d+\.\d+$
 *   format     "plain" (por defecto) | "obsidian"
 *   vault      con "obsidian": carpeta donde resuelven los wikilinks (por
 *              defecto, `dir`)
 *   repos      nombres de los repositorios cuyos changes se leen (por defecto,
 *              todos los que tengan proveedor de especificación)
 *
 * En la ficha: `rf:` (id), `estado:`, `estado_auto:`, `estado_motivo:`,
 * `titulo:`, `actualizado:`. En el change: `rf:`, `cierra_rf:`, `pendiente_rf:`
 * en su archivo de metadatos (`sdd.metaFile`; para openspec, `.openspec.yaml`).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./lib/workspace-config');
const sdd = require('./lib/sdd');

const ROOT = config.ROOT;

/** El ciclo de un requisito, en orden. `descartado` queda fuera del orden. */
const ESTADOS = ['pendiente', 'analisis', 'validado', 'implementacion', 'testing', 'cerrado', 'descartado'];
const ORDEN = ESTADOS.slice(0, 6);
const SIN_EMPEZAR = new Set(['pendiente', 'analisis', 'validado']);

const DEFAULT_ID_PATTERN = '^RF-\\d+\\.\\d+$';
const SKIP_DIRS = new Set(['.obsidian', '.trash', 'node_modules', '.git']);
const BOM = '﻿';

/** No se pudo verificar: se dice por qué y se sale con 2, sin escribir stdout. */
class Unverified extends Error {}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const posix = (p) => p.split(path.sep).join('/');
const rel = (abs) => posix(path.relative(ROOT, abs));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function unquote(s) {
  const m = s.match(/^(["'])(.*)\1$/);
  return m ? m[2] : s;
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

/**
 * Lee el front matter con el subconjunto de YAML que usan las fichas: escalares
 * (con o sin comillas, con comentario final), listas en bloque (`- valor`) y
 * listas en línea (`[a, b]`).
 *
 * Cualquier otra forma ABORTA con "no se pudo verificar". Interpretarla a medias
 * haría que un campo desapareciera sin aviso, y un `estado_auto: false` perdido
 * se leería como una ficha derivable.
 *
 * @returns {object|null} `null` si el texto no abre con `---`
 */
function parseFrontMatter(text, file) {
  if (!/^---\r?\n/.test(text)) return null;
  const end = text.slice(3).search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end < 0) throw new Unverified(`${file}: el front matter no se cierra con ---`);
  const body = text.slice(text.indexOf('\n') + 1, 3 + end + 1);

  const data = {};
  let listKey = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^\s*#/.test(line)) continue;

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }

    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) throw new Unverified(`${file}: no sé leer esta línea del front matter: "${line}"`);
    const [, key, valueRaw] = kv;
    // Un comentario final solo cuenta si el valor no está entre comillas.
    const value = /^["']/.test(valueRaw) ? valueRaw : valueRaw.replace(/\s+#.*$/, '');

    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new Unverified(`${file}: lista sin cerrar en "${key}"`);
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map((s) => unquote(s.trim())) : [];
      listKey = null;
    } else {
      data[key] = unquote(value.trim());
      listKey = null;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

/** Enlaces del texto, ignorando bloques y fragmentos de código. */
function linksOf(text, wiki) {
  const out = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const sinCodigo = line.replace(/`[^`]*`/g, '');
    const re = wiki ? /!?\[\[([^\]]+)\]\]/g : /(?<!!)\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
    for (const m of sinCodigo.matchAll(re)) {
      const target = wiki ? m[1].split('|')[0].split('#')[0].trim() : m[1].split('#')[0].split('?')[0].trim();
      if (!target) continue;
      if (!wiki && /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // http:, mailto:, etc.
      out.push({ target, line: i + 1 });
    }
  });
  return out;
}

function vaultIndex(vaultDir) {
  const names = new Set();
  const paths = new Set();
  for (const full of walk(vaultDir)) {
    const r = posix(path.relative(vaultDir, full)).toLowerCase();
    const ext = path.extname(r);
    paths.add(r);
    paths.add(r.slice(0, r.length - ext.length));
    names.add(path.basename(r));
    names.add(path.basename(r, ext));
  }
  return { names, paths };
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function requirementsOptions(cfg) {
  const req = cfg.requirements || cfg.raw.requirements;
  if (!req) return null;
  if (!req.dir || typeof req.dir !== 'string' || path.isAbsolute(req.dir) || req.dir.includes('..')) {
    throw new Unverified('`requirements.dir` es obligatorio y debe ser una ruta relativa dentro del workspace');
  }
  const format = req.format || 'plain';
  if (!['plain', 'obsidian'].includes(format)) {
    throw new Unverified(`\`requirements.format\` debe ser "plain" u "obsidian". Recibido: ${JSON.stringify(req.format)}`);
  }
  let idRe;
  const pattern = req.idPattern || DEFAULT_ID_PATTERN;
  try {
    idRe = new RegExp(pattern);
  } catch (err) {
    throw new Unverified(`\`requirements.idPattern\` inválido: ${err.message}`);
  }
  // Para extraer ids de un texto libre (`rf: RF-1.01 RF-1.02`) se usa el mismo
  // patrón sin anclas.
  const scan = new RegExp(pattern.replace(/^\^/, '').replace(/\$$/, ''), 'g');

  const dir = path.resolve(ROOT, req.dir);
  return {
    dir,
    format,
    vault: req.vault ? path.resolve(ROOT, req.vault) : dir,
    idRe,
    scan,
    repos: Array.isArray(req.repos) ? req.repos : null,
  };
}

// ---------------------------------------------------------------------------
// Changes (la evidencia)
// ---------------------------------------------------------------------------

/** `cierra_rf:` por defecto es `true`; `false` = entrega una parte; lista = completa solo esos. */
function cierraRf(valueRaw, id) {
  if (valueRaw === null) return true;
  const v = valueRaw.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (['false', 'no'].includes(v)) return false;
  if (['true', 'si', 'sí', 'yes'].includes(v)) return true;
  return v.split(/[\s,]+/).map((s) => s.toUpperCase()).includes(id.toUpperCase());
}

function metaField(text, name) {
  const m = text.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  const v = /^["']/.test(m[1]) ? m[1] : m[1].replace(/\s+#.*$/, '');
  return v.trim();
}

/**
 * Los changes de cada repositorio con proveedor, abiertos y archivados.
 * @returns {{changes: object[], providers: object[]}}
 */
function loadChanges(cfg, opts) {
  let repos = cfg.repos;
  if (opts.repos) {
    for (const name of opts.repos) {
      if (!cfg.repos.some((r) => r.name === name)) {
        throw new Unverified(`\`requirements.repos\` nombra "${name}", que no está en \`repos\``);
      }
    }
    repos = cfg.repos.filter((r) => opts.repos.includes(r.name));
  }

  const changes = [];
  const providers = [];

  for (const repo of repos) {
    const { provider, problems } = sdd.providerFor(cfg, repo);
    if (problems.length > 0) throw new Unverified(`${repo.name}: ${problems[0]}`);
    if (!provider) continue;

    // Con `changeLayout: file` los metadatos van en el propio documento.
    const metaFile = provider.metaFile || (provider.provider === 'openspec' ? '.openspec.yaml' : null);
    if (!metaFile && provider.changeLayout !== 'file') {
      throw new Unverified(
        `el proveedor "${provider.provider}" no declara \`metaFile\` (el archivo del change donde van rf:, cierra_rf: y pendiente_rf:)`,
      );
    }
    // Un repositorio sin clonar no tiene "cero changes": no se sabe.
    if (!fs.existsSync(repo.absPath)) {
      throw new Unverified(`${repo.name}: el repositorio no existe en ${repo.path}. ¿Falta clonarlo?`);
    }
    providers.push(provider);

    const listed = sdd.listChanges({ ...provider, metaFile }, repo.absPath);

    for (const { name, archived, path: dir, metaPath } of listed) {
      let text = '';
      try {
        text = metaPath ? fs.readFileSync(metaPath, 'utf8') : '';
      } catch {
        text = '';
      }
      const rfRaw = metaField(text, 'rf');
      const ids = rfRaw ? [...new Set(rfRaw.match(opts.scan) || [])] : [];
      const date = archived ? (name.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '' : '';
      changes.push({
        repo: repo.name,
        name,
        archived,
        date,
        dir: rel(dir),
        ids,
        rfRaw,
        ninguno: rfRaw !== null && /^(ninguno|none|n\/a)$/i.test(rfRaw.replace(/^["']|["']$/g, '')),
        cierraRaw: metaField(text, 'cierra_rf'),
        pendiente: (metaField(text, 'pendiente_rf') || '').replace(/^["']|["']$/g, '') || null,
      });
    }
  }

  return { changes, providers };
}

/** Evidencia por id: los changes que lo declaran, con su `cierra` ya resuelto. */
function evidence(changes) {
  const ev = new Map();
  for (const c of changes) {
    for (const id of c.ids) {
      if (!ev.has(id)) ev.set(id, []);
      ev.get(id).push({ ...c, cierra: cierraRf(c.cierraRaw, id) });
    }
  }
  return ev;
}

/**
 * El estado que dicen los changes. Alguno abierto -> hay trabajo en curso. Todos
 * archivados -> `cerrado`, salvo que la entrega más reciente diga que no lo
 * completa.
 *
 * Se mira la última fecha de archivado y no "alguno cierra": un requisito que se
 * entrega por partes tiene changes viejos sin el campo, y el que manda es el
 * último. Si esa fecha tiene varios changes (el par proveedor/consumidor de una
 * misma entrega), tienen que cerrar todos.
 */
function derivar(cambios) {
  if (!cambios.every((c) => c.archived)) return 'implementacion';
  const ultima = cambios.reduce((m, c) => (c.date > m ? c.date : m), '');
  const ultimos = cambios.filter((c) => c.date === ultima);
  return ultimos.every((c) => c.cierra) ? 'cerrado' : 'implementacion';
}

/** Los changes de la última entrega que declaran no cerrar el requisito. */
function parciales(cambios) {
  if (!cambios.length || !cambios.every((c) => c.archived)) return [];
  const ultima = cambios.reduce((m, c) => (c.date > m ? c.date : m), '');
  return cambios.filter((c) => c.date === ultima && !c.cierra);
}

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------

function loadFichas(opts, findings) {
  if (!fs.existsSync(opts.dir)) throw new Unverified(`no existe la carpeta de fichas ${rel(opts.dir)}`);

  const fichas = [];
  for (const full of walk(opts.dir)) {
    if (path.extname(full).toLowerCase() !== '.md') continue;
    let text = fs.readFileSync(full, 'utf8');
    const file = rel(full);

    // El front matter tiene que arrancar en el byte 0. Con BOM se informa y se
    // sigue leyendo sin él; con líneas en blanco antes, la ficha no se parsea.
    if (text.startsWith(BOM)) {
      findings.push({
        rule: 'REQ-FM',
        file,
        line: 1,
        message: 'el front matter empieza con un BOM: algunas herramientas lo leen como texto y la ficha sale del tablero',
      });
      text = text.slice(1);
    } else if (/^\s+---\r?\n/.test(text.slice(0, 200))) {
      findings.push({
        rule: 'REQ-FM',
        file,
        line: 1,
        message: 'hay líneas en blanco antes del --- del front matter: la ficha queda sin propiedades',
      });
      continue;
    }

    const fm = parseFrontMatter(text, file);
    if (!fm) continue; // un índice o un README: no es una ficha
    if (fm.rf === undefined && fm.tipo !== 'requisito') continue;

    fichas.push({ full, file, text, fm, line: 1 });
  }
  return fichas;
}

const isManual = (f) => /^(false|no)$/i.test(String(f.fm.estado_auto === undefined ? '' : f.fm.estado_auto));

/** Valida las fichas y devuelve las que sirven para derivar (id válido y único). */
function validateFichas(fichas, opts, findings) {
  const byId = new Map();
  for (const f of fichas) {
    const id = f.fm.rf;
    if (!id || typeof id !== 'string' || !opts.idRe.test(id)) {
      findings.push({
        rule: 'REQ-FICHA',
        file: f.file,
        line: 1,
        message: `rf: ${JSON.stringify(id || '')} no cumple ${opts.idRe.source}`,
      });
      f.invalid = true;
      continue;
    }
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(f);

    if (!ESTADOS.includes(f.fm.estado)) {
      findings.push({
        rule: 'REQ-ESTADO-VOCAB',
        file: f.file,
        line: 1,
        message: `estado: ${JSON.stringify(f.fm.estado || '')} no está en el vocabulario (${ESTADOS.join(', ')})`,
      });
      f.badEstado = true;
    }

    if (isManual(f) && !f.fm.estado_motivo) {
      findings.push({
        rule: 'REQ-MANUAL',
        file: f.file,
        line: 1,
        message: 'estado_auto: false sin estado_motivo: que explique por qué el estado no se deriva',
      });
    }
  }

  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    for (const f of group) f.duplicate = true;
    for (const f of group.slice(1)) {
      findings.push({
        rule: 'REQ-FICHA',
        file: f.file,
        line: 1,
        message: `${id} ya lo usa ${group[0].file}: con dos fichas para el mismo id el estado no se puede derivar (declarar estado_auto: false con su motivo, o unificarlas)`,
      });
    }
  }
  return byId;
}

function validateLinks(fichas, opts, findings) {
  const wiki = opts.format === 'obsidian';
  const index = wiki ? vaultIndex(opts.vault) : null;

  // Los enlaces se validan en todas las notas de la carpeta, no solo en las fichas.
  for (const full of walk(opts.dir)) {
    if (path.extname(full).toLowerCase() !== '.md') continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const l of linksOf(text, wiki)) {
      let ok;
      if (wiki) {
        const t = l.target.toLowerCase().replace(/\\/g, '/');
        ok = t.includes('/') ? index.paths.has(t) || index.paths.has(t.replace(/\.md$/, '')) : index.names.has(t);
      } else {
        let target = l.target;
        try {
          target = decodeURIComponent(target);
        } catch {
          // se usa tal cual
        }
        ok = fs.existsSync(path.resolve(path.dirname(full), target));
      }
      if (!ok) {
        findings.push({
          rule: 'REQ-LINK',
          file: rel(full),
          line: l.line,
          message: wiki ? `[[${l.target}]] no resuelve a ninguna nota` : `el enlace a "${l.target}" no resuelve a ningún archivo`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Verificaciones contra los changes
// ---------------------------------------------------------------------------

function validateAgainstChanges(byId, changes, ev, findings, flags) {
  for (const f of [].concat(...byId.values())) {
    if (f.duplicate || f.badEstado || isManual(f) || f.fm.estado === 'descartado') continue;
    const cambios = ev.get(f.fm.rf);
    if (!cambios) continue; // ningún change lo declara: no hay evidencia, no se opina

    const d = derivar(cambios);
    const estado = f.fm.estado;
    const abiertos = cambios.filter((c) => !c.archived).map((c) => `${c.repo}/${c.name}`);
    const parc = parciales(cambios);

    if (d === 'implementacion') {
      const porque = abiertos.length
        ? `change abierto: ${abiertos.join(', ')}`
        : `la última entrega declara cierra_rf: false (${parc.map((c) => c.pendiente || 'sin pendiente_rf').join('; ')})`;
      if (estado === 'cerrado') {
        findings.push({
          rule: 'REQ-ESTADO',
          file: f.file,
          line: 1,
          message: `dice cerrado pero queda trabajo: ${porque}. Si es trabajo nuevo, una persona lo reabre; si es un change abandonado, se archiva o se borra`,
        });
      } else if (SIN_EMPEZAR.has(estado)) {
        findings.push({
          rule: 'REQ-ESTADO',
          file: f.file,
          line: 1,
          message: `dice ${estado} pero ya se está construyendo (${porque}). Correr --sync-estados`,
        });
      }
    } else if (flags.exigirCerrados && estado !== 'cerrado') {
      findings.push({
        rule: 'REQ-ESTADO-ATRASADO',
        file: f.file,
        line: 1,
        message: `todos sus changes están archivados y la ficha dice ${estado}. Correr --sync-estados`,
      });
    }
  }

  const ids = new Set(byId.keys());
  for (const c of changes) {
    if (c.archived) continue; // el historial no es ruido de este gate
    if (c.ids.length === 0 && !c.ninguno) {
      findings.push({
        rule: 'REQ-CHANGE-SIN-RF',
        file: c.dir,
        line: 1,
        message: `el change abierto ${c.repo}/${c.name} no declara rf:. Si construye un requisito, declararlo; si no corresponde a ninguno, \`rf: ninguno\``,
      });
    }
    for (const id of c.ids) {
      if (!ids.has(id)) {
        findings.push({
          rule: 'REQ-RF-INEXISTENTE',
          file: c.dir,
          line: 1,
          message: `el change ${c.repo}/${c.name} declara ${id}, que no tiene ficha en el tablero`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sincronizar estados
// ---------------------------------------------------------------------------

function syncStates(byId, ev, write) {
  const aplicados = [];
  const retrocesos = [];
  const respetadas = [];
  const duplicadas = [];
  const parcialesOut = [];

  for (const group of byId.values()) {
    for (const f of group) {
      const id = f.fm.rf;
      const cambios = ev.get(id);
      if (!cambios || f.badEstado || f.fm.estado === 'descartado') continue;

      if (f.duplicate) {
        duplicadas.push({ id, file: f.file });
        continue;
      }
      if (isManual(f)) {
        respetadas.push({ id, file: f.file, estado: f.fm.estado, motivo: f.fm.estado_motivo || null });
        continue;
      }

      const actual = f.fm.estado;
      const nuevo = derivar(cambios);

      if (nuevo === 'implementacion' && parciales(cambios).length > 0) {
        parcialesOut.push({
          id,
          file: f.file,
          pendiente: parciales(cambios).map((c) => ({ change: `${c.repo}/${c.name}`, pendiente_rf: c.pendiente })),
        });
      }

      if (nuevo === actual) continue;
      // `testing` es un estado manual dentro de "hay un change abierto".
      if (nuevo === 'implementacion' && actual === 'testing') continue;

      if (ORDEN.indexOf(nuevo) < ORDEN.indexOf(actual)) {
        retrocesos.push({
          id,
          file: f.file,
          actual,
          derivado: nuevo,
          abiertos: cambios.filter((c) => !c.archived).map((c) => `${c.repo}/${c.name}`),
        });
        continue;
      }

      aplicados.push({ id, file: f.file, from: actual, to: nuevo, applied: !!write });
      if (write) {
        let text = f.text;
        const comillas = new RegExp(`^estado:[ \\t]*"`, 'm').test(text);
        text = text.replace(/^estado:[^\r\n]*/m, comillas ? `estado: "${nuevo}"` : `estado: ${nuevo}`);
        text = text.replace(/^actualizado:[^\r\n]*/m, `actualizado: ${today()}`);
        fs.writeFileSync(f.full, text);
      }
    }
  }
  return { aplicados, retrocesos, respetadas, duplicadas, parciales: parcialesOut };
}

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

function board(fichas, ev) {
  const lines = [];
  const validas = fichas.filter((f) => !f.invalid && ESTADOS.includes(f.fm.estado));
  for (const e of ESTADOS) {
    const rs = validas
      .filter((f) => f.fm.estado === e)
      .sort((a, b) => String(a.fm.rf).localeCompare(String(b.fm.rf), 'es', { numeric: true }));
    if (rs.length === 0) continue;
    lines.push(`## ${e} (${rs.length})`);
    for (const f of rs) {
      const titulo = f.fm.titulo || path.basename(f.file, '.md');
      const parc = ev && ev.has(f.fm.rf) ? parciales(ev.get(f.fm.rf)) : [];
      const nota = parc.length ? ` — pendiente: ${parc.map((c) => c.pendiente || 'sin pendiente_rf').join('; ')}` : '';
      const manual = isManual(f) ? ' (estado manual)' : '';
      lines.push(`- ${f.fm.rf}  ${titulo}${manual}${nota}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const asJson = has('--json');
  const out = (s) => process.stdout.write(s);

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const opts = requirementsOptions(cfg);
  if (!opts) {
    // No hay tablero: no hay nada que verificar, y se dice. No es un "limpio".
    if (asJson) out('[]\n');
    else out('\n  No aplica: el proyecto no declara `requirements` en ai-workspace.json. No se verificó nada.\n\n');
    return 0;
  }

  const findings = [];
  const fichas = loadFichas(opts, findings);
  const byId = validateFichas(fichas, opts, findings);

  const needsChanges = has('--sync-estados') || has('--huerfanos');
  const { changes, providers } = loadChanges(cfg, opts);
  const hasSdd = providers.length > 0;
  const ev = evidence(changes);

  if (has('--tablero')) {
    const text = board(fichas, hasSdd ? ev : null);
    const target = arg('--out');
    if (target) fs.writeFileSync(path.resolve(ROOT, target), `# Tablero de requisitos\n\n${text}`);
    if (asJson) {
      const grouped = {};
      for (const f of fichas.filter((x) => !x.invalid)) (grouped[f.fm.estado] = grouped[f.fm.estado] || []).push(f.fm.rf);
      out(`${JSON.stringify(grouped, null, 2)}\n`);
    } else out(`${text}${target ? `\n  Escrito: ${target}\n` : ''}`);
    return 0;
  }

  if (needsChanges && !hasSdd) {
    throw new Unverified(
      'ningún repositorio declara un proveedor de especificación (`sdd` en el manifest de un pack): no hay de dónde leer los changes',
    );
  }

  if (has('--huerfanos')) {
    const conFicha = new Set(byId.keys());
    const huerfanos = changes.filter((c) => c.ids.length === 0 || c.ids.every((id) => !conFicha.has(id)));
    if (asJson) {
      out(`${JSON.stringify(huerfanos.map((c) => ({ change: `${c.repo}/${c.name}`, abierto: !c.archived, rf: c.rfRaw })), null, 2)}\n`);
    } else {
      for (const c of huerfanos) out(`  ${c.repo}/${c.name}${c.archived ? '' : '  (ABIERTO)'}\n`);
      out(`  ${huerfanos.length} change(s) sin ficha.\n`);
    }
    return 0;
  }

  if (has('--sync-estados')) {
    // Un id repetido o ilegible detiene la derivación de esa ficha, no la de las demás.
    const r = syncStates(byId, ev, !has('--dry-run'));
    if (asJson) {
      out(`${JSON.stringify(r, null, 2)}\n`);
      return 0;
    }
    const verbo = has('--dry-run') ? 'cambiaría' : 'actualizado';
    for (const a of r.aplicados) out(`  ${verbo}  ${a.id.padEnd(10)} ${a.from} -> ${a.to}   (${a.file})\n`);
    if (r.aplicados.length === 0) out('  Ningún estado para cambiar.\n');
    if (r.parciales.length) {
      out('\n  En implementacion: la última entrega declara cierra_rf: false\n');
      for (const p of r.parciales) {
        for (const c of p.pendiente) out(`    ${p.id}  ${c.change} — pendiente: ${c.pendiente_rf || 'sin pendiente_rf: completarlo'}\n`);
      }
    }
    if (r.respetadas.length) {
      out('\n  Sin derivar (estado_auto: false; lo gestiona una persona):\n');
      for (const x of r.respetadas) out(`    ${x.id}  estado: ${x.estado} — ${x.motivo || 'sin estado_motivo: completalo'}\n`);
    }
    if (r.duplicadas.length) {
      out('\n  Sin tocar (hay dos fichas para el mismo id; no se sabe a cuál aplicar):\n');
      for (const x of r.duplicadas) out(`    ${x.id}  ${x.file}\n`);
    }
    if (r.retrocesos.length) {
      out('\n  Sin tocar (lo derivado va hacia atrás; una persona decide si es trabajo nuevo o un change abandonado):\n');
      for (const x of r.retrocesos) {
        out(`    ${x.id}  dice ${x.actual}, derivado ${x.derivado}${x.abiertos.length ? `; change abierto: ${x.abiertos.join(', ')}` : ''}\n`);
      }
    }
    out(`\n  ${r.aplicados.length} ficha(s)${has('--dry-run') ? ' a cambiar' : ''}.\n`);
    return 0;
  }

  // Validación (modo por defecto).
  validateLinks(fichas, opts, findings);
  if (hasSdd) {
    validateAgainstChanges(byId, changes, ev, findings, { exigirCerrados: has('--exigir-cerrados') });
  }

  if (asJson) {
    out(`${JSON.stringify(findings, null, 2)}\n`);
    return findings.length > 0 ? 1 : 0;
  }

  if (findings.length === 0) {
    out(`\n  Tablero sin hallazgos (${fichas.length} ficha(s)).\n`);
    if (!hasSdd) out('  Sin proveedor de especificación: el estado no se contrastó con ningún change (no hay ciclo instalado).\n');
    out('\n');
    return 0;
  }
  out(`\n  Tablero de requisitos  —  ${findings.length} hallazgo(s)\n\n`);
  for (const f of findings) out(`  [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ''}\n    ${f.message}\n`);
  out('\n');
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  if (err instanceof Unverified || (err && err.isAssetError)) {
    process.stderr.write(`\n  check-requirements: no se pudo verificar — ${err.message}.\n`);
    process.stderr.write('  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n\n');
    process.exit(2);
  }
  process.stderr.write(`\n  check-requirements: ${err && err.message}\n  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n\n`);
  process.exit(2);
}
