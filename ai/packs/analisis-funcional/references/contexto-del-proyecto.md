# El contexto de análisis del proyecto

Los procedimientos del pack `analisis-funcional` son iguales para todos los proyectos. Lo que cambia de un proyecto a otro vive en **un solo archivo**, `analisis.md` de `ai/local/`, que es del proyecto y que ninguna actualización de la base toca.

Se carga en cada sesión junto con el resto de `ai/local/`, así que es **corto**: dice dónde está cada cosa, no la copia.

---

## Cuándo se crea

La primera vez que se usa un procedimiento del pack y el archivo no existe. El agente lo arma con lo que encuentra en el repositorio y pregunta solo lo que falta, en una ronda. Lo escribe recién cuando la persona confirma.

Si el proyecto ya tiene esto en otro lado (un `AGENTS.md` de la carpeta de documentación, un archivo de convenciones), el archivo **apunta ahí** en vez de repetirlo: dos copias divergen.

---

## Qué lleva

```markdown
# Análisis funcional — <proyecto>

## Fuentes y precedencia
De mayor a menor. Lo que no está acá sigue el orden por defecto de
evidencia-y-fuentes.
1. <documento> — <dónde está> — <qué manda: todo, un módulo, una etapa>
2. …

## Fichas modelo
El listón de calidad. Una por tipo, si hay.
- Cálculo o configuración: <ruta>
- Flujo con estados: <ruta>
- Integración con un tercero: <ruta>

## Quién decide
| Tema | Decide |
|---|---|
| Alcance y reglas de negocio | <rol> |
| Prioridad | <rol> |
| Arquitectura | <rol> |

## Dónde va cada cosa
- Fichas: requirements.dir (o <ruta> si no hay tablero)
- Decisiones de un requisito: <ruta>/decisiones/<id>.md
- Cambios sobre una ficha: <ruta>/cambios/
- Revisiones y dictámenes: <ruta>/revisiones/
- Fuentes recibidas: <ruta>

## Convenciones
- Versionado de fichas: <sí, con `version:` / no, alcanza con git>
- Formato de entrega además del Markdown: <ninguno / Word / PDF>
- Prefijos de id que no son de requisito: <DEC-, CHG-, …>
```

Las rutas por defecto, si el proyecto no dice otra cosa: las fichas en `requirements.dir` (o `docs/requisitos/` sin tablero), y `decisiones/`, `cambios/`, `revisiones/` y `fuentes/` como subcarpetas de esa misma carpeta.

Esas subcarpetas no rompen el tablero: `check-requirements` solo cuenta como ficha un archivo con `rf:` o `tipo: requisito` en el encabezado. Por eso los documentos del pack que no son fichas **no llevan `rf:`**: un cambio usa `requisito:` para nombrar a qué ficha se refiere.

---

## Qué no va

- El glosario y las reglas de negocio: ya tienen su lugar (`ai/local/`, que arma `project-loader`). Este archivo los usa, no los repite.
- Nombres de personas: van roles. El archivo lo lee cualquiera que abra el repositorio.
- Contenido de las fuentes: van rutas.
