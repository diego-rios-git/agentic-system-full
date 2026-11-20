#!/usr/bin/env node
/**
 * sdd.js
 *
 * El ciclo dirigido por especificación, separado de la herramienta que lo
 * implementa.
 *
 * El ciclo —proponer, diseñar, escribir los tests, implementar, archivar— es
 * una forma de trabajar, no un producto. Lo que cambia de una herramienta a
 * otra es dónde viven los documentos, cómo se marca un escenario de aceptación
 * y cómo se llama el programa que los valida. Esas tres cosas son datos.
 *
 * Sin esta separación, cambiar de herramienta significaba reescribir el gate y
 * los cinco procedimientos, así que en la práctica no se cambiaba: la elección
 * hecha el primer día quedaba clavada en el sistema.
 *
 * El proveedor lo declara un pack en su `manifest.json`, bajo `sdd`:
 *
 *   "sdd": {
 *     "provider": "openspec",
 *     "changesDir": "openspec/changes",
 *     "archiveSegment": "archive",
 *     "scenarioPattern": "^#{3,4}\\s+Scenario:\\s*(.+?)\\s*$",
 *     "docExtension": ".md",
 *     "cli": "openspec"
 *   }
 *
 * Cambiar de herramienta mañana es escribir un pack con esas seis claves. Los
 * procedimientos del ciclo no se tocan: hablan del contrato, no de rutas.
 *
 * **Un cambio es un directorio o un documento** (`changeLayout`). Por defecto,
 * `dir`: cada cambio es un directorio bajo `changesDir`, con sus documentos y
 * su archivo de metadatos (`metaFile`). Con `file`, cada cambio es UN documento
 * (`<changesDir>/<nombre><docExtension>`, archivado como
 * `<changesDir>/<archiveSegment>/<AAAA-MM-DD>-<nombre><docExtension>`) y los
 * metadatos —`rf:`, `cierra_rf:`, `pendiente_rf:`— van en líneas propias de ese
 * mismo documento. Es la forma de ODD (`odd/tasks/<funcionalidad>.md`).
 *
 * **Ninguno es obligatorio.** Un proyecto sin ciclo dirigido por especificación
 * no declara proveedor, y el gate de cobertura de escenarios sale con 0 diciendo
 * que no hay nada que verificar — no con 2, porque no es que no pudo: es que no
 * hay ciclo instalado.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const assets = require('./asset-roots');

/** Lo que se asume si el proveedor no lo declara. */
const DEFAULTS = {
  archiveSegment: 'archive',
  docExtension: '.md',
  changeLayout: 'dir',
  cli: null,
};

const LAYOUTS = new Set(['dir', 'file']);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------
// Resolución del proveedor
// ---------------------------------------------------------------------------

/**
 * El proveedor activo para un repositorio, o `null` si no hay ninguno.
 *
 * Si hubiera más de uno declarado se toma el último según el orden de
 * precedencia de `asset-roots` —el proyecto le gana al pack— y se reporta,
 * porque dos ciclos a la vez es casi siempre una instalación a medio migrar.
 */
function providerFor(cfg, repo) {
  const found = [];
  const problems = [];

  for (const root of assets.rootsFor(cfg, repo)) {
    const manifest = assets.rawManifest(root);
    const raw = manifest && manifest.sdd;
    if (!raw) continue;

    if (!raw.changesDir) {
      problems.push(`${root.dir}/manifest.json (sdd): falta \`changesDir\`.`);
      continue;
    }

    let scenarioRe;
    try {
      scenarioRe = new RegExp(raw.scenarioPattern || '^#{3,4}\\s+Scenario:\\s*(.+?)\\s*$');
    } catch (err) {
      problems.push(`${root.dir}/manifest.json (sdd): \`scenarioPattern\` inválido — ${err.message}`);
      continue;
    }

    // El mismo error que en los dialectos de consulta: en JSON `"\s"` no es la
    // secuencia de expresión regular, y un patrón con un carácter de control
    // compila sin quejarse y no coincide con nada.
    if (/[\u0000-\u001f]/.test(String(raw.scenarioPattern || ''))) {
      problems.push(
        `${root.dir}/manifest.json (sdd): \`scenarioPattern\` tiene un carácter de control. ` +
          'En JSON las barras invertidas van dobles.',
      );
      continue;
    }

    // Un valor desconocido no se trata como `dir`: leería directorios que no
    // existen y el gate reportaría "nada que verificar" sobre cambios reales.
    if (raw.changeLayout !== undefined && !LAYOUTS.has(raw.changeLayout)) {
      problems.push(
        `${root.dir}/manifest.json (sdd): \`changeLayout\` es "${raw.changeLayout}"; tiene que ser "dir" o "file".`,
      );
      continue;
    }

    found.push({
      ...DEFAULTS,
      ...raw,
      provider: raw.provider || root.id,
      origin: root.id,
      scenarioRe,
    });
  }

  if (found.length > 1) {
    problems.push(
      `Hay más de un ciclo dirigido por especificación activo (${found
        .map((f) => f.provider)
        .join(', ')}). Se usa "${found[found.length - 1].provider}".`,
    );
  }

  return { provider: found[found.length - 1] || null, problems };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function walkDocs(dir, extension, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDocs(full, extension, acc);
    else if (e.name.toLowerCase().endsWith(extension)) acc.push(full);
  }
  return acc;
}

const isFileLayout = (provider) => provider.changeLayout === 'file';

/** Orden por punto de código: estable entre máquinas, a diferencia de localeCompare. */
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Con `file`, ¿este nombre de archivo es el documento de un cambio?
 *
 * La extensión se compara exacta: aceptar `X.MD` y después armar la ruta con
 * `.md` encuentra el archivo en Windows y no en Linux, y el gate aprobaría sin
 * escenarios. Un README, o un archivo que empieza con `_` o `.`, es de la
 * carpeta y no un cambio: contarlo haría fallar el tablero por un `rf:` que no
 * tiene por qué declarar.
 */
function isChangeDoc(provider, fileName) {
  if (!fileName.endsWith(provider.docExtension)) return false;
  const stem = fileName.slice(0, fileName.length - provider.docExtension.length);
  return stem.length > 0 && !/^[_.]/.test(stem) && stem.toLowerCase() !== 'readme';
}

/**
 * Los documentos de un cambio. `change` es su nombre relativo a `changesDir`,
 * con el segmento de archivo si está archivado (`archive/2026-09-01-x`), que es
 * lo que devuelven `changesTouched` y `listChanges`.
 *
 * Con `file` se acepta también lo que una persona tipea naturalmente —el nombre
 * con extensión o la ruta desde la raíz del repositorio—: si no, `--change x.md`
 * buscaría `x.md.md`, no encontraría escenarios y el gate daría todo por cubierto.
 */
function docsOf(provider, repoRoot, change) {
  if (isFileLayout(provider)) {
    let name = String(change).split('\\').join('/');
    const prefix = `${provider.changesDir}/`;
    if (name.startsWith(prefix)) name = name.slice(prefix.length);
    if (name.endsWith(provider.docExtension)) name = name.slice(0, name.length - provider.docExtension.length);
    const file = path.join(repoRoot, provider.changesDir, `${name}${provider.docExtension}`);
    return fs.existsSync(file) ? [file] : [];
  }
  const target = path.join(repoRoot, provider.changesDir, change);
  return fs.existsSync(target) ? walkDocs(target, provider.docExtension) : [];
}

/**
 * Los cambios de un repositorio, abiertos y archivados.
 *
 * `metaPath` es el archivo donde viven `rf:`, `cierra_rf:` y `pendiente_rf:`:
 * con `dir`, el `metaFile` del directorio (o null si el proveedor no lo
 * declara); con `file`, el propio documento.
 *
 * @returns {{name: string, archived: boolean, path: string, metaPath: string|null}[]}
 */
function listChanges(provider, repoRoot) {
  const base = path.join(repoRoot, provider.changesDir);
  const archive = provider.archiveSegment || DEFAULTS.archiveSegment;
  const ext = provider.docExtension;

  const entries = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };

  const collect = (dir, archived) => {
    const out = [];
    for (const e of entries(dir)) {
      if (isFileLayout(provider)) {
        if (!e.isFile() || !isChangeDoc(provider, e.name)) continue;
        const full = path.join(dir, e.name);
        out.push({ name: e.name.slice(0, e.name.length - ext.length), archived, path: full, metaPath: full });
      } else {
        if (!e.isDirectory() || (!archived && e.name === archive)) continue;
        const full = path.join(dir, e.name);
        out.push({
          name: e.name,
          archived,
          path: full,
          metaPath: provider.metaFile ? path.join(full, provider.metaFile) : null,
        });
      }
    }
    return out.sort(byName);
  };

  return [...collect(base, false), ...collect(path.join(base, archive), true)];
}

/** Escenarios declarados en los documentos de un cambio. */
function scenariosOf(provider, repoRoot, change) {
  const scenarios = [];
  for (const file of docsOf(provider, repoRoot, change)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');

    content.split(/\r?\n/).forEach((line, idx) => {
      const m = provider.scenarioRe.exec(line);
      if (!m) return;
      scenarios.push({ title: m[1], spec: `${rel}:${idx + 1}` });
    });
  }
  return scenarios;
}

/**
 * Cambios que toca la rama, leídos del diff contra su base.
 *
 * Incluye los archivados: cuando se revisa una rama, el cambio suele estar ya
 * archivado, y un barrido de "cambios activos" lo excluiría justo cuando hace
 * falta verificarlo.
 */
function changesTouched(provider, repoPath, base) {
  let out;
  try {
    // Sin `core.quotePath`, git escapa en octal y entre comillas toda ruta no
    // ASCII (`"odd/tasks/validaci\303\263n.md"`), y un cambio con tilde en el
    // nombre no se detectaría. `-z` separa con NUL y no escapa nada.
    out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', `${base}...HEAD`], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
  } catch {
    // Base inexistente o rama sin historia común: no es un fallo del gate.
    return [];
  }

  const dir = escapeRe(provider.changesDir);
  const archive = escapeRe(provider.archiveSegment || '');
  const found = new Set();
  const paths = out.split('\0').filter(Boolean);

  if (isFileLayout(provider)) {
    // El cambio es el documento: abierto en `changesDir` o archivado en su
    // segmento, y con las mismas reglas de nombre que `listChanges`.
    const re = new RegExp(`^${dir}/((?:${archive}/)?)([^/]+)$`);
    for (const p of paths) {
      const m = p.match(re);
      if (!m || !isChangeDoc(provider, m[2])) continue;
      found.add(`${m[1]}${m[2].slice(0, m[2].length - provider.docExtension.length)}`);
    }
    return [...found];
  }

  const re = new RegExp(`^${dir}/(${archive}/[^/]+|[^/]+)/`);
  for (const p of paths) {
    const m = p.match(re);
    if (m && m[1] !== provider.archiveSegment) found.add(m[1]);
  }
  return [...found];
}

module.exports = { DEFAULTS, providerFor, scenariosOf, changesTouched, listChanges, docsOf };
