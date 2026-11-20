# code-review/ — registro de prompts

Prompts que cargan los revisores lanzados por `ai/core/procedures/pr-review.md`. Hay dos, **parametrizados por stack**: lo que es de un stack concreto (qué mirar en un controlador, en un componente, en una consulta) no está incrustado acá; lo aporta el pack del repositorio revisado.

| Archivo | Cubre | Lo carga |
|---|---|---|
| `review-tecnico.md` | Auditoría técnica de un repositorio: corrección, arquitectura, rendimiento, mantenibilidad, tests | `code-reviewer`, y `qa-agent` en su parte técnica |
| `review-contrato-diseno.md` | El código contra el diseño acordado y los criterios de aceptación; y, si el cambio cruza repositorios, el contrato entre el que expone y el que consume | `qa-agent` |

Un revisor de seguridad usa su propia lista (`security-auditor`); no hay prompt aparte.

---

## Vocabulario único: modos A, S y C

Todos los prompts, procedimientos y agentes hablan de los mismos tres modos (definición completa en `pr-review.md`). Si agregás un prompt, no inventes otro nombre.

| Modo | Qué se revisa | Cómo llega al prompt |
|---|---|---|
| **A** | La rama actual en la principal, sin checkout | Sin `REVIEW_ROOT`. El diff real es `base...HEAD` + working tree + archivos sin trackear |
| **S** | Un slot de implementación, en su lugar | `REVIEW_ROOT: <ruta>` como **primera línea** del prompt |
| **C** | La rama de otra persona, en el slot `review` | `REVIEW_ROOT: <ruta>` como **primera línea** del prompt |

**`REVIEW_ROOT` es obligatoria en S y C.** Los subagentes no heredan el directorio de trabajo; sin esa línea leen la rama de la principal y citan líneas que no son las del cambio. Fuente: `ai/core/rules/aislamiento-de-rama.md`.

---

## Parámetros de un prompt

Cada prompt declara arriba sus parámetros; el orquestador los completa al lanzar el subagente.

| Parámetro | Qué es |
|---|---|
| `REPO` | Nombre del repositorio en `ai-workspace.json` |
| `MODO` | `A`, `S` o `C` |
| `BASE` | `repos[].baseBranch` |
| `STACK` | Las listas que aportan los packs del repositorio (`repos[].packs`): sus procedimientos y reglas, y, si el pack publica uno, `ai/packs/<pack>/prompts/code-review/<prompt>.md` |
| `GATES` | El bloque `## Gates deterministas`, pegado textual |
| `DISENO` | El diseño o la especificación del cambio, si existe |

### Cómo se parametriza por stack

El prompt pide el checklist del stack con una referencia, no con una copia:

1. Leer `repos[REPO].packs` en `ai-workspace.json`.
2. Por cada pack: sus reglas (`ai/packs/<pack>/rules/`) y sus procedimientos (`ai/packs/<pack>/procedures/`) son el checklist de ese stack.
3. Si el pack tiene `prompts/code-review/<prompt>.md`, se agrega a la lista.
4. Lo propio del proyecto va en `ai/local/rules/` y `ai/local/prompts/code-review/`.

Un pack nuevo aporta su stack **sin tocar** estos prompts: es la razón por la que no se escribió "NestJS" ni "Next" en ninguno.

---

## Reglas transversales a todo review

Aplican a los dos prompts.

### Si la revisión parte de un reporte externo

Un reporte de una persona, de otra herramienta o de otro agente aporta valor real: no es sospechoso por venir de afuera. Lo que corresponde es aplicarle el mismo rigor que a un hallazgo propio.

1. **Verificar que las citas de línea sean físicamente posibles.** Comparar `wc -l <archivo>` contra el número de línea citado. Si lo excede, la cita está fabricada: es la única señal objetiva de fabricación.
2. **Verificar cada punto contra el código real**, sea sospechoso o no. Dar crédito explícito a lo que esté bien señalado y marcar como refutado, con evidencia, lo que no se sostenga.
3. **Nunca copiar una línea o una conclusión sin haberla re-derivado** contra el código de esta rama.

### Antes de listar algo como hallazgo

Leer el diseño o la especificación del cambio. **Un trade-off ya decidido y documentado no es un hallazgo.** Reportarlo genera trabajo de refutación y desgasta la credibilidad de la revisión.

### Los gates corren antes de la revisión manual

El orquestador corre `node scripts/run-gates.js` una vez y pega el resultado. La revisión manual se limita a lo que los scripts no cubren. Si el prompt trae el bloque `## Gates deterministas`, **no se vuelven a correr**: repetirlos es gasto sin información nueva.

### Un check que no terminó es "sin verificar"

Si el prompt dice que los checks (tipos, lint, tests) están en curso, no se corren: los integra el orquestador. Nada que no se ejecutó se reporta como verde.

### El informe cierra con el bloque verificable

Un JSON con `file`, `line`, `rule`, `severity`, `summary`, `evidence` (la línea textual). Lo verifica `scripts/verify-findings.js` antes de que llegue a la persona.

---

## Cómo agregar un prompt

1. Un caso real que lo justifique (`ai/core/rules/autoria-de-activos.md`).
2. Parámetros arriba, vocabulario A/S/C, y la línea `REVIEW_ROOT` en el encabezado.
3. Nada de un stack ni de un gestor de tickets o de PRs concreto: eso va en el pack.
4. Registrarlo en la tabla de este archivo y en el manifiesto.
