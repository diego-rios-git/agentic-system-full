# Cerrar un ticket: del slot al merge

> **Estado: esqueleto, sin primera corrida guiada.** El orden, las fases y el turno salen de un recorrido que funcionó en otro proyecto; en este todavía no se corrió de punta a punta con una persona mirando. La primera vez, se corre paso a paso, se anota en `ai/local/` qué hubo que ajustar y recién después se confía en él sin supervisión.

Un ticket terminado en un slot se cierra en **tres fases**. Solo la del medio usa la principal, y la usa de a un ticket por vez:

| Fase | Dónde | Qué | ¿Traba a otros? |
|---|---|---|---|
| **1 · Precierre** | En el slot | Traer la base, chequeo de tipos, gates, review sin contexto, correcciones, archivado, commit y push | No: todos los slots la hacen a la vez |
| **2 · Turno** | En la principal | Turno, `promote`, migraciones, prueba de punta a punta y sus correcciones, commit y push, **`release`** | Sí, el rato que dura |
| **3 · Cierre** | Fuera de la principal | PR, tarjeta, merge, lecciones, estados de los requisitos y commit de la raíz | No |

**Por qué así.** Cuando la principal se tomaba en el `promote` y se devolvía después del merge, cada ticket la tenía unos 40 minutos, y solo las migraciones y la prueba de punta a punta la necesitaban. El resto —review, correcciones, PR, merge— y sobre todo **la espera de una respuesta del operador** la tenían tomada sin usarla, y los slots que ya habían terminado esperaban detrás.

Este procedimiento **no reemplaza a ninguno de los que usa**: solo fija el orden, dice dónde frenar y cuál hace cada paso. Si un procedimiento y este archivo dicen cosas distintas sobre **cómo** se hace un paso, gana el procedimiento; este archivo manda sobre **cuándo**.

**Una orden del operador en contra de un paso automático gana** (no mover la tarjeta, no mergear, no archivar todavía). El reporte final dice qué quedó sin hacer por esa orden.

**Corre desde la raíz del workspace**, con `git -C`, nunca con `cd`. La guía de uso, con el prompt de cada caso, es `docs/trabajo-en-paralelo.md`.

---

## Qué pasos aplican según la configuración

Un paso que no aplica **se omite explícitamente y el reporte lo dice**: "paso 1.5 omitido: el proyecto no tiene ciclo dirigido por especificación". No se simula.

| Paso | Opcional según... | Si no aplica |
|---|---|---|
| Fases 1 y 2 en el slot y por turno | `worktrees.enabled` | Sin slots, todo pasa en la principal y en el mismo orden: no hay turno, ni `promote`, ni `release` |
| 1.2 Tipos de los tests | `repos[].typecheckTestCommand` | Si el runner chequea tipos o el lenguaje compila los tests, no hace falta |
| 2.4 Migraciones | `repos[].database.migrationsDir` | No hay migraciones que mirar |
| 2.5 Prueba de punta a punta | Que el cambio tenga algo que se vea con la aplicación levantada | Se omite, y se dice |
| 1.5 Archivar | Un proveedor del ciclo dirigido por especificación (`sdd` en un pack) | Se omite |
| 3.1 PR | `forge.kind` distinto de `none` | No hay PR: ver la tabla del paso 3.1 |
| 3.1 Tarjeta | `tracker.kind` o tablero de requisitos (`requirements`) | Ver `tracker-events`: sin tracker y sin tablero, no se hace nada |
| 3.2 Merge | `forge.kind` distinto de `none` | Lo hace la persona por su medio |
| 3.4 Estados de los requisitos | `requirements` | No hay tablero |

---

## Lo que hay que saber antes de arrancar

| Dato | De dónde sale | Si falta |
|---|---|---|
| Identificador del ticket y el change | El pedido, el nombre de la rama, la carpeta de changes del proveedor | Se pregunta |
| Slot y repositorios | `node scripts/manage-worktree.js status`; `repos[]` | Se pregunta |
| ¿Hay autorización anticipada? | El pedido ("cerralo hasta el merge", "hasta el PR") | Se frena una vez, al final de la fase 1 (ver *Punto de control*) |
| ¿Hay orden de no tocar la tarjeta? | El pedido | Se mueve como dice `tracker-events` |
| Orden de repositorios | Ver el paso 3.2 | Se pregunta |

**Precondiciones del slot** (si una falla, se frena y se avisa; no se arregla desde acá):

- El trabajo del ticket está hecho y sus tests unitarios en verde.
- El chequeo de tipos de los tests, en verde (`verificar-lo-que-el-runner-no-ve`).

---

## Cuándo se frena: por excepción, no por rutina

La regla del workspace es que no hay commit sin un pedido explícito. Ese pedido puede llegar **por adelantado**, en el pedido de cierre:

| Pedido | Cubre |
|---|---|
| "Cerrá `<ticket>` desde `<slot>`, hasta el merge" | Commits y push en la rama del ticket, PR, tarjeta, merge y commit de la raíz |
| "… hasta el PR" | Lo mismo sin el merge: el recorrido termina en el paso 3.1 |
| "Cerrá `<ticket>`", sin alcance | Nada: se frena **una vez**, al final de la fase 1, en el slot |

Con autorización, el recorrido corre de punta a punta y **solo frena ante una excepción**:

| Excepción | Dónde aparece |
|---|---|
| Un conflicto con la base donde los dos lados cambiaron la misma lógica, un tipo de contrato, una entidad o una migración | 1.1, 2.3, 3.1 |
| Un hallazgo del review que choca con el diseño del change | 1.3 |
| Una corrección que cambia el contrato (un endpoint, un tipo, un código de error) | 1.4, 2.5 |
| Una migración que borra o renombra una columna o una tabla, o que falla | 2.4 |
| Hay que reinstalar dependencias y los servicios del operador están arriba | 2.2 |
| La prueba de punta a punta queda en FALLA o NO CONCLUYENTE después de corregir | 2.5 |
| El script de estados movió fichas de otros requisitos | 3.4 |

**Cómo se frena.** Con un aviso al celular si el harness lo tiene (en Claude Code, `PushNotification`: el operador puede no estar mirando esta sesión) y un mensaje con la excepción, una propuesta concreta y **una sola pregunta**. Si la excepción aparece en la fase 2, primero se evalúa si se puede devolver la principal: un conflicto o un hallazgo que necesita una decisión se resuelve en el slot, no con la principal tomada (ver 2.7).

### Punto de control: solo sin autorización anticipada

Al final de la fase 1, en el slot, el agente muestra en **un solo mensaje**:

- La rama de cada repositorio, los commits que entraron de la base y los conflictos resueltos.
- Los hallazgos del review: arreglados, justificados y descartados (con el motivo).
- El estado de git del slot y el mensaje de commit propuesto.

Y hace **una sola pregunta**: *¿commiteo, pido turno y sigo hasta el PR (o hasta el merge)?* El sí es la autorización para todo el resto.

**Por qué acá.** Hasta este punto todo se puede deshacer en local; desde el commit, lo que se hace lo ve el equipo. Y esperar acá no le cuesta nada a nadie: la principal no está tomada. Si el punto de control estuviera después de la prueba de punta a punta, la principal quedaría tomada mientras el operador contesta.

---

## Fase 1 · Precierre, en el slot

Todo apunta a `<worktrees.dir>/<slot>/<repo>`. No necesita la principal ni la base de datos, y **no espera a nadie**: arranca aunque otra sesión tenga la principal.

### 1.1 · Traer la base

`git-sync-branch`, con cada `git -C` apuntado al slot en vez de a la principal: fetch y merge de `origin/<baseBranch>`. **El push del merge espera a 1.6**: sin autorización todavía no se publica nada. **Antes del review**, no después: el review tiene que mirar el estado integrado, el que se va a mergear.

**Conflictos.** `git-sync-branch` frena ante cualquiera. Desde acá se resuelven así:

- **Se resuelven y se muestran:** los que son solo agregados de los dos lados (dos entradas nuevas en un mismo archivo de textos, dos imports, dos filas de una tabla) y la documentación. El lockfile se regenera **en la principal**, en la fase 2: instalar dependencias en un slot con el directorio enlazado vacía el de la principal (`shared-dependencies`).
- **Excepción:** cualquier conflicto donde los dos lados cambiaron la misma lógica, un tipo de contrato, una entidad o una migración.

Si entraron migraciones de otros PR, se anotan para la fase 2: no se corren acá.

### 1.2 · El chequeo de tipos que ve los tests

Por cada repositorio que declare `typecheckTestCommand`, correrlo en el slot **sobre el resultado de la sincronización** (regla `verificar-lo-que-el-runner-no-ve`). Si falla, se corrige antes de seguir.

### 1.3 · Gates y review sin contexto

```bash
node scripts/run-gates.js --repo <repo> --from <slot>     # o --all si son varios
node scripts/run-checks.js --repo <repo> --from <slot> --scope diff
```

Una vez. Su salida se les pasa a los revisores en el prompt: que cada uno repita el mismo barrido es gasto sin información nueva. Una salida "no se pudo verificar" no es "sin hallazgos": se dice en el reporte.

El review del PR se hace **acá**, con `pr-review` en su **modo S** (el slot, leído en su lugar): `qa-agent` y `code-reviewer`, más `security-auditor` si el cambio toca autenticación, permisos, datos de personas o el borde de la aplicación.

**Sin contexto** quiere decir que los revisores son agentes nuevos que reciben la rama, el diseño del change y la salida de los gates, y **nada de esta conversación**. Así no heredan las suposiciones de quien escribió el código.

Se anota el commit revisado: si después algo cambia (correcciones de la prueba de punta a punta, una nueva sincronización), se revisa **solo el delta** desde ese commit.

### 1.4 · Corregir

Antes de tocar un hallazgo:

1. **Que la línea citada exista**: `wc -l` contra el número citado (y `node scripts/verify-findings.js`).
2. **Que no sea una decisión tomada en el diseño** (`design.md` del change). Si choca: excepción.
3. **Que el archivo sea el que efectivamente se llama**: hay copias muertas, y un hallazgo sobre un archivo que nadie importa es ruido. Se verifica el **sitio de la llamada**, no solo la definición.

Los bloqueantes se arreglan o se justifican por escrito. **Un defecto real que ningún gate vio pasa por `gate-from-finding`**: ese es el paso que hace que el sistema mejore solo. En el slot corren los tests unitarios, el lint, el chequeo de tipos y el build; los que necesitan la base de datos o la aplicación levantada esperan a la fase 2.

Si las correcciones fueron grandes, se repite el review **solo sobre lo corregido**, no sobre la rama entera.

### 1.5 · Archivar el change

`spec-archive`, sobre el slot, **dentro del PR y antes del merge**, para que la base reciba el código y su especificación permanente en el mismo merge. Incluye releer la ficha del requisito y dejar `cierra_rf` diciendo la verdad. Sincronizar el estado de las fichas espera al merge (paso 3.4).

### 1.6 · Commitear y pushear en el slot

Con autorización (anticipada o del punto de control): `git-commit-workflow`, un commit por repositorio, con `git -C <worktrees.dir>/<slot>/<repo>`. Formato según `commits.format`, **sin atribución de IA**. Antes del push, el chequeo de tipos de los tests y verificar el upstream: tiene que ser `origin/<rama>`.

---

## Fase 2 · Turno en la principal

La principal es una sola: base de datos, servicios y puertos compartidos. Por eso se usa **de a un ticket por vez y solo para lo que la necesita**.

### 2.1 · Pedir el turno

Primero el nombre de esta sesión, para que la que libere la principal pueda despertarla. En Claude Code, `ListAgents` lo dice en su primera línea. Si el harness no tiene cómo nombrar ni mandarle un mensaje a otra sesión, se omite `--session`: la que libere la principal le avisará al operador en vez de a esta sesión.

```bash
node scripts/manage-worktree.js turn --slot <slot> --session <nombre>
```

| Salida | Qué hace la sesión |
|---|---|
| `TURNO: es de <slot>` (sale 0) | Sigue con 2.2 |
| `TURNO: <slot> espera, puesto K de M` (sale 3) | **Termina su turno de conversación** diciendo el puesto y quién tiene la principal. No hace polling ni lanza un loop que espere: la despierta la sesión que haga `release` (2.7) |
| `… nadie lo tiene, pero la principal no está en la base y limpia` (sale 3) | Nadie va a hacer `release` por sí solo: es un ticket grande que vive en la principal o alguien la movió sin turno. Se le avisa al operador y se termina |
| Sale 2 (slot desconocido o de revisión, slots desactivados) o 1 (no se pudo tomar el lock en 15 s) | Se reporta el mensaje. Con 1, se reintenta una vez |

Al despertar con el aviso, vuelve a pedir el turno con el mismo comando: **el aviso no es el turno**, el script es el que lo da.

El turno se da en orden de llegada y solo cuando nadie lo tiene y la principal está en la base y limpia. `promote` se niega si otro slot tiene el turno o está antes en la cola. Detalle en `worktree-slots`, *El turno de la principal*.

### 2.2 · Llevar la rama a la principal

```bash
node scripts/manage-worktree.js promote --slot <slot> [--repo <repo>]
```

El script verifica todo antes de tocar nada (`worktree-slots`). Al terminar, avisa si cambió el lockfile o si hay migraciones nuevas: anotarlo para 2.4. Si cambió el lockfile, la instalación va **en la principal** y con los servicios parados: los servicios son del operador, y si están arriba es una excepción.

### 2.3 · Volver a traer la base, solo si avanzó

Si la base avanzó desde 1.1 (otro ticket mergeó mientras este esperaba), `git-sync-branch` sobre la principal y review **del delta** que entró. Es lo común con varios slots: el que esperaba trae el merge del anterior.

### 2.4 · Migraciones

Con la lista de 1.1, 2.2 y 2.3. **Pedir este procedimiento es la orden del operador** para correr las migraciones **pendientes** de la rama —las propias y las que entraron de la base—, **y solo esas**, con el procedimiento del stack.

Se frena antes de correr si una migración borra o renombra una columna o una tabla: si el despliegue migra antes de actualizar el código, el código que sigue corriendo todavía la usa. Ante cualquier error, se frena y se avisa; nunca se arregla en el momento.

### 2.5 · Probar de punta a punta

Con `prueba-e2e` (y la guía propia del proyecto que ese procedimiento pide en `ai/local/`), completo: plan, datos generados usando el producto, evidencia que se mira, limpieza, reporte N/N y cada lección con su destino. Acá corren también los tests que necesitan la base de datos.

Una falla que se arregla sin tocar el contrato se corrige acá y se vuelve a correr. Si sigue en FALLA o queda NO CONCLUYENTE, es una excepción. **"No concluyente" no es verde.**

Se salta solo si el change no tiene nada que se vea con la aplicación levantada, y se dice en el reporte.

### 2.6 · Commitear y pushear lo de la prueba

Si la prueba dejó cambios (correcciones, lecciones al repositorio): `git-commit-workflow` en la principal, con las mismas reglas que 1.6. Si no dejó nada, no hay commit.

### 2.7 · Devolver la principal y despertar a la siguiente sesión

```bash
node scripts/manage-worktree.js release
```

Va **antes del PR**: lo que sigue no necesita la principal. Deja cada repositorio en su base, actualizada; con la principal entera en la base, suelta el turno y, si hay cola, nombra a la siguiente:

```
TURNO-AVISAR: <sesión> <slot>
```

Con un nombre de sesión, se le manda un mensaje a esa sesión (en Claude Code, `SendMessage`) con un texto que se entienda sin contexto, porque puede llegarle a una sesión compactada o nueva:

> La principal quedó libre y sigue `<slot>` (`<ticket>`, si lo sabés). Pedí el turno con `node scripts/manage-worktree.js turn --slot <slot>` y seguí `ai/core/procedures/cerrar-ticket.md` desde el paso 2.1, con la autorización que ya te habían dado.

Con `(sin sesión)`, o si el mensaje falla, se avisa al operador (al celular si el harness puede): *"La principal quedó libre: sigue `<slot>`"*. El prompt para retomar está en `docs/trabajo-en-paralelo.md`, caso 6.

**Devolver la principal ante una excepción.** Si de 2.3 a 2.5 aparece algo que necesita una decisión del operador y no se resuelve en minutos, no se espera con la principal tomada: se commitea y pushea lo que haya (con autorización) o se deja anotado, `release`, y se reabre el slot con la rama (`open --slot <slot> --repo <repo> --branch <rama>`) para resolverlo ahí. Después se vuelve a pedir el turno.

---

## Fase 3 · Cierre, fuera de la principal

### 3.1 · Abrir el PR y mover la tarjeta

**Si la base avanzó desde la última sincronización**, se reabre el slot con la rama, se sincroniza ahí y se revisa **el delta** antes de abrir el PR: muchos hosts no avisan si un PR tiene conflictos.

El PR se abre contra `repos[].baseBranch`, con la descripción en un archivo (no pegada en la línea de comandos). Qué comando es depende del host:

| `forge.kind` | Abrir el PR | Mirar si se puede mergear |
|---|---|---|
| `github` | `gh pr create --base <base> --head <rama> --title … --body-file …` | `gh pr view <n> --json mergeable,mergeStateStatus` |
| `gitlab` | `glab mr create --target-branch <base> --source-branch <rama> …` | `glab mr view <n>` |
| `bitbucket` | El procedimiento propio del proyecto en `ai/local/` (no hay un CLI estándar) | El host no expone conflictos: por eso la sincronización va antes |
| `none` | **No hay PR.** El trabajo queda pusheado y se dice; la integración la hace la persona por su medio | — |

Con el PR creado, la tarjeta pasa a **En revisión / QA** con su comentario (`tracker-events`, evento 3), y la historia la sigue si corresponde (evento 4). Sin tracker, la ficha del tablero. **El comentario no lleva atribución de IA.** Sin `forge`, el evento 3 se dispara con el push del trabajo listo para revisar.

**Varios repositorios:** un PR por repositorio, **empezando por los proveedores** de contrato.

### 3.2 · Mergear

**Solo con la autorización del operador** (en el pedido o en el punto de control). La estrategia de merge (merge commit, squash, fast-forward) es del proyecto; si no la declara en `ai/local/`, se pregunta, porque cada una pierde algo distinto (el squash pierde el commit por change; el fast-forward disuelve el PR como unidad que se puede revertir).

**Orden de los repositorios: las dependencias primero.** El que provee un contrato se mergea antes que el que lo consume, porque mergear al revés deja la base con un consumidor que usa algo que todavía no existe. El orden sale de lo que declare el proyecto (en `ai/local/`, o en `repos[]`), y si no lo declara, se pregunta antes de mergear el primero.

Después de mergear, **confirmar** el estado en el host (`gh pr view <n> --json state,mergeCommit`, o el equivalente) y anotar el identificador del merge para el reporte.

Sin autorización, el recorrido termina en el paso 3.1: se reporta y se deja anotado qué falta (merge, estados y raíz).

### 3.3 · Guardar lo aprendido

Dos preguntas sobre **toda la sesión**, no solo sobre la prueba:

1. **¿Qué se aprendió?** Algo del producto, del entorno o del flujo que le sirve al próximo ticket.
2. **¿Qué salió mal y cómo se evita que vuelva a pasar?** Un error del código, un paso que se hizo dos veces, una suposición que resultó falsa.

Cada respuesta va a **la memoria del proyecto** (la herramienta de memoria persistente que tenga la sesión, si la hay: qué pasó, por qué y cómo evitarlo) **y también al repositorio**, con el destino que corresponda: un gate (`gate-from-finding`), un helper, una guía, o una regla en `ai/local/rules/`. La memoria es de una persona y una máquina; el repositorio es del equipo.

### 3.4 · Sincronizar los estados de los requisitos

**Recién con el PR mergeado:**

```bash
node scripts/check-requirements.js --sync-estados
```

**Antes de correrlo, mirar en qué rama está cada repositorio de la principal.** El `release` de 2.7 ya despertó a la siguiente sesión, y si esa hizo `promote`, la principal está en **su** rama: el script lee los changes de esa rama, no ve tu merge y les cambia el estado a los requisitos del otro ticket. En ese caso no se corre: se pasa a mano solo la línea `estado:` de tu ficha a lo que derivaría tu `cierra_rf`, y no se toca la principal, porque ya no es tuya.

Después, `git status` de la raíz: quedarse **solo con las fichas del requisito propio**. Si el script movió fichas de otros requisitos, es una excepción: se listan y se consultan; no se commitean. Un salto de `analisis` a `cerrado` es la señal de alarma (regla `requisitos`). Antes del merge **no** se corre: afirmaría como entregado algo que vive en una rama que todavía se puede rechazar.

### 3.5 · Commitear la raíz

`git-commit-workflow` sobre la raíz del workspace, si corresponde: la ficha del requisito y las lecciones de 3.3 que hayan ido a archivos de la raíz (`docs/`, `ai/`, `scripts/`). Se commitea en la rama en la que esté la raíz, verificando el upstream. Con varios slots cerrando a la vez, `git pull --ff-only` antes del commit: otra sesión pudo haber pusheado la raíz. **Si la raíz está en su rama base, se frena y se pregunta**: a la base no se commitea directo.

---

## El reporte final

Una tabla con los pasos y su resultado (hecho, **omitido con motivo**, o pendiente), los hashes de cada commit y de cada merge, la URL de cada PR, el estado de la tarjeta o de la ficha, las lecciones con su destino, **cuánto tiempo estuvo tomada la principal**, y lo que quedó pendiente para el operador (migraciones de otros PR, fichas de otros requisitos a consultar, órdenes en contra que se respetaron).

Antes de reportar: ningún proceso propio queda corriendo (servicios de la prueba, observadores) y los temporales del scratchpad se borran.

---

## Lo que este procedimiento NO hace

- No hace `promote` sin turno, ni de un slot con cambios sin commitear, ni `release` de una principal que tiene otro ticket.
- No espera el turno con un loop ni con polling: la sesión en cola termina y la despierta la que libera la principal.
- No retiene la principal mientras espera una decisión del operador.
- No reinicia los servicios del operador: se le pide.
- No commitea ni pushea sin autorización (anticipada o del punto de control).
- No mergea sin autorización del operador.
- No corre migraciones que no estén pendientes de esta rama, ni sin la orden.
- No corre `--sync-estados` antes del merge, ni con la principal en la rama de otro ticket.
- No commitea fichas de requisitos ajenos que el script haya movido.
- No decide el orden de merge de los repositorios por su cuenta si el proyecto no lo declaró.
