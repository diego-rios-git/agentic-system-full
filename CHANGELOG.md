# Changelog

Las versiones siguen [SemVer](https://semver.org/lang/es/) aplicado a los activos, no a un producto:

- **MAJOR** — un cambio que rompe un proyecto ya generado: se elimina un activo, cambia el formato de `ai-workspace.json`, o `template-sync` requiere intervención manual.
- **MINOR** — activos nuevos, packs nuevos, o mejoras que un proyecto adopta sin tocar nada.
- **PATCH** — correcciones y ajustes de contenido.

---

## [Sin publicar]

### Pack `odd`: Organic Driven Development

La metodología con la que gentle-ai v4 (Gentleman Programming) reemplazó a SDD, traída como alternativa al pack `openspec`. El flujo escala solo: lo chico se hace directo y sin artefactos, lo grande arma un documento, lo de riesgo alto se verifica. Ningún mecanismo está prendido por defecto; cada uno tiene su disparador.

#### Agregado
- **Pack `odd`**: `odd-protocolo` (los siete pasos, el tamaño por la prueba de retomar, la lista de riesgo alto y los disparadores), `odd-documento` (un archivo por funcionalidad con specs textuales, tareas y bitácora; un cambio de requisito reescribe solo su spec), `odd-tests` (un rojo por regla pedida, uno por comportamiento existente tocado, chequeo diferencial contra la base), `odd-verificacion` (tres niveles y límites de corrección) y el agente de solo lectura `odd-verificador`. Qué se tomó del original y qué se dejó: `ai/packs/odd/references/odd-origen.md`.
- **`changeLayout` en el adaptador del ciclo** (`scripts/lib/sdd.js`): `dir` (por defecto, como hasta ahora) o `file`, donde cada cambio es un documento y lleva sus propios `rf:`, `cierra_rf:` y `pendiente_rf:`. Lo leen el gate de cobertura de escenarios y el tablero de requisitos sin saber qué herramienta es.

#### Cambiado
- `check-requirements.js` lista los cambios con `sdd.listChanges` en lugar de recorrer directorios por su cuenta.

### Proyectos de cualquier lenguaje, con o sin pack

Node es el lenguaje de las herramientas de la base, no del proyecto. Faltaba decirlo y ayudar a quien usa un stack sin pack (Python, Angular, Go): los gates no veían su código y nada lo avisaba.

#### Agregado
- **`docs/stack-sin-pack.md`**: qué declarar cuando el stack no tiene pack (perfil de lenguaje, comandos del ecosistema, perfil de dependencias), con ejemplos para Python, Angular y React, y qué no se tiene sin pack.
- **`init.js` pregunta el stack** de un repositorio sin pack, lo guarda en `repos[].stack` y lo lista en los próximos pasos.
- **`project-loader`, tanda 2b**: por cada repositorio sin pack, el agente propone con confirmación el perfil, los comandos y las dependencias, y después corre los gates.
- **`appliesTo.sourceFiles`** en la declaración de un gate: aplica a lo que el perfil de lenguaje del repositorio llama fuente.

#### Corregido
- **Anti-patrones no corría al escribir un `.py`** aunque el repositorio declarara su perfil: el gate tenía fijas las extensiones de JavaScript en el manifiesto del núcleo. `antipatterns` y `duplication` usan ahora `sourceFiles`.

### Trabajo en paralelo con turno de la principal

Traído del circuito de LinXDASH, donde corre desde el 05/10/2026. Antes, cada ticket tenía la principal desde el `promote` hasta el merge, unos 40 minutos, casi todos esperando una respuesta del operador. Ahora solo la tiene mientras migra y prueba de punta a punta.

#### Agregado
- **`manage-worktree.js turn`**: pide el turno de la principal para un slot. Sale 0 si es suyo y 3 si queda en cola; `--session` guarda el nombre de la sesión que espera y `--leave` la saca de la cola. La cola es FIFO, vive en `<worktrees.dir>/.turno/turno.json` y se protege con un lock que se recupera si el proceso que lo tenía murió.
- **`docs/trabajo-en-paralelo.md`**: la guía de uso, con el prompt de cada caso y la sección para un agente sin contexto.

#### Cambiado
- **`cerrar-ticket` va en tres fases.** El precierre (traer la base, review en modo S, correcciones, archivado y commit) corre en el slot y en paralelo. Por turno, en la principal: `promote`, migraciones, prueba de punta a punta y `release`. Sin la principal: PR, tarjeta, merge y estados. El punto de control único pasa al final del precierre, donde esperar no traba a nadie. Ante una excepción que necesita decisión, se devuelve la principal.
- **`promote` exige el turno.** Lo toma después de verificar todo, así que un promote que falla no se queda con él.
- **`release` suelta el turno e imprime `TURNO-AVISAR: <sesión> <slot>`.** La sesión que libera la principal le manda un mensaje a la siguiente; si no puede, avisa al operador. Con la principal ya en la base, `release` libera un turno colgado.
- **`status` muestra quién tiene el turno y la cola.** En `--json`, la clave es `turn`. `clean --orphans` ignora la carpeta del turno.
- **El review del PR pasa al slot** (`pr-review` modo S). En la principal solo se revisa el delta que entró después.

El método de análisis funcional que usaba el agente de análisis de un proyecto, generalizado para cualquier proyecto y para quien trabaja desde su propio harness. Un dev saca la ficha que necesita sin esperar al PM; las decisiones que no le tocan le quedan escritas con quién las decide.

### Agregado
- **Pack `analisis-funcional`** (de workspace, `experimental`): `metodo-analista` (conversar antes de producir, preguntas de a una con recomendación, archivo de decisiones, control antes de entregar), `ficha-desde-documento`, `cambio-de-requisito` (la diferencia contra una versión nombrada de la ficha, con no regresión), `revisar-ficha` (hallazgos con evidencia y veredicto, sin corregir), `auditar-cobertura-rf` (dictamen de fuentes contra código) y `catalogo-y-camino-critico`. Lo propio de cada proyecto —fuentes y su orden, fichas modelo, quién decide— va en `analisis.md` de `ai/local/`.
- `ai/packs/analisis-funcional/scripts/validar-ficha.js`: revisa la estructura de una ficha (secciones, cada regla con su escenario, la fórmula de un requisito de cálculo, la no regresión de una versión nueva). Sale 0/1/2. No es un gate: lo corren los procedimientos. `test/validar-ficha.test.js`.
- `ai/core/references/requisitos/contenido-por-seccion.md`: qué tiene que traer cada sección de la ficha.

### Cambiado
- **`redactar-requisito`: la ficha suma secciones de profundidad** —*Flujos*, *Estados*, *Configuración*, *Auditoría*, *Dependencias*, *Riesgos y supuestos*, *Historial*— cuando el requisito las necesita, y dos claves opcionales en el encabezado (`version`, `perfil`). Sigue siendo una sola ficha: las secciones de siempre no cambian y una ficha sin profundidad sigue siendo válida.
- `template-sync` copia también las `references` de un pack.
- **`task-estimation` lee la ficha** (Step 1b): equivalencias de cada sección, incluidas las de profundidad, con el volumen; `[a decidir: …]` cuenta como ambigüedad; el `perfil:` dice dónde buscar el riesgo; la `version:` va en el título. Un cambio (`CHG`) se estima como diferencia, sin tocar la estimación de la base.
- `project-estimation` arma la WBS con una tarea por ficha cuando el frente ya tiene fichas.
- `revisar-ficha`, `ficha-desde-documento` y `cambio-de-requisito` dicen cómo se sigue hacia la estimación. `metodo-analista` aclara que "actualizá" sobre una ficha validada es un cambio.

### Corregido
- El README decía v1.2.0 en lugar de v1.3.0.

---

## [1.3.0] — 2026-10-05

Hooks más baratos y que avisan cuando la máquina no puede correrlos. Con todos encendidos, cada comando de shell lanzaba cuatro o cinco procesos `node` y cada escritura tres; el arranque de `node`, no lo que el hook decide, era casi todo el costo.

### Cambiado
- **Un proceso por evento, no por hook.** `consolidate-skills.js --wrappers` registra en Claude Code un solo comando por evento y matcher, que llama a `scripts/hooks/dispatch.js` con la lista de scripts: la configuración se carga una vez y los hooks corren en ese mismo proceso. Medido en Windows, un comando de shell pasa de unos 195 ms de CPU repartidos en cuatro procesos a 55 ms en uno. El tiempo límite de la entrada es el del hook más largo. Si el proyecto todavía no tiene `dispatch.js`, se registra un hook por entrada, como antes.
- Los hooks se declaran con `core.defineHook(module, id, handler, opts)`: corridos directamente (OpenCode, los tests, a mano) se ejecutan solos; requeridos por el despachador exportan su handler. Un hook propio de un proyecto que no usa `defineHook` sigue funcionando: el despachador lo corre en su propio proceso, con la misma entrada.
- **Filtro previo**: `pre-commit-attribution` y `pre-commit-gates` solo cargan la configuración si el comando dice `commit`, `pre-bash-heredoc` si lleva `<<`, y la variante de shell de `pre-write-protected` si el comando puede escribir un archivo. Un `ls` o un `git status` ya no la cargan.
- `pre-write-secrets` analiza el texto en su propio proceso (`check-secrets.js` exporta `scan`) en vez de lanzar otro `node`, y bloquea aunque `ai-workspace.json` falte o esté roto.
- `post-edit-checks` corre los gates aplicables en paralelo. La mejora es chica (con dos gates, de 206 a 197 ms de mediana) porque en Windows los procesos compiten por CPU; crece con más gates.
- La status line lee la rama de `.git/HEAD` (también en un worktree) en vez de lanzar dos `git` por repositorio en cada redibujo; si no la entiende, le pregunta a `git` como antes.
- `.ai-gates-log.jsonl` rota a `.ai-gates-log.1.jsonl` pasado 1 MB.

### Agregado
- `scripts/lib/preflight.js`: comprueba que haya `node` 18 o más **en el PATH** (el que usa el harness para correr los hooks, que no tiene por qué ser el que corrió `init.js`) y avisa si falta `git`. `init.js` se niega a instalar sin `node`; `consolidate-skills.js --wrappers` lo avisa al registrar hooks. Sin `node` en el PATH cada hook sale con 127 y el harness lo trata como un error que no bloquea: todos los guards quedaban apagados a la vez.
- `test/hooks-dispatch.test.js`: el despachador decide lo mismo que los hooks corridos uno por uno; *fail-open* por hook; hooks propios; el filtro previo; `post-edit-checks` (que no tenía ninguna prueba de comportamiento); la rotación del log; la rama leída de `HEAD`; el preflight.

### Corregido
- `init.js` no agregaba `.ai-gates-cache.json` al `.gitignore` del proyecto: el caché de `post-edit-checks` podía terminar versionado.
- El `.claude/settings.json` de la propia base registraba sus hooks con rutas relativas, que fallan con la sesión abierta en un subdirectorio.

### Actualización
- Después de `template-sync`, correr `node scripts/consolidate-skills.js --wrappers` para pasar al despachador. Hasta entonces, el registro anterior (un hook por entrada) sigue funcionando igual.
- En un proyecto existente, agregar a mano `.ai-gates-cache.json` y `.ai-gates-log.1.jsonl` al `.gitignore`: `init.js` solo lo escribe al instalar.

## [1.2.0] — 2026-10-02

El circuito de trabajo completo, de punta a punta: pensar un requisito, trabajar en slots en paralelo, revisar, probar contra la app real, cerrar, mergear y mejorar el propio sistema. Antes eran piezas sueltas; ahora es un recorrido, con cada paso en un procedimiento y cada regla con el incidente que la originó. Ver `docs/circuito-de-trabajo.md`.

Dos decisiones lo atraviesan. **Lo que depende del stack es un dato** —perfiles de dependencias, comandos de base de datos, packs—: el núcleo no sabe de npm, de NestJS ni de un ORM. **Lo que depende de cómo lo hace cada proyecto viene como una guía** que un agente sin contexto lee y adapta, no como código fijo que fingiría servirle a todos.

No cambia el contrato de `ai-workspace.json` (sigue en `version: 1`; todo lo nuevo es opcional) ni el de `template-sync`. Ver la sección de actualización.

### Agregado

**Slots y status line**
- `manage-worktree.js` completo: `open`, `status`, `promote`, `release` y `clean`. La **principal queda libre** para lo que no se puede paralelizar (migraciones, e2e, review, PR), porque la base de datos y los puertos son únicos. Una rama nueva se crea **sin upstream** (con upstream a la base, "Sync Changes" del editor empuja trabajo a la rama base); el slot de revisión se **reutiliza** con cuatro guardas (detached, limpio, HEAD contenido en una rama, mismo lockfile); `promote` y `release` verifican todo antes de tocar nada y reintentan el cambio de rama ante el bloqueo de `HEAD` solo si el índice ya es el de la rama destino.
- **Dependencias compartidas por perfil** (`depsProfiles`: Node, Python, PHP): un slot enlaza el directorio de dependencias del principal (junction en Windows, symlink en Unix). Incluye el barrido de enlaces anidados antes de borrar, `check-deps.js` y la guía `shared-dependencies`, que enseña a **medir** qué operación destruye el directorio antes de blindarlo.
- **Status line** (`scripts/statusline.js`): slot, ramas, modelo con su esfuerzo, contexto y costo. `start-worktree-session.js` abre una sesión en un slot.
- `scripts/lib/worktree-paths.js`: **una** definición de qué es un slot. Antes eran cuatro expresiones regulares copiadas, y cuando una se quedaba vieja el hook dejaba de ver el slot y dejaba pasar justo lo que debía bloquear.

**Hooks**
- **Registro declarativo de hooks** (`scripts/lib/hooks.js`): se declaran en el `manifest.json` de su origen con eventos neutrales y `consolidate-skills.js --wrappers` los registra en cada harness; `--check` detecta lo que falta. Antes eran un bloque que `init.js` copiaba una vez a `.claude/settings.json` y la actualización nunca tocaba: un hook nuevo no llegaba a ningún proyecto. Un registro heredado se **adopta** en vez de duplicarse. OpenCode recibe plugins generados que delegan en el mismo script.
- Hooks nuevos: `pre-write-protected` (rutas protegidas con autorización temporal del operador: `allow-protected-edit.js`), `pre-bash-slot-deps`, `pre-bash-slot-migrations`, `pre-commit-attribution`, y los opcionales `pre-commit-gates` y `pre-bash-heredoc`. Cualquiera se apaga con `hooks.<id>.enabled: false`.
- `scripts/lib/guard-core.js`: lo común a todos los hooks (contrato de salida, *fail-open* ante un error propio, análisis de comandos encadenados siguiendo el `cd` de cada tramo).

**Gates**
- `run-gates.js --from <slot>`, `--base`, `--change`, `--todo`: cuatro estados (sin hallazgos, con hallazgos, NO CORRIÓ, NO SE PUDO EJECUTAR) y solo el primero es verde.
- `run-checks.js`: typecheck, lint y tests que el repo declara, **una vez** y con tope de recursos; ningún comando fijo.
- Gates nuevos: `unreachable` (código nuevo que nadie importa), `encoding` (texto con la codificación rota, sobre todo archivo de texto), `cochange` (quien toca X regenera Y), `verify-rules` (toda regla trae un fixture que marca y uno que no), `gate-candidates` (lintea el registro) y `requirements`.
- `scripts/lib/domain-gate.js` y la guía `domain-gate`: el patrón de un gate de dominio (una política escrita en una regla + un gate que la verifica), para que cada proyecto arme el suyo.
- Capacidades `needs` en la declaración de un gate: si el repo no tiene lo que el gate necesita, aparece como NO CORRIÓ con el motivo, nunca como limpio.

**Ciclo, requisitos y cierre**
- Procedimientos: `cerrar-ticket` (un solo punto de control antes de lo irreversible), `git-sync-branch`, `ciclo-de-tarea`, `trabajo-autonomo` (+ `trabajo-por-sesion.js`), `redactar-requisito`, `resumen-humano`, `prueba-e2e`, `tracker-events`, y `spec-explore` en el pack `openspec`. La regla `verificar-lo-que-el-runner-no-ve` (el chequeo de tipos que sí mira los tests antes del push).
- **Tablero de requisitos** (`check-requirements.js`): el estado sale de la evidencia del repo, no de la mano; `cierra_rf` y `pendiente_rf` para los requisitos que se entregan en partes; nunca retrocede un estado solo.
- `tracker.kind` (`none`, `jira`, `github`) y `forge.kind` (`none`, `github`, `bitbucket`, `gitlab`) en `ai-workspace.json`. Sin tracker, el agente mueve la ficha del tablero si hay uno, y si no, no hace nada. Packs `tracker-jira` y `tracker-github`: guías para configurar el propio.

**Revisión, agentes y reglas**
- `pr-review` con tres modos: la rama actual, un slot leído en el sitio con `--from`, y la rama de otra persona en el slot de revisión. Prompts de revisión por modo.
- Pack `fullstack` (`fullstack-agent` y el contrato entre repositorios) y pack `e2e` (kit de pruebas de punta a punta y un linter de scripts e2e).
- Reglas transversales, cada una con su incidente: `edicion-por-reemplazo`, `dobles-de-repositorio`, `aislamiento-de-rama`, `autoria-de-activos`; `probar-el-borde` (pack `nestjs`) y `copy-de-interfaz` (pack `nextjs`).
- Migraciones: la guía `shadow-migration` (generar contra una base descartable, para cualquier ORM) y su variante para TypeORM + PostgreSQL en el pack `nestjs`. Las rutas de migraciones quedan protegidas en `nestjs` y `dotnet`.

**Configuración** (todo opcional): `tracker`, `forge`, `commits`, `hooks`, `protectedPaths`, `statusline`, `requirements`, `autonomous`, `e2e`, `review.outputDir`, y por repositorio `database`, `deps`, `consumes`, `typecheckTestCommand`, `testRelatedCommand`, `lintRelatedCommand`, `artifactPaths`, `coChange`.

### Cambiado
- Un repositorio **sin remoto** compara contra su rama local; con remoto, contra `origin/<base>` (una base local atrasada cuela en el diff cambios ya mergeados). Antes, todo gate que comparaba contra la base quedaba en "no se pudo verificar" para siempre en un proyecto nuevo.
- `--repo` acepta la ruta de un slot en **todos** los gates, y `--write-baseline` desde un slot se rechaza (congelaría la deuda de una rama sin mergear).
- El gate de aislamiento entre clientes ya no sale 2 para siempre sobre un repositorio de frontend: el pack `nextjs` declara que no consulta la base y el gate figura como NO CORRIÓ con ese motivo. Un stack que sí consulta y no declara dialecto sigue saliendo 2.
- `spec-archive`: el change se archiva **dentro** del PR, antes del merge; solo el estado del requisito espera al merge. Antes decía "después del merge", lo que contradecía el cierre.
- `ai/gate-candidates.md` deja de ser un archivo de la base: es el registro de cada proyecto y `template-sync` no lo toca.
- `templates/claude-settings.json` ya no trae el bloque de hooks: los registra `consolidate-skills`.

### Corregido
- **`check-antipatterns.js` analizaba un archivo suelto fuera de `src/`** con reglas pensadas para `src/`: el hook de escritura marcaba un script de consola con hallazgos que el barrido completo y el baseline no ven nunca, y que por eso no se podían congelar. Lo encontró un proyecto que lo sufrió y lo corrigió a mano; ahora está en la base, con un test que falla sin el arreglo.
- Los hooks usaban rutas relativas (`node scripts/hooks/x.js`): con la sesión abierta dentro de un repositorio salían con 1 y el comando pasaba **sin revisar**. Ahora usan `$CLAUDE_PROJECT_DIR`.
- `check-secrets.js`: una ruta de propiedad como `"body.access_token"` ya no se lee como un literal asignado.

### Cómo actualizar

Ver `docs/actualizar-la-base.md`. En corto: `template-sync` y después **`consolidate-skills.js --wrappers`**, que ahora también registra los hooks. Un proyecto que traía a mano piezas de otro sistema a `ai/local/` y `scripts/` tiene un orden de pasos propio (qué se pisa, qué se borra de `ai/local/` porque ahora vive en el núcleo), probado sobre una copia de un proyecto real.

### Lo que no se verificó
- `cerrar-ticket` y `prueba-e2e` son esqueletos: no tuvieron una primera corrida guiada de punta a punta.
- Los comandos de lanzamiento de sesión (`launch`, `headless`) de cada harness no se probaron contra la herramienta real; el mecanismo sí.
- La generación de migraciones contra una base descartable se probó con un `pg` y un CLI de mentira, no contra PostgreSQL ni TypeORM reales.
- Los slots, enlaces y hooks se probaron en Windows; la guarda de dependencias no ve un borrado hecho desde un programa (`node -e`, `find -delete`) ni `git clean -x`.

### Verificación de la base y costo de contexto (acumulado desde la 1.1.0)

La base se verifica a sí misma, y deja de pagar contexto que no usa.

#### Agregado
- **Tests de la propia base** (`npm test`, sin dependencias: el ejecutor viene con Node). Repositorios de prueba por lenguaje en `test/fixtures/`, con un archivo que debe marcar y otro que no. Los gates se corren **como los corre un proyecto** —invocando el script, mirando su código de salida y su JSON— porque los peores defectos que tuvo esta base no estaban en la lógica de detección sino en el contrato de salida. Ver `docs/verificar-la-base.md`.
- **Test de contrato sobre todos los gates declarados** (`test/contract.test.js`). Recorre los manifiestos, no una lista escrita en el test: un gate nuevo queda sujeto al contrato el día que se declara. Le exige a cada uno los tres estados, y que con código 2 no escriba nada en stdout.
- **Fixtures dentro de cada regla** (`fixtures: { bad, good }`) y `--validate-rules` para correrlos. Las 20 reglas de los cuatro packs los declaran. Era una exigencia escrita en `gate-from-finding`; ahora se ejecuta.
- **`scripts/verify-findings.js`**: comprueba que los hallazgos de un agente citen código que existe — archivo, línea y fragmento. `pr-review` le pedía esto al orquestador en prosa, que es exactamente lo que esta base sostiene que no funciona. Los tres agentes de revisión ahora cierran su informe con un bloque JSON verificable.
- **`scripts/check-context-budget.js`**: mide el costo fijo de contexto de una sesión en sus tres partidas —descripciones de activos, mapa del sistema, `ai/local/`— y avisa cuál se pasó. Ajustable con `contextBudget`. Ver `docs/costo-de-contexto.md`.
- **`scripts/baseline-report.js`**: qué hay congelado, desde cuándo, y cuántas huellas ya no corresponden a ningún hallazgo. Una baseline sin forma de mirarla deja de ser una decisión y pasa a ser una alfombra.
- **`scripts/lib/gate-cli.js`**: el andamiaje común de un gate, con el tri-estado incorporado. Un gate que lo usa no elige su código de salida.
- **Caché por contenido en el hook de escritura.** Un agente edita el mismo archivo varias veces por tarea; el resultado de cada gate se recuerda por hash del contenido, así que un archivo que vuelve a un estado ya verificado no se vuelve a analizar.
- `AI_WORKSPACE_CONFIG` y `AI_BASELINE_DIR`: los dos ganchos que hacen posible probar la base sin tocar la configuración ni los baselines del proyecto donde corre.
- `docs/verificar-la-base.md` y `docs/costo-de-contexto.md`.

#### Corregido
- **`check-semgrep.js` solo analizaba archivos versionados en git.** Al pasarle un directorio, semgrep omite todo lo que git no tiene registrado — es decir, **exactamente los archivos que un agente acaba de crear**. El gate salía limpio sobre código que nunca había mirado. Ahora los archivos los enumera el perfil de lenguaje y se pasan explícitamente, por lotes.
- **`check-duplication.js` y `check-scenario-coverage.js` salían con 0 y `[]` con el repositorio sin clonar.** Los encontró el test de contrato la primera vez que se corrió, y son el tercer y cuarto caso del mismo patrón en esta base.
- `--validate-rules` reportaba "todas las reglas se comportan" cuando un archivo de reglas no había cargado. Ahora sale con 2: las reglas de ese archivo quedaron sin validar.
- La resolución de qué raíces aplican a un repositorio estaba **copiada en seis módulos**. Vive en `assets.rootsFor()`. Seis copias de una regla de resolución son seis lugares donde corregirla, y el que se olvida no falla: deja de ver un pack y su gate reporta "sin hallazgos" sobre reglas que nunca cargó.

#### Cambiado
- **Las descripciones de skills y agentes son ahora una línea de disparo.** El harness las carga todas en cada sesión aunque no se invoque ninguna: pasaron de 7.903 a 2.259 bytes, unos **1.400 tokens menos por sesión**. Dicen cuándo usar el activo; el detalle vive en el cuerpo, que se carga solo al invocarlo. De paso mejora la elección: el modelo distingue mejor entre disparadores cortos que entre párrafos parecidos.
- Los baselines registran `frozenAt`. Sin fecha, se puede decir cuánta deuda hay congelada pero no desde cuándo.
- `CONTRIBUTING.md` exige `npm test` en verde y un test que falle sin el arreglo.

#### Agregado
- `docs/actualizar-la-base.md`: cómo traer las mejoras publicadas a un proyecto ya generado. La sección del README cubría el caso feliz; faltaba lo que necesita decisión — un pack nuevo no llega si no se declara, un archivo eliminado se reporta pero no se borra, un divergente puede dejar una combinación rota, y un CI que pasa a rojo puede tener razón. Incluye qué esperar al actualizar de 0.1.0 a 1.1.0.

## [1.1.0] — 2026-09-08

Los gates dejan de reportar como limpio lo que no se pudo verificar, y dejan de asumir que todo el código es JavaScript.

Lo que atraviesa toda la versión es un solo cambio de fondo: **lo que depende del stack se declara como dato en el manifiesto de un pack, y el núcleo no conoce ninguna herramienta**. Vale para el lenguaje, el ORM, el marco de tests, el harness, la herramienta de especificación y la preparación de un worktree. Cuando el dato falta, el gate sale con 2 en vez de con 0 — salvo cuando genuinamente no hay nada que verificar, donde sale 0 y lo dice.

### Agregado
- **Preparación de un slot de worktree declarada por el pack**, con dos estrategias: `link` —enlazar del repositorio principal lo que pesa mucho y no cambia entre ramas, como `node_modules`— y `command`, que ejecuta un comando dentro del slot con sus argumentos ya separados, sin pasar por un shell. Un worktree recién abierto tiene el código y nada más, porque git no versiona las dependencias: sin prepararlo, compila en el repositorio principal y no en el slot. Los packs `nestjs` y `nextjs` declaran el enlazado de `node_modules`; un stack que necesite otra cosa declara la suya sin tocar el script.
- `manage-worktree.js open --all`: abre el slot en todos los repositorios declarados. Una tarea que cruza el backend y el frontend necesita los dos en el mismo slot, y abrirlos de a uno es donde se cuela el error de dejar uno en la rama anterior. Con `--all`, un repositorio sin clonar se informa y se omite en vez de abortar el resto.
- **El ciclo dirigido por especificación, separado de la herramienta que lo implementa** (`scripts/lib/sdd.js`). El ciclo —proponer, diseñar, escribir los tests, implementar, archivar— es una forma de trabajar, no un producto. Lo específico de una herramienta son tres cosas: dónde viven los documentos, cómo se marca un escenario de aceptación y cómo se llama el programa que los valida. Ahora son datos que declara un pack bajo `sdd`, y **cambiar de herramienta mañana es escribir un pack con seis claves**: ni el gate ni los cinco procedimientos se tocan. `check-scenario-coverage.js` subió al núcleo, porque verifica el contrato y no OpenSpec. Sin proveedor declarado sale con 0 y lo dice — un proyecto que trabaja sin especificación previa no tiene nada que verificar ahí, y tratarlo como "no verificado" habría dejado el CI en rojo para siempre.
- `docs/agregar-un-sdd.md`.
- **Gate de reglas estructurales** (`scripts/check-semgrep.js`), para lo que una expresión regular por línea no puede ver porque depende de la forma del código. Semgrep entiende C#, Java, Go, Python, Kotlin, Ruby, PHP, Rust y JavaScript con el mismo formato de regla: un pack aporta un `.yml` en `rules/semgrep/` y su stack queda cubierto, sin escribir un analizador por lenguaje. **Semgrep es opcional** — no es dependencia de la base y el resto de los gates no lo necesita — pero si hay reglas declaradas y la herramienta no está, el gate sale con **2**, nunca con 0.
- Primera regla estructural del pack `dotnet`: un endpoint `HttpGet` que guarda cambios en la base. Un GET tiene que poder repetirse sin consecuencias, y un reintento de red termina aplicando el efecto dos veces.
- **Harnesses declarados en datos, y opcionales** (`scripts/lib/harnesses.js`). Agregar una herramienta de IA ya no requiere tocar código: se declara un bloque con su árbol y su dialecto de frontmatter, y esa herramienta recibe todo el contenido de `ai/` proyectado a su formato. El catálogo base vive en `template.manifest.json`; **un proyecto agrega el suyo en `harnessDefinitions` de `ai-workspace.json`**, sin bifurcar la plantilla ni esperar a que la base incorpore la herramienta. Antes eran dos listas de código —`KNOWN_HARNESSES` y `HARNESS_TREES`— más un `if` por identificador dentro del generador: sumar una herramienta obligaba a tocar tres archivos y publicar una versión, así que la respuesta a "mi equipo usa otra" era esperar.
- `"harnesses": []` es válido, y la clave puede faltar. El contenido del sistema vive en `ai/` y los gates, los packs y el ciclo de trabajo no dependen de que exista ningún `.claude/` ni `.opencode/`: esos árboles son una proyección. Antes se exigía al menos un harness, que daba por sentado que todo proyecto usa una herramienta con árbol propio.
- **Perfiles de lenguaje** (`scripts/lib/languages.js`). Qué es un archivo fuente, qué es un test, qué directorios se saltean y cómo se recorta un comentario ya no son constantes dentro de cada escáner: los declara cada pack en su `manifest.json`, bajo `language`. Instalar el pack de un stack instala su perfil, igual que ya pasaba con reglas, procedimientos y gates.
- **Pack `dotnet` completo**: perfil de lenguaje para C#, tres anti-patrones por línea —`async void` fuera de un manejador de eventos, espera sincrónica sobre una tarea (`.Result`, `.Wait()`), SQL construido por interpolación—, una regla estructural, y los cinco procedimientos del stack: desarrollo de una funcionalidad, patrones de EF Core, contratos de entrada y salida, manejo de errores y migraciones.
- `languages` y `language` por repositorio en `ai-workspace.json`. El primero **restringe** qué perfiles aplican, para el repositorio que no quiere los que aportan otros packs; el segundo declara uno a mano, para el lenguaje que todavía no tiene pack. Ambos son opcionales: un `ai-workspace.json` existente sigue siendo válido sin tocarlo.
- **Dialectos de consulta** para el gate de aislamiento por tenant. El concepto que verifica —toda lectura lleva el filtro del cliente— es el mismo en cualquier stack; cómo se ve una consulta no lo es. El script ya no sabe nada de ningún ORM: el dialecto lo declara el pack del stack bajo `tenant`, con `readMethods`, `conditionMarker`, `byIdMethods`, `byIdCondition` y `afterFilter`. El de TypeORM pasó al pack `nestjs`, que es donde vive ese ORM.
- **Extracción de títulos de test por lenguaje** (`scripts/lib/test-discovery.js`), con cuatro estrategias declarables en el perfil bajo `language.testTitles`: `callback` (Jest, Vitest, Mocha), `attribute-or-method` (xUnit, NUnit, MSTest, JUnit), `function-name` (Go, pytest) y `regex` como escape. En xUnit el título no es una cadena —el test es un método decorado y su nombre *es* el título— así que una expresión regular configurable no alcanzaba: hay que saber además cómo convertir lo capturado en algo comparable con la frase de un escenario. `Rechaza_Un_Monto_Mayor` se compara como "Rechaza Un Monto Mayor".
- `docs/agregar-un-pack-de-lenguaje.md`.
- `onWrite: false` en la declaración de un gate: lo excluye del hook de escritura y lo deja solo en `run-gates`. Para el gate que no puede acotarse a un archivo.
- `package.json` con `jscpd` como dependencia de desarrollo **de la base**. No se instala en un proyecto: no está declarado en `template.manifest.json`, porque en topología `single-repo` la raíz es el repositorio de la aplicación y le pisaría el suyo.

### Corregido
- `manage-worktree.js clean` **borraba las dependencias del repositorio principal**. Un enlace de directorio se borra siguiendo lo que apunta, así que cerrar un slot con `node_modules` enlazado eliminaba el `node_modules` real de los dos repositorios mientras el mensaje decía "cerrado" con toda normalidad. Ahora los enlaces se deshacen antes de borrar el slot, y solo se toca lo que efectivamente es un enlace.
- Los escáneres ignoraban en silencio cualquier lenguaje que no fuera JavaScript. `check-antipatterns.js` traía `SOURCE_EXT = /\.[cm]?[jt]sx?$/` escrito adentro, `check-tenant-isolation.js` traía `/\.[cm]?ts$/` —solo TypeScript, ni siquiera JavaScript— y `check-duplication.js` definía por su cuenta qué era un test. En un backend C#, Java o Go **no producían un solo archivo para analizar y salían con 0 y "sin hallazgos"**. Que el gate de aislamiento entre clientes, el más importante en materia de seguridad, fuera el más angosto de todos era el caso peor.
- `check-antipatterns.js` salía con **0** cuando no había ninguna regla activa, después de un comentario que decía explícitamente que eso no debía pasar. En `--json` emitía `[]`, indistinguible de "revisé y no encontré nada". Ahora sale con 2.
- `check-tenant-isolation.js` salía con **0** y `[]` cuando el repositorio no estaba clonado. Ahora sale con 2.
- `check-tenant-isolation.js` traía el dialecto de TypeORM escrito adentro como si fuera universal: `find`/`findOne`, condiciones con `where:`, objetos `{ id: … }`. En un proyecto con EF Core, Dapper, Prisma o Mongo no reconocía **ni una sola consulta** y reportaba "sin hallazgos" sobre código que no había sabido leer. Sin dialecto declarado ahora sale con 2.
- Un patrón de dialecto con una barra invertida sin escapar se rechaza con un mensaje que explica el arreglo. En JSON `"\b"` es el carácter de retroceso, no la secuencia de expresión regular: `"\bwhere\b"` compila sin error, no coincide con nada y deja el gate mudo. Se pisó escribiendo el primer dialecto, así que se pisa.
- La regla `CORE-1.2` daba por sentado `process.env` para reconocer un valor inyectable. En cualquier lenguaje que no fuera JavaScript no existía forma de "aprobar" una dirección local, así que las marcaba todas. Ahora las formas de leer el entorno las aporta el perfil (`envAccess`) y llegan a la regla por `ctx`.
- El recorte de comentarios asumía las cadenas de JavaScript. Un literal sin escapes —`@"C:\ruta\"` de C#, `r"..."` de Python, las cadenas triples— dejaba el rastreador dentro de una cadena y **el resto de la línea se perdía para todas las reglas**, sin error ni aviso. El perfil declara esos prefijos.
- `normalize()` en `workspace-config.js` no copiaba los campos nuevos de un repositorio, así que un filtro declarado en `ai-workspace.json` llegaba como `undefined` y no filtraba nada, en silencio.
- `check-scenario-coverage.js` reportaba **todos** los escenarios como sin test cuando no lograba leer los tests del repositorio. La extracción solo reconoce archivos `.spec`/`.test` de JavaScript y llamadas `it()`/`test()`: en un repositorio .NET con xUnit devolvía cero títulos y salía con 1, llenando el informe de falsos positivos. Ahora, si no encuentra ningún título en un repositorio que declara `testCommand`, sale con **2** — no pudo verificar. El falso positivo masivo es peor que el falso negativo: un equipo que ve doscientos hallazgos inventados apaga el gate.
- `run-gates.js` distingue tres estados en el código de salida: **0** sin hallazgos, **1** hay hallazgos, **2** algo no se verificó — un gate caído o un repositorio sin clonar. Antes contaba solo los hallazgos y salía 0 con todo sin verificar.
- `check-duplication.js` en `--json` emitía una lista vacía y salía 0 cuando jscpd no estaba disponible, indistinguible de "sin duplicación". Ahora avisa por la salida de error y sale con 2, y `run-gates` lo muestra como **NO SE PUDO EJECUTAR**.
- El gate de duplicación ya no se planifica en el hook de escritura. jscpd necesita al menos dos archivos para detectar un clon, así que no puede acotarse al archivo editado; barría el repositorio entero en cada edición contra el tiempo límite del hook, con lo cual aparentaba correr sin correr. Sigue corriendo en `run-gates.js`.
- `check-duplication.js` ignoraba `migrations/` pero no `Migrations/`. El regex de rutas excluidas era sensible a mayúsculas y cada generador elige su propia capitalización: EF Core escribe `Migrations/`, TypeORM `migrations/`. Las migraciones de la mitad de los stacks entraban al análisis de duplicación, donde por definición se repiten.
- `qa-agent` indicaba correr las verificaciones como `(cd <ruta> && <comando>)`. Es un idiom de shell POSIX: se rompe en PowerShell 5.1, y una ruta con espacios o un comando con barras invertidas lo rompe en cualquier shell. Ahora indica ejecutar cada comando con el directorio de trabajo puesto en el repositorio, y copiarlo literalmente sin traducirlo a otro gestor de paquetes.
- Finales de línea normalizados a LF en doce archivos que habían quedado en CRLF. `template-sync` compara por hash del archivo en disco: en un árbol de trabajo con CRLF, esos doce se habrían reportado como divergentes sin que nadie los tocara.

### Impacto en un proyecto ya generado
Ninguna intervención manual: `template-sync` lo adopta solo y `ai-workspace.json` no cambia de formato — los campos nuevos son opcionales.

Pero **un CI que corra `run-gates.js` puede pasar de verde a rojo**, y eso es deliberado por partida doble:

- Si estaba en verde con gates caídos o repositorios sin clonar, no estaba verificando lo que creía.
- Un repositorio que no sea de JavaScript **nunca fue analizado**. Al instalar el pack de su lenguaje van a aparecer los hallazgos que estuvieron ahí desde el primer día. Calibrar la baseline antes de mirar el resultado como una regresión: `node scripts/check-antipatterns.js --repo <repo> --write-baseline`.

## [0.1.0] — 2026-08-21

Esqueleto inicial. La base todavía no es usable.

### Agregado
- Estructura de directorios: núcleo, packs, scripts, plantillas y documentación.
- `template.manifest.json` con la frontera de propiedad entre plantilla y proyecto, los harnesses soportados y los cuatro packs declarados.
- `README.md`, `CONTRIBUTING.md`, `.gitignore`, `VERSION`.

### Pendiente
- Portar el núcleo: scripts de verificación, hooks, ciclo de trabajo, agentes y documentación.
- Extraer los packs de backend, frontend, aislamiento por tenant y ciclo dirigido por especificación.
- `init.js` y `scripts/template-sync.js`.
