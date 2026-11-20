# Adaptar el tracker GitHub a este proyecto

Guía para que un agente **sin contexto** configure cómo se mueve una tarjeta (un issue) en **este** proyecto usando GitHub, de modo que los eventos de `tracker-events` (rama creada, PR creado, historia completa) funcionen sin suponer nada.

Esto es una **guía, no código**: GitHub permite llevar el estado de un trabajo de varias maneras (etiquetas, un tablero de proyectos, solo abierto/cerrado), y cuál usa **este** equipo es una decisión del proyecto. La base no puede saberlo; sí puede decirte qué buscar, dónde dejarlo y cómo comprobarlo.

Se aplica cuando `tracker.kind` es `github` en `ai-workspace.json`. Con otro valor, no hace falta. Es independiente de `forge.kind`: se puede usar GitHub para los PR y otro tracker para las tarjetas, y al revés.

---

## El problema

El contrato de `tracker-events` pide mover la tarjeta a "En curso" al crear la rama y a "En revisión" al abrir el PR, sin cerrarla nunca. En GitHub eso no tiene una única forma:

| Cómo lleva el estado el equipo | Qué significa "mover" |
|---|---|
| **Etiquetas** (`in progress`, `in review`, ...) | Agregar una y sacar la anterior |
| **Un tablero de proyectos** (GitHub Projects) con un campo de estado | Cambiar el valor de ese campo en el elemento |
| **Solo abierto/cerrado** | No hay estado intermedio: los eventos 2 y 3 solo dejan un comentario |

Si el agente elige solo, mueve cosas que el equipo no mira, o usa una etiqueta que no existe y GitHub la crea con otro nombre.

## Dos incidentes que explican las reglas

1. **El cierre automático.** GitHub cierra un issue cuando un PR mergeado dice "closes #N". El contrato dice que el agente **nunca cierra una tarjeta**: la cierra quien la revisa. Un PR que cierra solo la tarjeta al mergear se salta esa revisión. Por eso la descripción del PR usa una referencia que **no** cierra (`Refs #N`) salvo que el proyecto lo decida distinto y lo deje escrito (`closeOnMerge`).
2. **El estado que no se mueve.** Una tarea quedó "por hacer" con el PR ya mergeado porque la rama se creó a mano y nadie la movió. Si al abrir el PR la tarjeta no está en curso, se pasa primero por "En curso" y después a "En revisión".

---

## Qué tiene que quedar al final

### 1. La configuración, en `ai-workspace.json`

Propuesta de forma (el bloque `tracker.github` es del proyecto; la base solo exige que `kind` sea válido):

```json
"tracker": {
  "kind": "github",
  "github": {
    "repo": "<organización>/<repositorio>",
    "mode": "labels",
    "labels": { "enCurso": "in progress", "enRevision": "in review" },
    "statusOrder": ["in progress", "in review"],
    "closeOnMerge": false,
    "parentLink": "tasklist"
  }
}
```

O, con un tablero de proyectos:

```json
"tracker": {
  "kind": "github",
  "github": {
    "repo": "<organización>/<repositorio>",
    "mode": "project",
    "project": {
      "owner": "<organización o usuario>",
      "number": 3,
      "projectId": "<id del proyecto, medido>",
      "statusFieldId": "<id del campo de estado, medido>",
      "options": { "enCurso": "<id de la opción>", "enRevision": "<id de la opción>" }
    },
    "statusOrder": ["Todo", "In Progress", "In Review", "Done"],
    "closeOnMerge": false,
    "parentLink": "sub-issues"
  }
}
```

| Campo | Qué es |
|---|---|
| `repo` | Dónde viven los issues, `<org>/<repo>`. Si se omite, el del remoto del repositorio |
| `mode` | `labels`, `project` o `none` (solo abierto/cerrado: los eventos dejan un comentario y nada más) |
| `labels` | Con `mode: labels`: la etiqueta de cada evento. **Tienen que existir ya** en el repositorio |
| `project.*` | Con `mode: project`: los ids del tablero. Se miden (paso 3), no se escriben a mano |
| `statusOrder` | Los estados en orden, para la regla "si ya está en el destino o más adelante, no se toca" |
| `closeOnMerge` | `false` (por defecto): el PR referencia el issue sin cerrarlo |
| `parentLink` | Cómo se relaciona una tarea con su historia o épica: `sub-issues` (la relación nativa), `tasklist` (una lista de tareas `- [ ] #N` en el issue padre) o `description` ("Historia: #N") |

### 2. Una regla local, `tracker`, en `ai/local/rules/`

Lo que no cabe en un JSON: por qué el equipo eligió ese modo, qué estados existen pero el agente no usa, y las particularidades (por ejemplo, que el tablero de proyectos pertenece a la organización y no al repositorio, o que ciertas etiquetas las pone una automatización). Es lo que le explica a la próxima persona por qué la configuración es la que es.

---

## Paso a paso

### 1. Verificar el acceso

```bash
gh auth status
gh issue view <un issue cualquiera> --repo <org>/<repo> --json number,state,labels,assignees,title
```

Si `gh` no está instalado o no hay sesión, **no sigas**: decíselo a la persona. Para un tablero de proyectos, el permiso `project` tiene que estar en la sesión (`gh auth refresh -s project`; es una decisión de la persona, no tuya).

### 2. Preguntar cómo lleva el estado el equipo

Con una pregunta concreta, ofreciendo las tres opciones de arriba. No lo deduzcas mirando un par de issues: un equipo puede tener etiquetas viejas que ya nadie usa.

### 3. Medir lo que haga falta, según el modo

**Con etiquetas:**

```bash
gh label list --repo <org>/<repo> --json name,description
```

Confirmar que las dos etiquetas existen **con ese nombre exacto**. Si no existen, no las crees: preguntale a la persona (crear etiquetas es cambiar el repositorio de todo el equipo).

**Con tablero de proyectos:**

```bash
gh project list --owner <org>
gh project field-list <número> --owner <org> --format json     # el id del campo de estado y los de sus opciones
gh project item-list <número> --owner <org> --format json      # el id del elemento de un issue
```

Anotar `projectId`, `statusFieldId` y el id de cada opción (`enCurso`, `enRevision`). Cambiar el estado de un elemento es:

```bash
gh project item-edit --id <id del elemento> --project-id <projectId> --field-id <statusFieldId> --single-select-option-id <id de la opción>
```

### 4. Escribir la configuración

Completar `tracker.github` con lo medido. Ningún `<id>` en blanco.

### 5. Decidir cómo se vincula una tarea con su historia

Para el evento 4 (la historia sigue a sus tareas) el agente necesita saber qué tareas son de qué historia:

- **`sub-issues`:** la relación nativa. Se consulta con `gh api` sobre los sub-issues del padre.
- **`tasklist`:** el issue padre lista a los hijos (`- [ ] #12`). Se lee el cuerpo del padre.
- **`description`:** cada tarea dice "Historia: #N".

Si el proyecto no agrupa tareas bajo historias, el evento 4 no aplica y se omite.

### 6. Documentar en la regla local `tracker`

Una línea por decisión: el modo, el motivo, y la fecha y el issue con el que se midió.

---

## Cómo se ejecuta cada evento (lo que el agente hace después)

Siguiendo las reglas de `tracker-events`:

| Evento | Con etiquetas | Con tablero de proyectos |
|---|---|---|
| 1 · Explorar | `gh issue view <n> --json assignees` y mirar. **Ofrecer** `gh issue edit <n> --add-assignee @me` solo si está libre, y esperar el sí | Igual |
| 2 · Rama creada | `gh issue edit <n> --add-label "<enCurso>"` | `gh project item-edit …` con la opción `enCurso` |
| 3 · PR creado | Sacar `enCurso`, poner `enRevision` (`--remove-label` / `--add-label`) y `gh issue comment <n> --body-file <archivo>` con el PR | `item-edit` con `enRevision` y el mismo comentario |
| 4 · Historia completa | Lo mismo sobre el issue padre, **solo si todos sus hijos** están en revisión o más adelante | Igual |

Antes de cada movimiento: **leer el estado actual** y, si ya está en el destino o más adelante según `statusOrder`, no tocarlo. Después: **releer** para confirmar que quedó como se esperaba; si no, no se dice "movida". El comentario **no lleva atribución de IA** ni credenciales. El PR referencia el issue con `Refs #N` (no `Closes #N`) mientras `closeOnMerge` sea falso.

---

## Cómo sé que lo adapté bien

- [ ] La persona me dijo cómo lleva el equipo el estado y lo escribí tal cual en `mode`.
- [ ] Las etiquetas (o los ids del tablero) **existen y los medí**; no los inventé.
- [ ] Probé el movimiento completo sobre un issue de prueba (creado para esto): sin estado, En curso, En revisión, **releyendo después de cada paso**.
- [ ] Probé que un issue que **ya está** en el destino no se toca.
- [ ] Verifiqué que el PR de prueba **no** cierra el issue al mergear (con `closeOnMerge: false`).
- [ ] El agente no tiene permiso, ni intención, de cerrar issues ni de reasignarlos sin el sí de la persona.
- [ ] La regla local `tracker` dice qué modo se eligió, por qué y con qué issue se midió.

## Cómo verificarlo de punta a punta

Con un issue y una rama de prueba: corré `create-branch` y comprobá que el issue pasa a "En curso" **después** de crear la rama y verificar su upstream; abrí un PR de prueba y comprobá que pasa a "En revisión" con el comentario y que el issue **sigue abierto**. Devolvé el issue de prueba a su estado.

## Qué NO hace esta guía

- No trae etiquetas, ids de tablero ni nombres de organización de ningún proyecto concreto: se miden en el tuyo.
- No crea etiquetas ni tableros: son decisiones del equipo.
- No cierra issues, no los reasigna sin el sí de la persona y no los retrocede: lo fija `tracker-events`.
