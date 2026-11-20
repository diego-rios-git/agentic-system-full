# De un documento a la ficha

El camino más común, y el que tiene que ser fácil: alguien trae un documento —un SRS, un documento de módulo, una minuta, una transcripción, capturas, un mensaje del cliente— y se lleva una o varias fichas de requisito. Puede ser un PM que adelanta trabajo o un dev que necesita el requisito para arrancar una tarea.

Antes de empezar, `metodo-analista` (`ai/packs/analisis-funcional/procedures/metodo-analista.md`). La ficha que sale es la de `redactar-requisito`, con las secciones de profundidad que el requisito necesite.

**La diferencia con `redactar-requisito`:** ahí la persona cuenta y el agente estructura. Acá la fuente ya existe, y el trabajo es sacar de ella lo que dice **sin agregarle nada**, y convertir lo que no dice en preguntas.

---

## 1. El documento

- **Se guarda tal como llegó**, con su nombre original y la fecha, en la carpeta de fuentes del proyecto (`analisis.md` de `ai/local/`; por defecto `<carpeta de fichas>/fuentes/`). Si llegó pegado en el chat, se guarda el texto completo en un `.md`. Una fuente no se edita nunca.
- **Si es un audio o un video**, se pide la transcripción.
- **Si es un PDF largo**, se lee por tramos de páginas hasta el final; ninguno se saltea. Si es una imagen escaneada sin texto, se pide una versión con texto o se dice qué páginas no se pudieron leer.
- **Se lee entero**, y lo mismo cada fuente que la persona nombre. Las que se leyeron se anotan en el archivo de decisiones del requisito; la lista va en el mensaje de entrega.
- **Si es una reunión**, cuenta como evidencia, no como cambio de requisito: `ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`, "Reuniones y transcripciones".

---

## 2. El mapa

Antes de fichar nada, un mapa corto de lo que trae el documento:

```text
El documento trae 4 requisitos:
1. RF-2.03 — Alta de sedes. Completo: se puede fichar.
2. RF-2.04 — Cupo diario por sede. Falta la fórmula del cupo.
3. RF-2.05 — Aviso al administrador. Ya tiene ficha (v1.2): sería un cambio.
4. RF-2.06 — Reporte mensual. Solo el título: no alcanza para fichar.
¿Cuál armamos?
```

Por cada uno: id y nombre, si alcanza para fichar, qué falta, y **qué artefacto sería**.

- **Se busca antes si ya tiene ficha** (`node scripts/check-requirements.js --tablero`, o por título en la carpeta de fichas). Si la tiene, no es una ficha nueva: es un cambio (`cambio-de-requisito`).
- **La unidad es la del documento.** Un bloque de requisito, una fila de catálogo, un caso de uso. No se convierte cada mención de un id en un requisito, ni se fusionan dos porque se parecen.
- **Un id que el documento no trae no se inventa como oficial.** Si hace falta uno para ordenar, se dice que es provisorio y se toma el siguiente libre según `requirements.idPattern`.
- Si son muchos y se van a fichar varios, conviene antes ordenarlos por dependencias (`catalogo-y-camino-critico`).

Si la persona ya dijo cuál quiere, se saltea el mapa y se va a ese.

---

## 3. Las dudas

El bucle de preguntas de `metodo-analista`, sección 2. Dos ritmos, y elige la persona:

- **Completo:** resumen, todas las dudas de a una, cierre.
- **Rápido:** solo las bloqueantes, tres como máximo. El resto entra a la ficha como decisiones abiertas con quién decide.

Si no dijo, se le pregunta en una línea. "Necesito la ficha" pide el artefacto, no elige el ritmo. Solo si las fuentes ya cierran todo se va directo, y se dice: "Las fuentes ya cierran todo; voy directo a la ficha."

Cada respuesta va al archivo de decisiones en el momento.

---

## 4. Antes de escribir: el dueño y lo que ya existe

Dos controles cortos que evitan las fichas duplicadas:

- **El dueño.** Si la capacidad la decide, la persiste o la autoriza otro requisito, este no la redefine: la consume y lo dice en *Dependencias*. Un tablero que muestra un dato no es dueño del dato.
- **Lo que ya existe.** Si hay repositorio y el requisito toca algo que ya está construido, se mira el código antes de escribir. Si el solapamiento es dudoso —parece que ya está hecho, o que es parte de otro—, primero va `auditar-cobertura-rf`, y la ficha sale después con el residual.

---

## 5. La ficha

Con el formato de `redactar-requisito` y lo que pide `ai/core/references/requisitos/contenido-por-seccion.md`:

1. **Mapa de evidencia, interno.** Para cada regla que se va a escribir, de qué parte de la fuente sale. No va en la ficha; sirve para no escribir nada sin origen.
2. **Las secciones de siempre**, y las de profundidad que el requisito necesita (un cálculo, estados, configuración, auditoría, dependencias).
3. **Cada regla dice de dónde sale** cuando la fuente es un documento: "(SRS v0.6, §4.2)" al final de la regla alcanza. Lo que el documento no dice va a *Decisiones abiertas*, no a una regla.
4. **Los escenarios salen de las reglas, las postcondiciones y los casos borde.** Cada regla tiene el suyo; la que no puede tenerlo sin hablar de implementación va a *Decisiones abiertas*.
5. **Estado:** `analisis` si quedan decisiones abiertas. Aunque no quede ninguna, el agente no la pasa a `validado`: le pregunta a la persona.

---

## 6. Antes de entregar

1. El control de `metodo-analista`, sección 6, de verdad.
2. `node ai/packs/analisis-funcional/scripts/validar-ficha.js <ficha>` sin errores. Con un aviso, se lee y se decide; no se tapa.
3. Si el proyecto tiene una ficha modelo del mismo tipo, comparar sección por sección.
4. `node scripts/check-requirements.js` sin hallazgos nuevos, si hay tablero.

El mensaje de entrega: qué ficha, qué fuentes se leyeron, qué quedó abierto y quién lo decide. Si alguna fuente no se pudo leer entera, se nombra, y la ficha queda en `analisis` hasta leerla.

**Si después piden estimar:** `task-estimation` por ficha y `project-estimation` para el total del frente (`ai/core/procedures/`). Las decisiones abiertas suben el máximo de la estimación; conviene cerrarlas antes, o pasar primero por `revisar-ficha`.

---

## Varios requisitos del mismo documento

Se fichan **de a uno**, terminado cada uno hasta la entrega. Dos fichas a medias son dos fichas que nadie puede validar.

Si la persona pide un documento que **solo transcribe** requisitos de las fuentes (un compilado, no fichas), es otro artefacto: copia textual, sin resumir ni normalizar, cada entrada con su fuente, su fecha y su ubicación, y los duplicados o contradicciones conservados como registros separados. No se mezcla con fichar.
