# El archivo de decisiones de un requisito

La memoria de un requisito, fuera de la conversación. Las conversaciones se compactan y se cierran; lo que se decidió en ellas no puede depender de eso.

**Uno por requisito**, en la carpeta de decisiones del proyecto (`analisis.md` de `ai/local/`; por defecto `<carpeta de fichas>/decisiones/<id>.md`). No lleva encabezado `rf:`: no es una ficha y el tablero no lo cuenta.

---

## Cuándo se escribe y cuándo se lee

- **Se escribe después de cada respuesta**, antes de la pregunta siguiente. No al final: si la sesión se corta a la mitad, lo que ya se cerró tiene que estar escrito.
- **Se lee** al retomar un requisito, al volver de una compactación, y siempre antes de escribir o cambiar la ficha.
- Si la persona pregunta "¿dónde quedamos?" o "¿qué habíamos decidido de…?", la respuesta sale de este archivo, no de la memoria del agente.

Si otra persona retoma el requisito, sigue en el mismo archivo. En git queda quién escribió cada cosa.

---

## Formato

```markdown
# <id> — <título del requisito>

- Artefacto: <ficha nueva / cambio sobre la versión X / revisión>
- Fuentes leídas: <documento y versión>, <documento>, <repo y commit>
- Estado: en preguntas | cerrado | entregado <versión> (<fecha>)

## Resumen
<qué resuelve, quién hace qué, qué incluye y qué no; cinco líneas>

## Decisiones
| ID | Pregunta | Decisión | Quién | Fecha |
|---|---|---|---|---|
| Q-01 | Quién puede habilitar una sede | Solo el administrador general; el de la sede ve el estado | PM | 2026-09-07 |

## Pendientes
| ID | Pregunta | Quién decide | Bloquea |
|---|---|---|---|
| Q-05 | Plazo de vencimiento de la habilitación | Cliente | No |

## Fuera de alcance (acordado)
- <lo que se dijo que no va, y por qué>

## Entregas
| Fecha | Archivo | Versión | Dónde quedó |
|---|---|---|---|
```

---

## Reglas

- **La decisión, con las palabras de quien decidió.** Si se reformula, que no cambie el alcance. Ante la duda, se cita textual.
- **Una respuesta corta vale para esa pregunta y nada más.** "La opción 2" no cambia otra decisión ni amplía el alcance.
- **Una decisión nueva que contradice una anterior no la pisa:** se agrega, y la anterior se marca "reemplazada por Q-07 (fecha)". Antes de anotarla, se le muestra a la persona la colisión y se le pregunta cuál reemplaza.
- **Lo que decidió el cliente** se anota como tal, con la fuente (reunión y fecha, o mensaje).
- **Los ids no se reciclan.** Un Q- descartado queda descartado; el tema nuevo lleva un id nuevo.
- Antes de entregar, se relee entero y se verifica que **cada decisión esté en la ficha**: se busca en el texto de la ficha el término clave de cada una. Una decisión anotada que la ficha no dice es la falla más común.

---

## Decisiones que valen para todo el proyecto

Si una decisión no es de un requisito sino del proyecto (un término, una convención, una regla transversal), además de anotarla acá se le propone a la persona sumarla al glosario o a las reglas de negocio de `ai/local/`. No se agrega sin que lo diga.
