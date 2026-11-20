# Task Estimation

Convierte un documento de requisito **crudo** (historia de usuario, ticket,
issue, spec, RFC — no un breakdown ya procesado) en una estimación de
esfuerzo mínima: complejidad calificada de **1 a 10** (1 = trivial, 10 =
extremadamente complicada — no existe el nivel 0) con un motivo breve,
tiempo mínimo/medio/máximo de desarrollo por capa (Backend, Frontend, o
ambas — solo se muestra la que aplica), y un **QA independiente en 3
niveles** que no se suma al desarrollo.

Es un procedimiento **genérico, agnóstico de stack y de metodología**. No
asume nomenclatura de tickets, sistema de specs, ORM ni dominio de negocio
concretos: todo eso se declara por proyecto en el bloque de
**Personalización** de más abajo. La base trae valores por defecto que
funcionan en cualquier repo; cada proyecto los afina.

---

## Cuándo usar este procedimiento

- Tengo un requisito y quiero saber cuánto va a tomar para planear o cotizar.
- Necesito estimar un ticket antes de asignarlo.
- Quiero comparar dos requisitos en términos de esfuerzo.

**Cómo trabaja:** solo lectura de documentos (no toca código ni git). No
hace `git checkout` ni crea worktrees. Genera **un** archivo por fuente en
el directorio de estimaciones del proyecto — ese es el único archivo que
escribe, y siempre lo hace (es parte de su contrato). Es `.md` por defecto;
si la persona pide PDF, se escribe además el `.pdf` convertido de ese mismo
`.md` (ver `ai/core/references/estimation-output-format.md`).

---

## Premisa metodológica

Con desarrollo asistido por IA, **escribir el código deja de ser el cuello
de botella**. El tiempo real se concentra en entender sin ambigüedad el
requisito, revisar/validar lo que la IA produce (más riguroso en dominios
sensibles: dinero, aislamiento de datos, autorización — ver las reglas
innegociables del proyecto en `CLAUDE.md`/`AGENTS.md`), coordinar el
contrato cuando cruza capas, y hacer QA real de los flujos y casos borde.

**El primer error que evita este procedimiento es mezclar scopes.** Un
requisito casi siempre menciona otros — como precondición, como algo que
dispara, o solo como contexto de "esto lo hace otra capa". Si se cuentan
como si fueran trabajo propio de la tarea, el número queda inflado con
complejidad que no le pertenece. Por eso el Step 3 clasifica cada
referencia **antes** de contar nada.

**El segundo error es tratar "cuánto hay que construir" y "cuán riesgoso
es" como si fueran lo mismo.** Veinte reglas de negocio simples no son
necesariamente más difíciles que tres reglas que tocan dinero, autorización
y una migración. Por eso el score se calcula en **dos ejes separados** —
Volumen funcional y Riesgo técnico — y se combinan con un peso fijo 50/50,
no se suman en una sola bolsa. Así una tarea chica pero riesgosa no queda
subestimada frente a una tarea grande pero simple.

**El tercer error es la deriva entre agentes.** Dos modelos que lean el
mismo requisito deberían llegar a números parecidos. Por eso: la
clasificación de referencias tiene un árbol de decisión con prioridad fija
y un default explícito (🟡, nunca 🟣); las banderas de dominio y de deuda
técnica solo se activan con evidencia concreta del CORE propio; las
ambigüedades se separan por severidad con criterios explícitos; y todos los
ajustes de tiempo son porcentajes fijos, nunca rangos ni "a criterio".
Menos judgment calls sueltos → menos divergencia entre corridas. Y antes de
fijar cualquier número (Step 7), se reverifica la suma una segunda vez — el
modo de falla más común observado en la práctica no fue una regla mal
aplicada, sino un error de aritmética al sumar.

**El QA es una variable independiente, no una fase más.** Se calcula aparte
en 3 niveles de cobertura (básico/intermedio/completo) y **no se suma** al
desarrollo — la persona decide cuántas horas de QA sumarle según el riesgo
que esté dispuesta a aceptar.

**El output es intencionalmente mínimo, y es el único output.** Todo el
cálculo de dos ejes, severidades y ajustes es interno (Steps 3-10) y **no
se vuelca completo** en el resultado final; solo se cita lo que explica el
número. El archivo `.md` generado es la respuesta — el chat solo confirma
que se generó (Step 13), nunca repite ni explica su contenido salvo que la
persona lo pida aparte.

---

## Personalización por proyecto

Este bloque es lo único que cambia entre proyectos. Los valores por defecto
funcionan sin configurar nada; un proyecto los afina en `ai-workspace.json`
(clave `project.estimation`) o en su `CLAUDE.md`. Lo que el procedimiento
lee de acá:

| Parámetro | Default de la base | Cómo lo ajusta el proyecto |
|---|---|---|
| **Directorio de output** | `estimations/` en la raíz del repo | `project.estimation.outputDir` |
| **Patrón de ID de fuente** | Cualquier identificador de ticket/issue (`ABC-123`, `#456`, `RF-X.XX`, un slug) | `project.estimation.idPattern` o el `project.ticketPrefix` que ya usa `create-branch` |
| **Formato de salida** | `md`; `pdf` solo si se pide | `project.estimation.format`; un pedido explícito en la conversación gana |
| **Fuente de breakdown/spec** (Step 2) | Ninguna — deriva todo del crudo | Si el proyecto usa un flujo de breakdown o el pack `openspec`, declarar dónde viven |
| **Banderas de dominio extra** (Step 6) | Solo las universales (💰🔒🔑 + migración destructiva) | Agregar banderas propias con su evidencia y sus puntos (ver "Banderas de dominio propias") |

**Banderas de dominio propias.** Las universales cubren la mayoría de los
proyectos. Si un dominio de negocio tiene un patrón de riesgo recurrente que
las universales no capturan, el proyecto lo declara acá con la misma forma
que las universales del Step 6: un nombre, la **evidencia concreta en el
texto fuente** que la activa (nunca inferida), y sus puntos de riesgo. El
procedimiento las trata igual que las universales. Ejemplos de bandera
propia: "parámetro global vs. por-tenant mezclado en el mismo esquema" en un
SaaS multi-tenant; "cálculo regulado / cumplimiento" en fintech; "integración
con hardware físico" en IoT. **Sin declaración explícita del proyecto, solo
corren las universales** — nunca inventar una bandera de dominio que el
proyecto no declaró.

---

**Input**: Uno o más paths de documentos de requisito **crudos**
(descripciones completas, no un breakdown ya generado). Si no se provee
ninguno, usar **AskUserQuestion** para pedirlos antes de continuar.

**Output**: Un archivo `.md` **corto** por fuente, en el directorio de
estimaciones del proyecto (`<outputDir>/<id>-estimation.md`). Ver template
del Step 12 — no debería superar ~15-18 líneas por tarea.

---

## Steps

### 1. Recibir y validar input

- Identificar el/los documento(s) fuente.
- Si no se especificó ninguno → **AskUserQuestion**:
  > "¿Qué requisito(s) querés estimar? Pasame el path del documento crudo
  > (ticket, historia, spec)."
- Leer cada archivo fuente **completo** con Read. Si supera 200 líneas,
  procesar por secciones y combinar al final — nunca truncar ni saltar.
- Verificar si ya existe `<outputDir>/<id>-estimation.md`: si existe,
  avisar y preguntar si sobreescribir o versionar (`-v2.md`).

### 2. Enriquecer con breakdown/spec existente (opcional, no bloqueante)

- Si el proyecto declaró una fuente de breakdown o specs (ver
  Personalización) y existe una para esta fuente, leerla también. Un
  breakdown suele traer las referencias externas ya clasificadas (reusables
  en el Step 3) y un conteo de ambigüedades ya depurado.
- Si no existe o el proyecto no usa ese flujo, **no es un bloqueante**:
  derivar todo directamente del fuente crudo. Este procedimiento **no
  depende** de que exista un breakdown previo.

### 3. Delimitar el CORE de la tarea — clasificar cada referencia externa

**Este paso va primero, antes de contar cualquier señal.** Define qué es
"esta tarea" y qué son tareas previas o vinculadas — sin esto, una tarea
que solo *menciona* mucho detalle de otras capas puede inflar el score con
complejidad que no le pertenece.

Recorrer el documento completo (priorizar la tabla de "Dependencias" /
"Requisitos involucrados" si existe) y listar cada mención a otro ticket,
requisito, módulo o issue, excluyendo el ID propio.

**Regla de conteo**: cada **ID de ticket distinto** cuenta como una
referencia separada, incluso si el documento los agrupa en la misma
fila/oración con un solo rol compartido (ej. "ABC-8 / ABC-9" cuenta como
**2** referencias, no 1; ambas heredan la misma clasificación).

Clasificar cada una recorriendo este árbol de decisión **en este orden
exacto** — el primer criterio que matchee gana:

1. ¿El texto está en una sección "Qué NO es" / "No aplica" del propio
   requisito, o dice explícitamente "no es responsabilidad de esta tarea" /
   "eso es X" / "es independiente de X"? → **⚪ Fuera de scope explícito.**
2. ¿Esta tarea es la que **actúa sobre** el otro sistema — lo crea, lo
   dispara, lo encola, lo notifica ("crea una disputa en", "genera una
   alerta hacia", "delega a", "encola para")? → **🔵 Activado por esta tarea.**
   **Regla direccional**: para el mismo par de tickets, la clasificación
   puede ser opuesta según cuál se esté estimando. Si *esta* tarea
   produce/escribe el dato o señal que la otra referencia consume ("aguas
   arriba") → 🔵. Si *esta* tarea es la que lee/consume algo que la otra ya
   produjo ("aguas abajo") → no es 🔵, cae en el default 🟡.
3. ¿El texto dice explícitamente "en coordinación con" o describe una
   tabla/config que **otro ticket activamente escribe/administra en una UI
   propia** mientras esta tarea coexiste con esa administración en el mismo
   ciclo de análisis (ej. una pantalla de configuración vs. el servicio que
   la consume, ambos in-flight)? → **🟣 Paralelo/Coordinado.**
4. **Default — cualquier otro caso**, incluida cualquier relación ambigua:
   → **🟡 Pre-condición.** Cubre "ya existe", "hereda", "consume", "origen
   de la señal X", y **cualquier caso dudoso**.

| Tipo | Emoji | Costo para esta tarea |
|---|---|---|
| Fuera de scope explícito | ⚪ | Cero — es solo contexto |
| Activado por esta tarea | 🔵 | Real — hay que escribir la integración |
| Paralelo / Coordinado | 🟣 | Medio — coordinar contrato, no implementar lógica ajena |
| Pre-condición (default) | 🟡 | Bajo — solo verificar que ya está disponible |

**Por qué el default es 🟡 y no 🟣**: la mayoría de las referencias son del
tipo "esta capa consume lo que otra ya produjo" — la relación más barata y
más común. Reservar 🟣 solo para coordinación activa explícita evita que
cualquier referencia dudosa infle el score por defecto.

Esta clasificación reemplaza cualquier conteo plano de "tickets
mencionados" — se usa en el Step 4 (Volumen) y el Step 6 (Riesgo), nunca en
el Step 5.

### 4. Extraer señales de Volumen funcional del CORE (uso interno)

**Volumen funcional mide cuánto comportamiento hay que implementar** — no
cuán difícil es. Recorrer **solo el contenido que pertenece al CORE**
(excluyendo lo ⚪ del Step 3) y contar:

| Señal | Cómo detectarla |
|---|---|
| Reglas de Negocio (RN) | Ítems de regla de negocio propios de este requisito |
| Criterios de Aceptación (CA) | Ítems de criterio de aceptación |
| Casos de Uso (CU) | Ítems de caso de uso / flujo |
| Casos Borde (CB) | Ítems de caso borde / excepción |
| Entidades/tablas nuevas o modificadas | Mencionadas como creación/alteración de esquema **de esta tarea** |
| Referencias 🟡 Pre-condición (Step 3) | Solo si representan una dependencia técnica real — ver regla abajo |

Un RN/CA/CU/CB que describe en detalle el comportamiento interno de una
referencia ⚪ **no cuenta acá** — es contexto, no un ítem a implementar.

**Regla para contar una referencia 🟡 en Volumen**: solo suma si esta tarea
necesita, de forma concreta, **consumir** un dato/señal/API de esa
referencia, **verificar** una precondición técnica antes de ejecutar, o
**coordinar** su existencia (ej. un flag que debe estar en `true`). Una
mención puramente narrativa o de ordenamiento temporal — "esto ocurre
después de X", "en el contexto de X" — sin que el CORE de esta tarea lea,
valide o dependa técnicamente de nada de X, **no suma**.

Si un archivo no usa nomenclatura formal (RN/CA/CU/CB), aplicar el mismo
criterio por equivalencia: flujos en prosa como RN implícitos, condiciones
"si/cuando" como CA implícitos, menciones de errores/reintentos como CB
implícitos.

**Puntaje de Volumen (raw)**:

| Señal | Puntos |
|---|---|
| Por cada RN | +1 (cap 15 pts) |
| Por cada CA | +0.5 |
| Por cada CU | +1 |
| Por cada CB | +1 |
| Por cada entidad/tabla nueva | +4 |
| Por cada entidad/tabla modificada | +3 |
| Por cada referencia 🟡 (Step 3) | +0.5 c/u (cap 5 pts) |

### 5. Clasificar ambigüedades por severidad (uso interno)

Detectar ambigüedades/riesgos sin resolver del CORE (marcados `⚠️`, "no
definido", "a confirmar", "pendiente", `TBD`, o en Riesgos sin marca de
resuelto). **Cada una se clasifica por severidad** — no todas pesan lo
mismo:

| Severidad | Señales en el texto | Puntos (riesgo) | Ajuste al máximo |
|---|---|---|---|
| Menor | copy/textos/nombres/detalles visuales, mensajes no críticos sin definir | +1 | +0% |
| Importante (default si es dudoso) | momento/orden de una validación, elección entre 2 comportamientos razonables, umbral/default propuesto pendiente de confirmar | +2 | +10% |
| Bloqueante | regla de cálculo no definida, fuente de verdad desconocida, comportamiento transaccional no definido, permisos críticos no definidos, estado de una migración desconocido | +4 | +25% |

**El default de severidad dudosa es Importante, no Menor** — a diferencia
del default de referencias (Step 3, que sí es el más barato), una
ambigüedad de negocio real casi nunca es solo copy; asumir lo más barato
subestimaría sistemáticamente.

Cap del ajuste temporal combinado de todas las ambigüedades: **+75% al
máximo** (ver Step 9).

### 6. Detectar señales de Riesgo técnico del CORE (uso interno)

**Riesgo técnico mide dificultad, incertidumbre y posibilidad de
regresión** — no cuánto hay que construir. Una bandera solo se activa si
el CORE propio de esta tarea manipula ese dominio — no alcanza con que el
texto mencione el *nombre* de un dato/señal que en realidad pertenece a una
referencia 🟡/⚪ (ejemplo: si esta tarea solo *lee* un `total_mismatch` que
otra capa calculó, eso no activa 💰 acá).

**Regla anti-contaminación cruzada**: activar una bandera **solo** con
evidencia dentro **de este mismo archivo fuente** — nunca por conocimiento
de otros tickets relacionados que puedas tener de otra parte de la
conversación o de memoria. Si la evidencia no está en el archivo que se está
leyendo en el Step 1, la bandera no se activa.

**Determinar primero qué capas aplican** (mismo criterio que el Step 9):
Backend si hay lógica server-side propia; Frontend si además hay
pantalla/formulario/componente propios. Esto se necesita acá para el
puntaje de "Capas BOTH" — no esperar al Step 9 para definirlo.

**Banderas universales** (aplican en cualquier proyecto):

| Bandera | Se activa si el CORE de esta tarea... | Puntos |
|---|---|---|
| 💰 Dinero | ...calcula, compara o persiste montos con lógica propia (tolerancias, redondeo monetario, saldos) | +5 |
| 🔒 Aislamiento de datos / multi-tenant | ...filtra o resuelve datos por dueño/tenant/organización como parte de su propia lógica | +5 |
| 🔑 Auth / autorización | ...valida tokens, guards, roles, permisos, cookies o crypto como parte de su propia lógica | +5 |
| Migración con backfill o breaking change | Esquema propio con backfill, o drop/renombre de columnas con datos | +5 |
| Capas Backend + Frontend simultáneas | Ambas capas aplican (determinado arriba) | +3 |
| Referencia 🔵 (Step 3) | Cada una — es integración real que hay que construir | +1.5 c/u |
| Referencia 🟣 (Step 3) | Cada una — coordinación de contrato activa | +1 c/u |
| ↩️ Corrige/reemplaza una decisión ya implementada | El texto dice explícitamente que **esta tarea** cambia un comportamiento propio previo | +5 |
| Ambigüedades (Step 5) | Suma de puntos por severidad | ver Step 5 |

**Banderas de dominio propias del proyecto**: si el proyecto declaró
banderas extra (ver Personalización), activarlas con la misma disciplina de
evidencia — solo con señal concreta en este archivo fuente. Sin declaración,
no hay banderas extra.

**Banderas de spec/documentación (📄) — solo si el proyecto usa un flujo
spec-driven** (p. ej. el pack `openspec`). Si el proyecto no lo usa, omitir
esta bandera por completo:

| Categoría | Se activa si... | Puntos |
|---|---|---|
| 📄 Capability nueva | No existe una spec funcionalmente equivalente a lo que este requisito implementa | +3 |
| 📄 Extensión de capability existente | Existe una spec equivalente y el requisito agrega/modifica comportamiento sobre ella | +1 |
| 📄 Documentación pura | El requisito no cambia comportamiento, solo documenta algo ya implementado | +0 |

**Criterio para clasificar 📄**: lo que determina la categoría es si existe
o no una spec **funcionalmente equivalente** — no la mera existencia de una
carpeta. Usar Glob/Grep sobre el directorio de specs del proyecto como
**evidencia auxiliar**, nunca como prueba única. **Default determinista si
no se puede determinar con seguridad**: clasificar como **Extensión** (+1) —
el punto medio entre asumir capability nueva (+3, sobreestima) y mera
documentación (+0, subestima).

**🏚️ Deuda técnica / código legado** — activar **solo con evidencia
explícita** en el texto fuente. Nunca inferir ni asumir mala calidad por
falta de información:

| Nivel | Evidencia requerida en el texto | Puntos | Ajuste al máximo |
|---|---|---|---|
| Sin evidencia (default) | El texto no dice nada sobre el estado del código existente | +0 | +0% |
| Acoplamiento moderado | "lógica compartida difícil de modificar", "depende de", "duplicación limitada", acoplamiento entre módulos mencionado explícitamente | +3 | +10% |
| Código legado / difícil | "código legado", "muy acoplado", "sin separación de responsabilidades", "lógica duplicada", "sin tests en esta zona", "módulo difícil de modificar" | +6 | +20% |
| Refactor requerido explícito | El texto pide refactorizar una parte **independiente** del sistema | — | No ocultar en un %. Evaluar como candidato de split (Step 8). |

### 7. Calcular Volumen (1-10) + Riesgo (1-10) → Complejidad final

Sumar los puntos del Step 4 (Volumen raw) y convertir a 1-10:

| Volumen raw | Rating |
|---|---|
| 0–3 | 1 |
| 4–7 | 2 |
| 8–12 | 3 |
| 13–17 | 4 |
| 18–22 | 5 |
| 23–27 | 6 |
| 28–32 | 7 |
| 33–37 | 8 |
| 38–43 | 9 |
| 44+ | 10 |

Sumar los puntos del Step 6 (Riesgo raw, incluyendo Step 5) y convertir a 1-10:

| Riesgo raw | Rating |
|---|---|
| 0–3 | 1 |
| 4–7 | 2 |
| 8–11 | 3 |
| 12–15 | 4 |
| 16–19 | 5 |
| 20–23 | 6 |
| 24–28 | 7 |
| 29–34 | 8 |
| 35–42 | 9 |
| 43+ | 10 |

**Regla de búsqueda del intervalo (determinista, sin zonas grises)**: los
raw pueden ser fraccionarios (por CA×0.5 o refs🟡×0.5). Antes de buscar el
intervalo:

1. Aplicar `ceil(raw)` (redondear siempre hacia arriba al entero más
   cercano — `ceil(27.0) = 27`, `ceil(27.01) = 28`).
2. Buscar ese entero en la tabla. Como los intervalos son enteros
   contiguos y sin solapamiento, el entero cae en exactamente una fila.
3. Usar el rating de esa fila.

**Validación (3 casos obligatorios a chequear si hay dudas):**
- Entero en el límite inferior: `raw = 28` → `ceil(28) = 28` → cae en "28–32" → rating 7.
- Entero en el límite superior: `raw = 32` → `ceil(32) = 32` → cae en "28–32" → rating 7 (no salta a la fila siguiente).
- Fraccionario entre dos intervalos: `raw = 27.5` → `ceil(27.5) = 28` → cae en "28–32" → rating 7 (no en "23–27").

**Regla de redondeo (única para todo el procedimiento)**: `redondear(x) =
floor(x + 0.5)`. Es la definición matemática de "0.5 hacia arriba" — no
depende de la convención de redondeo del modelo o lenguaje que ejecute el
cálculo (evita el redondeo bancario, que resolvería `6.5` hacia `6`). Se usa
acá y en todo redondeo de horas de los Steps 9-10.

**Complejidad final = floor(0.5 × Volumen_rating + 0.5 × Riesgo_rating + 0.5)**,
acotado a [1,10]. Peso igual para ambos ejes — ninguno domina por diseño,
así una tarea chica-pero-riesgosa y una tarea grande-pero-simple con el
mismo nivel real de esfuerzo llegan a calificaciones comparables.

**Qué significa este número**: la Complejidad final es una medida
**combinada** de esfuerzo (Volumen) y dificultad técnica (Riesgo) — no es
exclusivamente un score de riesgo ni exclusivamente una medida de tamaño.
Un riesgo extremo (ej. Riesgo=10 con Volumen=1) ya se refleja en el promedio
(Complejidad=floor(0.5×1+0.5×10+0.5)=6) y, sobre todo, en el rango
mín/medio/máx del Step 9 vía los ajustes porcentuales — no hace falta (ni se
debe agregar) un piso artificial que fuerce la Complejidad hacia arriba por
riesgo alto.

**Verificación obligatoria**: volver a sumar Volumen raw y Riesgo raw una
segunda vez, en el mismo orden, antes de fijar los ratings y la Complejidad
final. Un error de suma es el modo de falla más común de este step — dos
corridas con las mismas señales y la misma clasificación deben llegar al
mismo resultado.

Una Complejidad final **8-10** → ir al Step 8 antes de estimar el tiempo.

### 8. Evaluar si es un conjunto de tareas — split solo si hay un límite natural

Una Complejidad ≥ 8 es una **alerta**, no una orden automática de dividir.
Puede llegar a 8-10 solo por volumen o por riesgo altos y seguir siendo
**una sola pieza de lógica cohesiva** — dividir a la fuerza produce
subtareas artificiales que no se pueden entregar ni desplegar por separado.

**Dividir solo si existe un límite natural entre partes entregables por
separado.** Señales de bundle (cualquiera basta):

- Lenguaje de consolidación de *entidades o pantallas independientes*:
  "consolida varios parámetros/pantallas" o "el alcance se fue ampliando
  para cubrir [N tablas/pantallas distintas]" (no confundir con un servicio
  que "consolida señales" en runtime — eso es comportamiento, no bundle).
  **"Renumerado desde" / "renombrado desde" por sí solo NO cuenta** — es un
  dato administrativo de a qué módulo pertenece el ticket, no una señal de
  que agrupe entidades independientes. Solo suma si aparece **junto con**
  evidencia real de consolidación de entidades/pantallas.
- **3 o más** entidades/tablas independientes, cada una con su propia
  pantalla/sección de configuración.
- **Dos o más entregables funcionales independientes** (ej. dos endpoints o
  dos APIs que podrían liberarse en releases distintos).
- Una **capability principal + una integración externa independiente** (la
  integración podría entregarse antes/después sin bloquear la otra).
- Una **migración de datos independiente** de la funcionalidad (el esquema
  podría cambiar en un release separado del resto).
- **Backend y Frontend con ciclos de entrega distintos** (el backend expone
  algo usable sin esperar la pantalla, o viceversa).
- **Dos dominios de negocio** con reglas y ciclos de entrega propios,
  descriptos como secciones separables del mismo documento.
- **Refactor requerido explícito** de una parte independiente (🏚️, Step 6)
  — se separa como subtarea propia en vez de ocultarse en un ajuste de %.

**No dividir solo porque**: hay muchas reglas, muchos métodos, muchas capas,
o la Complejidad es 8-10 — eso por sí solo no es un límite natural.

Si **ninguna** señal de bundle aparece, no dividir: mantenerla como tarea
única y dejar explícito en el "por qué" que el número tiene más
incertidumbre de lo normal.

Si sí aplica split: agrupar por dominio de negocio/entidad (no por capa),
nombrar cada subtarea `<ID>-A <dominio>`, `<ID>-B <dominio>`, etc., y
repetir los Steps 3-10 **para cada una por separado** (cada subtarea saca su
propia Complejidad y su propio QA, normalmente más bajos que el conjunto).
Documentar solo si una subtarea bloquea a otra (una línea).

### 9. Estimar tiempo de desarrollo mínimo / medio / máximo por capa

Determinar qué capas aplican:
- **Backend aplica** si el texto menciona, propio de esta tarea: entidad/
  tabla, servicio, endpoint, controller, DTO, guard, regla de negocio
  ejecutada server-side, migración, evento/listener. Es el caso más común.
- **Frontend también aplica** (línea separada) si además el texto menciona,
  propio de esta tarea: pantalla, formulario, componente, hook, estado de
  UI, validación de UI, copy/mensaje mostrado a la persona.
- **Solo Frontend aplica** si hay señales de Frontend pero ninguna de
  Backend (UI/copy/layout sin lógica server-side nueva).
- Si el texto no da ninguna señal de ninguna de las dos listas, **no
  asumir** — tratar como Backend por default solo si hay al menos una RN o
  CA propia (la lógica de negocio tiene que vivir en algún lado); si tampoco
  hay eso, es una ambigüedad a listar en el "por qué", no una capa a inventar.
- **Nunca mostrar una capa que no aplica.**

Estos números cubren **análisis, diseño y desarrollo** — el QA vive aparte
en el Step 10.

**Tabla ancla por Complejidad final (horas, antes de ajustes) — un valor
por cada nivel 1-10, sin saltos bruscos entre niveles adyacentes:**

| Complejidad | Backend mín·medio·máx | Frontend mín·medio·máx |
|---|---|---|
| 1 | 1h · 1h · 2h | 1h · 1h · 1h |
| 2 | 1h · 2h · 3h | 1h · 1h · 2h |
| 3 | 2h · 3h · 5h | 1h · 2h · 4h |
| 4 | 3h · 5h · 7h | 2h · 4h · 5h |
| 5 | 4h · 7h · 10h | 3h · 5h · 7h |
| 6 | 5h · 9h · 14h | 4h · 7h · 10h |
| 7 | 7h · 12h · 19h | 6h · 9h · 14h |
| 8 | 9h · 16h · 25h | 7h · 12h · 18h |
| 9 | 12h · 21h · 33h | 9h · 16h · 24h |
| 10 | 16h · 27h · 43h | 12h · 20h · 32h |

**Validado**: la tabla es monotónica — cada columna sube o se mantiene al
subir de nivel (nunca baja), y en cada fila mín ≤ medio ≤ máx.

**Por qué algunas señales afectan la Complejidad Y además el ajuste de
tiempo — no es doble conteo accidental**: la Complejidad final (Step 7)
desplaza **toda la fila** de la tabla ancla (mín, medio y máx juntos) — es
el nivel base esperado. Los ajustes de este step modifican **solo el máximo
o solo el medio** de esa fila, porque representan específicamente cuánto
puede desviarse el peor caso (ambigüedad, deuda técnica, ↩️) o cuánto exige
de rigor extra la revisión (dominio sensible). Por eso:
- Migración **no** tiene ajuste de tiempo propio — su efecto ya está
  reflejado en la Complejidad (vía Step 6).
- Ambigüedad, deuda técnica y ↩️ **sí** tienen ajuste directo, porque son
  específicamente fuentes de incertidumbre de peor-caso.
- Dominio sensible (💰/🔒/🔑 y banderas propias del proyecto) **sí** tiene
  ajuste directo sobre el medio, porque implica una ronda de revisión
  adicional en el caso esperado, no solo en el peor caso.

**Ajustes — porcentajes fijos, no rangos, no "a criterio":**

- Por severidad de ambigüedad (Step 5): **sumar** el % de cada una (Menor
  +0%, Importante +10%, Bloqueante +25%); si la suma supera +75%, usar +75%.
  Este subtotal se aplica al **máximo**. Llamar a este subtotal `P_ambig`.
- Por deuda técnica (Step 6): acoplamiento moderado +10%, código legado +20%
  al **máximo** (no combinar ambos niveles, usar el más alto detectado).
  Llamar a esto `P_deuda`.
- Si ↩️ corrige/reemplaza una decisión ya implementada: **+20% fijo al
  máximo**. Llamar a esto `P_correccion` (0% si no aplica).
- Por cada bandera de dominio (💰/🔒/🔑 y las propias del proyecto) presente:
  **sumar +10% por bandera** (aditivo, no compuesto). Se aplica al **medio**.
  Llamar a este subtotal `P_dominio`.
- El **mínimo nunca se ajusta** — representa el caso sin fricción.

**Fórmula explícita (al ser puramente multiplicativa, el orden de los
factores no altera el resultado):**

```
máx_final   = redondear( base_máx   × (1 + P_ambig) × (1 + P_deuda) × (1 + P_correccion) )
medio_final = redondear( base_medio × (1 + P_dominio) )
mín_final   = base_mín
```

donde `redondear(x) = floor(x + 0.5)` (Step 7) y los `P_*` están en forma
decimal (10% = 0.10). **No redondear** ningún producto intermedio — solo el
resultado final de `máx_final` y `medio_final`. Redondear antes de tiempo es
la causa más común de que dos corridas con las mismas señales den horas
ligeramente distintas.

**Desglose obligatorio: cuánto de esas horas es entender vs. codear.** La
premisa metodológica es que la IA escribe el código — el tiempo humano real
está en leer el requisito, resolver ambigüedades con quien lo pidió, y
revisar lo que la IA produjo (más a fondo en dominios sensibles). Esa
premisa tiene que verse en el número. Descomponer `mín_final`, `medio_final`
y `máx_final` (por capa) en análisis vs. implementación con una proporción
fija que **crece hacia el máximo**, porque el peor caso está dominado por
ciclos de clarificación (análisis), no por más tipeo:

```
análisis_mín   = redondear( mín_final   × 0.25 )
análisis_medio = redondear( medio_final × 0.35 )
análisis_máx   = redondear( máx_final   × 0.45 )
```

(implementación = el resto de cada valor). Esta descomposición es puramente
informativa — **no suma horas nuevas**, solo reparte las que ya existen. Se
muestra en el output como anotación entre paréntesis (Step 12):
`mín 7h (~2h análisis) · medio 16h (~6h análisis) · máx 26h (~12h análisis)`.

### 10. Estimar QA — variable independiente en 3 niveles

El QA **no se suma** al tiempo de desarrollo del Step 9. Se presentan 3
niveles como opciones separadas:

- **Básico** — solo el flujo feliz principal. Verifica que el happy path
  funciona de punta a punta.
- **Intermedio** — básico + todos los CA + los CU principales.
- **Completo** — intermedio + todos los CB + regresión si hay ↩️ o 🏚️ +
  verificación bajo dominio sensible si aplica 💰/🔒/🔑 o una bandera propia.

**Tabla ancla por Complejidad final (horas, antes de ajustes):**

| Complejidad | Básico | Intermedio | Completo |
|---|---|---|---|
| 1 | 1h | 1h | 2h |
| 2 | 1h | 2h | 3h |
| 3 | 1h | 3h | 4h |
| 4 | 2h | 4h | 6h |
| 5 | 2h | 5h | 8h |
| 6 | 3h | 6h | 10h |
| 7 | 3h | 8h | 13h |
| 8 | 4h | 10h | 16h |
| 9 | 4h | 12h | 20h |
| 10 | 5h | 15h | 25h |

**Validado**: monotónica en las 3 columnas (nunca baja al subir de nivel), y
en cada fila Completo ≥ Intermedio ≥ Básico.

**Ajustes — porcentajes fijos:**

- Por cada bandera de dominio (💰/🔒/🔑 y las propias del proyecto) presente:
  **sumar +10% por bandera** (aditivo, igual que en el Step 9) a Intermedio y
  a Completo (no a Básico). Llamar a este subtotal `P_dominio`.
- Si ↩️ corrige una decisión ya implementada: **+20% fijo solo a Completo**
  (`P_correccion`).
- Si 🏚️ código legado (no acoplamiento moderado): **+10% fijo solo a
  Completo** (`P_legado`; regresión sobre código difícil de verificar).
- **Básico nunca se ajusta.**

```
completo_final   = redondear( base_completo × (1 + P_dominio) × (1 + P_correccion) × (1 + P_legado) )
intermedio_final = redondear( base_intermedio × (1 + P_dominio) )
básico_final     = base_básico
```

Misma regla de redondeo del Step 9/7 (`floor(x + 0.5)`), sin redondear
productos intermedios.

### 11. Determinar nombre y path del archivo output

Directorio: el `outputDir` del proyecto (default `estimations/`; crear si no
existe). Nombre: el ID de la fuente normalizado a minúsculas y guiones.

| Fuente | Nombre del estimation |
|---|---|
| `ABC-378.md` | `abc-378-estimation.md` |
| `RF-3.25.md` | `rf-3-25-estimation.md` |
| `#456` / `issue-456.md` | `issue-456-estimation.md` |

### 12. Escribir el archivo output (template mínimo)

Tarea única (sin split) — **este es el formato completo, no un resumen**:

```markdown
# Estimación — <ID> <Nombre corto>

**Complejidad: N/10** — <1 oración citando 2-3 drivers concretos de Volumen y/o Riesgo (ej. "12 reglas propias + 2 integraciones reales (🔵); riesgo alto por 🔒 aislamiento de datos y una corrección de comportamiento (↩️)"); si es 8-10 sin split, aclarar por qué no se dividió>

**Backend**: mín Xh (~Ah análisis) · medio Yh (~Bh análisis) · máx Zh (~Ch análisis)
**Frontend**: mín Xh (~Ah análisis) · medio Yh (~Bh análisis) · máx Zh (~Ch análisis)

**QA** (no se suma — elegir un nivel): básico Xh · intermedio Yh · completo Zh

**Por qué el rango**: <1 oración citando el driver concreto del máximo o del medio de desarrollo>
```

- `N/10` es la Complejidad final del Step 7.
- El `(~Ah análisis)` de cada valor es el desglose del Step 9 (0.25/0.35/0.45
  de mín/medio/máx) — **no es una hora adicional**, es la misma hora
  repartida entre entender y codear. Nunca omitir esta anotación: es la
  respuesta directa a "¿esto ya considera el tiempo humano de entender la
  tarea, no solo de que la IA escriba código?".
- Omitir la línea **Frontend** si no aplica (y viceversa con Backend). La
  línea **QA** siempre va.
- Sin tablas de Volumen/Riesgo, sin tabla de clasificación de referencias,
  sin sección de riesgos aparte — el "por qué" ya contiene lo esencial.

Si aplica split (Step 8):

```markdown
# Estimación — <ID> <Nombre> — conjunto de tareas

<1 oración: qué señal de bundle disparó la división>

### <ID>-A — <dominio>
**Complejidad: N/10** — <motivo breve>
**Backend**: mín Xh (~Ah análisis) · medio Yh (~Bh análisis) · máx Zh (~Ch análisis)
**Frontend**: mín Xh (~Ah análisis) · medio Yh (~Bh análisis) · máx Zh (~Ch análisis)
**QA**: básico Xh · intermedio Yh · completo Zh

### <ID>-B — <dominio>
**Complejidad: N/10** — <motivo breve>
**Backend**: mín Xh (~Ah análisis) · medio Yh (~Bh análisis) · máx Zh (~Ch análisis)
**QA**: básico Xh · intermedio Yh · completo Zh

**Total desarrollo**: Backend mín X · medio Y · máx Z h · Frontend mín X · medio Y · máx Z h
**Total QA**: básico Xh · intermedio Yh · completo Zh (suma de niveles equivalentes)
```

Los totales son la suma directa del valor equivalente (mín con mín, medio
con medio, máx con máx; básico con básico, etc.) de todas las subtareas para
esa capa/nivel — nunca omitir el medio. Los totales no llevan el desglose de
análisis (queda a nivel de cada subtarea, donde es accionable).

### 13. Reportar a la persona — el único output es el archivo

El archivo `.md` generado **es** el output. El chat **no** repite su
contenido — solo confirma que se generó:

```
Listo: `<outputDir>/<nombre>-estimation.md`
```

Si se pidió PDF, agregar la ruta del `.pdf` generado; si no se pudo producir,
decirlo en una línea en vez de listarlo. Reglas en
`ai/core/references/estimation-output-format.md`.

Si hubo split, agregar como máximo media oración con la señal de bundle.

**No agregar nunca**, salvo pedido explícito de la persona: el contenido del
archivo pegado en el chat, explicación de metodología, tablas de
Volumen/Riesgo/clasificación, ejemplos o comparaciones. Todo eso vive en el
archivo y en este procedimiento.

---

## Pre-stop checks — OBLIGATORIOS

- [ ] Se clasificó cada referencia externa (Step 3) siguiendo el árbol de decisión en orden — el default de lo ambiguo es 🟡, nunca 🟣.
- [ ] Cada ID de ticket distinto se contó por separado — ninguna fila agrupada ("X / Y") se contó como una sola referencia.
- [ ] Ninguna referencia ⚪ sumó puntos a Volumen ni a Riesgo.
- [ ] Volumen funcional y Riesgo técnico se calcularon como ejes separados (Steps 4 y 6) — ninguna señal de riesgo (dominio, migración, refs 🔵/🟣, ↩️, 🏚️) se coló en el cálculo de Volumen, y viceversa.
- [ ] Cada ambigüedad se clasificó por severidad (Step 5) — no se aplicó el mismo peso a todas.
- [ ] 🏚️ deuda técnica solo se activó si el texto fuente da evidencia explícita — nunca se infirió por falta de información.
- [ ] Cada bandera de dominio (💰/🔒/🔑 y las propias del proyecto) se verificó contra evidencia **de este archivo fuente**, no contra el nombre de un dato/señal de una referencia 🟡/⚪, ni contra conocimiento de otro ticket visto en otra parte de la conversación.
- [ ] No se activó ninguna bandera de dominio que el proyecto no haya declarado (más allá de las universales) — sin declaración, solo corren las universales.
- [ ] Cada referencia 🟡 sumada a Volumen representa una dependencia técnica real (consumir/verificar/coordinar) — ninguna mención puramente narrativa sumó puntos.
- [ ] 📄 spec/documentación se evaluó solo si el proyecto usa un flujo spec-driven; si se evaluó, se clasificó por equivalencia funcional y, ante duda, se usó el default Extensión (+1).
- [ ] La calificación de Volumen y de Riesgo usa la escala **1-10** (nunca 0-10) — no existe el nivel 0.
- [ ] El límite de cada tabla raw→rating se resolvió con `ceil(raw)` antes de buscar el intervalo.
- [ ] Ambos ejes (Volumen, Riesgo) se reverificaron una segunda vez antes de fijar la Complejidad final (Step 7).
- [ ] No se aplicó ningún piso artificial a la Complejidad por riesgo alto — el promedio 50/50 es la única regla de combinación.
- [ ] Los ajustes de horas (Steps 9-10) se calcularon sin redondear pasos intermedios — solo el resultado final.
- [ ] Las tablas ancla de tiempo (Steps 9-10) son monotónicas y cumplen mín ≤ medio ≤ máx / Básico ≤ Intermedio ≤ Completo en cada fila.
- [ ] Cada línea Backend/Frontend lleva la anotación `(~Nh análisis)` en mín, medio y máx (Step 9) — nunca se omite.
- [ ] Existe un archivo estimation en el `outputDir` del proyecto, siguiendo el template del Step 12.
- [ ] Se muestra Backend, Frontend, o ambos — nunca una capa que no aplica. La línea QA siempre está.
- [ ] Cada tiempo de desarrollo tiene los 3 valores (mín/medio/máx); el QA tiene los 3 niveles — nunca un solo número.
- [ ] El QA **no** está sumado al Backend/Frontend.
- [ ] La calificación está expresada como `N/10`, nunca como S/M/L/XL ni como un score crudo.
- [ ] Si la Complejidad es ≥ 8, se evaluó el Step 8 — se dividió solo si había un límite natural real, nunca por volumen/capas/complejidad altos por sí solos, ni por "renumerado desde" aislado.
- [ ] Las banderas de dominio se sumaron de forma aditiva (+10% c/u), no compuesta, tanto en Riesgo como en los ajustes de tiempo y QA.
- [ ] Todo redondeo (Complejidad y horas) usó `floor(x + 0.5)` — no el redondeo por defecto del modelo/lenguaje.
- [ ] Si hubo split, el "Total desarrollo" incluye mín, medio **y** máx por capa — nunca se omitió el medio.
- [ ] La respuesta en el chat es solo la confirmación de una línea (Step 13) — el contenido del archivo no se repitió.

---

## Guardrails

- **NUNCA** sumar señales de Volumen y de Riesgo en un solo score — son ejes independientes que se combinan 50/50 recién en el Step 7.
- **NUNCA** clasificar una referencia ambigua como 🟣 por defecto — el default es siempre 🟡 (Step 3, criterio 4).
- **NUNCA** activar una bandera de dominio o 🏚️ deuda técnica sin evidencia concreta del CORE propio — nunca inferir mala calidad de código por falta de información.
- **NUNCA** activar una bandera de dominio que el proyecto no declaró (más allá de las universales 💰/🔒/🔑 y migración destructiva).
- **NUNCA** activar una bandera usando conocimiento de otro ticket que no esté escrito en el archivo fuente que se está estimando.
- **NUNCA** sumar volumen por una referencia 🟡 que sea solo mención narrativa/de ordenamiento temporal — solo cuenta si hay una dependencia técnica real.
- **NUNCA** evaluar la bandera 📄 si el proyecto no usa un flujo spec-driven; si la usa, clasificar por equivalencia funcional y, ante duda, default Extensión.
- **NUNCA** usar la escala 0-10 — es 1-10; no existe el nivel 0.
- **NUNCA** resolver un raw fraccionario en el límite de una fila con una regla ambigua — usar siempre `ceil(raw)` antes de buscar el intervalo.
- **NUNCA** agregar un piso artificial de Complejidad por riesgo alto — el promedio 50/50 del Step 7 es la única regla de combinación.
- **NUNCA** redondear un resultado intermedio en los Steps 9-10 — solo el resultado final.
- **NUNCA** tratar todas las ambigüedades con el mismo peso — clasificar siempre por severidad (Step 5); el default dudoso es Importante, no Menor.
- **NUNCA** pegar el contenido del archivo en el chat — el único output es el archivo (`.md`, más `.pdf` solo si se pidió).
- **NUNCA** generar PDF sin que se pida, ni reportar un PDF que no se pudo producir.
- **NUNCA** contar una señal sin haber pasado primero por el Step 3.
- **NUNCA** sumar puntos por una referencia ⚪.
- **NUNCA** sumar el QA al tiempo de Backend/Frontend.
- **NUNCA** usar un rango de porcentaje en los ajustes — son fijos y únicos.
- **NUNCA** producir un output largo — si el borrador supera ~18 líneas por tarea, recortar.
- **NUNCA** mostrar Backend y Frontend si solo uno aplica.
- **NUNCA** dar un solo número de tiempo — siempre mín/medio/máx, y los 3 niveles en QA.
- **NUNCA** mostrar la calificación como S/M/L/XL — siempre `N/10`.
- **NUNCA** dividir un requisito solo porque la Complejidad es ≥8, ni solo porque hay muchas reglas/capas — dividir únicamente si existe un límite natural entre partes entregables por separado (Step 8).
- **NUNCA** ocultar un refactor explícitamente requerido dentro de un simple ajuste de porcentaje — evaluarlo como candidato de split.
- **NUNCA** tratar un breakdown existente como sustituto del fuente crudo.
- **NUNCA** inventar señales no presentes en el texto.
- Si el fuente no usa nomenclatura formal (RN/CA/CB), aplicar el criterio de equivalencia del Step 4.
