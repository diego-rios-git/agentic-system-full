# Tests desde la especificación

Convierte los escenarios de aceptación en tests **antes** de implementar. Los tests deben fallar primero.

---

## Por qué en este orden

Un test escrito después de la implementación confirma lo que el código **hace**. Un test escrito desde la especificación verifica lo que el código **debería hacer**. Cuando difieren, el segundo lo detecta y el primero no.

Además, un test que nunca se vio fallar no prueba nada: puede estar verificando algo trivialmente cierto, o no estar ejecutándose. **Verlo en rojo es parte del procedimiento.**

---

## Paso 1: partir del diseño aprobado

No de la conversación, no del ticket: del documento de diseño ya aprobado. Si todavía no está aprobado, este procedimiento no corre.

---

## Paso 2: un test por escenario

Cada `#### Scenario:` del diseño se convierte en un test cuyo **título contiene el nombre del escenario**.

```
#### Scenario: rechaza un monto mayor al disponible
```

```ts
it('rechaza un monto mayor al disponible', async () => { ... });
```

Esa correspondencia de nombres no es estética: es lo que permite que un gate verifique que ningún escenario quedó sin cubrir. Un test que prueba el escenario pero se llama distinto es indistinguible de un escenario sin test.

---

## Paso 3: verlos fallar

```bash
<comando de tests del repositorio>
```

**Todos los tests nuevos deben fallar.** Si alguno pasa antes de implementar, hay tres posibilidades y ninguna es buena:

- El comportamiento ya existía y la tarea es innecesaria.
- El test no verifica lo que dice verificar.
- El test no se está ejecutando.

Averiguar cuál antes de seguir. Un test verde en esta etapa es una alarma, no una buena noticia.

---

## Paso 4: implementar hasta el verde

Ver `spec-apply`. La implementación termina cuando **todos** los tests pasan — no cuando pasa la mayoría.

---

## Qué hace bueno a un test

**Prueba comportamiento observable, no implementación.** Un test que se rompe al renombrar un método privado o al reordenar una función no está probando nada: está copiando el código.

**Un motivo de fallo por test.** Si un test puede fallar por cinco razones distintas, cuando falle no vas a saber cuál fue.

**Datos que dicen algo.** `"Cliente A"` y `"Cliente B"` explican el caso; `"test1"` y `"test2"` no.

**Los casos límite son el punto.** El camino feliz suele funcionar por accidente. Lo que se rompe es el valor ausente, la colección vacía, el límite exacto, la operación concurrente, y el fallo a mitad de camino.

---

## Qué no hacer

- **No escribir el test mirando la implementación.** Se escribe desde el diseño; si hace falta mirar el código para saber qué esperar, el diseño está incompleto y hay que arreglar el diseño.
- **No aflojar un test para que pase.** Si falla, o el código está mal, o el test está mal, o el diseño estaba mal. Las tres se resuelven, ninguna se esconde.
- **No dejar tests desactivados.** Un test apagado es deuda invisible: no falla, no cubre y nadie lo ve.
