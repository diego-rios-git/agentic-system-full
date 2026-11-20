# Disciplina de alcance

Reglas anti-inflación que aplican **antes** de generar una propuesta y **antes** de implementarla. Fuente única de los umbrales.

---

## El problema que resuelve

Una propuesta generada por IA tiende a crecer. Cada "y ya que estamos" agrega una tarea, y las tareas agregadas no se estiman, no se revisan y no se prueban con el mismo cuidado que las pedidas. El resultado es un cambio que toca veinte archivos donde el pedido eran tres, con un riesgo que nadie evaluó.

El síntoma no es el tamaño: es que **nadie decidió** ese tamaño.

---

## Umbrales

Contados sobre las tareas de la propuesta:

| Tareas | Semáforo | Qué hacer |
|---|---|---|
| ≤ 15 | Verde | Seguir |
| 16 – 25 | Amarillo | Justificar por escrito por qué no se puede partir |
| > 25 | Rojo | **Partir**, salvo decisión explícita de la persona |

En rojo no se implementa hasta partir o hasta que alguien decida seguir igual, dejándolo dicho.

---

## Qué cuenta como fuera de alcance

Cualquier cosa que el pedido no nombró y que no sea **necesaria** para que lo pedido funcione:

- Refactorizar código vecino que "ya que estamos, conviene".
- Agregar cobertura de tests a código preexistente que el cambio no toca.
- Renombrar por consistencia.
- Migrar un patrón viejo encontrado de paso.
- Corregir un defecto no relacionado descubierto en el camino.

Todas son mejoras legítimas. Ninguna pertenece a este cambio. **Se anotan como trabajo aparte**, no se hacen acá.

La excepción es real: si lo pedido no puede funcionar sin ese trabajo previo, entonces es parte del cambio, y hay que decirlo explícitamente en la propuesta — no colarlo entre las tareas.

---

## Cómo partir

Buscar el **límite natural**, no el punto medio:

1. **Por capa** — el contrato primero, el consumidor después. El corte más limpio cuando el cambio cruza repositorios.
2. **Por caso de uso** — el camino principal primero, los casos límite después.
3. **Por dependencia** — lo que otras partes necesitan primero.
4. **Por riesgo** — aislar lo que toca datos, permisos o dinero en un cambio propio, más chico y más revisado.

Un corte que deja dos mitades que solo funcionan juntas no es un corte: es la misma tarea con dos nombres y el doble de ceremonia.

---

## Cuándo aplicar esto

| Momento | Qué se verifica |
|---|---|
| Al generar la propuesta | Contar las tareas; si supera el umbral, partir antes de escribirla |
| Antes de implementar | Que las tareas sigan siendo las aprobadas |
| Durante la implementación | Que no aparezcan tareas nuevas sin que alguien las apruebe |

**Si durante la implementación aparece trabajo necesario que no estaba previsto**: parar, decirlo, y esperar. Agregarlo en silencio es la forma más común de que un cambio de tres días se convierta en uno de dos semanas sin que nadie lo haya decidido.

---

## Reglas de apoyo contra la inflación

Cuatro costumbres que producen una propuesta inflada sin que ninguna tarea individual lo parezca:

| Regla | Qué dice | Prueba mental |
|---|---|---|
| **Un documento de especificación solo si hay delta real** | Se crea solo si el cambio introduce o modifica un comportamiento que otro (un consumidor, otro servicio) puede observar. Una decisión de diseño va en el diseño; no implica una especificación aparte | Si borrás el documento propuesto, ¿cambia el contrato con alguien? Si no, no es una especificación |
| **"Modificado" requiere un cambio verificable** | "Conserva X", "sigue aplicando Y", "no muta Z" no son modificaciones: son notas del diseño | ¿Cambió el comportamiento actual? Si no, no se marca |
| **Qué queda afuera, por escrito** | La propuesta lleva una sección explícita de lo que **no** toca: capacidades vecinas, trabajo futuro, lo que el requisito deja afuera. Lo que no se listó no se toca en este cambio | Un agente no puede escudarse en la ambigüedad |
| **Cada tarea declara los archivos que va a tocar** | Una lista corta de rutas por tarea. Es la base del detector de crecimiento durante la implementación | Si tocás un archivo que ninguna tarea declaró, no seguís: ver abajo |

**Si durante la implementación se toca un archivo que ninguna tarea declaró, se pausa y se reporta.** La persona elige: (a) es parte del cambio, y se agrega a las tareas; (b) es crecimiento de alcance, y se revierte y se propone un cambio aparte; (c) es trabajo paralelo ya planificado, y se anota. **El agente no elige solo.** Al terminar, si los archivos reales superan a los declarados, la diferencia se registra o se abre un seguimiento: no se deja en silencio.

---

## Qué NO es esto

No es una excusa para entregar a medias. Una tarea del alcance que quedó sin hacer es trabajo incompleto, no disciplina de alcance.

La distinción: **disciplina de alcance es no agregar lo que nadie pidió. No es sacar lo que sí pidieron.**
