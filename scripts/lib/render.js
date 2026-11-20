#!/usr/bin/env node
/**
 * render.js
 *
 * Sustitución de plantillas, deliberadamente mínima.
 *
 * No se usa un motor de plantillas de terceros por una razón concreta: esta
 * base se instala en proyectos que todavía no tienen dependencias instaladas, y
 * el `init` tiene que correr con Node pelado. Una dependencia acá significaría
 * `npm install` antes de poder generar nada.
 *
 * Sintaxis soportada, y nada más:
 *
 *   {{ruta.al.valor}}              interpolación
 *   {{#if ruta}}…{{/if}}           bloque si el valor es verdadero o no vacío
 *   {{#unless ruta}}…{{/unless}}   el complemento
 *   {{#each lista}}…{{/each}}      repetición; dentro se accede a las
 *                                  propiedades del elemento directamente,
 *                                  y `{{@index}}` / `{{@first}}` / `{{@last}}`
 *
 * Lo que NO soporta, a propósito: expresiones, comparaciones, helpers y
 * anidamiento de `each` dentro de `each`. Si una plantilla necesita eso, el
 * dato tiene que llegar ya calculado desde el código.
 */

'use strict';

/** Resuelve `a.b.c` contra un objeto. Devuelve undefined si el camino se corta. */
function resolve(ctx, path) {
  if (path === '.' || path === 'this') return ctx;
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, ctx);
}

function isTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return Boolean(value);
}

function interpolate(template, ctx) {
  return template.replace(/\{\{([\w.@]+)\}\}/g, (match, path) => {
    const value = resolve(ctx, path);
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/**
 * Encuentra el cierre que corresponde a una apertura, contando los bloques
 * anidados del mismo tipo. Sin esto, un `{{#if}}` dentro de otro `{{#if}}`
 * cierra en el lugar equivocado y la plantilla sale cortada — en silencio, que
 * es lo peor que puede pasar en un generador.
 */
function findClose(source, tag, name, fromIndex) {
  const open = new RegExp(`\\{\\{#${tag}\\s+[\\w.@]+\\}\\}`, 'g');
  const close = new RegExp(`\\{\\{\\/${tag}\\}\\}`, 'g');

  let depth = 1;
  let cursor = fromIndex;

  while (cursor < source.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(source);
    const nextClose = close.exec(source);

    if (!nextClose) return -1;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }

    depth--;
    if (depth === 0) return nextClose.index;
    cursor = nextClose.index + nextClose[0].length;
  }

  return -1;
}

function renderBlocks(template, ctx) {
  const blockStart = /\{\{#(if|unless|each)\s+([\w.@]+)\}\}/;

  let out = template;
  let match;

  while ((match = blockStart.exec(out))) {
    const [opening, tag, path] = match;
    const bodyStart = match.index + opening.length;
    const closeIndex = findClose(out, tag, path, bodyStart);

    if (closeIndex === -1) {
      throw new Error(`Plantilla inválida: {{#${tag} ${path}}} sin su {{/${tag}}}`);
    }

    const body = out.slice(bodyStart, closeIndex);
    const after = closeIndex + `{{/${tag}}}`.length;
    const value = resolve(ctx, path);

    let replacement = '';
    if (tag === 'if') {
      replacement = isTruthy(value) ? renderBlocks(body, ctx) : '';
    } else if (tag === 'unless') {
      replacement = isTruthy(value) ? '' : renderBlocks(body, ctx);
    } else {
      const list = Array.isArray(value) ? value : [];
      replacement = list
        .map((item, i) => {
          const scope =
            item !== null && typeof item === 'object'
              ? { ...ctx, ...item }
              : { ...ctx, this: item };
          scope['@index'] = i;
          scope['@first'] = i === 0;
          scope['@last'] = i === list.length - 1;
          return renderBlocks(body, scope);
        })
        .join('');
    }

    out = out.slice(0, match.index) + replacement + out.slice(after);
  }

  return interpolate(out, ctx);
}

/**
 * Un tag de bloque que ocupa su propia línea no debe dejar esa línea vacía en
 * la salida. Sin esto, cada condición no cumplida deja un hueco y el documento
 * generado sale con espaciado irregular — que es exactamente la señal de "esto
 * lo escupió una máquina" que un entregable no debería tener.
 */
function trimBlockLines(template) {
  return template.replace(
    /^[ \t]*(\{\{[#/](?:if|unless|each)(?:\s+[\w.@]+)?\}\})[ \t]*\r?\n/gm,
    '$1',
  );
}

/**
 * @param {string} template contenido de la plantilla
 * @param {object} ctx datos
 * @returns {string}
 */
function render(template, ctx) {
  return renderBlocks(trimBlockLines(template), ctx || {});
}

module.exports = { render, resolve, isTruthy };
