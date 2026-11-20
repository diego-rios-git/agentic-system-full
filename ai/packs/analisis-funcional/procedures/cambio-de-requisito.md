# Especificar un cambio sobre un requisito que ya tiene ficha

Cuando un requisito ya tiene ficha y hay que cambiar una parte acotada —corregir una regla, sumar un caso, retirar un comportamiento, incorporar una decisión, un hallazgo de auditoría o un bug—, no se escribe una ficha nueva: se escribe **el cambio**. Un documento corto que dice exactamente qué cambia contra qué versión, qué **no** cambia, y cómo se prueba.

Antes de empezar, `metodo-analista` (`ai/packs/analisis-funcional/procedures/metodo-analista.md`).

**El objetivo es aislar el cambio.** Quien implementa tiene que poder aplicarlo sin reinterpretar el resto de la ficha, sin borrar cobertura que no se tocó y sin tomar el código parcial como aprobación.

---

## Qué es cada cosa

| Documento | Qué es |
|---|---|
| **La ficha** | El contrato funcional completo y duradero. Sigue siendo la fuente |
| **El cambio** (`CHG-<id>-NN`) | La diferencia contra una versión nombrada de la ficha. Es la entrada de la implementación de ese cambio; no reemplaza la ficha |
| **El change del ciclo dirigido por especificación** | La realización técnica. Sale del cambio y declara `rf:` como cualquier otro (`spec-propose`) |
| **Una decisión o un suplemento** | Evidencia para el cambio; no es un cambio por sí sola |

Un cambio se puede consolidar después en una versión nueva de la ficha, cuando la persona lo pide. Mientras tanto, el documento no dice que ya se consolidó.

---

## Cuándo no

**Se escribe una versión nueva de la ficha, no un cambio, cuando:**

- cambia más de la mitad de las reglas, los flujos o los escenarios;
- cambia el objetivo del requisito o quién es su dueño;
- un ciclo de vida nuevo reemplaza al viejo;
- el cambio no se entiende sin releer casi toda la ficha;
- en realidad es un requisito nuevo.

Si el requisito **todavía no tiene ficha**, primero va la ficha (`ficha-desde-documento` o `redactar-requisito`). Y si la persona solo pide un análisis o una opinión, se contesta en la conversación sin escribir el documento.

Según el estado de la ficha base:

| La ficha está | Tratamiento |
|---|---|
| En `pendiente` o `analisis` | Se edita la ficha (con su *Historial*); no hace falta un cambio aparte |
| En `validado`, sin construir | Un cambio, con no regresión contra la versión validada |
| En `implementacion`, `testing` o `cerrado` | Un cambio con compatibilidad, transición de lo que ya existe, regresión y vuelta atrás |

---

## 1. Fijar las dos puntas

Un cambio compara **dos versiones explícitas**, y no se empieza sin las dos:

1. **La base:** la ficha tal como está, en un commit concreto (`git log -1 --format=%h -- <ficha>`). Se cita el id, la versión, la ruta y el commit.
2. **El objetivo:** cómo tiene que quedar. Puede ser una versión nueva completa que trajo alguien, un documento del cliente, o las decisiones cerradas en la conversación.

Reglas:

- **Se verifica la identidad de cada punta** leyendo su encabezado: id, versión, fecha. No se confía en el nombre del archivo.
- **No se infiere una versión intermedia** a partir de un suplemento, una salida de otro agente o un requisito parecido.
- **El objetivo con número de versión más alto no está aprobado por eso.** La aprobación sale de una persona o de un registro.
- **Si el objetivo se contradice a sí mismo** (texto heredado que choca con la regla nueva), se registra como `CLARIFY` con los dos lugares exactos, y se pregunta cuál manda.
- Si una punta llegó pegada en el chat, se guarda el texto completo como fuente antes de compararla.

---

## 2. El registro de diferencias, antes de escribir prosa

Una fila por comportamiento afectado:

| Id | Tipo | Dónde en la base | Antes | Después | Fuente | Dueño | Estado |
|---|---|---|---|---|---|---|---|

- **Tipo:** `ADD`, `MODIFY`, `RETIRE`, `CLARIFY` (no cambia el comportamiento, saca una ambigüedad) o `NO CHANGE` (se menciona para dejar claro que no cambia).
- **Estado:** `aprobado`, `propuesto`, `falta confirmado`, `decisión pendiente`, `fuera de alcance`.

Ningún comportamiento pedido falta, ninguno está dos veces, y ninguno se amplió sin decirlo. Un `CLARIFY` y un `MODIFY` no se confunden: el primero no cambia lo que se ve.

---

## 3. El código, sin reescribir el contrato

Si hay repositorio, para cada diferencia se clasifica qué hay hoy: `reutilizable`, `parcial`, `falta`, `diverge` o `sin revisar`, con repo, commit y archivo, y qué no demuestra (`ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`).

El código reconstruye el contexto técnico: compatibilidad, datos existentes, tests. **No aprueba ni reemplaza la regla funcional.** Si el código contradice la base o el objetivo, se escribe la contradicción y se pide la decisión.

Cuando el cambio toca un contrato que consumen otros requisitos, se arma la lista de **cada consumidor** y se dice, para cada uno, si se ve afectado y por qué no, si no.

---

## 4. Escribir el cambio

Con `ai/packs/analisis-funcional/references/plantilla-cambio.md`. Lo que no se negocia:

1. **Base primero.** Si la base es ambigua o no está, se frena y se dice.
2. **Solo la diferencia.** No se repiten el objetivo, los flujos ni los escenarios que no cambian: se citan por su lugar.
3. **Lo que se conserva se dice.** Cada `MODIFY` y `RETIRE` nombra lo que sigue igual. Un `RETIRE` dice qué lo reemplaza o por qué nada. Un `ADD` dice qué no altera.
4. **Nada de alcance silencioso.** Todo trabajo de frontend, backend, datos o pruebas se mapea a un `CHG`. Una mejora "de paso" va en otra propuesta.
5. **Sin implementación inventada.** Ni un campo, endpoint, estado, migración ni política de reintentos sin haberlo visto.
6. **Sin falso cierre.** El cambio no prueba que se implementó, se migró, se desplegó ni se probó.

Cada diferencia se escribe con anclas que no dejan dudas de dónde aplica: `REEMPLAZA R3`, `AGREGA DESPUÉS DE R5`, `RETIRA el escenario "…"`.

---

## 5. Escenarios del cambio

- `CA-CHG-NN` para lo que cambia: el caso positivo, el negativo, el límite, la autorización y la transición de lo que ya existe.
- `CA-NR-NN` para la **no regresión**: lo que tiene que seguir funcionando igual.
- Los escenarios de la ficha base que no cambian se citan por nombre; no se copian.

---

## 6. Control y entrega

El control de la plantilla, más el de `metodo-analista`, sección 6.

Se guarda en la carpeta de cambios del proyecto (`analisis.md` de `ai/local/`; por defecto `<carpeta de fichas>/cambios/CHG-<id>-NN-<tema>.md`). **Lleva `requisito:` en el encabezado, no `rf:`**, para que el tablero no lo cuente como una ficha más.

Un cambio ya entregado o referenciado no se edita para marcarlo superado: se escribe la versión siguiente del mismo `CHG` y se dice ahí qué reemplaza.

**Lo que sigue:** con el cambio aprobado, se implementa como cualquier ficha validada (si el proyecto usa el ciclo dirigido por especificación, `spec-propose` lo toma y el change declara `rf:` con el id del requisito).

**Si preguntan cuánto impacta**, o el requisito ya tenía estimación: `task-estimation` sobre el cambio, no sobre la ficha (`ai/core/procedures/task-estimation.md`, Step 1b). Estima solo la diferencia y deja la estimación de la base como estaba. Cuando la persona lo pide, el cambio se consolida en una versión nueva de la ficha: se aplica cada `CHG` en su lugar, se suma la fila al *Historial* con la matriz de no regresión, y se busca en toda la ficha lo que quedó contradiciendo la regla nueva.

---

## Cuando no hay una base limpia

A veces la ficha base está desactualizada, es muy angosta, o no explica lo que el producto ya hace, y no hay un objetivo completo sino un pedido del cliente y el código. Entonces el cambio **lleva el contexto mínimo** para entenderse: qué hay hoy (con su evidencia: código, documentos, confirmaciones del cliente, cada una rotulada), qué se pide, y la diferencia. Los mismos tipos, los mismos escenarios y el mismo control, con una sección inicial de contexto. Lo que no se pudo verificar se dice: "verificación bloqueada" no es "no existe".
