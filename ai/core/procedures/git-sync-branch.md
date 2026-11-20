# Sincronizar la rama con su base

Trae a la rama actual lo que se acumuló en su base —`repos[].baseBranch`, aunque la base es un parámetro— **antes del review y del PR**, en ese orden: sincronizar, revisar, crear. Corre desde la raíz del workspace con `git -C`, igual que `git-commit-workflow`.

**Motor**: git. Lo demás (migraciones, dependencias) solo se **lista**, nunca se ejecuta.

---

## Por qué el orden es sincronizar -> revisar -> PR

Hubo dos incidentes, y cada uno fija una mitad del orden.

1. **Sincronizar DESPUÉS del review.** El review aprobó la rama y recién entonces la sincronización trajo cientos de commits, varios conflictos y miles de líneas nuevas en el mismo módulo. El estado integrado —el que efectivamente se mergea— nunca fue revisado, y justo ahí terminó roto lo que el review no había visto. Sincronizar antes **no le cuesta nada al review**: compara contra la base con tres puntos (`<base>...HEAD`), que mide contra el ancestro común; tras sincronizar, ese ancestro es la punta de la base y el diff sigue siendo solo el trabajo de la rama. Ahora el review mira el código que de verdad se va a mergear.
2. **PR abierto con la rama muy atrasada, y el host no avisa.** Muchos hosts de PR no exponen si el PR es mergeable: no hay un campo de conflictos en lo que devuelven. Un PR abierto sobre una rama atrasada no lo avisa nadie, y el conflicto aparece en el merge. Por eso se detecta **antes de abrir el PR** y sin tocar el árbol de trabajo (ver el Paso 2).

Si la base avanzó entre el review y el merge, el recorrido vuelve acá y se revisa **el delta**, no la rama entera (`cerrar-ticket`).

---

## Qué automatiza, y qué no

Automatiza lo que se hace a mano antes de cada PR: entrar a cada repositorio, traer la base, empujar el merge y mirar si aparecieron migraciones o cambió el lockfile.

**Se detiene y pregunta en las tres situaciones donde una decisión automática haría daño:**

| Situación | Qué hace |
|---|---|
| Hay cambios sin commitear | **Para antes de traer nada.** Ni `pull` ni `stash` |
| El merge da conflictos | **Para**, lista los archivos y espera. Nunca resuelve por su cuenta |
| Aparecieron migraciones | **Las lista y espera la orden.** Nunca las corre sin que se lo pidan |

**Nunca genera una migración.** Eso es del procedimiento de migraciones del stack, y solo cuando la persona lo pide.

---

## Paso 0: qué repositorios y contra qué base

```
Repos:  los de `repos[]` que la persona nombre; si no nombró, todos los que tengan trabajo en la rama
Base:   `repos[].baseBranch` de cada uno; si la persona nombró otra, esa, sin discutir
```

La base **no está fija**: sirve para sincronizar contra una rama de funcionalidad compartida o contra una de release. Si la persona nombró una base, se usa esa; si difiere de la declarada, se dice.

Si el trabajo está en un slot, el repositorio es `<worktrees.dir>/<slot>/<repo>` (ver `worktree-slots`). Sincronizar en un slot es válido; **migrar desde un slot no** (la base de datos es compartida).

Antes de tocar nada, decir en voz alta qué se va a hacer:

> "Sincronizo `<repoA>` y `<repoB>` con `origin/<base>`."

---

## Paso 1: estado y rama — BLOQUEANTE

```bash
git -C {REPO_PATH} status --porcelain
git -C {REPO_PATH} branch --show-current
```

**Si `status --porcelain` devuelve algo, parar ese repositorio acá.** Traer la base sobre un árbol sucio, o falla a mitad, o mezcla trabajo sin commitear dentro de un merge que después nadie puede separar. No se resuelve con `git stash` por iniciativa propia: el stash es fácil de olvidar y el trabajo queda invisible.

Reportar los archivos y seguir con el otro repositorio:

> `<repo>` tiene 3 archivos sin commitear. No lo sincronizo: commiteá o guardá esos cambios y volvemos.

**Si la rama actual ES la base**, no hay nada que mezclar: se actualiza con `git -C {REPO_PATH} fetch origin {BASE}` y `git -C {REPO_PATH} merge --ff-only origin/{BASE}`, y listo.

---

## Paso 2: traer la base y mirar los conflictos ANTES de mezclar

```bash
git -C {REPO_PATH} fetch origin {BASE}
```

Para saber si el merge va a dar conflicto **sin tocar el árbol de trabajo**:

```bash
MB=$(git -C {REPO_PATH} merge-base origin/{BASE} HEAD)
git -C {REPO_PATH} merge-tree "$MB" HEAD origin/{BASE} | grep -c "^+<<<<<<<"
```

Esa es la forma con el ancestro explícito, que anda en cualquier git. `git merge-tree --write-tree` (que devuelve directamente los archivos en conflicto) existe desde git 2.38: si `git --version` lo permite, es más directa; si no, la de arriba.

Con un conteo mayor que cero, **avisar ahora** cuántos conflictos esperan y en qué archivos, antes de mezclar. Con cero, seguir.

---

## Paso 3: mezclar

```bash
git -C {REPO_PATH} merge origin/{BASE}
```

**`fetch` + `merge` explícito. Nunca `pull`.** `pull` obedece la configuración local de cada máquina (`pull.rebase`): el mismo comando hace cosas distintas en dos computadoras, y acá el resultado tiene que ser el mismo siempre.

**Merge. Nunca `rebase`.** La rama ya está publicada: un rebase reescribe historia compartida y obliga a `--force`, que en una rama que otra persona puede haber tocado pierde trabajo.

Tres resultados posibles:

| Salida de git | Significa | Qué sigue |
|---|---|---|
| `Already up to date.` | La base no avanzó | Nada que empujar. Ir al Paso 6 |
| `Fast-forward` o `Merge made by...` | Entró trabajo nuevo | Paso 4 |
| `CONFLICT (content): ...` | **PARAR** | Ver abajo |

### Si hay conflictos: PARAR Y PREGUNTAR

```bash
git -C {REPO_PATH} diff --name-only --diff-filter=U
```

Listar los archivos en conflicto y **detenerse**. No resolver, no elegir un lado, no abortar el merge por decisión propia:

> `<repo>` quedó con 2 archivos en conflicto:
> - `<archivo 1>`
> - `<archivo 2>`
>
> El merge está a medias. ¿Los resuelvo yo, los resolvés vos, o lo abortamos con `git merge --abort`?

El merge a medias **no se deja así en silencio**: si la persona no responde, el repositorio queda en un estado que rompe cualquier otro comando. Decirlo explícitamente.

(Un procedimiento que orquesta esto, como `cerrar-ticket`, puede fijar qué conflictos se resuelven y se muestran —por ejemplo, agregados de los dos lados— y cuáles se preguntan. Este procedimiento, solo, **pregunta siempre**.)

---

## Paso 4: lo que el runner no ve, antes de empujar

Si el repositorio declara `typecheckTestCommand`, correrlo **sobre el resultado del merge y antes del push** (regla `verificar-lo-que-el-runner-no-ve`): un merge sin conflictos puede traer una firma cambiada por otra persona y dejar tus tests apuntando a la vieja. Si falla, **no se empuja**: se reporta qué rompió, y la persona decide. No es "correr los tests": es mirar los tipos de los archivos que ningún otro chequeo mira.

---

## Paso 5: empujar el merge

```bash
git -C {REPO_PATH} rev-parse --abbrev-ref @{u}
git -C {REPO_PATH} push origin {RAMA_ACTUAL}
```

Verificar el upstream **antes**: uno mal configurado manda el push a la rama base aunque la rama se llame distinto. **El nombre no determina el destino; el upstream sí.**

- Si el upstream apunta a la base (`origin/{BASE}`): **corregirlo antes de empujar**, con `git -C {REPO_PATH} push -u origin {RAMA_ACTUAL}` (nombre explícito), y decirlo.
- Si no hay upstream: lo mismo, `push -u origin {RAMA_ACTUAL}`.
- Si el push se rechaza porque el remoto tiene commits que no están acá: **parar**, nunca `--force`.

**El merge commit no lleva el formato de commits de `commits.format`.** El mensaje que genera git (`Merge remote-tracking branch 'origin/<base>' into <rama>`) queda como está: la convención es para los commits que escribe una persona; un merge no describe un cambio, describe una integración. **Nunca atribución de IA** en el merge, igual que en cualquier otro commit.

> Este push es parte del pedido de sincronizar: no hace falta un permiso aparte. Lo que sí hace falta es que la persona haya pedido la sincronización (o que lo pida un procedimiento que ella invocó): este procedimiento no se dispara solo al terminar una tarea.

---

## Paso 6: migraciones nuevas — LISTAR, NUNCA CORRER SOLO

Solo para los repositorios que declaran `repos[].database.migrationsDir`, y solo si el Paso 3 trajo algo.

```bash
git -C {REPO_PATH} diff --name-only --diff-filter=A ORIG_HEAD HEAD -- {MIGRATIONS_DIR}
```

Son los archivos de migración **que entraron con el merge**. Si el proyecto declara un comando de solo lectura que muestra qué migraciones están pendientes de aplicar (`repos[].database.statusCommand`), ese es el que dice la verdad; la lista de archivos es lo que se puede afirmar sin él.

- **Si no hay**: decirlo y seguir.
- **Si hay**: listarlas por nombre y **esperar la orden**.

> `<repo>` trajo 2 migraciones: `<nombre 1>`, `<nombre 2>`. ¿Las corro?

Recién con el sí, y **desde la principal, no desde un slot**, con el comando que declara el procedimiento de migraciones del stack. **Ante cualquier error: parar y reportar.** No reintentar, no editar el archivo, no borrar filas para que pase: una migración que falla a mitad deja la base en un estado que hay que mirar, no arreglar a ciegas.

**Nunca generar una migración acá.** Sincronizar es traer lo que otro escribió; generar una es trabajo propio y tiene su procedimiento.

---

## Paso 7: dependencias, si cambió el lockfile

```bash
git -C {REPO_PATH} diff --name-only ORIG_HEAD HEAD -- {LOCKFILE}
```

`{LOCKFILE}` es el del perfil de dependencias del repositorio (`repos[].deps`, o el del pack del stack; `scripts/lib/deps-profiles.js` lo resuelve y `node scripts/check-deps.js` mira su salud). Si el merge lo tocó, **avisar sin instalar**:

> El merge de `<repo>` cambió el lockfile. Antes de levantar nada conviene reinstalar las dependencias.

Una instalación automática puede tardar minutos y reescribir el lockfile si el manifiesto quedó desalineado. Es una decisión de la persona, no un efecto colateral de sincronizar. Si el repositorio comparte sus dependencias con sus slots, quién instala y desde dónde lo dice el procedimiento de slots.

---

## Paso 8: reportar

Un bloque por repositorio, con las respuestas que importan:

```
=== <repo> ===
Rama:         <rama>
Base:         origin/<base>
Resultado:    Merge made by the 'ort' strategy — 14 archivos
Tipos de los tests: ok | no declarado | FALLA (no se empujó)
Push:         OK | no hacía falta | upstream corregido
Migraciones:  2 llegaron -> esperando tu orden
Dependencias: sin cambios | el lockfile cambió: reinstalar
```

Si algún repositorio se saltó, decir **por qué** en la misma tabla: "no sincronizado: 3 archivos sin commitear" es información; "no sincronizado" solo, no.

---

## Lo que este procedimiento NO hace

- **No crea el PR.** Sincronizar deja la rama lista; abrir el PR es aparte.
- **No commitea trabajo propio.** Solo empuja el merge commit que genera git.
- **No corre tests ni gates.** Si el merge trajo cambios que rompen algo, se ve en la corrida siguiente, pero esa corrida se pide, no se dispara acá. La única excepción es el chequeo de tipos de los tests del Paso 4, que existe porque nadie más mira esos archivos.
- **No ejecuta migraciones ni instala dependencias.**
- **No toca la raíz del workspace** salvo que se la nombre explícitamente como repositorio objetivo: su base es otra.
