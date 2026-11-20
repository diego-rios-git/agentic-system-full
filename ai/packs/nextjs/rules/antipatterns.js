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
    fixtures: {
      bad: ['<div className="w-[16px] p-[8px]" />', '<span className="gap-[24px]" />'],
      good: [
        // Un valor intermedio puede ser deliberado: marcarlo sería el falso
        // positivo que mata al gate.
        '<div className="w-[15px]" />',
        '<div className="w-4 p-2" />',
      ],
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
    fixtures: {
      bad: [
        '<li className="[aria-selected=true]:bg-accent" />',
        '<div className="[data-state=open]:rotate-180" />',
      ],
      good: [
        '<li className={cn(variantes({ seleccionado }))} />',
        '<div className="data-open:rotate-180" />',
      ],
    },
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
    fixtures: {
      bad: [
        "localStorage.setItem('authToken', token);",
        "sessionStorage.getItem('jwt');",
      ],
      good: [
        "localStorage.setItem('tema', 'oscuro');",
        "localStorage.setItem('ultimaPestana', id);",
      ],
    },
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
    // Esta regla necesita el contexto de las líneas anteriores, así que sus
    // fixtures lo declaran. Sin `before`, ninguna de las dos marcaría y el
    // fixture correcto pasaría por el motivo equivocado.
    fixtures: {
      before: 'const q = useQuery({ queryKey: k });',
      bad: ['const fn = useCallback(() => hacer(q), [q]);'],
      good: ['const fn = useCallback(() => hacer(q), [q.refetch]);'],
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
    fixtures: {
      bad: [
        '<button aria-label="Cerrar el panel" />',
        '<input placeholder="Buscar por nombre" />',
      ],
      good: [
        '<button aria-label={t("cerrar")} />',
        '<input placeholder={t("buscar")} />',
      ],
    },
  },
];
