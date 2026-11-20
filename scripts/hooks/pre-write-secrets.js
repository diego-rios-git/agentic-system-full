#!/usr/bin/env node
/**
 * pre-write-secrets.js — hook PreToolUse sobre Edit y Write.
 *
 * A diferencia de post-edit-checks.js (corre DESPUÉS de escribir y avisa
 * para corregir), este corre ANTES: si el contenido que se está por
 * escribir tiene forma de secreto, la escritura nunca llega a pasar.
 *
 * Convierte la regla de ai/core/rules/datos-sensibles.md en garantía ejecutada
 * en vez de una regla que depende de que alguien se acuerde de aplicarla.
 *
 * El detector es `scan` de scripts/check-secrets.js, llamado en este mismo
 * proceso. Antes se lanzaba `check-secrets.js` como otro `node`: dos arranques
 * por cada escritura para analizar un texto que ya estaba en memoria.
 *
 * No necesita `ai-workspace.json`: un secreto se bloquea aunque la
 * configuración del proyecto esté rota.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const path = require('path');

const core = require('../lib/guard-core');
const { scan } = require('../check-secrets');

/** El texto que se está por escribir, según la tool. */
function contentOf(payload) {
  const input = payload.tool_input || {};
  if (payload.tool_name === 'Write') return input.content || '';
  if (payload.tool_name === 'Edit') return input.new_string || '';
  return '';
}

core.defineHook(
  module,
  'pre-write-secrets',
  (ctx) => {
    const content = contentOf(ctx.payload);
    const findings = scan(content);
    if (findings.length === 0) return null;

    const rel = ctx.filePath
      ? path.relative(ctx.root, path.resolve(ctx.cwd, ctx.filePath)).split(path.sep).join('/')
      : '(desconocido)';

    return {
      reason: 'secreto-en-escritura',
      extra: { rules: [...new Set(findings.map((f) => f.rule))] },
      message: [
        `Escritura bloqueada en ${rel}: parece contener un secreto.`,
        '',
        ...findings.map((f) => `  [${f.rule}] línea ${f.line}: ${f.message}`),
        '',
        'Si es un secreto real: NO lo escribas acá. Describí el caso sin el valor,',
        'o si ya se compartió, seguí el procedimiento de ai/core/rules/datos-sensibles.md.',
        'Si es un falso positivo (un placeholder que no reconoció el detector),',
        'avisale al usuario — puede pedir que se agregue a la lista de exclusiones.',
      ].join('\n'),
    };
  },
  {
    tools: ['Write', 'Edit'],
    config: 'none',
    relevant: (p) => contentOf(p).trim() !== '',
  },
);
