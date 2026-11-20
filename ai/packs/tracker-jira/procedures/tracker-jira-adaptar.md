# Adaptar el tracker Jira a este proyecto

Guía para que un agente **sin contexto** configure cómo se mueve una tarjeta de Jira en **este** proyecto, de modo que los eventos de `tracker-events` (rama creada, PR creado, historia completa) funcionen sin que nadie suponga un id.

Esto es una **guía, no código**: lo que cambia de un Jira a otro (los flujos, los estados, los ids de transición) es de cada proyecto, y la base no puede saberlo. Lo que sí puede es decirte qué buscar, dónde dejarlo y cómo comprobar que quedó bien.

Se aplica cuando `tracker.kind` es `jira` en `ai-workspace.json`. Con otro valor, no hace falta.

---

## El problema

El contrato de `tracker-events` pide mover tarjetas al empezar y al abrir el PR. Para mover una tarjeta hace falta, en Jira, **el id de una transición**: no se le dice a Jira "pasala a En curso", se le dice "aplicá la transición número N", y N es un dato de **ese flujo de trabajo**.

## El incidente que explica la forma de la configuración

Una historia quedó en un estado equivocado porque el mismo número de transición lleva a **estados distintos según el tipo de tarjeta**: en las tareas, ese id significa "pasar a En curso"; en las historias, es un estado que el agente nunca usa. La tarjeta quedó ahí hasta que alguien la corrigió a mano. De ahí tres reglas:

1. Los ids van **por tipo de tarjeta**, nunca uno solo para todo el proyecto.
2. Los ids **no se suponen**: se miden contra una tarjeta real de cada tipo.
3. Una transición solo existe **desde ciertos estados**: la que lleva a "En revisión" suele salir únicamente de "En curso". Si la tarjeta sigue "por hacer", hay que pasar primero por "En curso" (otro incidente: tareas que quedaron "por hacer" con el PR ya mergeado).

---

## Qué tiene que quedar al final

Dos cosas, en dos lugares:

### 1. La configuración, en `ai-workspace.json`

Una propuesta de forma (el bloque `tracker.jira` es del proyecto; la base solo exige que `kind` sea válido):

```json
"tracker": {
  "kind": "jira",
  "jira": {
    "tool": "mcp",
    "site": "<identificador del sitio o URL base que pide tu herramienta>",
    "projectKey": "ABC",
    "issueTypes": {
      "Tarea": {
        "statusOrder": ["Por hacer", "En curso", "En revisión", "Finalizada"],
        "transitions": { "enCurso": "<id>", "enRevision": "<id>" }
      },
      "Historia": {
        "statusOrder": ["Por hacer", "En curso", "En revisión", "Finalizada"],
        "transitions": { "enCurso": "<id>", "enRevision": "<id>" }
      }
    },
    "storyLink": { "type": "issueLink", "linkType": "Relates" }
  }
}
```

| Campo | Qué es |
|---|---|
| `tool` | Cómo se habla con Jira desde la sesión: `mcp` (el servidor MCP del proyecto), `cli` (una herramienta de línea de comandos) o `rest` (la API directamente) |
| `site` | Lo que tu herramienta pide para identificar el sitio. Va **acá**, no en ningún procedimiento |
| `projectKey` | Debe coincidir con `project.ticketPrefix` |
| `issueTypes.<Tipo>.statusOrder` | Los estados del flujo **de ese tipo**, en orden. Sirve para la regla "si ya está en el destino o más adelante, no se toca" |
| `issueTypes.<Tipo>.transitions.enCurso` / `enRevision` | El id de la transición que lleva a ese estado, **para ese tipo**. Los dos eventos que el agente ejecuta |
| `storyLink` | Cómo se relaciona una tarea con su historia: `issueLink` (vínculo nativo, con su tipo) o `description` (la convención "Historia: XXX" escrita en la descripción) |

Los nombres de los tipos son **los que muestra tu Jira** (en español, en inglés, o los que tu equipo definió). No se traducen ni se normalizan.

### 2. Una regla local, `tracker`, en `ai/local/rules/`

Lo que no cabe en un JSON: la **fecha y la tarjeta con la que se midió cada id**, los estados que existen pero el agente no usa y por qué (espera, bloqueado, pendiente de integración...), si el proyecto tiene tipos de tarjeta raros, y las particularidades de la herramienta (por ejemplo, que el servidor MCP tarda minutos en responder a veces). Es lo que le explica a la próxima persona por qué un id es el que es.

---

## Paso a paso

### 1. Verificar que podés hablar con Jira

Con la herramienta que declaraste en `tool`: leé una tarjeta cualquiera del proyecto (clave, tipo, estado, responsable). Si falla, **no sigas**: sin acceso no hay nada que medir. Decíselo a la persona.

### 2. Listar los tipos de tarjeta que el agente va a mover

Normalmente tarea, historia y, a veces, defecto o épica. Pregunta a la persona cuáles trabaja el equipo. Cada tipo que el agente pueda mover necesita su bloque.

### 3. Medir los ids, tipo por tipo

Para **cada tipo**, sobre **una tarjeta de prueba** (una que la persona te indique y cree para esto; nunca la de otra persona):

1. Dejarla en el estado inicial del flujo ("por hacer").
2. Pedirle a Jira las transiciones disponibles **desde ese estado** (con MCP, la herramienta que lista transiciones de una tarjeta; con REST, `GET /rest/api/3/issue/<clave>/transitions`; con un CLI, su subcomando equivalente).
3. Anotar, por cada una: `id`, nombre de la transición y **estado al que lleva**.
4. Aplicar la que lleva a "En curso", releer el estado, y repetir el listado **desde ahí**: ahora aparece la que lleva a "En revisión". Anotarla.
5. Volver la tarjeta de prueba al estado inicial si el flujo lo permite, o avisar que quedó movida.

Con eso tenés, por tipo, `enCurso` y `enRevision`, **y** el orden de los estados para `statusOrder`.

> No copies ids de un tipo a otro "porque se parecen": ese es el incidente. Si dos tipos comparten flujo, tenés que comprobarlo midiendo los dos.

### 4. Escribir la configuración

Completar `tracker.jira` con lo medido. No dejes `<id>` sin reemplazar: un id en blanco hace que el agente **no mueva** la tarjeta y lo diga, lo cual es seguro pero inútil.

### 5. Decidir cómo se vincula una tarea con su historia

Para el evento 4 (la historia sigue a sus tareas), el agente necesita saber qué tareas son de qué historia. Hay dos formas, y el proyecto elige una:

- **Vínculo nativo** (`issueLink`): al crear las tareas de una historia, se vinculan con ella (tipo `Relates`, o el que el equipo use). Se navega en los dos sentidos.
- **Convención en la descripción** (`description`): cada tarea dice "Historia: XXX". Sirve cuando las tareas cuelgan de una épica y Jira no las ve como hijas de la historia.

Si el proyecto no tiene historias que agrupen tareas, se omite este paso y el evento 4 no aplica.

### 6. Documentar en la regla local `tracker`

Escribí lo que no cabe en el JSON (ver arriba). Una línea por tipo: "Tarea: ids medidos con la tarjeta ABC-123 el <fecha>".

---

## Cómo se mueve una tarjeta (lo que el agente hace después, con esta configuración)

Con la herramienta que declaraste, y siguiendo las reglas de `tracker-events`:

1. **Leer** el tipo y el estado actual de la tarjeta (solo esos campos: es más barato).
2. Si ya está en el estado destino **o más adelante** según `statusOrder`: **no tocar**, avisar y seguir.
3. Tomar el id de `issueTypes.<tipo>.transitions` y aplicarlo. **Sin listar antes**: cuesta una llamada de más y siempre devuelve lo mismo. Se lista solo **si la transición falla**.
4. **Leer la respuesta** y confirmar que la tarjeta quedó en el estado esperado. Si no, no se dice "movida".
5. Si el tipo no está en la configuración: no suponer. Listar sus transiciones, **preguntar** y pedir que se agregue el bloque.

Operaciones auxiliares (según tu `tool`): comentar (con REST, `POST /rest/api/3/issue/<clave>/comment`), asignar (`PUT /rest/api/3/issue/<clave>/assignee`; solo con el sí de la persona), vincular (`POST /rest/api/3/issueLink`). El comentario **no lleva atribución de IA** y no incluye credenciales.

---

## Cómo sé que lo adapté bien

- [ ] Cada tipo de tarjeta que el agente mueve tiene su propio bloque en `issueTypes`, con ids **medidos**, no copiados.
- [ ] Ningún `<id>` quedó sin reemplazar.
- [ ] `projectKey` coincide con `project.ticketPrefix`.
- [ ] Probé el movimiento completo sobre una tarjeta de prueba: por hacer, En curso, En revisión, **leyendo el estado después de cada paso**.
- [ ] Probé el camino que **debe fallar**: intentar la transición a "En revisión" desde "por hacer" y ver que Jira la rechaza. Si la acepta, el flujo es otro y `statusOrder` o los ids están mal.
- [ ] Probé que una tarjeta que **ya está** en el destino no se toca.
- [ ] La regla local `tracker` dice con qué tarjeta y en qué fecha se midió cada id.
- [ ] La herramienta falla de forma conocida (tiempo de espera, sesión vencida) y la regla local dice que **eso no bloquea el trabajo**: se reintenta una vez y se sigue.

## Cómo verificarlo de punta a punta

Pedile a la persona una rama de prueba y una tarjeta de prueba, y corré `create-branch` sobre ella: tiene que terminar con la tarjeta en "En curso", **después** de crear la rama y de verificar su upstream. Abrí un PR de prueba y comprobá que la tarjeta pasa a "En revisión" con el comentario. Después, devolvé la tarjeta de prueba a su estado.

## Qué NO hace esta guía

- No trae ids, identificadores de sitio ni nombres de estado de ningún proyecto concreto: se miden en el tuyo.
- No cierra tarjetas, no las reasigna y no las retrocede: eso lo fija `tracker-events` y aplica a Jira como a cualquier otro tracker.
- No decide qué estados del flujo del equipo "cuentan" como en revisión: lo decide la persona, y queda en `statusOrder` y en la regla local.
