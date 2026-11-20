# Trabajo autónomo

Recorre las tareas pendientes de un **plan**, una tras otra, **sin parar a preguntar**, cuando la persona lo pidió expresamente: trabaja sola hasta terminar lo planificado, y lo que no pueda resolver lo anota para cuando ella vuelva.

Este procedimiento encadena. Cada tarea adentro se hace con `ciclo-de-tarea`; acá están el bucle, la revisión sin contexto y qué hacer cuando algo trabaría el avance.

**Solo corre con pedido expreso.** Que exista un plan no lo habilita: la autonomía es una decisión de la persona, y la toma explícitamente ("trabajá sola con el plan", o lanzando `scripts/trabajo-por-sesion.js`).

---

## De dónde sale todo (`autonomous` en `ai-workspace.json`)

| Dato | Campo | Si falta |
|---|---|---|
| El plan | `autonomous.plan` | No hay qué recorrer: se pregunta cuál es |
| Cómo se ve el encabezado de una tarea | `autonomous.taskHeading` (expresión regular: grupo 1 = id, grupo 2 = título) | Se pregunta |
| Qué marca lleva una tarea cerrada | `autonomous.doneMarker` | `✅` |
| La bitácora de decisiones | `autonomous.logbook` | Se crea `bitacora-autonoma.md` junto al plan y se dice |
| ¿Autorizó commit y push al cerrar cada tarea? | `autonomous.commit` (`true`) o el pedido | **No se commitea**: se deja el trabajo en el árbol y se dice |

---

## El bucle

```
┌─→ 1. Leer          el plan, el tablero y la bitácora
│   2. Hacer         la tarea con ciclo-de-tarea: propuesta, tests en rojo, implementación, gates
│   3. Revisar       agentes sin contexto (y de seguridad si toca datos o sesión)
│   4. Corregir      lo que confirme la revisión, y probar de punta a punta
│   5. Cerrar        automejora, archivar, documentación, gates y tests en verde, y commit/push si está autorizado
└── 6. Seguir        con la próxima tarea
```

### 1. Leer

Al empezar **cada** tarea, no solo la primera:

- La sección de la tarea en el plan, y su tabla de decisiones de la persona, si la tiene.
- El estado del plan: qué falta y por dónde se retoma.
- El tablero (`node scripts/check-requirements.js --tablero`) y la ficha del requisito que construye la tarea (`ciclo-de-tarea`, paso 0). Un requisito en `implementacion` o `testing` que no es el de esta tarea es trabajo que quedó a medias: se anota en la bitácora antes de empezar otro.
- La bitácora: una decisión tomada en una tarea anterior puede tocar esta.
- Las reglas de `ai/local/` que la tarea toque.

Si el plan y el código no coinciden (una ruta que no existe, un campo con otro nombre), **gana el código**: se ajusta la propuesta y se anota en la bitácora.

### 2. Hacer la tarea

`ciclo-de-tarea`, pasos 0 a 4. Con dos diferencias:

- **Donde `ciclo-de-tarea` dice "parar y preguntar", acá se decide y se anota** (ver "Cuando algo trabaría el avance").
- Si la tarea supera el umbral de `spec-scope-discipline`, se parte **en su límite natural** sin preguntar, y la parte que queda pasa a ser la tarea siguiente del plan.

### 3. Revisar sin contexto

Lanzar los agentes de revisión (`qa-agent` y `code-reviewer`, como en `pr-review`) pasándoles **solo**: los repositorios, el nombre del change, la sección de la tarea en el plan y el commit desde el que comparar. **Nada de lo que se pensó al hacerla**: su valor es justamente que no lo saben. Si les llega una explicación de lo que se hizo o por qué, la ignoran: revisan contra el diseño y las reglas, no contra la intención.

Si la tarea toca sesión, datos de personas, cifrado o algo que se expone sin sesión, lanzar en paralelo `security-auditor` con el mismo pedido.

Corren sobre la **salida de los gates ya resuelta** (una sola vez; `pr-review`) y devuelven los hallazgos en el formato verificable. Lo que citan una línea inexistente se descarta mecánicamente.

### 4. Corregir y probar

- Cada hallazgo **se verifica contra el código antes de corregirlo**: que la línea exista, que no sea una decisión del diseño, que el archivo sea el que se usa. Uno falso se descarta y se anota por qué en el resumen de la tarea; uno real se corrige **con su escenario y su test**, visto en rojo antes de arreglarlo.
- Después, la prueba de punta a punta (`ciclo-de-tarea`, paso 5). Si falla, se corrige y se vuelve a correr la revisión del punto que cambió.
- Un hallazgo que no se corrige (porque es de otra tarea o requiere una decisión) va a la bitácora: no se pierde.

### 5. Cerrar

En este orden:

1. `ciclo-de-tarea` paso 6, **automejora**: qué error cometí, si se puede repetir, y si es un gate (`gate-from-finding`) o un candidato anotado.
2. **Si un procedimiento o un agente guió mal**, se corrige su fuente en `ai/` y se regeneran los punteros con `node scripts/consolidate-skills.js --wrappers`. Si es una trampa del entorno, va a las reglas del proyecto en `ai/local/`.
3. `spec-archive`: el change a la especificación permanente.
4. Documentación: la ficha del requisito (estado, lo que quedó afuera), el plan (la tarea cerrada y lo que salió distinto) y, si se cerró una regla, `ai/local/`.
5. `node scripts/run-gates.js --all` y los tests de cada repositorio tocado: **en verde antes de cualquier commit**.
6. **Commit y push**, **solo si está autorizado** (`autonomous.commit` o el pedido), con `git-commit-workflow`: un commit por repositorio tocado, más uno en la raíz para la documentación; sin atribución de IA; upstream verificado antes del push. Si no está autorizado, el trabajo queda en el árbol y la bitácora lo dice.

### 6. Seguir

Volver al paso 1 con la próxima tarea. **No se para entre tareas.**

**Salvo en modo una tarea por sesión**: si el pedido dice "solo la tarea X" o "una tarea por sesión", se hace esa, se la marca cerrada en el plan, se deja el plan apuntando a la siguiente, y se termina. La próxima la empieza una sesión nueva, de cero. Así lo corre `node scripts/trabajo-por-sesion.js`, que abre una sesión por tarea y **frena si la tarea no quedó cerrada en el plan**.

**Por qué una sesión por tarea:** el contexto de una sesión larga se llena de lo ya pasado, y una suposición equivocada de la tarea tres sigue viva en la ocho. Cada sesión empieza de cero: lo que necesita saber está en el plan, el tablero y la bitácora, que es donde tiene que estar.

---

## Cuando algo trabaría el avance

**No se frena.** Se decide, se anota y se sigue. Todo va a la bitácora, que es lo primero que la persona lee al volver.

| Situación | Qué se hace |
|---|---|
| Una decisión de negocio que el plan no respondió | Elegir **la opción más conservadora y reversible**: la que guarda menos datos, no cobra, no expone nada a terceros y se puede deshacer sin migrar. Anotarla como **decisión a revisar**, con las alternativas |
| Una duda que no cambia lo que se construye | Anotarla como **duda abierta** y seguir |
| Falta una credencial o una cuenta | Hacer todo lo que no la necesita, dejar lo demás preparado y probado con lo que haya, y anotarlo como **pendiente de la persona** |
| Una contradicción entre documentos | Gana `ai/local/`; si es entre el plan y el código, gana el código. Anotarla y corregir el documento que perdió |
| Un paso que falla tres veces con el mismo síntoma | Probar por otro camino, anotar la **complicación** con el síntoma exacto, y seguir |
| Un gasto que se acerca al tope que fijó la persona | No seguir gastando en eso; anotar cuánto se gastó y qué quedó sin hacer |

**Lo que nunca se hace para no frenar:** saltear tests, aflojar un test para que pase, desactivar un gate, commitear en rojo, forzar un push, inventar una credencial, o marcar como hecho algo que no se probó. Si una tarea no se puede terminar, se commitea lo que está verde (si hay autorización), se anota qué falta, y se sigue con la próxima **solo si no depende de esta**.

**Las decisiones del tablero siguen siendo de la persona.** Autonomía no es poder para marcar un requisito `validado` o `descartado`: eso no cambia (`requisitos`).

---

## Cuando el plan no tiene más tareas

Lo que sigue sale del tablero: los requisitos en `validado`, por id. Esos ya los decidió la persona. Los que están en `pendiente` o `analisis` **no se toman**: no están decididos, y empezar uno es decidir por ella.

Un requisito `validado` que necesita a la persona para avanzar (una cuenta, una prueba con un dispositivo suyo, publicar) se saltea y se nombra en el resumen. Si no queda ninguno, se termina y se dice.

## Al terminar todo el plan

- Tablero y plan al día, y `check-requirements.js` sin hallazgos.
- Al principio de la bitácora, un **resumen para la persona**: qué se terminó, qué decidí yo y conviene revisar, qué dudas quedan, qué necesita de ella.
- Si la sesión tiene memoria persistente, dejar el resumen de la sesión.
