#!/usr/bin/env node
/**
 * pre-bash-heredoc.js — hook PreToolUse sobre Bash. OPCIONAL: se enciende con
 * `hooks.pre-bash-heredoc.enabled: true` en ai-workspace.json.
 *
 * Bloquea un heredoc cuyo cuerpo lleve una barra invertida, y solo en Windows.
 *
 * ## El motivo real
 *
 * En Git Bash sobre Windows un heredoc puede comerse las barras invertidas, aun
 * con el delimitador entre comillas: `\b` llega como el carácter 0x08, `'\n'`
 * como un salto de línea real. No falla: transforma el contenido. En un caso, un
 * reemplazo hecho con un script de Python buscaba `\n`, no encontró nada, y el
 * archivo quedó exactamente como estaba, sin ningún error. Una regla escrita en la
 * guía de entorno ("no uses barras en un heredoc") pasó igual cuatro veces, porque
 * depende de acordarse al escribir el comando.
 *
 * ## Por qué solo con barra, y solo en Windows
 *
 * Un heredoc sin barras es seguro y es la forma normal de pasar un mensaje de
 * commit (`git commit -F - <<'EOF'`): bloquearlo sería sobrebloquear. En Linux y
 * macOS el heredoc con comillas no toca el cuerpo, así que el hook no actúa; por
 * eso es opcional y por plataforma: un equipo mixto no bloquea a quien no
 * corre el riesgo. (`AI_HOOK_PLATFORM` fuerza la plataforma; lo usan los tests.)
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const core = require('../lib/guard-core');

const ID = 'pre-bash-heredoc';

/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`. No `<<<`, que es una cadena. */
const OPENER = /(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

/** El delimitador del primer heredoc cuyo cuerpo lleva una barra invertida, o `null`. */
function findBackslashHeredoc(command) {
  for (const match of String(command).matchAll(OPENER)) {
    const bodyStart = command.indexOf('\n', match.index);
    if (bodyStart === -1) continue;
    const lines = command.slice(bodyStart + 1).split('\n');
    const end = lines.findIndex((l) => l.trim() === match[2]);
    const body = (end === -1 ? lines : lines.slice(0, end)).join('\n');
    if (body.includes('\\')) return match[2];
  }
  return null;
}

core.defineHook(
  module,
  ID,
  (ctx) => {
    if ((process.env.AI_HOOK_PLATFORM || process.platform) !== 'win32') return null;
    const delimiter = findBackslashHeredoc(ctx.command);
    if (!delimiter) return null;
    return {
      reason: 'heredoc-con-barra-invertida',
      message: [
        `Comando bloqueado: el heredoc <<${delimiter} lleva una barra invertida, y la shell de Windows`,
        'se la puede comer sin avisar (`\\b` llega como 0x08, `\\n` como un salto de línea).',
        '',
        'En su lugar:',
        '  - escribí el archivo con la herramienta Write (o el cambio con Edit);',
        '  - o guardá el script en un archivo .js y corrélo con node;',
        '  - o, si es un mensaje de commit, evitá las barras en el texto.',
      ].join('\n'),
    };
  },
  {
    tools: ['Bash'],
    defaultOn: false,
    // Sin `<<` no hay heredoc: no hace falta cargar la configuración.
    relevant: (p) => String((p.tool_input || {}).command || '').includes('<<'),
  },
);
