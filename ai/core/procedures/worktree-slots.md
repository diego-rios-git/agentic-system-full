# Slots de worktree

Espacios de trabajo aislados para implementar o revisar una rama **sin mover la rama del repositorio principal**, y el circuito que lleva esa rama a la principal para lo único que no se puede paralelizar.

Todo lo que sigue usa los nombres de `ai-workspace.json`: `<repo>` es un `repos[].name`, `<base>` es `repos[].baseBranch` de ese repo, `<slot>` es un `worktrees.slots[].name` y `<dir>` es `worktrees.dir`. Nada de esto nombra un repositorio ni una rama fija.

---

## Por qué existe el modelo

La base de datos, los servicios locales y los puertos son **uno solo por máquina**. El código y los tests sí se pueden paralelizar; migrar, correr e2e, revisar el PR completo y abrirlo, no. Entonces:

- El trabajo vive en los **slots** (un worktree por tarea).
- La **principal** (el checkout de cada repo en `<base>`) queda libre para lo único que se hace en un solo lugar y de a una tarea por vez: **migrar, e2e, review y PR**.
- Git no deja la misma rama en dos worktrees: por eso pasar una rama del slot a la principal **libera el slot** antes de mover la principal.

Slots declarados:

```json
"worktrees": {
  "enabled": true,
  "dir": "worktrees",
  "slots": [
    { "name": "implementation-1", "kind": "implementation" },
    { "name": "implementation-2", "kind": "implementation" },
    { "name": "review", "kind": "review" }
  ]
}
```

- `implementation-*`: una tarea por slot, con su rama. **No se reutilizan** mientras estén ocupados.
- `review`: desprendido (`detached`), para leer la rama de otra persona. Se **reutiliza** (ver abajo).

Layout: `<dir>/<slot>/<repo>/` es un worktree de git por repo (un slot multi-repo es lógico: contiene los repos que la tarea necesita), y `<dir>/<slot>/.ai-worktree.json` es el manifiesto del slot (`slot`, `kind`, `createdAt`, `repos`); se borra solo cuando el slot queda vacío.

---

## Flujo: slot → principal → PR

| Paso | Dónde | Qué |
|---|---|---|
| 1 | slot | Código y tests. Si cambia el esquema, **generar** la migración (no correrla). Gates apuntados al slot (`--from`) |
| 2 | slot | Commit y push de la rama |
| 3 | raíz | `promote`: el slot se libera y la principal pasa a la rama |
| 4 | principal | Migrar (por orden del operador), e2e, review, correcciones, commit y push |
| 5 | principal | PR |
| 6 | raíz | `release`: la principal vuelve a `<base>`, actualizada |

Mientras una tarea está en la principal, los otros slots siguen trabajando.

**Tarea grande.** Una que va a necesitar la base con su esquema nuevo durante días **vive en la principal desde el principio** (o hace `promote` apenas la necesita) y es su dueña mientras dure. En un slot la migración se genera pero no se corre. Qué es "grande" lo decide el operador al arrancar; una pista: si va a probar contra la base migrada más de una vez antes del review.

---

## Comandos

Siempre desde la raíz del workspace.

```bash
node scripts/manage-worktree.js status [--json]
node scripts/manage-worktree.js open --slot <slot> --repo <repo>|--all --branch <rama> [--base <rama-base>] [--link-deps]
node scripts/manage-worktree.js promote --slot <slot> [--repo <repo>]
node scripts/manage-worktree.js release [--repo <repo>]
node scripts/manage-worktree.js clean --slot <slot> [--repo <repo>]
node scripts/manage-worktree.js clean --orphans
node scripts/start-worktree-session.js --slot <slot> [--repo <repo>|--all] [--harness <id>]
```

### `open`

La rama se resuelve así:

1. Existe **local** → `worktree add` de esa rama (si está en la principal o en otro slot, git se niega: la mueven `promote`/`release`, nunca un checkout a mano).
2. Existe **en el remoto** → se crea siguiéndola (`--track`).
3. **No existe** → nace de `origin/<base>` con `--no-track` y se **verifica** que el upstream quedó vacío.

**Por qué `--no-track`.** Con `branch.autoSetupMerge` (valor de fábrica de git), una rama nueva creada desde `origin/<base>` heredaba como upstream la propia base, y el botón "Sync Changes" del editor —que publica contra el upstream, no contra el nombre de la rama— empujaba trabajo en curso a `<base>`. Sin upstream, el primer push falla y pregunta adónde: del lado seguro. El primer `git push -u origin <rama>` la deja bien configurada para siempre.

Un slot de **implementación ocupado se niega** (tiene una rama con trabajo). `--link-deps` enlaza el directorio de dependencias del perfil del repo (ver `shared-dependencies`); los packs pueden declarar el enlace por su cuenta (`worktree.prepare`). En ambos casos solo se enlaza si el lockfile del slot coincide con el de la principal; si no, avisa y no enlaza.

Un slot **review** exige `--branch` (la rama a revisar, existente).

### Reutilizar el slot `review`

`open` sobre un `review` ocupado hace `git checkout --detach` **dentro** del worktree: no borra ni recrea nada, así que no hay borrado que pueda atravesar un enlace. Solo lo hace si no hay nada que perder, y verifica **antes** de mover el HEAD:

| Guarda | Si no se cumple |
|---|---|
| Es un worktree de git y está desprendido | Error: no se toca |
| Sin cambios ni archivos sin trackear | Error: se perderían |
| Su HEAD está contenido en alguna rama (`for-each-ref --contains`) | Error: sus commits quedarían huérfanos |
| Con dependencias enlazadas, el lockfile de la rama nueva coincide con el de la principal | Error: el slot queda donde estaba |

**Por qué.** Antes se exigía `clean` (que requiere orden del operador) para revisar otra rama: cada review de una rama nueva quedaba trabado en un slot ocupado aunque estuviera limpio.

### `promote`

Lleva la rama de un slot de implementación a la principal y libera el slot. **Verifica todo antes de tocar nada**, en todos los repos pedidos (un promote a medias deja un slot sin su rama y una principal sin la suya):

| Condición | Si no se cumple |
|---|---|
| El slot está en una rama (no desprendido) y sin cambios sin commitear | Error: no se toca nada |
| La principal está en `<base>` y sin cambios | Error: hay que liberarla antes con `release` |
| La rama tiene upstream | Aviso, no aborta: pushear antes del PR |

Después: `fetch`, quita el worktree del slot por **el único camino de borrado** (el mismo de `clean`) y cambia la rama de la principal. Avisa, **sin correr nada**, si cambió el lockfile del perfil de dependencias (reinstalar **en la principal**) y si hay migraciones nuevas (`repos[].database.migrationsDir`; correrlas en la principal, por orden del operador).

**Por qué reintenta `symbolic-ref`.** `git switch` puede fallar en Windows al escribir HEAD (otro proceso lo tiene abierto) **después** de haber llevado el índice y los archivos a la rama destino: la principal queda "sucia" con el contenido de otra rama. Si índice y archivos ya son los de la rama destino, falta solo la escritura de HEAD y se reintenta con pausas crecientes; si no coinciden, se frena sin adivinar.

### `release`

Devuelve la principal a `<base>`, actualizada (`merge --ff-only origin/<base>`), cuando su rama ya está en un PR. **Se niega** con cambios sin commitear, commits sin pushear, o un upstream que no es `origin/<rama>` (el que mandaría el "Sync Changes" a la base). Mismos avisos que `promote`.

### `clean`

Cierra un slot. **Sin `--force`**: con cambios sin commitear aborta (pueden ser horas de trabajo que nadie más tiene). Orden de las guardas, que no se reordena:

1. Cuenta los ejecutables del directorio de dependencias de la **principal**, antes de tocar nada.
2. Quita el enlace de dependencias del slot (como enlace: `unlink`/`rmdir`, jamás un borrado recursivo).
3. **Barre los enlaces anidados** de todo el árbol del slot; si alguno sobrevive, aborta.
4. Recién ahí `git worktree remove`. En Windows puede fallar por un bloqueo de otro proceso aunque git ya lo desregistró: se verifica que git lo soltó y se borra el residuo.
5. Compara el conteo (en un `finally`) y, si bajó, avisa y manda a `node scripts/check-deps.js --fix`.

**Por qué el barrido.** Una build dejó un enlace *anidado* (dentro de un directorio de salida del bundler) y `git worktree remove` lo atravesó: la principal quedó sin dependencias mientras el mensaje decía "cerrado". Quitar solo el enlace de la raíz no alcanza. Ver `shared-dependencies`.

**Directorio sin `.git`.** Si el slot de un repo no tiene `.git`, `clean` no lee su estado con `git -C`: sin `.git`, git sube al repo padre y reporta cambios que no son de ese directorio. Vacío → se borra; con archivos → los nombra y se niega.

`clean --orphans` limpia restos: registros de worktrees cuyo directorio ya no existe, directorios vacíos que no son worktrees, manifiestos de slots vacíos. Lo que tiene contenido se nombra, no se borra.

---

## Reglas

1. **Nada de `git worktree add` a mano**, ni siquiera para leer un commit viejo (para eso está el slot `review`). Si el script no cubre el caso, se pregunta al operador.
2. **Nada de `checkout`, `switch`, `reset` ni `clean` en la principal** fuera de `promote`/`release`: son los únicos que verifican antes de mover.
3. **`clean` solo por orden explícita del operador.** Un slot abierto no molesta; uno cerrado por iniciativa propia puede llevarse trabajo. `promote` y `release` no necesitan orden aparte, pero sí que el operador haya pedido ese paso.
4. **Nunca forzar** una limpieza.
5. **Dependencias enlazadas: no se reinstala ni se borra nada dentro de un slot.** Ver `shared-dependencies`: lo que atraviesa un enlace se mide, y un hook corta lo que se midió.
6. **Base de datos y puertos compartidos.** Una migración se **genera** en el slot (con el comando que el proyecto declare en `repos[].database.generateAlternative`, que no compara contra la base compartida) y se **corre en la principal**. Dev server y tests contra la base real van en la principal. Hooks: `pre-bash-slot-migrations`.
7. **Antes de cerrar el trabajo de un slot, correr los gates contra el slot**, no contra la principal (siguiente sección).
8. Para inspeccionar un slot, abrir su carpeta en otra ventana del editor; no editar el mismo archivo que otro agente está modificando.

---

## Los gates y los slots

Los gates se apuntan a un slot con `--from`:

```bash
node scripts/run-gates.js  --repo <repo> --from <dir>/<slot>
node scripts/run-gates.js  --all         --from <dir>/<slot>   # si el slot tiene varios repos
node scripts/run-checks.js --repo <repo> --from <dir>/<slot>
```

Leen el código, el diff y los cambios del slot, pero aplican las reglas y el baseline del repo **lógico** (las huellas llevan `<repo>/…`, no la ruta del slot). Si el slot no tiene el repo pedido, el gate corta con error en vez de caer a la principal. Congelar un baseline desde un slot está bloqueado.

**Por qué está escrito.** Un gate que arma la ruta como `<raíz>/<repo>` audita lo que esté checkouteado en la principal aunque quien revisa esté mirando otro slot, y el resultado sale igual de prolijo ("sin hallazgos"). Es el error más caro de esta familia porque no falla: reporta limpio sobre código que no es el del cambio.

---

## Modos de review

| Modo | Qué revisa | Dónde | Cuándo |
|---|---|---|---|
| **A** | Una tarea propia, **lo commiteado**, para el PR | En la principal, **después de `promote`** | Es el review del PR: hay migración corrida y e2e |
| **S** | El trabajo de un slot de implementación **leído en el sitio, incluyendo lo NO commiteado** | En el propio slot, **solo lectura** (sin checkout; scripts apuntados con `--from`) | Review chico antes de pushear |
| **C** | La rama de **otra persona** | En el slot `review` (desprendido) | Revisar un PR ajeno sin interrumpir lo que haya en la principal |

El modo S no reemplaza al A: en el slot no hay e2e ni migraciones, y el slot `review` no ve lo no commiteado. **Una tarea, un review con revisores:** si va a pasar por la principal con su review completo (A), en el slot alcanza con checks y gates deterministas, sin lanzar revisores. Si igual se hizo uno con revisores en el slot, el de la principal se acota a `git diff <commit revisado>..HEAD` más el merge con `<base>`, y se le dice a cada revisor qué ya se revisó.

Si solo hace falta análisis estático, usar refs (`git diff origin/<base>...origin/<rama>`) y no abrir slot.

---

## Cuándo NO usar slots

- Cambios de una línea o de un archivo, o cuando la principal está libre y no hay nada en paralelo: un slot cuesta tiempo y no aporta.
- Solo análisis estático de una rama (usar refs).
- Una tarea grande que necesita la base con su esquema nuevo durante días: vive en la principal.
- Proyecto de una sola persona sin trabajo paralelo ni base de datos compartida: el modelo existe para proteger recursos únicos entre varios trabajos a la vez.
- `worktrees.enabled` en `false`: el script sale con 2.

---

## Iniciar una sesión dentro de un slot

```bash
node scripts/start-worktree-session.js --slot <slot> [--repo <repo>|--all] [--harness <id>]
```

Arma el cwd (la raíz del slot, o `<slot>/<repo>`), exporta `AI_WORKTREE_SLOT` y `AI_WORKTREE_ROOT`, y lanza el harness. **Por qué existe:** una sesión con el cwd dentro de un slot (que es otro repo git, anidado) perdía las reglas y los agentes de la raíz. El comando de lanzamiento es un dato del harness (`launch`, con `{cwd}`, `{root}`, `{slot}`, `{slotRoot}`); si el harness no lo declara, el script imprime cómo hacerlo a mano y sale con 2. `--dry-run` muestra lo que lanzaría.

Con `AI_WORKTREE_SLOT` definido, las rutas de la principal (`<repo>/…`) se leen dentro del slot como `<dir>/<slot>/<repo>/…`: los comandos de git y del gestor de dependencias se ejecutan contra el directorio del slot, nunca contra la principal.

---

## Ver en qué slot está cada sesión

`scripts/statusline.js` (se registra solo desde el manifest; nadie edita a mano `settings.json`) muestra al pie de cada sesión:

```
● implementation-2 │ <repo>: <rama> │ <repo>: <rama> │ Opus 5.5 · high │ ctx 84k (8%) │ USD 3.10
● principal        │ <repo>: <base> │ <repo>: <base> │ Opus 5.5 · medium │ ctx 119k (12%) │ USD 1.87
● review           │ <repo>: detached@bbe9e75 │ Sonnet 5.5 · high │ ctx 31k (16%) │ USD 0.42
```

Azul = la principal, verde = `implementation`, amarillo = `review`. Las ramas se leen de git en cada refresco. El costo pasa a amarillo desde `statusline.costWarnUsd` y a rojo desde `costAlertUsd` (por defecto 10 y 20): la señal para abrir una sesión nueva.

**Por qué existe:** con varias sesiones abiertas, cada una en un slot distinto o yendo y viniendo, no se sabía en cuál trabajaba cada una.

**Es una inferencia, no un registro.** Una sesión abierta en la raíz tiene la raíz como cwd, así que el cwd no alcanza. Orden de decisión:

1. El cwd está dentro de `<dir>/<slot>/`: gana.
2. Si no, el **último** tool_use de la cola del transcript (últimos 512 KB) que mencione un slot o un repo principal.
3. Si no, el último slot detectado en la sesión (cache en el directorio temporal del sistema).
4. Si no, `principal`.

Límites:

- Una sesión recién abierta muestra `principal` hasta que toca un archivo.
- Un comando que solo **menciona** un slot (`--from <dir>/<slot>`) mueve la línea a ese slot: suele ser correcto, pero es una mención, no una prueba.
- Una sesión que solo conversa muestra el último lugar donde trabajó.
- Si lo que la sesión hizo salió de los últimos 512 KB y no hay cache, vuelve a `principal`.
- Un slot cerrado después de detectado deja de mostrarse.
- Transcript ausente o ilegible: se usa el cache o la principal. Cualquier excepción deja `● slot ?`: nunca rompe.

Antes de commitear, **la verificación de verdad es `git branch --show-current` en el directorio donde se está**, no la status line.

---

## "Sync Changes" publica contra el upstream, no contra el nombre de la rama

El botón del editor sube trabajo a `<base>` sin que nadie se lo pida: no mira cómo se llama la rama, empuja adonde apunte su upstream. Por eso **una rama de slot nace sin upstream** (ver `--no-track`).

Cómo verificarlo en una rama que ya existe, y cómo arreglarla si quedó mal:

```bash
git -C <repo> rev-parse --abbrev-ref @{u}      # si dice origin/<base>, está mal
git -C <repo> branch --unset-upstream          # y queda como debe
```

Corregirlo no toca el trabajo: el upstream es configuración, no contenido. `release` se niega mientras el upstream de la rama no sea `origin/<rama>`.

---

## Cómo lo usan los agentes

Un agente de revisión **no** crea ni limpia slots: los gestiona este procedimiento, y quien orquesta le pasa el directorio del slot como raíz de trabajo. Si un agente propone abrir un worktree por su cuenta o crear un directorio temporal para revisar, se está saliendo del mecanismo: los temporales sueltos quedan, se llenan de dependencias y nadie los borra.
