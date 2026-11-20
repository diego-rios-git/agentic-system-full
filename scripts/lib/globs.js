#!/usr/bin/env node
/**
 * globs.js
 *
 * Globs mínimos, sin dependencias, para las reglas que se declaran en datos
 * (`coChange`, raíces de alcance): `*`, `**`, `?` y `{a,b}`.
 *
 * Por qué no una expresión regular a secas: quien declara una regla en un
 * manifest piensa en rutas (`src/**\/*.snap`, `package-lock.json`), no en
 * regex. Y se evalúan siempre contra la ruta relativa al repositorio, con
 * barras normales, para que `\` de Windows no cambie el resultado.
 *
 * Reglas:
 *   *      cualquier cosa dentro de UN tramo (no cruza `/`)
 *   **     cualquier cantidad de tramos, incluso cero (`a/**\/b` casa `a/b`)
 *   ?      un carácter de un tramo
 *   {a,b}  alternativas
 *   un patrón SIN `/` casa contra el nombre del archivo en cualquier carpeta
 *   (`package-lock.json` casa `api/package-lock.json`), como en un .gitignore.
 */

'use strict';

/** A formato POSIX, sin `./` inicial. */
function normalize(rel) {
  return String(rel).split('\\').join('/').replace(/^\.\//, '');
}

function escapeChar(c) {
  return /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
}

/** Compila un glob a RegExp. */
function toRegExp(glob) {
  const g = normalize(glob);
  let re = '';
  let braces = 0;

  for (let i = 0; i < g.length; i++) {
    const c = g[i];

    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` = cero o más carpetas; `**` final = lo que sea.
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      braces += 1;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces -= 1;
      re += ')';
    } else if (c === ',' && braces > 0) {
      re += '|';
    } else {
      re += escapeChar(c);
    }
  }

  const anyDepth = !g.includes('/');
  return new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${re}$`);
}

/** ¿La ruta casa con alguno de los globs? */
function matchesAny(globs, rel) {
  const list = Array.isArray(globs) ? globs : [globs];
  const p = normalize(rel);
  return list.some((g) => toRegExp(g).test(p));
}

module.exports = { normalize, toRegExp, matchesAny };
