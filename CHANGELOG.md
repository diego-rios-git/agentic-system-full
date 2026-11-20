# Changelog

Las versiones siguen [SemVer](https://semver.org/lang/es/) aplicado a los activos, no a un producto:

- **MAJOR** — un cambio que rompe un proyecto ya generado: se elimina un activo, cambia el formato de `ai-workspace.json`, o `template-sync` requiere intervención manual.
- **MINOR** — activos nuevos, packs nuevos, o mejoras que un proyecto adopta sin tocar nada.
- **PATCH** — correcciones y ajustes de contenido.

---

## [Sin publicar]

La base se verifica a sí misma, y deja de pagar contexto que no usa.

### Agregado
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

### Corregido
- **`check-semgrep.js` solo analizaba archivos versionados en git.** Al pasarle un directorio, semgrep omite todo lo que git no tiene registrado — es decir, **exactamente los archivos que un agente acaba de crear**. El gate salía limpio sobre código que nunca había mirado. Ahora los archivos los enumera el perfil de lenguaje y se pasan explícitamente, por lotes.
- **`check-duplication.js` y `check-scenario-coverage.js` salían con 0 y `[]` con el repositorio sin clonar.** Los encontró el test de contrato la primera vez que se corrió, y son el tercer y cuarto caso del mismo patrón en esta base.
- `--validate-rules` reportaba "todas las reglas se comportan" cuando un archivo de reglas no había cargado. Ahora sale con 2: las reglas de ese archivo quedaron sin validar.
- La resolución de qué raíces aplican a un repositorio estaba **copiada en seis módulos**. Vive en `assets.rootsFor()`. Seis copias de una regla de resolución son seis lugares donde corregirla, y el que se olvida no falla: deja de ver un pack y su gate reporta "sin hallazgos" sobre reglas que nunca cargó.

### Cambiado
- **Las descripciones de skills y agentes son ahora una línea de disparo.** El harness las carga todas en cada sesión aunque no se invoque ninguna: pasaron de 7.903 a 2.259 bytes, unos **1.400 tokens menos por sesión**. Dicen cuándo usar el activo; el detalle vive en el cuerpo, que se carga solo al invocarlo. De paso mejora la elección: el modelo distingue mejor entre disparadores cortos que entre párrafos parecidos.
- Los baselines registran `frozenAt`. Sin fecha, se puede decir cuánta deuda hay congelada pero no desde cuándo.
- `CONTRIBUTING.md` exige `npm test` en verde y un test que falle sin el arreglo.

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
