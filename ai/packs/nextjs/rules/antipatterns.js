/**
 * Anti-patrones del pack `nextjs`.
 *
 * Varias nacieron de errores que costaron horas de diagnóstico porque el
 * síntoma no apunta a la causa: un bucle de render sin peticiones de red, o un
 * error de React con dos proveedores montados.
 */

'use strict';

/** Escala habitual de espaciado: 1 unidad = 4px. */
const SPACING_STEP = 4;

module.exports = [
  {
    id: 'NEXT-1.1',
    title: 'Valor arbitrario con equivalente en la escala',
    why:
      'Un número medido a mano que nadie más va a entender ni reutilizar. ' +
      'Casi siempre hay un valor de la escala del sistema de diseño que sirve.',
    test: (line) => {
      const m = /\b(?:w|h|p|m|gap|top|left|right|bottom|size)-\[(\d+)px\]/.exec(line);
      if (!m) return false;
      // Solo se marca si cae justo en la escala: un valor intermedio puede ser
      // deliberado, y marcarlo sería el falso positivo que mata al gate.
      return Number(m[1]) % SPACING_STEP === 0;
    },
  },
  {
    id: 'NEXT-1.2',
    title: 'Selector de atributo como variante suelta',
    why:
      'Una variante escrita a mano no pasa por el sistema de diseño y no se ' +
      'puede buscar. Usar la variante declarada en la configuración.',
    test: (line) =>
      /className\s*=\s*[{"'`][^"'`}]*\[(?:role|aria-[\w-]+|data-[\w-]+)=[^\]]+\]:/.test(line),
  },
  {
    id: 'NEXT-1.3',
    title: 'Token de sesión en almacenamiento del navegador',
    why:
      'Accesible desde cualquier script de la página: un solo punto de inyección ' +
      'lo expone. El token va en una cookie inaccesible desde JavaScript.',
    test: (line) =>
      /(localStorage|sessionStorage)\s*\.\s*(set|get)Item\s*\(\s*['"`][^'"`]*(token|jwt|auth|session)/i.test(
        line,
      ),
  },
  {
    id: 'NEXT-1.4',
    title: 'Objeto de consulta como dependencia de un hook',
    why:
      'El objeto que devuelve useQuery es nuevo en cada render: como dependencia ' +
      'produce un bucle infinito SIN peticiones de red, así que el síntoma no ' +
      'apunta a la causa. Depender de la función desestructurada, que es estable.',
    test: (line, ctx) => {
      const m = /use(?:Callback|Memo|Effect)\s*\([\s\S]*?\[\s*([\w$]+)\s*\]\s*\)/.exec(line);
      if (!m) return false;
      const dep = m[1];
      // Se marca solo si esa variable se asignó desde useQuery sin desestructurar.
      return new RegExp(`(?:const|let)\\s+${dep}\\s*=\\s*use\\w*Query\\s*\\(`).test(ctx.before);
    },
  },
  {
    id: 'NEXT-1.5',
    title: 'Texto visible escrito directamente en el componente',
    why:
      'Un texto suelto no se traduce y no se encuentra. Incluye los que más se ' +
      'olvidan: errores, estados vacíos y etiquetas de accesibilidad.',
    test: (line) =>
      /\b(?:aria-label|placeholder|title|alt)\s*=\s*["'][A-Za-zÁÉÍÓÚÑáéíóúñ][^"']{3,}["']/.test(line),
    skipFile: (rel) => /\.stories\.|\.test\.|\.spec\./.test(rel),
  },
];
