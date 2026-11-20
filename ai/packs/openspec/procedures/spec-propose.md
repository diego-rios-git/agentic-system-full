# Proponer un cambio

Crea la propuesta de un cambio antes de escribir una línea de código: qué se va a hacer, cómo, y cómo se sabrá que está bien.

---

## Por qué antes y no después

Un cambio implementado sin diseño acordado se revisa contra la intuición de quien revisa. Con diseño, se revisa contra lo que se acordó — y la diferencia entre ambos es el hallazgo.

Además, el diseño es lo único que le permite a un consumidor —otro repositorio, otro equipo— empezar a trabajar sin adivinar.

---

## Paso 1: entender el pedido

Antes de proponer, tener respuesta para:

- **Qué problema resuelve**, en términos de quien lo va a usar. No en términos técnicos.
- **Qué queda afuera.** Escribirlo explícitamente vale tanto como lo que queda adentro.
- **Cómo se sabrá que funciona.** Si no se puede escribir, el pedido todavía no está claro.

Si algo falta, **preguntar**. Una propuesta construida sobre una suposición se descubre cuando ya está implementada.

---

## Paso 2: aplicar la disciplina de alcance

Contar las tareas **antes** de escribir la propuesta. Ver `spec-scope-discipline`: por encima del umbral, se parte.

Es más barato partir una propuesta que partir una implementación.

---

## Paso 3: artefactos

### Propuesta

Qué se va a hacer y por qué. Incluye lo que queda afuera, y las decisiones que hay que tomar antes de empezar.

### Diseño

**El contrato.** Es el documento contra el que se va a auditar la implementación:

- Endpoints o interfaces, con su forma exacta de entrada y salida.
- Modelo de datos: qué se agrega, qué cambia, qué se migra.
- Reglas de negocio, incluidos los casos límite.
- Qué pasa cuando falla: cada error posible y qué se responde.

Si el cambio cruza repositorios, **el diseño se escribe antes de que empiece el trabajo del consumidor**. Sin eso, el consumidor adivina.

### Escenarios de aceptación

Cada comportamiento esperado, en la forma:

```
#### Scenario: <nombre que describe el caso>
- **WHEN** <situación>
- **THEN** <resultado esperado>
```

Estos escenarios no son decorativos: **cada uno debe terminar teniendo un test**, y hay un gate que lo verifica. Un escenario que nadie puede convertir en test está mal escrito — es demasiado vago o describe algo que no se puede observar.

Cubrir el camino principal **y** los casos que fallan. Una propuesta con solo escenarios felices produce una implementación que solo funciona cuando todo sale bien.

### Tareas

La lista de trabajo, en orden de dependencia. Cada tarea debe poder marcarse como hecha sin ambigüedad.

---

## Paso 4: decisiones abiertas

Lo que no se puede decidir sin la persona va en una sección propia, **no enterrado en el texto**. Una decisión abierta que nadie ve se resuelve sola —mal— durante la implementación.

---

## Antes de dar por buena la propuesta

- ¿El diseño alcanza para implementar sin volver a preguntar?
- ¿Cada escenario se puede convertir en un test?
- ¿Está escrito qué queda afuera?
- ¿Las tareas están dentro del umbral, o la excepción está justificada?
- ¿Las decisiones abiertas están señaladas como tales?

---

## Lo que sigue

1. La persona aprueba el diseño.
2. `spec-driven-testing` convierte los escenarios en tests **que deben fallar**.
3. `spec-apply` implementa hasta que pasen.

Ese orden no es ceremonia: escribir los tests después de implementar produce tests que confirman lo que el código hace, no lo que debería hacer.
