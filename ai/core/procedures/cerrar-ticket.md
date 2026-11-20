# Cerrar un ticket: del promote al merge

> **Estado: esqueleto, sin primera corrida guiada.** El orden y los puntos de frenado salen de un recorrido que funcionó en otro proyecto; en este todavía no se corrió de punta a punta con una persona mirando. La primera vez, se corre paso a paso, se anota en `ai/local/` qué hubo que ajustar y recién después se confía en él sin supervisión.

Un ticket se trabaja en un slot **hasta el `promote`**. Todo lo que viene después pasa en la principal y siempre en el mismo orden: traer la base, migrar, revisar, corregir, probar de punta a punta, archivar, **pedir permiso una vez**, commitear, abrir el PR, mergear, devolver la principal a la base, dejar escrito lo aprendido y actualizar el estado de los requisitos.

Este procedimiento **no reemplaza a ninguno de los que usa**: solo fija el orden, dice dónde frenar y cuál hace cada paso. El detalle de cada paso está en su procedimiento. Si un procedimiento y este archivo dicen cosas distintas sobre **cómo** se hace un paso, gana el procedimiento; este archivo manda sobre **cuándo**.

**Una orden del operador en contra de un paso automático gana** (no mover la tarjeta, no mergear, no archivar todavía). El reporte final dice qué quedó sin hacer por esa orden.

**Corre desde la raíz del workspace**, con `git -C`, nunca con `cd`.

---

## Qué pasos aplican según la configuración

Un paso que no aplica **se omite explícitamente y el reporte lo dice**: "paso 9 omitido: el proyecto no tiene ciclo dirigido por especificación". No se simula.

| Paso | Opcional según... | Si no aplica |
|---|---|---|
| 1 Promote, 13 Release | `worktrees.enabled` | Ya se trabaja en la principal: no hay qué llevar ni devolver |
| 3 Migraciones | `repos[].database.migrationsDir` | No hay migraciones que mirar |
| 4 Tipos de los tests | `repos[].typecheckTestCommand` | Si el runner chequea tipos o el lenguaje compila los tests, no hace falta |
| 8 Prueba de punta a punta | Que el cambio tenga algo que se vea con la aplicación levantada | Se omite, y se dice |
| 9 Archivar | Un proveedor del ciclo dirigido por especificación (`sdd` en un pack) | Se omite |
| 11 PR | `forge.kind` distinto de `none` | No hay PR: ver la tabla del paso 11 |
| 11 Tarjeta | `tracker.kind` o tablero de requisitos (`requirements`) | Ver `tracker-events`: sin tracker y sin tablero, no se hace nada |
| 12 Merge | `forge.kind` distinto de `none` | Lo hace la persona por su medio |
| 15 Estados de los requisitos | `requirements` | No hay tablero |

---

## Lo que hay que saber antes de arrancar

| Dato | De dónde sale | Si falta |
|---|---|---|
| Identificador del ticket y el change | El pedido, el nombre de la rama, la carpeta de changes del proveedor | Se pregunta |
| Slot y repositorios | `node scripts/manage-worktree.js status`; `repos[]` | Se pregunta |
| ¿El operador autorizó el merge? | El pedido ("cerralo hasta el merge") | Se frena antes del merge y se pregunta |
| ¿Hay orden de no tocar la tarjeta? | El pedido | Se mueve como dice `tracker-events` |
| Orden de repositorios | Ver el paso 12 | Se pregunta |

**Precondiciones del slot** (si una falla, se frena y se avisa; no se arregla desde acá):

- Todo commiteado y pusheado, con upstream a la rama propia (no a la base).
- El chequeo de tipos de los tests, en verde antes de ese push (`verificar-lo-que-el-runner-no-ve`).
- La principal en la rama base y limpia. Si tiene otra rama, es de otro ticket: se avisa, **no se hace `release` por cuenta propia**.

---

## El recorrido

| # | Paso | Procedimiento o script | Frena y pregunta si... |
|---|---|---|---|
| 1 | Llevar la rama a la principal | `worktree-slots` (`manage-worktree.js promote`) | El slot o la principal no cumplen las precondiciones |
| 2 | Traer la base y resolver conflictos | `git-sync-branch` | Un conflicto toca lógica de los dos lados |
| 3 | Migraciones pendientes | El procedimiento de migraciones del stack | Una migración borra o renombra, o falla; **y solo con orden del operador** |
| 4 | Chequeo de tipos que ve los tests | `typecheckTestCommand` | Falla |
| 5 | Gates y comprobaciones, **una vez** | `run-gates.js` + `run-checks.js` | Algo "no se pudo verificar" |
| 6 | Revisar con agentes sin contexto | `pr-review` (modo A) | — |
| 7 | Corregir lo que encontró | Los procedimientos del área + `gate-from-finding` | Un hallazgo choca con el diseño |
| 8 | Probar de punta a punta | `prueba-e2e` | Los servicios no están arriba, o algo queda en FALLA |
| 9 | Archivar el change | `spec-archive` (pasos de cierre, `cierra_rf`) | Hay tareas sin hacer |
| — | **PUNTO DE CONTROL ÚNICO** | — | **Siempre**: ver abajo |
| 10 | Commitear y pushear | `git-commit-workflow` | — |
| 11 | Abrir el PR y mover la tarjeta | El host (`forge`) + `tracker-events` (eventos 3 y 4) | La base avanzó desde el paso 2 |
| 12 | Mergear | El host (`forge`) | El operador no autorizó el merge |
| 13 | Devolver la principal a la base | `worktree-slots` (`manage-worktree.js release`) | — |
| 14 | Guardar lo aprendido | Memoria del proyecto **y** repositorio | — |
| 15 | Sincronizar los estados de los requisitos | `check-requirements.js --sync-estados` | El script cambió fichas de otros requisitos |
| 16 | Commitear la raíz | `git-commit-workflow` | La raíz está en la rama base |

**Varios repositorios:** cada paso se hace en todos, **empezando por los proveedores** de contrato. Son un commit y un PR por repositorio.

---

## 1 · Llevar la rama a la principal

```bash
node scripts/manage-worktree.js promote --slot <slot> [--repo <repo>]
```

El script verifica todo antes de tocar nada (`worktree-slots`). Al terminar, avisa si cambió el lockfile o si hay migraciones nuevas: anotarlo para los pasos 2 y 3. Si cambió el lockfile, la instalación va **en la principal** y con los servicios parados: los servicios son del operador, se le pide que los pare.

## 2 · Traer la base

`git-sync-branch`: fetch, merge de `origin/<baseBranch>` y push del merge. **Antes del review**, no después: el review tiene que mirar el estado integrado, el que se va a mergear.

**Conflictos.** `git-sync-branch` frena ante cualquiera. Desde acá se resuelven así:

- **Se resuelven y se muestran:** los que son solo agregados de los dos lados (dos entradas nuevas en un mismo archivo de textos, dos imports, dos filas de una tabla), el lockfile (se regenera, no se edita a mano) y la documentación.
- **Se pregunta, con una propuesta concreta:** cualquier conflicto donde los dos lados cambiaron la misma lógica, un tipo de contrato, una entidad o una migración.

Después de resolver: tests del módulo tocado en verde, y recién ahí el push.

## 3 · Migraciones

Con la lista que dejaron los pasos 1 y 2. **Pedir este procedimiento es la orden del operador** para correr las migraciones **pendientes** de la rama —las propias y las que entraron de la base—, **y solo esas**. Se corren **en la principal**, con el procedimiento del stack.

Se frena y se pregunta antes de correr si una migración borra o renombra una columna o una tabla: si el despliegue migra antes de actualizar el código, el código que sigue corriendo todavía la usa. Ante cualquier error, se frena y se avisa; nunca se arregla en el momento.

Sin `migrationsDir` declarado, este paso se omite.

## 4 · El chequeo de tipos que ve los tests

Por cada repositorio que declare `typecheckTestCommand`, correrlo **sobre el resultado de la sincronización** (regla `verificar-lo-que-el-runner-no-ve`). Si falla, se corrige antes de seguir: es exactamente lo que ni el runner ni el chequeo normal ven.

## 5 · Gates y comprobaciones: una vez

```bash
node scripts/run-gates.js --repo <repo>        # o --all si son varios
node scripts/run-checks.js --repo <repo> --scope diff
```

Su salida se les pasa a los revisores en el prompt: que cada uno repita el mismo barrido es gasto sin información nueva. Una salida "no se pudo verificar" no es "sin hallazgos": se dice en el reporte.

## 6 · Revisar con agentes sin contexto

`pr-review` en su **modo A** (la rama actual, ya sincronizada, sin hacer `checkout` de nada): `qa-agent` y `code-reviewer`, más `security-auditor` si el cambio toca autenticación, permisos, datos de personas o el borde de la aplicación.

**Sin contexto** quiere decir que los revisores son agentes nuevos que reciben la rama, el diseño del change y la salida de los gates, y **nada de esta conversación**. Así no heredan las suposiciones de quien escribió el código.

## 7 · Corregir

Antes de tocar un hallazgo:

1. **Que la línea citada exista**: `wc -l` contra el número citado (y `node scripts/verify-findings.js`).
2. **Que no sea una decisión tomada en el diseño** (`design.md` del change).
3. **Que el archivo sea el que efectivamente se llama**: hay copias muertas, y un hallazgo sobre un archivo que nadie importa es ruido. Se verifica el **sitio de la llamada**, no solo la definición.

Los bloqueantes se arreglan o se justifican por escrito. **Un defecto real que ningún gate vio pasa por `gate-from-finding`**: ese es el paso que hace que el sistema mejore solo. Las correcciones se commitean en el paso 10, junto con todo lo demás.

Si las correcciones fueron grandes, se repite el review **solo sobre lo corregido**, no sobre la rama entera.

## 8 · Probar de punta a punta

Con `prueba-e2e` (y la guía propia del proyecto que ese procedimiento pide en `ai/local/`), completo: plan, datos generados usando el producto, evidencia que se mira, limpieza, reporte N/N y cada lección con su destino.

Se salta solo si el change no tiene nada que se vea con la aplicación levantada, y se dice en el reporte. **"No concluyente" no es verde.**

## 9 · Archivar el change

`spec-archive`, **dentro del PR y antes del merge**, para que la base reciba el código y su especificación permanente en el mismo merge, y no queden uno sin el otro hasta que alguien abra un segundo PR para mover carpetas. Incluye releer la ficha del requisito y dejar `cierra_rf` diciendo la verdad.

Lo único que **no** va acá es sincronizar el estado de las fichas: espera al merge (paso 15).

## Punto de control: el único que no se saltea

Acá el agente frena **siempre** y muestra, en **un solo mensaje**:

- La rama de cada repositorio, los commits que entraron de la base y los conflictos resueltos.
- Las migraciones corridas.
- Los hallazgos del review: arreglados, justificados y descartados (con el motivo).
- El resultado de la prueba de punta a punta (N/N) y las lecciones con su destino.
- El estado de git de cada repositorio y el mensaje de commit propuesto.

Y hace **una sola pregunta**: *¿commiteo, pusheo y abro el PR?*, con la opción de incluir el merge si el pedido no la traía. Con el sí, los pasos 10 a 16 corren seguidos.

**Por qué acá y no antes ni después.** Hasta este punto todo se puede deshacer en local. Desde el paso 10 lo que se hace lo ve el equipo: el push, el PR, la tarjeta, el merge. Y la regla del workspace es que no hay commit sin un pedido explícito: esta pregunta **es** ese pedido, hecha cuando ya hay algo concreto para mirar. Preguntar antes es pedir permiso a ciegas; preguntar después es avisar de lo ya hecho.

## 10 · Commitear y pushear

`git-commit-workflow`, un commit por repositorio: la corrección del review, el archivado y lo que haya generado la prueba de punta a punta en ese repositorio. Formato según `commits.format`, **sin atribución de IA**. Antes del push: el chequeo de tipos de los tests (paso 4) y verificar el upstream.

## 11 · Abrir el PR y mover la tarjeta

**Si la base avanzó desde el paso 2**, se vuelve al paso 2 y se revisa **el delta** antes de abrir el PR: muchos hosts no avisan si un PR tiene conflictos.

El PR se abre contra `repos[].baseBranch`, con la descripción en un archivo (no pegada en la línea de comandos). Qué comando es depende del host:

| `forge.kind` | Abrir el PR | Mirar si se puede mergear |
|---|---|---|
| `github` | `gh pr create --base <base> --head <rama> --title … --body-file …` | `gh pr view <n> --json mergeable,mergeStateStatus` |
| `gitlab` | `glab mr create --target-branch <base> --source-branch <rama> …` | `glab mr view <n>` |
| `bitbucket` | El procedimiento propio del proyecto en `ai/local/` (no hay un CLI estándar) | El host no expone conflictos: por eso el paso 2 va antes |
| `none` | **No hay PR.** El trabajo queda pusheado y se dice; la integración la hace la persona por su medio | — |

Con el PR creado, la tarjeta pasa a **En revisión / QA** con su comentario (`tracker-events`, evento 3), y la historia la sigue si corresponde (evento 4). Sin tracker, la ficha del tablero. **El comentario no lleva atribución de IA.** Sin `forge`, el evento 3 se dispara con el push del trabajo listo para revisar, y solo si la persona lo confirmó en el punto de control.

## 12 · Mergear

**Solo con la autorización del operador** (en el pedido o en el punto de control). La estrategia de merge (merge commit, squash, fast-forward) es del proyecto; si no la declara en `ai/local/`, se pregunta, porque cada una pierde algo distinto (el squash pierde el commit por change; el fast-forward disuelve el PR como unidad que se puede revertir).

**Orden de los repositorios: las dependencias primero.** El que provee un contrato se mergea antes que el que lo consume (por ejemplo, un backend antes que el frontend que consume su contrato), porque mergear al revés deja la base con un consumidor que usa algo que todavía no existe. El orden no está fijo en este archivo: sale de lo que declare el proyecto (en `ai/local/`, o en `repos[]` si lo agrega), y si no lo declara, se pregunta antes de mergear el primero.

Después de mergear, **confirmar** el estado en el host (`gh pr view <n> --json state,mergeCommit`, o el equivalente) y anotar el identificador del merge para el reporte.

Sin autorización, el recorrido termina en el paso 11: se reporta y se deja anotado qué falta (merge, release, estados y raíz).

## 13 · Devolver la principal a la base

```bash
node scripts/manage-worktree.js release [--repo <repo>]
```

La principal vuelve a la rama base y se actualiza con `--ff-only`. Avisa si entraron dependencias o migraciones de otros PR. Esas migraciones **no** se corren solas: se listan en el reporte.

## 14 · Guardar lo aprendido

Dos preguntas sobre **toda la sesión**, no solo sobre la prueba:

1. **¿Qué se aprendió?** Algo del producto, del entorno o del flujo que le sirve al próximo ticket.
2. **¿Qué salió mal y cómo se evita que vuelva a pasar?** Un error del código, un paso que se hizo dos veces, una suposición que resultó falsa.

Cada respuesta va a **la memoria del proyecto** (la herramienta de memoria persistente que tenga la sesión, si la hay: qué pasó, por qué y cómo evitarlo) **y también al repositorio**, con el destino que corresponda: un gate (`gate-from-finding`), un helper, una guía, o una regla en `ai/local/rules/`. La memoria es de una persona y una máquina; el repositorio es del equipo. Lo que solo queda en la memoria, el resto del equipo lo vuelve a aprender.

## 15 · Sincronizar los estados de los requisitos

**Recién con el PR mergeado y la principal de vuelta en la base** (paso 13):

```bash
node scripts/check-requirements.js --sync-estados
```

Después, `git status` de la raíz: quedarse **solo con las fichas del requisito propio**. Si el script movió fichas de otros requisitos (pasa después de sincronizar con la base), se listan y se consultan; no se commitean. Un salto de `analisis` a `cerrado` es la señal de alarma (regla `requisitos`). Antes de mergear **no** se corre: afirmaría como entregado algo que vive en una rama que todavía se puede rechazar.

Sin `requirements`, este paso se omite.

## 16 · Commitear la raíz

`git-commit-workflow` sobre la raíz del workspace, si corresponde: la ficha del requisito y las lecciones del paso 14 que hayan ido a archivos de la raíz (`docs/`, `ai/`, `scripts/`). Se commitea en la rama en la que esté la raíz, verificando el upstream. **Si la raíz está en su rama base, se frena y se pregunta**: a la base no se commitea directo.

---

## El reporte final

Una tabla con los 16 pasos y su resultado (hecho, **omitido con motivo**, o pendiente), los hashes de cada commit y de cada merge, la URL de cada PR, el estado de la tarjeta o de la ficha, las lecciones con su destino, y lo que quedó pendiente para el operador (migraciones de otros PR, fichas de otros requisitos a consultar, órdenes en contra que se respetaron).

Antes de reportar: ningún proceso propio queda corriendo (servicios de la prueba, observadores) y los temporales del scratchpad se borran.

---

## Lo que este procedimiento NO hace

- No hace `promote` de un slot con cambios sin commitear ni `release` de una principal que tiene otro ticket.
- No reinicia los servicios del operador: se le pide.
- No commitea, no pushea ni abre el PR antes del punto de control.
- No mergea sin autorización del operador.
- No corre migraciones que no estén pendientes de esta rama, ni sin la orden.
- No corre `--sync-estados` antes del merge.
- No commitea fichas de requisitos ajenos que el script haya movido.
- No decide el orden de merge de los repositorios por su cuenta si el proyecto no lo declaró.
