#!/usr/bin/env node
/**
 * languages.js
 *
 * Perfiles de lenguaje: qué es un archivo fuente, qué es un test, qué se
 * saltea y cómo se ve un comentario, para cada lenguaje que el proyecto usa.
 *
 * Por qué existe: antes cada escáner tenía sus propias constantes.
 * `check-antipatterns.js` definía `SOURCE_EXT = /\.[cm]?[jt]sx?$/`,
 * `check-tenant-isolation.js` definía `/\.[cm]?ts$/`, y
 * `check-scenario-coverage.js` otra distinta. Tres definiciones del mismo
 * concepto, todas cableadas a JavaScript, ninguna alcanzable desde la
 * configuración. Un backend en C#, Java o Go quedaba **fuera de todos los
 * gates sin que nadie recibiera un aviso**: los escáneres no fallaban,
 * simplemente no encontraban ningún archivo que analizar y reportaban "sin
 * hallazgos". Un gate que no mira nada y dice que está limpio es el fallo que
 * esta base entera existe para evitar.
 *
 * El perfil lo declara **un pack**, en su `manifest.json`, bajo `language`.
 * Instalar el pack de un stack instala su perfil; no instalarlo lo deja fuera.
 * Es la misma regla que ya gobierna reglas, procedimientos y gates.
 *
 *   "language": {
 *     "id": "dotnet",
 *     "extensions": [".cs"],
 *     "ignoreDirs": ["bin", "obj", "packages"],
 *     "ignorePaths": ["Migrations", "Generated"],
 *     "testPatterns": ["Tests?\\.cs$", "(^|/)tests?/"],
 *     "syntax": { "lineComment": "//", "stringDelimiters": ["\"", "'"] },
 *     "envAccess": ["Configuration[", "GetEnvironmentVariable", "IOptions"]
 *   }
 *
 * `testPatterns` y `ignorePaths` son **expresiones regulares en texto**, no
 * globs. Un glob necesitaría un motor propio o una dependencia; una expresión
 * regular la compila Node sin nada de por medio. Se evalúan siempre contra la
 * ruta relativa al repositorio, con barras normales, en minúsculas para
 * `ignorePaths` y sensible a mayúsculas para `testPatterns` — porque
 * `UsuarioTests.cs` y `usuariotests.cs` son el mismo archivo para el sistema
 * operativo pero solo el primero sigue la convención de xUnit.
 *
 * Un proyecto puede ampliar o pisar cualquier campo desde `ai-workspace.json`,
 * por repositorio. Es la vía de escape para el lenguaje que todavía no tiene
 * pack: no hay que bifurcar la base para analizar Rust.
 *
 *   "repos": [
 *     { "name": "motor", "path": "motor",
 *       "language": { "id": "rust", "extensions": [".rs"],
 *                     "ignoreDirs": ["target"],
 *                     "testPatterns": ["(^|/)tests/", "#\\[test\\]"] } }
 *   ]
 */

'use strict';

const assets = require('./asset-roots');

/**
 * Lo que se saltea en cualquier lenguaje: control de versiones, artefactos de
 * compilación y dependencias vendorizadas. Se aplica siempre, aunque no haya
 * ningún perfil activo, porque ninguno de estos directorios contiene código que
 * alguien haya escrito y todos son enormes.
 *
 * `bin` y `obj` estaban ausentes hasta ahora: sin ellos, un repositorio .NET se
 * analiza a sí mismo dos veces — una vez el código y otra la copia compilada en
 * `bin/Debug/net10.0/` — y cada hallazgo aparece duplicado con una ruta que no
 * se puede abrir.
 */
const UNIVERSAL_IGNORE_DIRS = [
  '.git', '.hg', '.svn',
  'node_modules', 'vendor', 'packages',
  'dist', 'build', 'out', 'bin', 'obj', 'target',
  'coverage', '.next', '.turbo', '.venv', '__pycache__',
];

/** Sintaxis por defecto: la familia C, que cubre la mayoría de los lenguajes. */
const DEFAULT_SYNTAX = { lineComment: '//', stringDelimiters: ['"', "'"] };

// ---------------------------------------------------------------------------
// Lectura de perfiles
// ---------------------------------------------------------------------------

function normalizeExtensions(list) {
  return (list || [])
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));
}

/**
 * Compila las expresiones de un perfil. Una expresión inválida se reporta y se
 * omite; hacer fallar la carga entera dejaría al repositorio sin ningún gate
 * por culpa de una coma mal puesta en un pack.
 */
function compile(patterns, where, problems, flags = '') {
  const compiled = [];
  for (const raw of patterns || []) {
    try {
      compiled.push(new RegExp(raw, flags));
    } catch (err) {
      problems.push(`${where}: expresión inválida ${JSON.stringify(raw)} — ${err.message}`);
    }
  }
  return compiled;
}

function readProfile(raw, where, problems) {
  if (!raw || typeof raw !== 'object') return null;

  const id = raw.id || where;
  const extensions = normalizeExtensions(raw.extensions);

  if (extensions.length === 0) {
    problems.push(`${where}: el perfil "${id}" no declara \`extensions\`, no puede analizar nada.`);
    return null;
  }

  return {
    id,
    where,
    extensions,
    ignoreDirs: (raw.ignoreDirs || []).map((d) => String(d).toLowerCase()),
    ignorePaths: compile(raw.ignorePaths, `${where} (ignorePaths)`, problems, 'i'),
    testPatterns: compile(raw.testPatterns, `${where} (testPatterns)`, problems),
    syntax: { ...DEFAULT_SYNTAX, ...(raw.syntax || {}) },
    envAccess: raw.envAccess || [],
    // Cómo se extrae el título de un test en este lenguaje. Lo consume
    // `test-discovery.js`; sin esto, el lenguaje tiene tests que nadie sabe
    // leer, que no es lo mismo que no tener tests.
    testTitles: raw.testTitles || null,
  };
}

// ---------------------------------------------------------------------------
// Perfil efectivo de un repositorio
// ---------------------------------------------------------------------------

/**
 * Fusiona los perfiles que aplican a un repositorio: los de los packs que ese
 * repositorio tiene activos, más el que el proyecto haya declarado a mano.
 *
 * Los perfiles se **suman**, no se pisan. Un repositorio puede ser políglota de
 * verdad — una solución .NET con un frontend embebido, un backend Go con
 * scripts de migración en Python — y quedarse con un solo lenguaje ahí sería el
 * mismo punto ciego, más chico.
 *
 * @returns {{
 *   languages: string[],
 *   extensions: string[],
 *   problems: string[],
 *   isSource: (name: string) => boolean,
 *   isIgnoredDir: (name: string) => boolean,
 *   isIgnoredPath: (rel: string) => boolean,
 *   isTest: (rel: string) => boolean,
 *   syntaxFor: (rel: string) => {lineComment: string, stringDelimiters: string[]},
 *   envAccessFor: (rel: string) => string[],
 *   empty: boolean
 * }}
 */
function forRepo(config, repo) {
  const problems = [];
  const profiles = [];

  // `languages` en la configuración del repositorio **restringe** qué perfiles
  // aplican. Sirve para el caso en que sumar sobra: una solución .NET pura no
  // quiere el perfil de JavaScript que aporta el núcleo analizando los scripts
  // de compilación ni un `jquery.min.js` suelto en `wwwroot`.
  const only = repo && Array.isArray(repo.languages) && repo.languages.length > 0
    ? new Set(repo.languages)
    : null;

  for (const root of assets.rootsFor(config, repo)) {
    const manifest = assets.rawManifest(root);
    if (!manifest || !manifest.language) continue;

    const profile = readProfile(manifest.language, `${root.dir}/manifest.json`, problems);
    if (profile && (!only || only.has(profile.id))) profiles.push(profile);
  }

  if (only && profiles.length === 0 && !(repo && repo.language)) {
    problems.push(
      `El repositorio "${repo.name}" restringe sus lenguajes a ${[...only].join(', ')}, ` +
        'pero ningún pack activo declara un perfil con ese identificador.',
    );
  }

  // Declarado a mano en `ai-workspace.json`. Va último: gana sobre los packs,
  // que es lo que hace de esto una vía de escape utilizable.
  if (repo && repo.language) {
    const own = readProfile(repo.language, `ai-workspace.json (repos.${repo.name}.language)`, problems);
    if (own) profiles.push(own);
  }

  return build(profiles, problems);
}

function build(profiles, problems) {
  const extensions = new Set();
  const ignoreDirs = new Set(UNIVERSAL_IGNORE_DIRS);
  const ignorePaths = [];
  const testPatterns = [];
  const syntaxByExt = new Map();
  const envByExt = new Map();
  const titlesByExt = new Map();
  const idByExt = new Map();

  for (const p of profiles) {
    for (const ext of p.extensions) {
      extensions.add(ext);
      // El último perfil que reclama una extensión gana su sintaxis. Con el
      // orden de precedencia de `asset-roots`, eso significa que el proyecto le
      // gana al pack y el pack al núcleo.
      syntaxByExt.set(ext, p.syntax);
      envByExt.set(ext, p.envAccess);
      titlesByExt.set(ext, p.testTitles);
      idByExt.set(ext, p.id);
    }
    for (const d of p.ignoreDirs) ignoreDirs.add(d);
    ignorePaths.push(...p.ignorePaths);
    testPatterns.push(...p.testPatterns);
  }

  const extOf = (rel) => {
    const at = rel.lastIndexOf('.');
    return at === -1 ? '' : rel.slice(at).toLowerCase();
  };

  return {
    languages: profiles.map((p) => p.id),
    extensions: [...extensions],
    problems,
    empty: extensions.size === 0,

    isSource: (name) => extensions.has(extOf(name)),
    isIgnoredDir: (name) => ignoreDirs.has(String(name).toLowerCase()),
    isIgnoredPath: (rel) => ignorePaths.some((re) => re.test(rel)),
    isTest: (rel) => testPatterns.some((re) => re.test(rel)),
    syntaxFor: (rel) => syntaxByExt.get(extOf(rel)) || DEFAULT_SYNTAX,
    envAccessFor: (rel) => envByExt.get(extOf(rel)) || [],
    testTitlesFor: (rel) => titlesByExt.get(extOf(rel)) || null,
    languageOf: (rel) => idByExt.get(extOf(rel)) || null,
  };
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

/**
 * Barre un directorio devolviendo los archivos fuente según el perfil.
 *
 * Está acá y no en cada escáner por la misma razón que el perfil: tres copias
 * del mismo recorrido divergen, y la que se olvida de saltear `obj/` no avisa,
 * solo tarda más y reporta de más.
 */
function walk(profile, dir, acc = []) {
  const fs = require('fs');
  const path = require('path');

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const e of entries) {
    if (e.isDirectory()) {
      if (profile.isIgnoredDir(e.name)) continue;
      walk(profile, path.join(dir, e.name), acc);
    } else if (profile.isSource(e.name)) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

/**
 * Quita el comentario de línea final, respetando las cadenas del lenguaje.
 *
 * Cortar en el primer delimitador es un falso negativo mudo:
 * `const u = "http://localhost"` quedaría truncado en `const u = "http:` y
 * ninguna regla sobre direcciones podría dispararse jamás. El error no se nota
 * — el gate simplemente deja de ver esa familia entera de casos.
 *
 * Los literales que ignoran los escapes (`@"C:\ruta"` de C#, `r"..."` de
 * Python, las cadenas triples) se detectan por su apertura y se cierran con el
 * mismo delimitador sin interpretar la barra invertida. Sin eso, un
 * `@"C:\temp\"` de C# deja el rastreador dentro de una cadena para el resto de
 * la línea y todo lo que sigue se pierde.
 */
function stripComment(line, syntax = DEFAULT_SYNTAX) {
  const marker = syntax.lineComment;
  if (!marker) return line;

  // Continuación de un bloque de documentación: ` * texto`.
  if (/^\s*\*/.test(line)) return '';
  // Comentario de línea completa en lenguajes que usan `#`.
  if (marker === '#' && /^\s*#/.test(line)) return '';

  const delims = syntax.stringDelimiters || DEFAULT_SYNTAX.stringDelimiters;
  const rawPrefixes = syntax.rawStringPrefixes || [];

  let quote = null;
  let rawQuote = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (quote) {
      if (!rawQuote && c === '\\') {
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
        rawQuote = false;
      }
      continue;
    }

    // Apertura de un literal sin escapes: @" de C#, r" de Python, etc.
    const raw = rawPrefixes.find((p) => line.startsWith(p, i));
    if (raw) {
      quote = raw[raw.length - 1];
      rawQuote = true;
      i += raw.length - 1;
      continue;
    }

    if (delims.includes(c)) {
      quote = c;
      rawQuote = false;
      continue;
    }

    if (line.startsWith(marker, i)) return line.slice(0, i);
  }

  return line;
}

module.exports = {
  UNIVERSAL_IGNORE_DIRS,
  DEFAULT_SYNTAX,
  forRepo,
  walk,
  stripComment,
};
