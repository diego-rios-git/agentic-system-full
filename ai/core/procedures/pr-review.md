# PR Review

Orquesta la revisión completa de un cambio: corre las verificaciones automáticas **una sola vez**, y lanza los agentes de revisión en paralelo con ese resultado ya resuelto.

Funciona sobre cualquier repositorio declarado en `ai-workspace.json`, y sobre varios a la vez cuando el cambio los cruza.

---

## Por qué existe

Sin orquestador, cada agente corre los gates y las suites por su cuenta. Con tres agentes en paralelo eso es el mismo barrido determinista repetido tres veces, pagado con tokens de razonamiento en cada uno, y suites completas multiplicadas.

Medido en una máquina de desarrollo chica: una suite de tests sin tope de procesos levanta decenas de procesos y varios GB para revisar una fracción de las pruebas; con cuatro o cinco agentes repitiéndolo son **60 o más procesos**, la máquina entra en swap y la revisión sale más lenta que hacerla a mano.

El orquestador lo corre una vez y les pasa el resultado. Cada agente gasta tokens solo en lo que ningún script puede decidir.

---

## Los tres modos

Un solo vocabulario en todo el sistema: **A, S, C**.

| Modo | Qué se revisa | Dónde se lee | Revisores | Informe |
|---|---|---|---|---|
| **A** (default) | La rama actual, en la principal | El repositorio principal, **sin checkout** | Sí | Al chat |
| **S** | Un slot de implementación, **en su lugar** | `<slot>/<repo>`, incluido lo no commiteado. Solo lectura | Solo si el cambio no va a tener review completo en la principal | Al chat |
| **C** | La rama de **otra persona** | El slot `review` (desprendido, reusado si está limpio) | Sí | **A un archivo** |

Cómo se elige: si te pasan un slot → **S**. Si te pasan una rama explícita (que no es la actual) → **C**. Si no → **A**.

### Modo A — la rama actual

La persona ya está parada en la rama. **No se hace `git checkout`.**

El diff real **no es solo `base...HEAD`**. El flujo normal es implementar → revisar → corregir → commitear, así que lo habitual es que la rama todavía no tenga commits propios.

> **Incidente.** Se revisó antes de commitear: `base...HEAD` salió **vacío**, el agente no tenía nada que mirar y aprobó nada. Una revisión que no vio el cambio se lee igual que una que no encontró nada.

El diff real de la revisión es la suma de tres cosas, y se le dice así a cada subagente en su prompt:

```bash
git -C <repo> diff <base>...HEAD       # lo commiteado en la rama
git -C <repo> diff HEAD                # lo modificado sin commitear (staged y no)
git -C <repo> status --short           # las líneas "??": archivos nuevos sin trackear
```

`<base>` es `repos[].baseBranch`. Si la base local está desactualizada respecto del remoto, decirlo: un diff contra una base vieja mete en la revisión cambios que no son de la rama.

Los gates leen archivos, así que ven lo no commiteado. Lo que sale del diff de la rama (por ejemplo la detección de cambios de especificación) puede no verlo: pasar `--change <id>` o tratar ese gate como *sin verificar*.

### Modo S — un slot de implementación, en su lugar

Un chequeo chico antes de promover: `--from <slot>`. No se abre nada, no se hace checkout; el slot se lee **tal como está, incluido lo no commiteado**. Solo lectura.

La raíz de cada repositorio es `<raíz>/<worktrees.dir>/<slot>/<repo.name>/` (la resuelve `scripts/lib/worktree-paths.js`; nadie escribe esa ruta a mano). Si el slot tiene un solo repositorio, se usa `--repo`, no `--all`.

**Un ticket, un review con revisores.** Si el cambio va a pasar por la principal con su review completo (modo A, después de `promote`), en el slot alcanzan los dos comandos del flujo —checks y gates—, **sin lanzar revisores**.

> **Incidente.** Un mismo cambio tuvo un review chico en el slot (2 revisores) y otro completo en la principal (5): el segundo repitió casi todo lo del primero, y lo nuevo que encontró salió de agentes sin contexto, no del review chico.

Si igual se hizo un review con revisores en el slot (el cambio no va a pasar por la principal, o la persona lo pidió), el de la principal se acota a lo que cambió después: `git diff <commit revisado>..HEAD` más la integración con la base, y se dice en el prompt de cada revisor qué ya se revisó.

### Modo C — la rama de otra persona

```bash
node scripts/manage-worktree.js open --slot review --repo <repo> --branch <rama>
# o --all si la rama existe en todos los repositorios del cambio
```

El slot `review` queda **desprendido** (detached) en esa rama y se reusa si está limpio. Es el único lugar donde se revisa una rama ajena: **nunca** `git checkout` en la principal, **nunca** un worktree efímero.

El informe va **a un archivo**, no al chat. La carpeta de salida la define el proyecto (su configuración o una regla en `ai/local/rules/`); **no se inventa**. Si el proyecto no declara ninguna, preguntar a la persona dónde quiere el archivo antes de escribirlo.

El slot se limpia solo cuando la persona lo pide.

---

## Paso 1: resolver el alcance

Leer `ai-workspace.json`. Determinar:

- **Qué repositorios** toca el cambio. Si la persona no lo dijo, mirar cuáles tienen commits o cambios por delante de su rama base.
- **Qué modo** (A, S o C) y, si es S o C, la raíz de cada repositorio.
- **Si hay un diseño o especificación del cambio**: es el contrato contra el que se audita.

Confirmar la rama y el estado de partida, para acreditar al final que no se mutó nada:

```bash
git -C <raíz> rev-parse --abbrev-ref HEAD
git -C <raíz> status --porcelain
```

Las reglas de aislamiento están en `ai/core/rules/aislamiento-de-rama.md`.

---

## Paso 2: checks y gates, **una vez cada uno**

### Checks (tipos, lint, tests)

```bash
node scripts/run-checks.js --repo <repo> [--from <slot>]
# o --all; --scope full fuerza la suite entera; por defecto se acotan a lo que toca el diff
```

Un solo comando por repositorio, con tope de procesos. **Lanzarlo al principio, en segundo plano**, con la salida a un archivo:

```bash
node scripts/run-checks.js --repo <repo> > salida-checks.txt 2>&1
```

- **Nunca `comando | tail -N`.** El estado de salida de un pipeline es el del último comando: `tail` devuelve 0 siempre, y un build roto se reportaba en verde. Además, `tail` no emite nada hasta que el proceso termina, así que no se distingue "avanzando" de "colgado". Redirigir completo y leer el archivo.
- **El build no se corre en una revisión** salvo que el cambio toque la configuración de compilación: no dice nada que el chequeo de tipos no diga, y es de los procesos más caros del workspace. Si importa, se corre aparte y solo.
- No se corren migraciones reales ni se escribe en servicios compartidos.

**Un check lento no demora el informe.** Si cuando los subagentes cierran un check no terminó, el informe se entrega igual y ese check va como ***sin verificar***, con el motivo. **Sin verificar no es sin hallazgos.** Un informe terminado que queda sin entregar mientras se espera un check secundario es un informe no entregado. (Un caso real: la suite completa de un backend se leyó como precondición y el informe quedó media hora sin enviar.)

Al dar de baja una suite lenta en Windows, cerrar el árbol de procesos por PID: detener solo el padre deja huérfanos a los hijos.

### Gates deterministas

```bash
node scripts/run-gates.js --repo <repo> [--from <slot>] [--base <rama>] [--change <id>]
# o --all
```

**En los modos S y C, `--from <slot>` es obligatorio.** Sin él, los gates leen el diff y los archivos de la principal —otra rama— y el bloque sale igual de prolijo: nada avisa que se auditó el código equivocado.

> **Incidente.** Una revisión en un slot corrió los gates sin `--from`: leyeron la principal, el bloque salió limpio y completo, y no tenía nada que ver con el cambio revisado.

Con `--from`, el encabezado del bloque dice de dónde leyó. **Si no lo dice, el bloque no es de la rama revisada**: descartarlo y rehacerlo.

Leer la salida antes de seguir. Si un gate dice que no se pudo ejecutar o no corrió, eso es *sin verificar*, nunca *sin hallazgos*, y va así en el informe.

### La salida va **pegada textual** en el prompt

El bloque de gates (y el de checks, si ya terminó) va **dentro** del prompt de cada subagente, copiado tal cual, bajo el título `## Gates deterministas`. **No** se escribe a un archivo para pasar la ruta: son unas decenas de líneas, y obligar a cada agente a leerlo cuesta una llamada por agente para ahorrar unas pocas líneas de prompt.

A cada agente le corresponde el bloque de **su** repositorio. Si los checks siguen corriendo, el prompt dice *"checks en curso: no los corras; el orquestador los integra"*.

---

## Paso 3: lanzar los agentes en paralelo

En un solo mensaje, para que corran concurrentes:

| Agente | Qué aporta | Cuándo se lanza |
|---|---|---|
| `qa-agent` | El código contra el diseño acordado y los criterios de aceptación | Siempre que haya diseño o criterios |
| `code-reviewer` | Corrección, arquitectura, rendimiento, mantenibilidad, tests | Siempre |
| `security-auditor` | Autorización, aislamiento de datos, secretos, entrada no confiable | Si el cambio toca autenticación, permisos, datos de personas, o el borde de la aplicación |

Los **prompts** de cada revisor están en `ai/core/prompts/code-review/` (ver su `README.md`): uno técnico y uno de contrato y diseño, que se parametrizan con el checklist del stack que aporta el pack de cada repositorio.

### Lo que lleva el prompt de cada uno

1. **`REVIEW_ROOT: <ruta>` como PRIMERA línea**, en los modos **S y C**. Los subagentes no heredan el directorio de trabajo: arrancan en la raíz del workspace, y sin esa línea leen la rama equivocada y citan líneas que no son las del cambio. En el modo A no va (se trabaja sobre el repositorio principal).
2. El repositorio, su rama base y el **modo**; y en el modo A, cuáles son las tres partes del diff real (arriba).
3. El bloque `## Gates deterministas` completo, con la instrucción de **no volver a correrlos**.
4. El diseño acordado del cambio, si existe.
5. **El formato de salida** (abajo): es lo que permite verificar lo que devuelven.

**El modelo se fija por subagente**, el de juicio fuerte que declara cada agente en su manifiesto. No se hereda el de la sesión: un revisor que corre en un modelo chico por herencia produce más hallazgos inventados, y el costo de verificarlos supera el ahorro. Los agentes `primary` (los que abren una sesión, como `workspace-router`) no fijan modelo.

### Formato de salida

Cada agente cierra su informe con un bloque JSON. La prosa es para la persona; el bloque es para el script del paso siguiente.

````
```json
[
  {
    "file": "src/<modulo>/<archivo>",
    "line": 42,
    "rule": "autorizacion-despues-del-efecto",
    "severity": "bloqueante",
    "summary": "El permiso se comprueba después de haber escrito.",
    "evidence": "el texto exacto de esa línea"
  }
]
```
````

| Campo | Para qué |
|---|---|
| `file` | Ruta relativa al repositorio. Se comprueba que exista |
| `line` | Se comprueba que exista dentro del archivo. Opcional si el hallazgo es sobre el archivo entero |
| `evidence` | El fragmento textual de esa línea. **Es el campo que hace verificable el hallazgo**: si el texto no está ahí, se descarta |
| `severity` | `bloqueante`, `importante` o `menor` |
| `summary` | Una frase. El detalle va en la prosa |

Un agente que no devuelve el bloque obliga a verificar a mano, que es lo que se está tratando de evitar.

---

## Paso 4: descartar lo inventado, con un script

Antes de leer una sola línea, pasar todos los hallazgos por la verificación:

```bash
node scripts/verify-findings.js --repo <repo> --input <archivo.json>
```

En los modos S y C, `--repo` recibe la **ruta del repositorio dentro del slot** (la misma que fue `REVIEW_ROOT`): si no, se verifica contra la principal.

Comprueba tres cosas, mecánicamente: que el archivo exista, que la línea exista, y que el fragmento citado esté realmente ahí. Lo que no pasa, no llega al informe.

**Por qué un script y no una instrucción.** Una regla escrita se paga en tokens en cada corrida y se cumple mientras quede atención disponible, que es justo lo que escasea después de leer tres informes. El script cuesta cero y no se puede saltear.

### Lo que el script no decide

Si el hallazgo tiene razón. Eso es lo único que hay que leer, y para eso queda el presupuesto entero:

- **Verificar la cita física.** Si un informe cita una línea que excede `wc -l <archivo>`, la cita está fabricada: es la única señal objetiva de fabricación. Esto vale también para un reporte externo (de otra persona, otra herramienta u otro agente): no es sospechoso por venir de afuera, pero se le aplica el mismo rigor que a uno propio y **nunca se copia una conclusión sin re-derivarla** contra esta rama.
- **El diseño.** Antes de reportar algo como defecto, leer el `design.md` o la especificación del cambio: **un trade-off ya decidido y documentado no es un hallazgo**. Reportarlo genera trabajo de refutación y gasta la credibilidad de la revisión.
- **El call-site.** Un método "sin validación" puede estar protegido por quien lo llama. Leer el sitio de la llamada antes de aceptarlo.

---

## Paso 5: consolidar

Sobre lo que sobrevivió:

1. **Deduplicar.** El mismo defecto visto por dos agentes es un hallazgo, no dos.
2. **Resolver contradicciones.** Si dos agentes dicen cosas opuestas sobre el mismo código, leer el código y decidir. No trasladar la contradicción al informe.
3. **Ordenar por severidad**, no por agente.
4. **Preguntarse**: ¿es un defecto o una decisión?

---

## Paso 6: ¿este hallazgo puede volverse gate?

Por cada hallazgo **confirmado y real** que ningún gate detectó, aplicar el procedimiento `gate-from-finding`: ¿puede repetirse en otro módulo, por otra persona? ¿se ve leyendo el archivo?

Si no da el tiempo en esta revisión, anotarlo en `ai/gate-candidates.md` con el motivo: un candidato anotado sobrevive; uno que solo se mencionó en el chat se pierde. En un cambio que cruza repositorios, mirar con especial atención los hallazgos **de integración** (el contrato entre el que expone y el que consume): son los que menos cobertura de gate tienen.

Este paso es el que hace que el sistema mejore solo. Saltearlo significa encontrar el mismo error otra vez dentro de tres meses.

---

## Paso 7: informe

**Se entrega apenas cierran los subagentes.** No se espera a ningún check que siga corriendo: los que no terminaron se listan como *sin verificar*.

```
## Revisión — <repositorio> · <rama> · modo <A|S|C>

**Alcance leído**: <raíz>; en el modo A, "commiteado + sin commitear + sin trackear"
**Gates deterministas**: <resumen en una línea; nombrar explícitamente los que no corrieron>
**Checks**: <tipos / lint / tests: resultado; los que no terminaron, "sin verificar" y el motivo>

### Bloqueantes (N)
…

### Importantes (N)
…

### Menores (N)
…

**Recomendación**: se puede mergear / no se puede mergear, y por qué.
**Estado del árbol revisado**: la rama y `status --porcelain` del principio y del final, iguales.
```

- Modo A y S: al chat. Modo C: al archivo de la carpeta que define el proyecto.
- Si no hay hallazgos, decirlo. Un informe que inventa observaciones para justificar la revisión enseña al equipo a no leerlos.

---

## Restricciones

1. **No commitea.** El commit lo hace `git-commit-workflow`, con pedido explícito de la persona.
2. **No modifica código.** Si la persona pide que se arreglen los hallazgos, es un trabajo aparte, después de que ella los haya visto. La única escritura permitida es el archivo del informe del modo C.
3. No hace `git checkout`, `switch`, `reset` ni `clean` en el repositorio principal.
4. No limpia slots por iniciativa propia.
5. No aplica migraciones ni escribe sobre la base, cachés o colas compartidas.
