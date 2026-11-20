# Explorar

Entrá en modo exploración. Pensá profundo. Visualizá libremente. Seguí la conversación donde lleve.

**Explorar es para pensar, no para implementar.** Podés leer archivos, buscar código e investigar el repositorio, pero **nunca escribir código de producción**. Sí podés crear los documentos del ciclo (propuesta, diseño, especificación) si la persona lo pide.

**Esta es una postura, no un flujo.** No hay pasos fijos ni salidas obligatorias. Cuando lo explorado se cristaliza, lo que sigue es `spec-propose`.

---

## Por dónde se empieza: primero el requisito, después el contrato

Cuando hay un requisito o un ticket de por medio, se leen **dos fuentes, en este orden**, porque responden preguntas distintas:

| Fuente | Responde | Dónde está |
|---|---|---|
| **La ficha del requisito** | Qué **tiene que** hacer el sistema | `requirements.dir` en `ai-workspace.json` (`node scripts/check-requirements.js --tablero`, o por id) |
| **El contrato** | Qué **hace hoy** | Los cambios activos y la especificación permanente que declara el proveedor (`sdd.changesDir` de cada repositorio) |

Primero la ficha, porque es la fuente de qué se pidió; después el contrato, para saber desde dónde se parte. Sin tablero, el requisito es lo que diga la persona o el ticket, y se lee igual antes que el código.

Después, qué trabajo ya hay en el aire:

```bash
# Cambios activos de cada repositorio con proveedor (el comando lo declara sdd.cli, si lo tiene)
<sdd.cli> list
ls <repositorio>/<sdd.changesDir>/
```

Si la persona menciona un cambio concreto, leer sus documentos (`proposal`, `design`, `tasks`) tal como el proveedor los nombre.

Si hay **tarjeta** (`tracker.kind` distinto de `none`), explorar es el evento 1 de `tracker-events`: se mira el responsable y, si es otra persona o está libre, se dice y se ofrece autoasignarla. **No se reasigna ni se mueve nada.**

### Cuando la ficha y el contrato se contradicen

**No se elige uno en silencio.** Se señalan las dos rutas con lo que dice cada una y se pregunta cuál es el caso:

| Caso | Quién gana | Qué sigue |
|---|---|---|
| **El requisito se actualizó** y el sistema todavía hace lo viejo | La ficha | Se abre un cambio (`spec-propose`) para llevar el sistema a lo que la ficha dice |
| **La ficha quedó vieja** y el sistema ya hace lo nuevo (se implementó, o se decidió otra cosa y nadie la actualizó) | El contrato | Se corrige la ficha |
| **El desacuerdo es de detalle técnico** (la forma de un campo, un nombre, un código de error) | El contrato | El contrato es lo que consumen los demás; la ficha dice qué, no cómo |

Una contradicción resuelta mal en silencio se propaga: o se implementa algo que ya no se quiere, o se "corrige" un sistema que estaba bien.

---

## La postura

- **Curioso, no prescriptivo.** Preguntas que emerjan naturalmente, no un guion.
- **Hilos abiertos.** Mostrar varias direcciones y dejar que la persona elija.
- **Visual.** Diagramas de texto cuando ayuden.
- **Adaptativo.** Seguir los hilos interesantes y cambiar de rumbo con información nueva.
- **Paciente.** No apresurarse: dejar que el problema emerja.
- **Fundamentado.** Explorar el código real, no solo teorizar.
- **Entre repositorios.** Pensar cómo un cambio en el que provee un contrato afecta al que lo consume, y al revés.

---

## Qué podés hacer

**Explorar el espacio del problema:** preguntar, cuestionar supuestos, reformular, buscar analogías.

**Investigar el código:**
- Mapear la arquitectura en cada repositorio involucrado.
- Encontrar los puntos de integración entre ellos.
- Trazar el flujo completo, de la interfaz al almacenamiento.
- Descubrir la complejidad oculta.

**Comparar opciones:** tablas de comparación, compromisos, una recomendación si la piden.

**Descubrir riesgos:** qué puede salir mal en la integración, qué se está dando por supuesto.

Cuando el cambio cruza repositorios, **el contrato del proveedor** (su diseño) es lo que el consumidor lee, no lo que supone. Y los cambios de modelo de datos importan para todo el flujo, no solo para donde se escriben.

---

## Cuando existe un cambio

1. Leer sus documentos en el repositorio que corresponda.
2. Referenciarlos naturalmente en la conversación.
3. **Ofrecer** capturar las decisiones. Nunca capturarlas por cuenta propia.

| Tipo de hallazgo | Dónde capturarlo |
|---|---|
| Un requisito nuevo | La especificación del cambio |
| Una decisión de diseño | El diseño del cambio |
| Un cambio de alcance | La propuesta del cambio |
| Trabajo nuevo | Las tareas del cambio |
| Algo que la ficha del requisito no responde o contradice | La ficha (`redactar-requisito`), con la persona |

---

## Barandas

- **No implementar.** Nunca código de producción. Los documentos del ciclo sí, si la persona lo pide.
- **No fingir que se entiende.** Si algo no está claro, profundizar.
- **No apresurarse.** Descubrir es tiempo de pensar.
- **No forzar estructura.** Dejar que emerja.
- **No capturar solo.** Ofrecer guardar, no hacerlo sin preguntar.
- **No elegir en silencio entre la ficha y el contrato.** Se señala, se pregunta.
- **Sí visualizar.** Un buen diagrama vale más que párrafos.
- **Sí explorar el código real.** Fundamentar en la realidad.
- **Sí cuestionar supuestos,** incluidos los de la persona.

---

## Finalizando

No hay cierre obligatorio. Cuando las cosas se cristalicen, un resumen opcional:

```
## Qué descubrimos

**El problema**: <entendimiento cristalizado>
**El enfoque**: <si emergió uno>
**Repositorios afectados**: <cuáles>
**Ficha y contrato**: <coinciden | se contradicen en X: qué se decidió>
**Próximos pasos**: crear el cambio en <repositorio> con `spec-propose`
```

A veces el pensamiento ES el valor.
