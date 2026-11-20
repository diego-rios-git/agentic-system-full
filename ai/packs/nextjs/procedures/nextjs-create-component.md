# Crear un componente

Componentes reutilizables, accesibles y coherentes con el resto de la interfaz.

---

## Antes de crear uno

**Buscá si ya existe.** El catálogo de componentes crece con variantes del mismo botón porque nadie miró primero. Un componente duplicado es peor que uno imperfecto: la próxima corrección se aplica a uno solo.

Si existe algo parecido, la pregunta es si le falta una variante, no si hace falta uno nuevo.

---

## Estructura

```
src/components/<dominio>/
├── ComponentName.tsx
└── ComponentName.test.tsx
```

Los tipos y las constantes van en `src/types/` y `src/constants/`, **no en el archivo del componente**. Un tipo declarado dentro del componente no se puede reutilizar sin importar el componente entero, y termina duplicado. Solo una interfaz de propiedades usada por ese componente y nada más puede quedarse adentro.

---

## Accesibilidad

No es un extra: es parte de que el componente funcione.

- **Todo control interactivo se alcanza con teclado.** Un `div` con manejador de clic no recibe foco ni responde a Enter. Usar el elemento nativo — `button`, `a`, `input` — antes que recrearlo.
- **Un control que solo muestra un ícono necesita nombre accesible.** Sin él, un lector de pantalla anuncia "botón" y nada más.
- **El estado se comunica, no solo se pinta.** Deshabilitado, seleccionado, cargando, con error: cada uno tiene su atributo. Un botón que solo se ve gris no está deshabilitado para quien no lo ve.
- **El foco es visible.** Quitar el contorno de foco sin reemplazarlo por otra señal deja la navegación por teclado a ciegas.
- **El contraste alcanza.** Gris claro sobre blanco se ve bien en el monitor de quien lo diseñó.

---

## Estilos

Usar la escala del sistema de diseño. **Los valores arbitrarios se justifican o no se usan**: `w-[437px]` es un número que alguien midió una vez y que nadie más va a entender. Casi siempre hay un valor de la escala que sirve.

Hay un gate que detecta valores arbitrarios con equivalente en la escala.

**Las constantes de negocio no van en el componente.** Un umbral, un límite, una lista de opciones: van en `src/constants/`. Cuando cambien, hay que encontrarlas.

---

## Textos

**Ningún texto visible se escribe directamente en el componente.** Todos pasan por el sistema de traducciones, incluso en un proyecto de un solo idioma: el día que se agregue otro, el trabajo es encontrar todos los textos sueltos.

Eso incluye los que se olvidan siempre: mensajes de error, estados vacíos, textos alternativos de imágenes, etiquetas de accesibilidad y textos de marcadores de posición.

---

## Estados que hay que cubrir

Un componente que muestra datos tiene **cuatro** estados, no uno:

| Estado | Qué mostrar |
|---|---|
| Cargando | Un esqueleto con la forma del contenido real, no un texto de "cargando" |
| Vacío | Qué significa que no haya nada y qué puede hacer la persona |
| Error | Qué pasó y cómo reintentar |
| Con datos | El caso feliz |

El estado vacío es el que más se saltea, y el que más se ve en un sistema nuevo: al principio, todo está vacío.
