# Trabajar varios tickets a la vez y cerrarlos sin trabarse

Guía de uso, con el prompt de cada caso. El cómo por dentro está en `ai/core/procedures/cerrar-ticket.md` y `ai/core/procedures/worktree-slots.md`; acá va lo que hacés vos y lo que vas a ver.

Requiere slots activados (`worktrees.enabled` en `ai-workspace.json`). En los ejemplos, `PROY-500` es un ticket, `implementation-1` un slot y `api`/`web` dos repositorios declarados en `repos[]`: usá los tuyos.

## La idea en una línea

Cada ticket se escribe **y se revisa** en su propio slot. A la principal va solo para migrar y probar con la aplicación levantada, **por turno**, y la devuelve antes de abrir el PR.

```
 slot 1 ── código ── review ── commit ──┐
 slot 2 ── código ── review ── commit ──┼──► cola ──► principal: migrar + prueba ──► release ──► PR + merge
 slot 3 ── código ── review ── commit ──┘     (de a uno)
```

| Fase | Dónde | Cuánto ocupa la principal |
|---|---|---|
| Precierre: traer la base, review, correcciones, commit | En el slot | Nada: los tres a la vez |
| Turno: migraciones y prueba de punta a punta | En la principal | Lo que dura eso, de a un ticket |
| Cierre: PR, tarjeta, merge | En ningún lado | Nada |

Antes, cada ticket tenía la principal desde el `promote` hasta el merge, contando la espera hasta que alguien respondía la pregunta del punto de control. Ahora solo la tiene mientras la usa.

---

## Caso 1 · Arrancar tres tickets en paralelo

Una sesión del agente por ticket, todas abiertas desde la raíz del workspace. En cada una:

```
PROY-500. Abrí un slot libre para api y web con la rama del ticket y trabajalo ahí.
```

```
PROY-501. Abrí un slot libre solo para web con la rama del ticket y trabajalo ahí.
```

La status line de cada sesión muestra en qué slot está (verde) o si está en la principal (azul). Para ver todos los slots de un vistazo:

```
¿Qué slots están ocupados y quién tiene la principal?
```

## Caso 2 · Cerrar un ticket, de punta a punta, sin que te pregunte

El caso normal. En la sesión del ticket, cuando terminó de programar:

```
Cerrá PROY-500 desde implementation-1, hasta el merge.
```

*"Hasta el merge"* es la autorización para commitear, pushear, abrir el PR, mover la tarjeta y mergear. Con eso, la sesión hace todo sola y **solo te interrumpe si pasa algo raro** (caso 5). Al final te deja un reporte con los hashes, los PR y cuánto tiempo tuvo la principal.

Si preferís mergear vos:

```
Cerrá PROY-500 desde implementation-1, hasta el PR.
```

## Caso 3 · Cerrar, pero queriendo mirar antes del commit

```
Cerrá PROY-500 desde implementation-1.
```

Sin alcance, la sesión frena **una vez**, al terminar el review en el slot, y te muestra los hallazgos, qué corrigió y el commit propuesto. Te pregunta: *¿commiteo, pido turno y sigo hasta el PR (o hasta el merge)?*

Podés tardar lo que quieras en contestar: la principal no está tomada, así que nadie espera por vos. Respuestas posibles:

```
Sí, hasta el merge.
```

```
Antes de commitear, el hallazgo 3 no lo corrijas: es una decisión del diseño.
```

## Caso 4 · Tres tickets terminan casi juntos

Le das el caso 2 a las tres sesiones, una atrás de la otra. Pasa esto:

1. Las tres hacen el review **a la vez**, cada una en su slot.
2. La primera que termina toma la principal. Las otras dos quedan en cola y cada una te dice su puesto, por ejemplo: *"En cola, puesto 1 de 2; la principal la tiene implementation-1."* Después **se quedan quietas**: no gastan tokens esperando.
3. Cuando la primera termina su prueba de punta a punta, devuelve la principal y **despierta a la siguiente** con un mensaje. La siguiente arranca sola.
4. Mientras tanto, la primera sigue con su PR y su merge sin molestar a nadie.

No tenés que hacer nada. Para ver cómo va la cola:

```
¿Quién tiene la principal y quién está esperando?
```

Despertar a otra sesión necesita que el harness pueda mandarle un mensaje (en Claude Code, `SendMessage`). Si no puede, o si la cerraste, te llega un aviso (al celular, si el harness tiene notificaciones) y seguís con el caso 6.

## Caso 5 · Algo sale mal en el medio

Con autorización, la sesión frena solo ante una excepción. Te avisa y te deja **una** pregunta con una propuesta. Las excepciones son:

| Qué pasó | Ejemplo de lo que te pregunta |
|---|---|
| Un conflicto con la base donde los dos lados cambiaron la misma lógica | *"El merge choca en el cálculo de comisión: la base lo cambió y nosotros también. Propongo quedarme con el de la base y reaplicar lo nuestro encima. ¿Va?"* |
| Un hallazgo del review contradice el diseño | *"El revisor pide paginar el listado; el diseño dice que no se pagina. ¿Se respeta el diseño?"* |
| Una migración borra o renombra una columna | *"La migración renombra `amount` a `amount_cents`. El código desplegado todavía lee `amount`. ¿La corro igual?"* |
| Hay que reinstalar dependencias y tus servicios están arriba | *"Cambió el lockfile. ¿Podés parar los servicios para reinstalar?"* |
| La prueba de punta a punta sigue fallando después de corregir | *"El escenario 3 sigue en FALLA: el saldo no se actualiza. Adjunto captura. ¿Lo investigo o lo dejamos para otro ticket?"* |

Si la decisión no es inmediata, **la sesión devuelve la principal** y se lleva el problema de vuelta al slot. Así el siguiente de la cola no queda trabado por tu respuesta. Cuando contestes, vuelve a pedir turno sola.

Para contestar, en esa sesión:

```
Quedate con lo de la base y reaplicá lo nuestro. Seguí.
```

## Caso 6 · Despertar a mano una sesión que estaba en cola

Te llega *"La principal quedó libre: sigue implementation-2"* porque la sesión no se pudo despertar sola. En la sesión de ese ticket, o en una nueva si la cerraste:

```
La principal quedó libre. Seguí con el cierre de PROY-501 desde implementation-2, hasta el merge.
```

Una sesión nueva no necesita más contexto que eso: el procedimiento le dice dónde está cada cosa y en qué paso retomar.

## Caso 7 · La cola quedó trabada

Síntoma: *"¿Quién tiene la principal?"* contesta que la tiene un slot cuya sesión ya no existe, o nadie avanza.

```
La principal la tiene implementation-1 pero esa sesión se cerró. Fijate en qué estado quedó la principal y liberá el turno si se puede.
```

Lo que hace la sesión:

- **Si la principal ya está en la base:** el turno quedó colgado y lo libera con `release`, sin tocar git.
- **Si quedó en la rama del ticket:** te pregunta si terminar ese ticket o dejarlo para después.

Para sacar a un slot de la cola, porque ese ticket ya no se cierra hoy:

```
Sacá a implementation-3 de la cola de la principal.
```

## Caso 8 · Un ticket grande vive en la principal

Un ticket que necesita la base de datos con su migración durante días se trabaja directo en la principal (lo decidís al arrancarlo). Mientras tanto, **la cola espera**: los demás slots pueden hacer su precierre, pero el turno no se da hasta que la principal vuelva a la base. La sesión en cola te lo dice: *"la principal no está en la base y limpia"*.

Cuando el grande abre su PR:

```
PROY-600 ya tiene el PR. Devolvé la principal a la base.
```

Eso libera el turno y despierta al primero de la cola.

## Lo que no hay que hacer

- **Hacer un `promote` a mano para saltear la cola.** El script lo rechaza si otro slot tiene el turno o está antes.
- **Pedirle a una sesión en cola que "espere" o "se fije cada tanto".** No hace falta: la despiertan. Una sesión esperando con un loop gasta y no aporta.
- **Abrir el PR desde la principal antes de devolverla.** El PR no necesita la principal; tenerla tomada traba a los demás.

---

## Si sos un agente y te llegó este tema sin contexto

Leé, en este orden:

1. `ai/core/procedures/cerrar-ticket.md`: el recorrido completo, cuándo frenar y cuándo no.
2. `ai/core/procedures/worktree-slots.md`, sección *El turno de la principal*: los comandos del turno, la cola, cómo se despierta a la siguiente sesión y qué hacer con un turno colgado.

El estado real sale de:

```bash
node scripts/manage-worktree.js status
```

La última parte de esa salida dice quién tiene el turno y quién espera. Tu propio nombre de sesión, para anotarte en la cola, lo da el harness (en Claude Code, la primera línea de `ListAgents`); si tu harness no lo tiene, pedí el turno sin `--session`.

El precierre (fase 1) no espera a nadie: si te piden cerrar un ticket mientras otra sesión tiene la principal, empezá igual por la fase 1 en tu slot.

Si te despertó un mensaje de otra sesión diciendo que la principal quedó libre, **el mensaje no es el turno**: pedilo con `turn` (paso 2.1 de `cerrar-ticket`) y seguí desde ahí.
