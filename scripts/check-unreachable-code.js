#!/usr/bin/env node
/**
 * check-unreachable-code.js
 *
 * ¿Alguien puede llegar a esto? Marca el código del cambio que ninguna parte del
 * programa usa:
 *
 *   UNREACH-1  archivo NUEVO que nadie importa desde fuera del cambio (isla)
 *   UNREACH-2  archivo MODIFICADO que solo importan los tests (muerto editado)
 *
 * Por qué existe (los incidentes, en genérico):
 *
 *   - Un cambio entregó ocho archivos —tipos, servicio, hook, cuatro componentes
 *     y sus textos—, con todas las tareas tildadas y siete tests en verde. Ningún
 *     archivo de afuera los importaba: no había pestaña, ni ruta, ni botón. La
 *     capa estaba construida y la capacidad no existía, y ninguna verificación
 *     automática lo dijo: los tests importan el archivo que testean, así que
 *     pasan igual.
 *   - Se corrigió un filtro de fechas en un componente que ninguna pantalla
 *     montaba (solo lo importaba su test). Pasó la revisión y lo vio recién la
 *     prueba de punta a punta: el error real estaba en el componente que sí se
 *     montaba. Editar un archivo muerto es arreglar algo que el usuario nunca ve.
 *
 * Cómo decide (`ctx.diff()` de `review-base.js`: commiteado + working tree + sin
 * trackear):
 *
 *   - Cierre transitivo hasta punto fijo. Un archivo nuevo es alcanzable si lo
 *     importa algo de FUERA del cambio, o un archivo nuevo que ya resultó
 *     alcanzable. Sin esa segunda regla, un componente hijo montado por su
 *     padre —que sí está integrado— se marcaría como isla, y un gate que marca de
 *     más se termina ignorando. Punto fijo: el resultado no depende del orden.
 *   - Un test no cuenta como importador: lo corre el runner, no el producto.
 *   - **La resolución de imports es REAL, no por nombre de archivo.** Antes se
 *     buscaba por el nombre base, y dos archivos con el mismo nombre en carpetas
 *     distintas se confundían: un componente muerto salía "importado" porque la
 *     pantalla importaba a su homónimo de otra carpeta. Cada especificador se
 *     resuelve (relativo al importador, o por alias) y se compara contra la ruta
 *     del archivo, con o sin `index`.
 *
 * Qué aporta el perfil de lenguaje (`scripts/lib/languages.js`): cómo se ve un
 * import (`imports.patterns`), alias de rutas, índice de carpeta, extensiones,
 * qué es un test y las raíces por convención (`entrypoints`: lo que se ejecuta
 * sin que nadie lo importe). Las raíces de un FRAMEWORK las declara el pack bajo
 * `reachability`, no el núcleo.
 *
 * Un lenguaje sin `imports` declarado no tiene este gate: sale con 2 (no se pudo
 * verificar) y, en el orquestador, el gate ni corre (`needs: imports`) y se lo
 * muestra como "NO CORRIÓ". En un repositorio políglota se analizan las
 * extensiones que sí declaran imports y se avisa por stderr cuáles quedaron
 * fuera.
 *
 * Límites conocidos (por eso se pueden declarar raíces y alias): un import que
 * se arma con un texto dinámico, un alias de `tsconfig` que el perfil no
 * declara, o un archivo que carga un framework por convención y nadie declaró
 * como raíz aparecen como inalcanzables.
 *
 * Uso:
 *   node scripts/check-unreachable-code.js --repo mi-app [--base origin/main] [--json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const cli = require('./lib/gate-cli');
const languages = require('./lib/languages');

const posix = path.posix;

// ---------------------------------------------------------------------------
// Resolución de imports
// ---------------------------------------------------------------------------

function isRelativeSpec(spec) {
  return spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
}

/**
 * Los candidatos de ruta (relativos al repositorio) a los que puede apuntar un
 * especificador, o `null` si no es un import de archivos del repositorio (un
 * paquete, una URL).
 */
function candidatePaths(spec, importerRel, imports, extensions) {
  let base = null;

  // El prefijo más largo gana: `@/app/` antes que `@/`.
  const aliases = [...imports.aliases].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const alias of aliases) {
    if (spec.startsWith(alias.prefix)) {
      base = posix.normalize(alias.to + spec.slice(alias.prefix.length));
      break;
    }
  }

  if (base === null && imports.relative && isRelativeSpec(spec)) {
    base = posix.normalize(posix.join(posix.dirname(importerRel), spec));
  }

  if (base === null) return null;
  base = base.replace(/\/+$/, '');
  if (base === '' || base === '.' || base.startsWith('../') || base === '..') return null;

  const exts = imports.resolveExtensions || extensions;
  const out = [base];

  // `./a.js` que en realidad es `a.ts` (ESM de TypeScript): se prueba sin la
  // extensión declarada.
  const bare = base.replace(/\.[^./]+$/, '');
  for (const ext of exts) out.push(base + ext);
  if (bare !== base) for (const ext of exts) out.push(bare + ext);
  for (const idx of imports.indexFiles) for (const ext of exts) out.push(`${base}/${idx}${ext}`);

  return out;
}

/** Los especificadores de un archivo, sin lo que está en comentarios de línea. */
function specifiersOf(content, rel, profile, imports) {
  const syntax = profile.syntaxFor(rel);
  const text = content
    .split(/\r?\n/)
    .map((line) => languages.stripComment(line, syntax))
    .join('\n');

  const found = new Set();
  for (const pattern of imports.patterns) {
    for (const m of text.matchAll(pattern)) if (m[1]) found.add(m[1]);
  }
  return [...found];
}

/** `Map<destino, Set<importador>>` de todo el repositorio. */
function buildGraph(dir, profile) {
  const abs = languages.walk(profile, dir);
  const rels = abs.map((f) => path.relative(dir, f).split(path.sep).join('/'));
  const fileSet = new Set(rels);
  const importersOf = new Map();

  rels.forEach((rel, i) => {
    const imports = profile.importsFor(rel);
    if (!imports) return;

    let content;
    try {
      content = fs.readFileSync(abs[i], 'utf8');
    } catch {
      return;
    }

    for (const spec of specifiersOf(content, rel, profile, imports)) {
      const candidates = candidatePaths(spec, rel, imports, profile.extensions);
      if (!candidates) continue;
      const target = candidates.find((c) => fileSet.has(c));
      if (!target || target === rel) continue;
      if (!importersOf.has(target)) importersOf.set(target, new Set());
      importersOf.get(target).add(rel);
    }
  });

  return importersOf;
}

// ---------------------------------------------------------------------------
// Alcanzabilidad
// ---------------------------------------------------------------------------

/** Archivos nuevos alcanzables, por cierre transitivo hasta punto fijo. */
function reachableNew(newFiles, importersOf, profile) {
  const isNew = new Set(newFiles);
  const reachable = new Set();

  let changed = true;
  while (changed) {
    changed = false;
    for (const f of newFiles) {
      if (reachable.has(f)) continue;
      for (const imp of importersOf.get(f) || []) {
        if (profile.isTest(imp)) continue;
        // Importador de afuera del cambio: alcanzable de una. De adentro: sirve
        // solo si él mismo ya es alcanzable.
        if (!isNew.has(imp) || reachable.has(imp)) {
          reachable.add(f);
          changed = true;
          break;
        }
      }
    }
  }
  return reachable;
}

cli.run({
  name: 'unreachable',
  script: 'scripts/check-unreachable-code.js',
  usage: '[--base <ref>]',

  scan(ctx) {
    const profile = languages.forRepo(ctx.cfg, ctx.repo);
    for (const p of profile.problems) process.stderr.write(`  aviso: ${p}\n`);

    if (!profile.hasImports) {
      return cli.unverified(
        `${ctx.repo.name}: el perfil de lenguaje no declara \`imports\`, no hay cómo saber quién importa a quién`,
        'Un pack o `repos[].language` en ai-workspace.json lo declara (ver scripts/lib/languages.js).',
      );
    }

    const sinImports = profile.extensions.filter((e) => !profile.importExtensions.includes(e));
    if (sinImports.length > 0) {
      process.stderr.write(
        `  aviso: ${ctx.repo.name}: sin \`imports\` declarado para ${sinImports.join(' ')}: ` +
          'esos archivos NO se analizan.\n',
      );
    }

    ctx.warnBase();
    const diff = ctx.diff();
    if (!diff) {
      return cli.unverified(
        `${ctx.repo.name}: no se pudo leer el diff contra ${ctx.base}`,
        '¿Falta `git fetch origin`? Pasar otra base con --base.',
      );
    }

    // Lo que se verifica: código del producto. Los tests, lo generado y las
    // raíces por convención no necesitan que nadie los importe.
    const relevant = (rel) =>
      profile.importsFor(rel) &&
      profile.isSource(rel) &&
      !profile.isTest(rel) &&
      !profile.isIgnoredPath(rel) &&
      !profile.isEntrypoint(rel);

    const newFiles = [...diff.added].filter(relevant).sort();
    const editedFiles = [...diff.modified].filter(relevant).sort();

    if (newFiles.length === 0 && editedFiles.length === 0) {
      return cli.clean(`${ctx.repo.name}: sin archivos de código nuevos ni modificados que verificar`);
    }

    const importersOf = buildGraph(ctx.dir, profile);
    const reachable = reachableNew(newFiles, importersOf, profile);
    const isNew = new Set(newFiles);

    const findings = [];

    for (const f of newFiles) {
      if (reachable.has(f)) continue;
      findings.push({
        rule: 'UNREACH-1',
        file: f,
        line: 1,
        message:
          'Archivo nuevo que nadie importa fuera del cambio: es una capa construida, no una ' +
          'capacidad entregada. Falta montarlo, o el cambio tiene que decir que es deliberado.',
      });
    }

    for (const f of editedFiles) {
      const alive = [...(importersOf.get(f) || [])].some(
        (imp) => !profile.isTest(imp) && (!isNew.has(imp) || reachable.has(imp)),
      );
      if (alive) continue;
      findings.push({
        rule: 'UNREACH-2',
        file: f,
        line: 1,
        message:
          'Archivo editado que nada monta (solo lo importan tests): el cambio no llega a ningún ' +
          'lugar del producto. Corregir en el archivo que sí se usa.',
      });
    }

    return cli.findings(findings, {
      emptyMessage: `todo lo nuevo o editado tiene un importador (${newFiles.length} nuevos, ${editedFiles.length} editados)`,
    });
  },
});
