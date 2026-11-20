# ODD: verificación proporcional

Cuánto se verifica un cambio lo decide **lo que el cambio toca**, no su tamaño, ni lo poco claro que parezca, ni el modelo que lo escribió.

---

## Los tres niveles

| Nivel | Qué es | Qué se hace |
|---|---|---|
| **Pasivo** | Documentación, imágenes o comentarios sin efecto ejecutable | Relectura estructural. Nada más: no se abre una ceremonia de verificación semántica para un texto |
| **Medio** | Un cambio de comportamiento común, cubierto por tests enfocados | Quien escribió corre los comandos de verificación y reporta `<comando>: <resultado observado>`. Sin verificador aparte |
| **Alto** | Solo cuando la línea de riesgo **nombra** un ítem (`odd-protocolo`, Riesgo alto) | Lo del medio, más un verificador independiente: `odd-verificador` |

Un cambio "poco claro" sigue en medio hasta que alguien nombra el ítem que aplica. El verificador es para ocasiones concretas, y lo más raro posible.

**En todos los niveles**, antes de entregar, el padre vuelve a correr **uno** de los comandos reportados. Un autorreporte no es prueba.

Los gates de la base (`node scripts/run-gates.js --repo <repo>`) corren igual en todos los niveles: son los chequeos rápidos y no compiten con este.

---

## El orden de los chequeos

1. Primero todo lo que **modifica** archivos: formateadores, generadores, autocorrecciones.
2. Después la verificación funcional.
3. Después de verificar, solo lo que **mira sin tocar**: formato en modo chequeo, tipos, tests.

Si cambió un byte, una ruta o un permiso después de verificar, se vuelven a correr los chequeos afectados.

---

## Cuándo corre el verificador

- **Al final de la funcionalidad**, una vez, cuando varias entregas de la misma funcionalidad se escribieron directo.
- **Por unidad**, solo cuando esa unidad nombra un ítem de riesgo alto (en su línea de riesgo, o al mirar su diff real).
- Nunca por el modelo o el esfuerzo con que se escribió el código.

### Qué se le pasa

- El documento **completo** (todas las `S#`, nunca una sola tarea).
- El commit base.
- Las formas de los comandos con que puede probar: los de test, build y lint, y los ejemplos de las specs.

Si la tarea es chica y no tiene documento, el pedido textual de la persona.

---

## Bloqueo o advertencia

**Bloqueo** es un defecto que causó el cambio, o una spec que el cambio deja sin cumplir, reproducido con una entrada que un usuario podría cargar de verdad, y que **no** se reproducía en la base.

**Advertencia**:

- lo que ya fallaba en la base y nadie pidió cambiar;
- lo que falla solo con valores fuera de todo dominio real (montos más grandes que cualquier saldo, tamaños patológicos), salvo que el pedido los nombre.

**Siempre bloqueo**, aunque parezca menor:

- ignorar en silencio una opción o un valor que el usuario pasó explícitamente, y salir con éxito;
- cambiar la salida, el texto de error o la numeración de algo que ya existía, sin que nadie lo pidiera, aunque parezca una mejora.

Las advertencias se reportan con su reproducción, para que la persona decida. No piden una ronda de corrección.

---

## Los límites de la corrección

No existe "corregir hasta que quede limpio".

1. **Una tanda de corrección** que arregla **todos** los bloqueos reportados.
2. **Un rechequeo** limitado a esos bloqueos y sus regresiones directas. No es un barrido completo nuevo.
3. **Una segunda corrección** solo si el rechequeo muestra **el mismo** bloqueo todavía fallando. Un hallazgo nuevo no gana una ronda.
4. Lo que siga abierto después de eso se convierte en **un** resultado **"Necesita tu decisión"**.

La autorrevisión de quien escribe sigue el mismo límite, y si no cierra, reporta `parcial`.

Las pruebas que el verificador derivó de las specs se commitean como tests de regresión: él las devuelve listas, quien escribe las agrega.

---

## Cuando no se puede verificar

- Un verificador que no está disponible se reporta como **no disponible**. No se inventa un "pasó", no se reintenta sin fin, no se escala a más ceremonia.
- Un comando que ya falla en la base por el entorno puede pasarse como **falla conocida**, con el nombre exacto del test o la línea de comando y su evidencia. Cualquier otro comando requerido que falle deja la tarea en `parcial`.
- Prueba parcial, no disponible, rechazada o agotada: **un** resultado "Necesita tu decisión" con los bloqueos o la prueba que falta. Es una parada válida.

---

## Lo que la verificación no autoriza

Que un cambio esté verificado no autoriza commit, push, PR ni release. Eso sigue la política del repositorio: `git-commit-workflow` y `cerrar-ticket`.

`pr-review` es la mirada de afuera, con sus agentes de QA, código y seguridad. En gentle-ai ese lugar lo ocupa su revisión nativa, que no se trajo. Correrlo lo decide la persona, y no reemplaza ni saltea el nivel que corresponde acá: si los dos aplican, el verificador va primero.
