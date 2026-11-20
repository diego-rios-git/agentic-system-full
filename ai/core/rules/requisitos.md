# Los requisitos y su estado

**Fuente única** de cuándo el agente toca el estado de un requisito y qué significa cada estado. La lista de estados de `scripts/check-requirements.js` tiene que coincidir con la de este archivo.

Solo aplica a un proyecto que tiene tablero de requisitos (`requirements` en `ai-workspace.json`). Sin tablero, no hay fichas que mover y esta regla no se aplica: no se inventa una carpeta de requisitos para cumplirla.

---

## Por qué existe

Un estado escrito a mano envejece en silencio. Sin esta regla, el estado de un requisito vive en prosa (casillas marcadas, un párrafo "para retomar") y termina diciendo, en la misma línea, que el plan está terminado y que falta una parte. El tablero lo lee la persona para decidir y lo lee el agente para saber qué sigue: si miente, los dos deciden mal.

La respuesta tiene dos mitades. La mitad de los estados no se escribe: **se derivan de la evidencia del repositorio** (los changes del ciclo dirigido por especificación) y un script lo recalcula. La otra mitad son decisiones de una persona, y el agente no las toma.

---

## La ficha

Una ficha por **requisito**, en la carpeta que declara `requirements.dir`. Un requisito es lo que el producto tiene que hacer, no la tarea que lo construye: una tarea de un plan es un change, y un requisito puede necesitar varios, en varios repositorios.

```yaml
---
tipo: requisito
rf: RF-4.03                # el id; su forma la fija requirements.idPattern
titulo: "Historia clínica"
estado: implementacion
estado_auto: false         # solo si el estado no se deriva (ver abajo)
estado_motivo: "Se entrega en dos partes; solo la primera tiene change."
actualizado: 2026-10-01
---
```

El cuerpo dice **qué pide** (negocio) y **dónde quedó** (las specs que lo describen). No copia el contrato: la forma de un endpoint o de un tipo vive en el diseño del change, y dos copias divergen. Cómo se escribe una ficha pensada está en el procedimiento `redactar-requisito`.

**Un id no se reusa.** Un requisito descartado conserva el suyo con `estado: descartado`. Dos fichas con el mismo id rompen la derivación (ver más abajo).

La configuración (`requirements`): `dir` (obligatorio), `idPattern`, `format` (`plain` u `obsidian`: con `obsidian` los enlaces son wikilinks y se validan como tales; es solo un formato, nada de la regla depende de él), `vault`, `repos`. El detalle está en el encabezado de `scripts/check-requirements.js`.

---

## Los estados

| Estado | Significa | Quién lo pone |
|---|---|---|
| `pendiente` | Se sabe que hace falta; nadie lo pensó todavía | La persona, o el agente al anotar algo que surgió |
| `analisis` | Se está pensando: alternativas, preguntas abiertas | El agente al empezar a explorarlo |
| `validado` | **La persona lo decidió** y está listo para proponer | La persona, o el agente cuando ella lo aprueba en la conversación |
| `implementacion` | Tiene un change abierto | **Derivado** |
| `testing` | Implementado; en revisión sin contexto y prueba de punta a punta | El agente, al terminar de implementar (manual: no se deriva) |
| `cerrado` | Todos sus changes están archivados y el último lo completa | **Derivado** |
| `descartado` | Se decidió no hacerlo, con el porqué en la ficha | La persona |

`cerrado` significa *change archivado y mergeado*, no una impresión. `validado` y `descartado` no los pone el agente por su cuenta: son decisiones de la persona, y empezar un requisito `pendiente` o `analisis` es decidir por ella.

---

## Lo que se deriva, y cómo

El vínculo entre un requisito y sus changes lo declara el **change**, en su archivo de metadatos, no la ficha:

```yaml
rf: RF-4.03 RF-4.04        # uno o varios ids; o `rf: ninguno` si no corresponde a ningún requisito
cierra_rf: false           # opcional: true (por defecto), false, o la lista de ids que SÍ completa
pendiente_rf: "CA-04 y CA-05 (las acciones) -> otro ticket"   # qué falta y quién lo trae
```

Dónde está ese archivo lo declara el proveedor del ciclo dirigido por especificación (`sdd.metaFile`; para OpenSpec, `.openspec.yaml`). El script no tiene una carpeta de changes fija: lee los del proveedor de cada repositorio.

La derivación, que es lo que hace `node scripts/check-requirements.js --sync-estados`:

| Evidencia | Estado derivado |
|---|---|
| Ningún change declara el requisito | **No se toca**: sin evidencia no se opina |
| Algún change abierto | `implementacion` |
| Todos archivados | `cerrado`, **salvo** que la última entrega diga `cierra_rf: false` (o una lista que no lo incluye): queda en `implementacion` y `pendiente_rf` anota qué falta |

Manda la **última fecha de archivado**. Un requisito entregado por partes tiene changes viejos sin el campo; el que decide es el último. Si esa fecha tiene varios changes (el par proveedor/consumidor de una misma entrega), tienen que cerrar todos.

**Nunca retrocede un estado solo.** Si lo derivado va hacia atrás (un change abierto con la ficha en `cerrado`) lo reporta sin escribir, y una persona decide si es trabajo nuevo o un change abandonado. Tampoco baja `testing` a `implementacion`.

### Quién declara qué, y cuándo

- **Al proponer el change** (`spec-propose`): se declara `rf:` y, si el change entrega solo una parte, `cierra_rf: false` con `pendiente_rf`. Se escribe en ese momento, con el requisito a la vista: no cuesta nada ahora y no se puede reconstruir después.
- **Al archivar** (`spec-archive`, paso de cierre): se relee la ficha contra lo entregado y se deja la verdad. Acá es donde `cierra_rf` pasa a `true` si con este change están todos los criterios de aceptación.
- **Un change que completa lo que otro dejó pendiente** suma ese requisito a su `rf:` y no declara `cierra_rf: false` para él.

### Cuándo se sincroniza

**Solo después del merge.** El change se archiva dentro del PR, antes del merge, pero afirmar que un requisito está entregado es otra cosa: nada está entregado hasta que llega a la rama base, y un requisito marcado `cerrado` mientras vive en una rama que puede rechazarse es una mentira. Además el script recorre **todas** las fichas: tras sincronizar con la base puede cerrar requisitos de otras ramas cuyos changes acaban de llegar. Por eso, al correrlo, se mira `git status` y se queda uno **solo con las fichas del requisito propio**; el resto se lista y se consulta, no se commitea. Un salto de `analisis` a `cerrado` sin pasar por `implementacion` es la señal de alarma.

---

## Cuando el estado no se deriva

Hay requisitos cuya derivación es **estructuralmente** falsa:

- **Sub-entregables.** Un requisito que se entrega en cuatro partes, con las dos primeras archivadas: lo derivado dice `cerrado` y las otras dos no empezaron.
- **Dos fichas con el mismo id.** Una sucesión deja conviviendo la ficha del modelo anterior y la del nuevo, y los changes son de una sola: el estado derivado se aplicaría a las dos.

Ahí la ficha lo declara y el estado pasa a ser una decisión de la persona:

```yaml
estado: implementacion
estado_auto: false
estado_motivo: "Se entrega en sub-entregables A, B, C y D; los changes archivados cubren A y B."
```

`estado_motivo` es **obligatorio**: sin él el campo es una forma silenciosa de tapar un estado incorrecto, y el gate lo marca. Se usa cuando lo derivado es estructuralmente falso, **no para no actualizar** un estado que sí corresponde. Si el motivo era solo "se entrega por partes", el change que completa el requisito le quita `estado_auto` y `estado_motivo`, y desde ahí vuelve a derivarse.

`--sync-estados` no toca esas fichas y las lista aparte con su motivo: si el script no dijera que las saltea, nadie notaría que ese estado ya no se deriva.

---

## Qué mueve el agente, sin que se lo pidan

Igual que el resto de los movimientos que están escritos adentro de los procedimientos: ocurren cada vez que el procedimiento corre.

| Momento | La ficha |
|---|---|
| Se explora un pedido nuevo y no hay ficha | Se **crea** en `analisis` (o `pendiente` si solo se anota) |
| Se propone el change (`spec-propose`) | Se declara `rf:` en el change y se sincroniza: pasa a `implementacion` |
| Tests en verde, empieza la revisión y la prueba de punta a punta | `testing` (a mano) |
| Se crea el PR | Sin tracker, `testing` si aún no lo está (ver `tracker-events`) |
| Se archiva el change y se mergea | `--sync-estados` -> `cerrado` (o queda en `implementacion`) |

Cada movimiento actualiza `actualizado:`. **Una orden de la persona en contra gana**, y el reporte dice que el paso quedó sin hacer.

Lo que el agente **no hace nunca** con una ficha:

- Poner `validado` o `descartado` por su cuenta.
- Retroceder un estado. Si algo parece estar atrás, lo reporta.
- Escribir `estado_auto: false` sin `estado_motivo`.
- Cambiar **qué pide** un requisito: eso es negocio. Crear una ficha, sumar un change y mover el estado, no.
- Dejar un requisito `cerrado` con trabajo pendiente: si el change entrega una parte, lo dice (`cierra_rf: false`).

---

## Comandos

```bash
node scripts/check-requirements.js                      # validar (lo corre run-gates cuando hay tablero)
node scripts/check-requirements.js --sync-estados       # derivar y escribir (después del merge)
node scripts/check-requirements.js --sync-estados --dry-run   # qué cambiaría, sin escribir
node scripts/check-requirements.js --tablero            # la vista por estado en la terminal
node scripts/check-requirements.js --huerfanos          # changes que ninguna ficha reclama
node scripts/check-requirements.js --exigir-cerrados    # en la base, ya mergeado: exige que lo archivado diga cerrado
```

Salida y códigos: 0 limpio · 1 hallazgos · 2 no se pudo verificar. Sin `requirements` dice "no aplica" y sale 0 sin haber verificado nada.

---

## Lo que esta regla evita, con su porqué

- **Se cerraron requisitos de más.** Un script que deriva `cerrado` cuando todos los changes están archivados cierra un requisito cuyo único change archivado era parcial, y más aún tras sincronizar con la base, cuando llegan changes ajenos. De ahí `cierra_rf`, `pendiente_rf` y que mande la última entrega.
- **Un change invisible dejó la ficha en `cerrado` con trabajo pendiente.** Un change implementaba un requisito y olvidó declararlo: para la derivación, el requisito no tenía changes abiertos. De ahí que declarar `rf:` sea obligatorio al proponer (con `rf: ninguno` cuando de verdad no corresponde) y que el gate marque un change abierto sin `rf:`.
- **Requisitos entregados por partes, o con dos fichas para el mismo id, rompieron la derivación.** De ahí `estado_auto: false` con su motivo obligatorio.
- **Un estado que va hacia atrás nunca se escribe solo.** Un change viejo abandonado no tiene por qué reabrir un requisito que el equipo ya dio por cerrado.
