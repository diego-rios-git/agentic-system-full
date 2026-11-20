# ODD: el protocolo

Organic Driven Development: un flujo que **escala solo según lo que el trabajo necesita**. Lo simple se hace directo. Lo incierto se investiga. Lo grande arma su documento de tareas. Lo crítico se verifica.

Corre en **cada pedido**, sin que nadie pida "un plan" ni "una lista de tareas". De dónde viene, qué se tomó y qué se dejó: `ai/packs/odd/references/odd-origen.md`.

---

## La idea que lo sostiene

La ceremonia es un costo. Un ciclo que exige propuesta, diseño, tareas y archivo para todo lo cobra igual en un cambio de tres líneas que en una funcionalidad de dos semanas. En el cambio chico el costo no compra nada, y el equipo aprende a saltear el ciclo. Cuando llega el cambio grande, ya no lo usa nadie.

ODD invierte la regla: **ningún mecanismo está prendido por defecto**. Cada uno —preguntar, mapear, registrar, delegar, verificar— tiene su propio disparador, y solo se activa cuando ese disparador se cumple de verdad. Ante la duda, se trabaja directo.

La contracara: **cuando un disparador se cumple, no es opcional.** Seguir de largo con el disparador cumplido es un defecto de ruteo aunque el resultado salga bien.

---

## Los siete pasos, en orden, en cada pedido

### 1. Autorizar

¿El pedido autoriza un cambio? Investigar, explicar, revisar, comparar y proponer son **de solo lectura**: no se escribe código ni se crean artefactos de implementación.

Si no está claro si se autorizó un cambio, **una** pregunta y se espera. Una persona que dice "quizás te frene" o "lo sigo mañana" está pidiendo notas al día y cortes limpios, no que se frene.

### 2. Explorar

Leer el código y los requisitos existentes **antes** de proponer o escribir nada, en proporción al pedido. Si hay ficha en el tablero de requisitos, se lee primero.

No se delega la lectura de archivos que uno mismo va a leer igual para escribir. Se delega solo un **mapa** que hace falta para decidir o para rutear (ver los disparadores).

### 3. Resolver la incertidumbre

- **Investigar** solo ante una incertidumbre con nombre. Con fuentes primarias, citando URL o `ruta:línea`, y distinguiendo lo verificado de lo supuesto.
- **Preguntar** solo ante una decisión de producto abierta de verdad: una pregunta, enfocada, y se espera. Lo que se puede averiguar leyendo no se pregunta.
- **Desafiar un supuesto**, como mucho una vez y de solo lectura, cuando una premisa sin probar tiene consecuencias graves. Se nombra la premisa, la evidencia y la consecuencia. Sin debate en bucle: una falla determinista se arregla, no se discute.

### 4. Clasificar

Medir el tamaño con la sección siguiente. **Solo** sus tres criterios deciden. Lo chico va por el camino chico.

### 5. Registrar antes de la primera escritura

Solo si la tarea es grande y está autorizada: crear el documento de la funcionalidad (`odd-documento`) **antes** de tocar código, sin pedir permiso para eso, y decir en una línea qué documento se creó y cuántas tareas tiene.

### 6. Implementar tarea por tarea

- Cada tarea con su ruta (directo o delegado, por los disparadores) y con tests primero cuando aplica (`odd-tests`).
- Al delegar, se pasa **una referencia, nunca un resumen**: `Spec: odd/tasks/<funcionalidad>.md, T2, S3-S4`, leer hasta `## Log`, y reportar qué `S#` cubrió. Sin documento, se pasa el pedido textual de la persona.
- Si la persona reporta una falla, **se reproduce** antes de decidir que ya anda.
- Si se agrega o cambia un comando, una opción o un mensaje, se actualizan la ayuda y la documentación que lo describen.
- Una tarea se marca hecha **solo con su resultado y sus checks observados**. El documento se actualiza en cada transición.

### 7. Cerrar

Reportar el resultado verificado, **cada** check que falló, se omitió o quedó pendiente, y el paso siguiente.

- Toda tarea registrada termina hecha, o con la orden de frenar de la persona **citada textual**.
- Un check que aplica corre una vez. Un verificador que no está disponible se reporta como no disponible: no se reintenta ni se escala a más ceremonia.
- Si la prueba quedó parcial, bloqueada o agotada, el cierre es **un** resultado **"Necesita tu decisión"** con los bloqueos y la prueba que falta. Esa es una parada válida. Una redacción evasiva ("debería andar") no lo es.

---

## Tamaño

Una tarea es **chica** cuando se cumplen las tres:

1. **Entendida.** El resultado está especificado, se sabe qué cambiar y dónde, y no hay una decisión de producto o de diseño abierta. Se demuestra en **una** tanda de lectura acotada: como mucho tres llamadas y unos 10k tokens.
2. **Riesgo contenido.** No toca ningún ítem de riesgo alto (abajo).
3. **Retomable desde el diff.** Si la sesión se cortara ahora, alguien podría terminarla con el pedido original y `git diff`, nada más.

Es **grande** solo cuando falla la prueba de retomar: hacen falta varias sesiones, se espera algo externo, hay entregables separados que la persona quiere aparte, o los requisitos son demasiado largos para sobrevivir a una compactación del contexto.

**No deciden el tamaño:** la cantidad de archivos, de comandos, de tests o de arreglos, ni que la persona pida una lista de tareas. Un cambio entendido que toca seis archivos es chico. Varios pedidos chicos juntos siguen siendo chicos y van uno detrás de otro.

**Camino chico:** directo. Leer y editar, aunque sean varios archivos de un mismo cambio entendido. Ver el test en rojo antes del arreglo. Correr el test enfocado y la suite, una vez cada uno. Sin explorador, sin escritor delegado, sin verificador. Sin documento, sin espejo en memoria y sin commits salvo que la persona los pida.

---

## Riesgo alto

Un error sería difícil de detectar, difícil de deshacer, o llegaría más allá del cambio. El cambio toca:

| # | Ítem | Sí cuenta | No cuenta |
|---|---|---|---|
| 1 | **Datos o efectos irreversibles** | Migraciones, cambiar o borrar datos guardados, cambiar un formato persistido | Guardar registros nuevos; una base de desarrollo que un seed reconstruye |
| 2 | **Seguridad** | Autenticación, permisos, credenciales, secretos, guards, aislamiento entre clientes | — |
| 3 | **Contratos que otros consumen** | Cambiar o quitar una API pública, flags, formatos de configuración, exports publicados | Agregar un flag, un endpoint o un campo opcional. Lo pedido no es riesgo alto por sí solo; romper código compartido sin que lo pidan, sí |
| 4 | **Concurrencia** | Candados, carreras, orden de operaciones asíncronas | — |
| 5 | **Entrega o entorno** | Instaladores, release, CI, despliegue, dependencias | — |
| 6 | **Ningún test atraparía una regresión** en lo que cambia | — | — |

"No está claro" cuenta como alto **solo** cuando una mirada acotada no alcanza para saber si aplica alguno del 1 al 5.

**La línea de riesgo.** Todo cambio de código cierra con `Riesgo: ítem N (motivo)` o `Riesgo: ninguno`. Antes de escribir `ninguno`, mirar si el diff toca código que también usa un comportamiento existente que el pedido no mencionó (opciones compartidas, parsers, helpers): si lo toca, es el ítem 3. Cualquier ítem dispara la verificación independiente (`odd-verificacion`).

---

## Los disparadores

Cada uno vale solo cuando su condición se cumple de verdad. Cuando se resuelve, se vuelve a medir el tamaño: mientras se cumplan los tres criterios, la tarea sigue chica.

| Disparador | Condición | Qué se hace |
|---|---|---|
| **Preguntar** | Una decisión de producto o de diseño abierta | Una pregunta enfocada. Se espera |
| **Mapear** | Entender excede la tanda acotada o pide más de unas cinco búsquedas encadenadas | Un explorador de solo lectura, antes de decidir o escribir. Devuelve como mucho unos 2k tokens con evidencia `ruta:línea`. Se controla un punto, no se relee todo lo mapeado |
| **Verificar** | La línea de riesgo nombra un ítem | `odd-verificador`, después de los checks propios del cambio |
| **Registrar** | La tarea es grande | El documento de la funcionalidad (`odd-documento`) |
| **Escritor** | (a) Dos o más unidades independientes, con superficies de edición disjuntas y varios minutos de trabajo cada una (unas 100 líneas o más), lanzadas juntas. (b) La sesión llegó a unos 150k tokens de contexto | Un escritor acotado por unidad. Sin una de esas dos razones, se escribe directo |

**Una unidad** es una pieza de comportamiento con su código, sus tests y su documentación juntos. Nunca se parte un comportamiento en un escritor de tests, uno de documentación y uno de código. Una entrega que depende de otra no es independiente. Una unidad de unas 100 líneas o menos va siempre directa: escribirla cuesta menos que arrancar un subagente, que gasta uno o dos minutos leyendo antes de escribir.

**Al delegar un escritor**, el padre le pasa:

- **La superficie permitida:** las rutas exactas que el cambio debe tocar y los directorios donde puede crear archivos. Nunca `.` ni la raíz. Si no se puede derivar, no se lanza el escritor. Y no se le pide a la persona que escriba rutas: se le presenta la lista candidata para aprobar o rechazar.
- **Los helpers que tiene que reusar** para el estado compartido, y los invariantes que mantienen (orden, unicidad, validación, normalización). Unidades construidas en paralelo no se ven entre sí: el prompt es el único lugar donde se enteran.

**En paralelo, en esta base,** cada unidad va a su slot (`worktree-slots`). Si comparten un archivo, ese archivo tiene un solo dueño, o lo edita el padre al final. Al terminar, el padre controla el diff de cada uno contra su superficie y corre la suite completa una vez.

**La ruta se declara.** En trabajo grande, el documento anota la ruta de cada tarea (directa o delegada) y el disparador que la justificó. Así, una delegación salteada se ve en lugar de quedar en silencio.

---

## Continuidad de lo autorizado

Un resultado autorizado incluye sus pasos necesarios de implementación, documentación y verificación. **No se pide permiso para cada transición.** Un turno no termina anunciando un paso siguiente que ya se puede ejecutar: se ejecuta.

Se para **solo** por: una decisión de producto o de alcance sin resolver, un consentimiento que hace falta, una acción denegada, una prueba que no está disponible, o la orden de la persona. Se reporta el bloqueo concreto y la decisión exacta que hace falta, no un "¿sigo?".

Esta regla **no** autoriza publicar, ni acciones destructivas, ni alcance que nadie pidió.

---

## Cómo encaja con el resto de la base

ODD reemplaza al ciclo de `openspec`, no al circuito. **Se instala uno de los dos**: dos ciclos a la vez es una instalación a medio migrar, y los gates lo avisan.

| `ciclo-de-tarea` | Con ODD |
|---|---|
| 0. Ubicar el requisito | Igual. Una tarea chica sin ficha no la crea |
| 1. Proponer el cambio | Paso 5: el documento de la funcionalidad, solo si es grande. No hay propuesta ni diseño aparte: las specs son el contrato |
| 2. Tests en rojo | `odd-tests` |
| 3. Implementar | Paso 6 |
| 4. Revisar | `odd-verificacion`, proporcional al riesgo. Los gates corren igual. `pr-review` sigue disponible como mirada de afuera |
| 5. Punta a punta | Igual (`prueba-e2e`), cuando la tarea toca un recorrido |
| 6. Automejorar | Igual |
| 7. Archivar | Mover el documento al archivo (`odd-documento`). Una tarea chica no tiene nada que archivar |
| 8. Tablero | Igual |

**Los commits siguen la regla de la base**, no la de gentle-ai: los hace `git-commit-workflow` con pedido explícito, o `trabajo-autonomo` si la persona lo declaró (`autonomous.commit`). Lo que ODD aporta es **dónde cortar**: unidades de unas 400 líneas cambiadas, con sus tests y su documentación, y la unidad de riesgo alto en su propio commit, para que se pueda revisar sola. Los cortes se anotan en el documento. Push, PR y merge siguen siendo decisiones de la persona.

**Con `trabajo-autonomo`**, ODD no cambia: lo que acá dice "una pregunta y se espera" se resuelve de la forma más conservadora y reversible, y se anota en la bitácora.
