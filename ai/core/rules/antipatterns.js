/**
 * Anti-patrones del núcleo.
 *
 * Solo entra acá lo que vale para **cualquier** proyecto, sin importar el
 * framework. Todo lo que dependa de una biblioteca o de una convención de stack
 * va en el pack de ese stack.
 *
 * Cada regla debe ser **angosta y correcta**. Una regla ancha y ruidosa enseña
 * al equipo a ignorar los avisos, y ahí se pierde el gate entero — no solo esa
 * regla. Ver `ai/core/procedures/gate-from-finding.md`.
 */

'use strict';

module.exports = [
  {
    id: 'CORE-1.1',
    title: 'Error capturado y descartado',
    why: 'El fallo ocurre y nadie se entera. Registrar con contexto, o dejar que propague.',
    test: (line) =>
      // .catch(() => {})  ·  catch { }  ·  catch (e) { }
      /\.catch\s*\(\s*\(\s*[\w$]*\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line) ||
      /\bcatch\s*(\(\s*[\w$]*\s*\))?\s*\{\s*\}/.test(line),
  },
  {
    id: 'CORE-1.2',
    title: 'Dirección local escrita en el código sin posibilidad de sobreescribirla',
    why:
      'Configuración de desarrollo que llega a producción sin forma de cambiarla. ' +
      'Leerla del entorno, con un valor por defecto explícito.',
    test: (line, ctx) => {
      if (!/['"`][^'"`]*(?:localhost|127\.0\.0\.1)[^'"`]*['"`]/.test(line)) return false;

      // Un valor por defecto sobre una variable de entorno es legítimo: el
      // valor real se puede inyectar. Lo que se marca es el que no se puede.
      //
      // Cómo se lee el entorno **depende del lenguaje**, así que la lista la
      // aporta el perfil del pack y no esta regla. Cableado a `process.env`,
      // esto marcaba como error toda dirección local de un archivo C#, Go o
      // Python, porque ninguno tiene forma de "aprobar" el valor.
      const escapes = ctx && ctx.envAccess ? ctx.envAccess : [];
      if (escapes.some((e) => line.includes(e))) return false;

      // Operadores de valor por defecto, comunes a la mayoría de los lenguajes
      // con los que trabaja esta base.
      return !/(\?\?|\|\|)/.test(line);
    },
    skipFile: (rel) => /config|\.env|docker|compose/i.test(rel),
  },
];
