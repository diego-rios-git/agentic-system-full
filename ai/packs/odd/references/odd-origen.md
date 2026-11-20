# ODD: de dónde viene, qué se tomó y qué se dejó

Para quien mantiene el pack o lo compara con el original. Un agente que trabaja con ODD no necesita leer esto: le alcanza con los procedimientos.

---

## Origen

**Organic Driven Development** es la metodología que Alan Buscaglia (Gentleman Programming) publicó en **gentle-ai v3.0.0** y convirtió en el único flujo en **v4.0.0**, donde retiró SDD y sus comandos `sdd-*`. gentle-ai es un configurador en Go que instala el mismo protocolo en Claude Code, OpenCode, Codex, Cursor, Gemini, Kiro, Pi y otros.

Fuentes leídas para este pack, con el repositorio en `main` al 03/11/2026 (commit `ab08313`). Base de las rutas: https://github.com/Gentleman-Programming/gentle-ai/blob/ab0831349c3c8a2900bec426d80e340672be094b

- El protocolo canónico, que gentle-ai renderiza para cada agente: `routing.go` en el paquete `internal/components/agentguidance`, y su versión renderizada `routing-pi.md` en el `testdata` de ese paquete.
- Las secciones compartidas del orquestador: `odd-orchestrator-sections.md` en `internal/assets/skills/_shared`.
- Los agentes genéricos de OpenCode: `gentle-ai-worker`, `gentle-ai-verify` y `gentle-ai-explore`, en `internal/assets/opencode/agents`.
- `intended-usage.md` y la sección ODD de `usage.md`, en `docs`.
- Los documentos de funcionalidad reales del repositorio, en `odd/tasks`: en especial `odd-spec-by-reference.md`, `task-size-canon.md`, `odd-spend-proportionality.md` y `remove-sdd-odd-only-main.md`.

---

## Qué es, en una frase

Un flujo que escala solo: lo simple se hace directo, lo incierto se investiga, lo grande arma su documento de tareas, lo crítico se verifica. Review y TDD quedan como interruptores independientes.

## En qué se diferencia de SDD

| | SDD (OpenSpec) | ODD |
|---|---|---|
| Cuándo hay artefactos | Siempre: propuesta, diseño, escenarios, tareas | Solo en trabajo grande, y es **un** documento |
| Qué decide el tamaño | La cantidad de tareas (disciplina de alcance) | La **prueba de retomar**: ¿se termina con el pedido y el diff? |
| Cómo se escribe el requisito | Reescrito en el diseño, con escenarios WHEN/THEN | **Textual**: las specs citan las palabras, los mensajes y los ejemplos de la persona sin resumir |
| Un cambio de requisito | Se regenera la propuesta o el diseño | Se agrega a la bitácora, se reescribe **solo** la spec afectada y se reabre **solo** su tarea |
| Traspaso a un subagente | El agente lee el change | **Por referencia**: documento, tarea y specs, nunca un resumen |
| Delegación | Un agente del ciclo por etapa | Directo por defecto; se delega solo por un disparador con nombre |
| Verificación | Revisión por etapa | Proporcional al riesgo; un verificador independiente solo si se nombra un ítem de riesgo alto |
| Correcciones | Hasta que quede limpio | Una tanda de corrección y un rechequeo acotado; si sigue abierto, "Necesita tu decisión" |

En palabras del autor, sobre el cambio de requisitos: *"A diferencia de SDD, un cambio no rehace todo, solo rehace esa spec y la tarea asociada."*

---

## Qué se tomó tal cual

- Los siete pasos del protocolo (autorizar, explorar, resolver la incertidumbre, clasificar, registrar, implementar, cerrar).
- El tamaño por tres criterios y la prueba de retomar. Lo que no decide el tamaño.
- La lista de riesgo alto (seis ítems) y la línea de riesgo, incluido el chequeo del código compartido antes de escribir `ninguno`.
- Los disparadores, con la regla de que ninguno está prendido por defecto y que, cumplido, no es opcional.
- El formato del documento: encabezado, `## Specs` textuales, `## Tasks` de una línea, `## Log` al final con `L1` textual.
- El traspaso por referencia y el verificador que devuelve un veredicto por `S#`.
- La disciplina de tests: un rojo por regla, uno por comportamiento existente tocado, ninguno más; el chequeo diferencial contra la base; el borrador fuera del árbol de trabajo.
- La verificación proporcional, sus límites de corrección y la definición de bloqueo y de advertencia.
- La continuidad de lo autorizado y "Necesita tu decisión" como parada válida.

## Qué se adaptó

| En gentle-ai | Acá | Por qué |
|---|---|---|
| Commits de unidad de trabajo automáticos en la rama | Se **sugieren** los cortes; commitea `git-commit-workflow` con pedido explícito, o `trabajo-autonomo` si se declaró | La base no commitea sin pedido. Es una regla del núcleo y un pack no la cambia |
| Los documentos quedan en `odd/tasks/` para siempre | Al cerrar, se mueven a `odd/tasks/archive/AAAA-MM-DD-<nombre>.md` | El tablero de requisitos deriva el estado de la fecha de archivo. Sin archivo, ningún requisito llegaría a `cerrado` |
| Espejo obligatorio en Engram | Opcional: si el harness tiene memoria persistente | La base no depende de un harness ni de una herramienta de memoria |
| Artefactos técnicos en inglés por defecto | En el idioma del proyecto | La base es en español. Las specs citan a la persona en su idioma, que es lo que el original también exige |
| Ejecución en paralelo en el mismo árbol, con superficies disjuntas | Cada unidad en su slot | La base ya resolvió el paralelismo con `worktree-slots` |
| Etiquetas `S#` sueltas | `S<n>. <título corto>: <texto>` | El gate de cobertura de escenarios necesita un título que un test pueda nombrar. El texto textual va después de los dos puntos |

## Qué se dejó afuera

- **Receipt-Driven Development (RDD)** y el binario `gentle-ai review assess`: la evaluación nativa de riesgo, el consentimiento por candidato, los recibos y los lentes de revisión son de gentle-ai. El equivalente en la base es `pr-review`, y la decisión de correrlo sigue siendo de la persona.
- **Gentle Shell**: la herramienta `gentle_odd_phase` y la etiqueta de fase en el prompt.
- **El registro de skills** de gentle-ai (`skill-registry.md`, en `.atl`): la base proyecta sus skills con `consolidate-skills`.
- **Las estrategias de entrega** (`ask-on-risk`, `auto-chain`, PRs encadenados) y el presupuesto de 400 líneas por PR: el PR lo arma `cerrar-ticket`.
- **El bloque `## Key Learnings`** que alimenta la captura pasiva de Engram.

---

## Cuándo elegir uno u otro

| Elegí `openspec` si... | Elegí `odd` si... |
|---|---|
| El diseño lo aprueba alguien antes de implementar, y ese paso es parte del proceso | Quien pide y quien implementa conversan directo, y el diseño se acuerda en el pedido |
| Un consumidor (otro equipo, otro repositorio) necesita el contrato escrito antes de empezar | La mayoría de las tareas son chicas, y la ceremonia de todo cambio se está salteando |
| Querés la especificación permanente del sistema (`openspec/specs`) | Te alcanza con el historial de documentos archivados como registro |

---

## Preguntas abiertas

- **Sin corrida real todavía.** El pack se armó leyendo el original; falta una tarea grande de punta a punta en un proyecto para ajustar los umbrales (tanda de lectura, 100 líneas por unidad, 150k de contexto).
- **El título corto de cada spec** es una convención de este pack. Si molesta, la alternativa es que el gate empareje por `S#` en el nombre del test, lo que pide cambiar el núcleo.
- **El original sigue moviéndose** (varios commits por día en el protocolo). Comparar contra `routing.go` antes de actualizar este pack.
