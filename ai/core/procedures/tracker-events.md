# Eventos del tracker

El contrato de los **cuatro momentos** en los que el agente toca una tarjeta (o, sin tracker, la ficha del tablero de requisitos) y qué escribe en ella. Es la **fuente única**: los procedimientos `create-branch` y `cerrar-ticket` lo invocan, y cualquier otra descripción del tema queda subordinada a este archivo.

Este archivo define **qué** pasa y **cuándo**. El **cómo** de cada tracker (qué herramienta, qué ids) está en la guía de su pack y en la configuración del proyecto.

---

## Por qué existe

Sin esto, el estado que mira el equipo todos los días queda desacoplado del trabajo real: el estado del requisito en el repositorio se puede sincronizar solo, pero la tarjeta no, y termina diciendo una cosa mientras la rama dice otra. Una tarjeta que dice una cosa y una rama que dice otra hace más daño que una tarjeta sin mover.

**Por qué funciona sin que nadie se acuerde:** el equipo crea las ramas y los PR a través del agente, con esos procedimientos. Los movimientos están escritos adentro de ellos, así que ocurren cada vez que el procedimiento corre. Si alguna vez una rama o un PR se hacen a mano, la tarjeta se mueve a mano: cada uno sabe en qué está trabajando.

---

## Configuración: de dónde sale cada dato

| Dato | Dónde |
|---|---|
| Qué tracker usa el proyecto | `tracker.kind` en `ai-workspace.json`: `none`, `jira` o `github` |
| Cómo se llama cada estado y cómo se llega a él | `tracker.<kind>` en `ai-workspace.json`. **Los ids de transición van en la configuración del proyecto, por tipo de tarjeta; nunca se suponen** |
| Identificador de la tarjeta | El prefijo es `project.ticketPrefix`; el número, del pedido o del nombre de la rama |
| Tablero de requisitos (para `none`) | `requirements` en `ai-workspace.json`. Ver la regla `requisitos` |

Si `tracker.kind` es `jira` o `github` pero falta lo que su guía pide (ids de transición, nombres de estado), el agente **no improvisa**: dice qué falta, sigue con el trabajo y deja el movimiento sin hacer, anotado en el reporte. La guía para configurarlo es `tracker-jira-adaptar` o `tracker-github-adaptar`.

---

## Los cuatro eventos

| # | Evento | La tarjeta pasa a | Quién lo hace |
|---|---|---|---|
| 1 | **Explorar** el requisito | **No se mueve.** Se mira el responsable | El agente: solo mira, ofrece |
| 2 | **Rama creada** | **En curso** | El agente, solo |
| 3 | **PR creado** | **En revisión / QA**, con un comentario con el PR | El agente, solo |
| 4 | **Historia o épica completa** (todas sus tareas están en revisión) | La historia o épica también pasa a **En revisión / QA** | El agente, solo |

Una revisión de código (`pr-review`) **no es un evento**: no mueve nada. Puede correr varias veces, sobre la rama de un compañero o sobre un PR ajeno; si moviera tarjetas, movería las de otra persona o las haría ir y venir.

"Solo" quiere decir **sin que el humano lo pida**. Mover una tarjeta no destruye nada y es reversible desde la interfaz del tracker; lo que sí hace daño es que diga algo distinto de lo que dice la rama.

### 1 · Explorar: se mira el responsable, no el estado

Al leer la tarjeta, además del resumen y los criterios, mirar el **responsable** y compararlo con la cuenta de la sesión.

| Caso | Qué hace el agente |
|---|---|
| Asignada a la persona de la sesión | Nada. Sigue |
| Sin asignar, o asignada a otra persona | **Lo dice, con el nombre de quien la tiene, y ofrece autoasignarla.** Espera la respuesta |

El agente **no reasigna por su cuenta**, ni siquiera cuando está sin asignar. Una tarjeta con responsable es la señal de que alguien ya la está haciendo: tomarla en silencio produce dos personas sobre el mismo trabajo, y desde afuera parece que la primera abandonó.

No mueve el estado en este paso. Explorar no es empezar: existe justamente para decidir si la tarea se hace, se parte o se descarta.

### 2 · Rama creada -> En curso

Se mueve **después** de crear la rama y de verificar su upstream, no antes. La rama puede ser todavía solo local: lo que importa es que el trabajo arrancó de verdad, no la promesa de arrancarlo. Una tarjeta "En curso" sin rama muestra trabajo que no existe.

Si son varias tarjetas en una rama (`feat/{PREFIJO}-XXX.{PREFIJO}-YYY-…`), se mueven **todas**.

### 3 · PR creado -> En revisión / QA, más un comentario

Se mueve **con el PR creado**: cuando el host devolvió el id y la URL. No antes (un PR que falló al crearse no es trabajo entregado) y no se espera al merge.

En el mismo momento se deja **un comentario**, para que quien revise no tenga que reconstruir el contexto desde el PR:

```
{PREFIJO}-XXX con PR abierto hacia {BASE}.

PR: <url>

Qué verificar:
- <lo que la sección de verificación de la tarjeta pide, en una línea cada cosa>

Datos de ejemplo que siguen en pantalla:
- <los que la tarjeta declaró, o "ninguno">

Pendiente:
- <lo que quedó fuera, con su motivo, o "nada">
```

**Tarea con dos PR** (un repositorio proveedor y otro consumidor): la tarjeta se mueve y se comenta con el primero. Con el segundo, si ya está en revisión, no se mueve de nuevo: se agrega un comentario corto con la URL. Quien revisa tiene que saber que son dos.

**Si el PR lleva varias tarjetas**, cada una se mueve y recibe su comentario.

**Si la tarjeta sigue "por hacer" al crear el PR** (el evento 2 no se hizo), se pasa primero por En curso y después a En revisión, por el camino que la configuración declara. Pasó: una tarea quedó "por hacer" con el PR ya mergeado porque nadie la movió, y el tablero decía que no se había empezado.

### 4 · La historia sigue a sus tareas

Al mover una tarea a En revisión, buscar su historia o épica (el vínculo nativo del tracker, o el "Historia: XXX" de la descripción si es la convención del proyecto) y mirar el estado de **todas** sus tareas. Si están todas en revisión o más adelante, la historia pasa a En revisión y recibe un comentario corto con sus tareas y sus PR.

- Si alguna sigue pendiente, la historia **no se mueve**, y el reporte lo dice ("la historia queda En curso: falta la tarea X").
- Si la historia no tenía el vínculo con sus tareas, se crea en ese momento.

**Los ids de transición dependen del tipo de tarjeta.** Una historia y una tarea suelen tener flujos distintos, y el mismo id de transición lleva a estados distintos. Pasó: una historia quedó en un estado equivocado porque se le aplicó el id que en las tareas significa otra cosa. Por eso los ids van en la configuración **por tipo**, y antes de mover se mira el tipo y el estado actual de la tarjeta. Si aparece un tipo que la configuración no conoce, se listan sus transiciones la primera vez, se **pregunta**, y la persona lo agrega a la configuración.

---

## Reglas que valen para los cuatro eventos

1. **Nunca cierra una tarjeta.** El cierre lo decide quien la recibe en el evento 3.
2. **Nunca reasigna ni toma para sí** una tarjeta.
3. **Nunca la retrocede.** Si ya está en el estado destino o más adelante, **no se toca**: se avisa en el chat y se sigue. Si el listado de transiciones ofrece "volver a por hacer" o "reabrir", eso no es un camino hacia adelante. Si quien revisa encuentra algo, el estado lo corrige una persona con el contexto de por qué.
4. **Nunca comenta ni mueve una tarjeta ajena** a la tarea. Incluido señalar un problema de otra: eso va al chat, y la persona decide.
5. **Nunca usa estados fuera del recorrido** (espera, bloqueado, integración, desplegado, etc.) salvo pedido explícito: existen y son legítimos, pero dependen de un contexto que el agente no tiene.
6. **No registra horas ni estimaciones** en la tarjeta.
7. **El comentario no lleva atribución de IA.** Ni "Generated with…", ni la URL de la sesión, ni una mención a que lo escribió un agente. La tarjeta es el registro del equipo y de sus clientes, no de la herramienta con la que se trabajó. Tampoco lleva tokens, claves ni credenciales (`datos-sensibles`).
8. **Si el tracker falla, el trabajo no se bloquea.** Se reintenta una vez; si no sale, se sigue y el reporte dice que la tarjeta quedó sin mover. Lo que nunca se hace es decir que se movió sin haberlo verificado en la respuesta del tracker. Los trackers fallan seguido (tiempos de espera de minutos, sesiones vencidas): un procedimiento que se cuelga por eso se termina saltando.
9. **Una orden del operador en contra gana.** Si para esa tarjeta dijo que no se la mueva ni se la comente, no se toca: ni al crear la rama ni al crear el PR, aunque el procedimiento lo indique. El reporte dice que el paso quedó sin hacer por esa orden.

---

## Qué hace cada `tracker.kind`

| `tracker.kind` | Eventos 1-4 |
|---|---|
| `none` | Se mueve la **ficha del tablero de requisitos** si el proyecto tiene `requirements`; si no, **no se hace nada** (y el reporte no dice que se movió algo). Detalle abajo |
| `jira` | Con la herramienta y los ids que declara `tracker.jira`. Guía: `tracker-jira-adaptar` (pack `tracker-jira`) |
| `github` | Con `gh` y lo que declara `tracker.github`. Guía: `tracker-github-adaptar` (pack `tracker-github`) |

### Sin tracker: la ficha del tablero

El tablero de requisitos cumple el papel de la tarjeta (regla `requisitos`). Los eventos se traducen así, y **no retroceden nunca**:

| Evento | La ficha |
|---|---|
| 1 · Explorar | Si no hay ficha, se crea en `analisis`. No se mueve ninguna |
| 2 · Rama creada | Si la ficha está `validado`, no se toca: pasa a `implementacion` cuando el change se propone y el sync lo deriva. En `pendiente` o `analisis` tampoco: empezar es decidir por la persona |
| 3 · PR creado | `testing`, si todavía no lo está ni está más adelante |
| 4 · Historia completa | No aplica: el tablero no tiene jerarquía |

Con tablero, el estado `cerrado` no lo mueve este contrato: lo deriva `check-requirements --sync-estados` **después del merge** (`cerrar-ticket`).

---

## Cómo se invoca desde los otros procedimientos

- `create-branch`: **al final**, con la rama creada y el upstream verificado, "evento 2".
- `cerrar-ticket`: con el PR creado, "evento 3" y, si corresponde, "evento 4".
- `pr-review`, `git-sync-branch`, `git-commit-workflow`: **nunca** mueven nada.

---

## Lo que el agente no hace

| Nunca | Por qué |
|---|---|
| Cerrar una tarjeta | Lo decide quien la recibe |
| Reasignarla o tomarla | Ver el evento 1 |
| Mover una tarjeta durante una revisión | Ver "Una revisión de código no es un evento" |
| Suponer el id de una transición | Cambia por tipo de tarjeta y por flujo; va en la configuración |
| Decir "movida" sin leer la respuesta del tracker | Un movimiento no verificado es una afirmación inventada |
