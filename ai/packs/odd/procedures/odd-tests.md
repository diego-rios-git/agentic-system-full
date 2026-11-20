# ODD: tests primero

Una sola política de tests para todo cambio de comportamiento, chico o grande. Lo que la hace distinta de "escribir tests" es lo que **no** se escribe: un test por regla pedida, uno por comportamiento existente tocado, y ninguno más.

---

## Cuándo aplica

Cuando existen las dos cosas:

- un **test relevante, ejecutable y determinista** para lo que cambia, y
- un **resultado esperado claro**.

Que el repositorio tenga tests o un framework no alcanza para decir que aplica.

Si no aplica —documentación sin efecto ejecutable, ningún runner, o ningún rojo con sentido— se dice cuál es la excepción y se corre el chequeo funcional o estructural que corresponda. **Nunca se inventa un runner ni una evidencia de rojo o verde.**

El runner es el de `repos[].testCommand`. Si no está declarado, se reporta como **no verificado**, no se supone.

---

## Rojo, verde, refactor

1. **Rojo observado** antes de implementar. Un test que nunca se vio fallar no prueba nada: puede estar verificando algo trivialmente cierto, o no estar corriendo.
2. **Verde**: la implementación mínima que lo hace pasar.
3. **Refactor** con los tests en verde.

Para que falle por comportamiento y no porque el módulo no existe: crear la pieza con su firma y el cuerpo lanzando "no implementado".

Si la persona reporta una falla, el primer rojo es **reproducirla**. Antes de eso no se decide que "ya anda".

---

## Qué tests, exactamente

### Uno en rojo por regla pedida

Cada `S#` del documento (o cada regla del pedido, si es chico) tiene su test.

- **El título del test es el título corto de su spec.** El gate de cobertura de escenarios los empareja por las palabras: un test que dice lo mismo con otras palabras queda como "escenario sin test".
- **Afirma todos los efectos observables** de la regla: el código de salida o el estado, la salida y el mensaje de error **exactos**, y que una entrada rechazada deja **sin cambios** los datos guardados y los contadores.
- **Cubre los casos que la propia regla nombra**: sus ejemplos, sus bordes y sus errores. No los que se le ocurren a quien escribe.
- **Por la interfaz pública**, nunca leyendo el almacenamiento interno.

### Uno por comportamiento existente tocado

Por cada comando, opción o endpoint que ya existía y que **comparte el código que cambiaste** (opciones, parsers, helpers, validación), un test que demuestra que su comportamiento anterior sigue igual.

### Ninguno más

No se agregan casos que nadie pidió. Más tests no es más cobertura de lo pedido: es más código que mantener, y esconde cuál de todos prueba la regla.

---

## El chequeo diferencial

Antes de terminar, por cada comportamiento existente que comparte el código cambiado:

1. Correrlo con la entrada nueva o cambiada (por ejemplo, la opción nueva pasada a un comando hermano) contra **el código anterior**: una copia del commit base en un directorio temporal (`mktemp -d`).
2. Correrlo igual contra **el cambio**.
3. Comparar salida, errores y código de salida.

Cualquier diferencia que nadie pidió es una regresión: se arregla y se fija con un test.

La copia del commit base **no se commitea como test**. Los tests commiteados nunca leen el historial de git ni un commit fijo.

---

## El estado compartido pasa por su función

Un registro, una entrada de lista, un archivo o una configuración que otros comandos también crean o leen se toca **con la función que ya existe para eso**, respetando sus invariantes (orden, unicidad, validación, normalización). Reimplementar ese paso con otra forma es la regresión que el chequeo diferencial encuentra tarde.

Si se cambia un comando, una opción o un mensaje, se actualizan su ayuda y su documentación.

---

## El borrador, fuera del árbol de trabajo

Directorios temporales, `HOME`, `TMPDIR` y cachés de herramientas de los tests viven en un `mktemp -d` **fuera** del repositorio.

Si tiene que vivir adentro, en una ruta que git ignora, y se borra antes de terminar: ningún caché ni ruta de borrador queda en el cambio.

Un subagente **no borra** su borrador: reporta las rutas exactas, y el padre las borra al terminar.

---

## Lo que se anota

En el documento de la funcionalidad, en la tarea y en el `## Log`: el runner, el rojo observado (qué test, qué falló y por qué) y el verde. Si no aplicó, la excepción y el chequeo que se corrió en su lugar.

Al delegar, se le pasan al escritor el runner, esta política y la evidencia o la excepción.
