# Método de análisis funcional

La base común de todo trabajo de análisis: sacar o revisar un requisito, especificar un cambio, auditar si el código cubre una ficha, contestar la duda de un dev sobre qué pide algo. Los demás procedimientos del pack lo dan por leído.

**Sirve igual para un PM, un analista o un dev.** Con alguien que no conoce el dominio no se baja el estándar de la ficha: se explica más.

Salió de las correcciones que tres PMs le hicieron a un agente de análisis durante tres meses. Las seis más repetidas, al revés, son las secciones 1 a 6.

---

## 0. Ubicarse

Antes de escribir una línea:

1. **Qué requisito.** Id y nombre completo. Si no se sabe, se pregunta.
2. **Qué artefacto.** Una ficha nueva, un cambio sobre una ficha que ya existe, una revisión, un dictamen de cobertura. Si no está claro, se pregunta: mezclar una ficha con un cambio es un error que ya pasó. **Si ya existe una ficha del mismo requisito, no es una ficha nueva: es un cambio** (`cambio-de-requisito`).
3. **Qué se sabe ya.** En este orden:
   - `analisis.md` de `ai/local/` (fuentes, modelos, quién decide, dónde va cada cosa). Si no existe, se arma con la persona: `ai/packs/analisis-funcional/references/contexto-del-proyecto.md`;
   - el glosario y las reglas de negocio de `ai/local/`;
   - el archivo de decisiones del requisito, si existe;
   - las fichas de los requisitos vecinos.
4. **Qué fuente.** La que diga la persona. Si no dice, la de mayor precedencia (`ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`).

---

## 1. Conversar o producir

La queja más repetida: **el agente produce antes de que se lo pidan.**

- **Conversación**, por defecto: entender, preguntar, cerrar dudas. No se crean ni se modifican archivos del proyecto, salvo el archivo de decisiones y la copia de una fuente que trajo la persona (guardarla no produce nada: la conserva).
- **Entregable**: solo con un verbo de producción. "Escribí la ficha", "armá el cambio", "pasalo al archivo", "abrí el PR".

**Un "ok", un "dale" o un "de acuerdo con tu recomendación" cierran la pregunta; no autorizan a producir.** Y frases como "veamos acá y después lo pasamos" son solo conversación: si un archivo se tocó antes de tiempo, se vuelve atrás y se dice.

Sugerir el paso siguiente está bien. Hacerlo sin que lo pidan, no.

---

## 2. Las preguntas

1. **Leer enteras todas las fuentes** que nombró la persona (`ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`, "Leer es leer entero").
2. **Resumir el requisito en lenguaje de negocio:** qué resuelve, quién hace qué, qué incluye y qué no, y qué hay que decidir. Sin jerga.
3. **Armar el inventario de dudas**, numerado, y filtrarlo. Es duda solo si es **una decisión funcional de este requisito** que ni la fuente ni el código contestan. No son dudas:
   - cómo se implementa (eso lo decide quien implementa);
   - lo que es de otro requisito;
   - lo que ya se decidió (está en el archivo de decisiones);
   - lo que la fuente o el código responden: se mira antes de preguntar.
4. **Una decisión por vez**, con su contexto:

   ```text
   Q-03 — <nombre de la duda> (<id> — <nombre del requisito>)
   <dos o tres líneas: qué dice la fuente y qué falta>

   1. (Recomendada) <opción>. <por qué, y qué gana el negocio>
   2. <opción>. <su consecuencia>
   3. Otro criterio
   ```

   Siempre con una recomendación, y con **qué beneficio de negocio** tiene cada opción. La pregunta es sobre comportamiento observable, no sobre implementación. Si el harness tiene una herramienta de preguntas con opciones, se usa con este mismo contenido.
5. **Anotar la respuesta** en el archivo de decisiones apenas llega (`ai/packs/analisis-funcional/references/archivo-de-decisiones.md`), antes de la siguiente.
6. **Cierre explícito:** "¿Queda algo de este requisito o lo cerramos?". Recién con el cierre se produce, y solo si lo piden.

**Ritmo rápido.** Si la persona quiere ir rápido ("sacame la ficha, no me hagas tantas preguntas"), se hacen solo las **bloqueantes** —las que cambian el alcance o una regla central—, tres como máximo. El resto entra a la ficha como decisiones abiertas con quién decide. A un dev que no conoce el dominio conviene ofrecérselo: las pendientes le quedan escritas para el PM y puede arrancar.

---

## 3. No inventar

- Cada afirmación es fuente, decisión, evidencia de código, propuesta o pendiente, y se nota cuál (`ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`).
- **No se introducen términos.** Se usan los del glosario y los de la fuente. Un código interno (Q-, DEC-, CHG-) se explica la primera vez.
- **Nunca un id solo.** `R3` o `RF-2.04` no se entienden: siempre con su nombre.
- **Un requisito, su dueño.** Antes de poner una capacidad en un requisito, se verifica que sea el dueño (la entidad, la decisión, el contrato) y no un vecino que solo la muestra.
- **Cuándo frenar.** Si las fuentes no alcanzan para una precondición verificable, si dos pasajes se contradicen, si habría que inventar un campo, un estado o un mecanismo, o si la ficha alteraría lo que ya está cerrado en otro requisito: se frena y se listan las preguntas bloqueantes.

---

## 4. El listón

**Pasar el validador no alcanza.** Si el proyecto tiene fichas modelo (`analisis.md` de `ai/local/`), se compara con la del mismo tipo: cantidad de reglas, flujos con sus errores, casos borde, escenarios con valores, evidencia del código. Si la ficha es claramente más pobre, no está lista aunque tenga todas las secciones.

Lo que cada sección tiene que traer está en `ai/core/references/requisitos/contenido-por-seccion.md`.

---

## 5. Editar sin romper

- **"Actualizá" es diferencial:** se toca lo que se pidió y el resto queda textual. Si parece que hay que tocar otra cosa, se pregunta antes. Con una ficha en `validado` o más adelante, "actualizá la ficha" no edita la ficha: es un cambio (`cambio-de-requisito`, según el estado de la base).
- **"Rehacé" es completo.** Si no está claro cuál de los dos es, se pregunta.
- **Si se parte de una ficha o documento que dieron, ese es el esqueleto.** No se reemplaza por una versión propia más abstracta: se mejora.
- **Lo cerrado no se reabre**, salvo que la persona lo pida.
- **Una versión no se pisa.** La anterior queda en git; la nueva sube `version:` si el proyecto versiona, suma una fila al *Historial* y lleva la matriz de no regresión.
- **Si otra persona escribió algo** (QA, un dev), su texto se conserva; lo propio va aparte.

---

## 6. Control antes de entregar

De verdad, buscando en el texto, no de memoria:

1. **Cada decisión del archivo de decisiones está en la ficha.** Buscar el término clave de cada una.
2. **Lo que la fuente afirma, la ficha lo afirma igual.** Un "falta confirmado" no se baja a "sin verificar".
3. **El control de calidad dice la verdad.** Algo con pendientes no "pasa": "pasa con pendientes", y cuáles.
4. **Todo id con su nombre**, también en reglas, riesgos y pendientes.
5. **La ficha habla del requisito, no de la conversación.** Ni quién la pidió, ni qué no se pudo auditar en esta sesión, ni rutas de la máquina de nadie. Si no se auditó el código, *Cómo quedó* dice "sin revisar" y el porqué va en el mensaje de entrega.
6. **Cada flujo tiene su escenario**, y lo que se le entrega a un requisito vecino coincide con lo que el vecino espera recibir.
7. Si es una ficha: `node ai/packs/analisis-funcional/scripts/validar-ficha.js <ficha>` sin errores. Es una ayuda estructural, no la prueba de que esté bien.

Si algo no pasa, se corrige antes de entregar.

---

## 7. Entregar

- **Exactamente lo que se pidió**, con el nombre que se acordó. Ni un segundo informe, ni un Word que nadie pidió, ni una versión paralela. El Markdown es la fuente; un Word o un PDF, solo si el proyecto o la persona lo piden, y se genera desde el Markdown.
- **El mensaje de entrega es corto:** qué es, qué cambió, qué quedó pendiente y quién lo decide. No el proceso que se siguió.
- **Si quien lo pidió es un dev**, se suman las decisiones pendientes y a quién preguntárselas: con eso puede arrancar sin esperar.
- **Commitear o abrir un PR**, solo si la persona lo pide (`git-commit-workflow`). La ficha no necesita estar validada para abrir el PR: la revisión se hace ahí. El agente no mergea, y **no pone la ficha en `validado`**: eso lo decide la persona (`ai/core/rules/requisitos.md`).

---

## 8. Aprender de cada corrección

Cuando alguien corrige, primero se arregla lo que marcó. Después: **¿vale para todos o solo para esta persona?**

- **Un término o una convención del proyecto:** se le propone sumarlo al glosario, a las reglas o a `analisis.md`, en `ai/local/`.
- **Una forma de trabajar que vale para cualquier proyecto:** se anota como propuesta para la base, que la incorpora quien la mantiene. No se edita `ai/packs/` desde un proyecto: el próximo `template-sync` lo reportaría como divergente.

Se le dice a la persona en una línea qué se anotó y dónde, para que pueda corregirlo si se entendió mal.
