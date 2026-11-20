# Regla — El borde no lo ve un unitario

**Regla:** un cambio que agrega un controlador, un decorador de clase, una entrada en `controllers:` o un `provider` nuevo necesita **un test que levante la aplicación y mande una petición**, con los guards reales. Sin eso, ese cableado no está probado: no "poco probado", no probado.

Es del pack `nestjs`: habla de cómo arma Nest sus rutas. El principio general (una aserción que no puede fallar no es una aserción) está en `ai/core/rules/dobles-de-repositorio.md`.

---

## De dónde sale (el incidente)

Una revisión cruzada de un cambio de backend encontró seis bloqueantes, y el revisor lo resumió así:

> El criterio de diseño y la calidad de los tests de lógica están por encima del promedio, y por eso el patrón importa: **todo lo que falla está en el borde, y el borde es exactamente lo que no tiene un solo test.**

| | Qué pasaba | Por qué ningún test lo vio |
|---|---|---|
| 1 | Un decorador de clase hacía responder 500 a toda petición: el guard estaba montado pero sin su metadata | La metadata solo existe cuando Nest arma la ruta |
| 2 | Una ruta estática respondía 400: la capturaba la ruta con parámetro de otro controlador | El orden de rutas solo existe cuando hay dos controladores en un módulo |
| 3 | La pantalla no cargaba para ningún rol: dos endpoints con roles incompatibles | Cada endpoint se probó solo; nadie probó **la pantalla** |
| 4 | Evidencia → resolución dejaba el registro activo para siempre | El test miraba un campo y no el estado final |
| 5 | Todo registro de monitoreo iba a escalar | El test afirmaba sobre una fixture escrita a mano, sin llamar al servicio |
| 6 | El registro que el diseño exige decía siempre lo mismo | El test afirmaba `toBe(true)` sobre algo que era `true` siempre |

Los tres primeros son cableado; los tres últimos son **aserciones que no podían fallar**. Son dos reglas distintas y las dos están abajo.

---

## Regla 1 — Lo que arma el framework se prueba arrancándolo

No alcanza con leer el código y convencerse. Estas cuatro cosas **no existen** hasta que Nest levanta:

- La metadata de un decorador y el guard que la consulta. Son dos mitades, y al leer los `@UseGuards` se ve una sola.
- El orden de rutas entre controladores del mismo prefijo.
- La resolución de dependencias.
- Los pipes y filtros globales, que deciden el código HTTP que sale.

Un `e2e.spec.ts` que monte los controladores **en el orden real del módulo**, con los guards reales, y mande una petición, cuesta media hora y atrapa las cuatro.

**Y los guards reales, no dobles.** Un doble de un guard de contexto que siempre escribe el contexto habría hecho pasar el primer caso: el defecto era justamente que el guard real no escribía nada.

## Regla 2 — Una aserción que no puede fallar no es una aserción

Tres formas de escribir una, las tres cometidas el mismo día:

**Afirmar sobre una fixture propia.** El test llamaba a una función de mapeo con una fila armada a mano y verificaba que un campo fuera `null`. Era `null` porque el test lo escribió así, no porque el código lo dejara así: el servicio no se llamaba ni una vez. Si la aserción es sobre datos que el test construyó, prueba el constructor del test.

**Probar un booleano con un solo valor.** El test afirmaba `toBe(true)` sobre un campo implementado como `registro.atendido_en === null`, cuando el escalamiento **solo ocurre** con `atendido_en` en `null`. Siempre `true`, y el test verde. Un booleano se prueba con los dos valores; si el caso contrario no se puede escribir, el campo no distingue nada, **y eso es un hallazgo, no un detalle del test**.

**Mirar un campo y no el resultado.** El test verificaba que la segunda acción no pisara `atendido_en` —cierto— y no miraba el estado del registro, que era lo que quedaba roto. Un test de una secuencia que no mira cómo termina la secuencia no prueba la secuencia.

## Regla 3 — Un booleano por hecho

Los casos 4 y 6 son el mismo error con distinta ropa: **una variable respondiendo dos preguntas**.

`cambioLaAtencion` significaba "¿se movió `atendido_en`?" y se usaba como "¿hay que escribir algo?". Son distintas: en la secuencia evidencia → resolución, la segunda no mueve `atendido_en` **y sí** tiene que escribir. Un solo booleano hizo que resolver fuera imposible después de aportar evidencia.

Si dos hechos ocurren en momentos distintos, llevan dos campos y dos condiciones de escritura. Juntarlos "porque hoy coinciden" convierte una coincidencia temporal en una regla.

---

## Cómo aplicarlo en tu proyecto

Antes de dar por terminado un cambio de backend, tres preguntas:

1. **¿Agregué algo que el framework cablea?** Un controlador, un decorador de clase, una entrada en `controllers:` o `providers:`. → hace falta un test que levante la app.
2. **¿Alguna aserción mía podría pasar con el código borrado?** Si el dato lo arma el test, sí. → llamar al código.
3. **¿Algún booleano nuevo puede tomar sus dos valores?** Si no, o sobra o está mal implementado.

Si el proyecto ya tiene una base de tests que levanta la aplicación, el test del borde se agrega ahí (con la misma fábrica de módulo de prueba) y no en un archivo aparte que nadie mantenga. Si no la tiene, el primer cambio que agregue un controlador es el momento de crearla.

Lo que sí se puede automatizar (un decorador usado sin el que lo activa en el mismo archivo, por ejemplo) se evalúa con `gate-from-finding` como regla del pack. El resto queda anotado en `ai/gate-candidates.md` con lo que haría falta.

Relacionadas: `ai/core/rules/dobles-de-repositorio.md` (el doble más pobre que el objeto real) y `ai/core/rules/edicion-por-reemplazo.md` (la mutación que no se aplicó). Las tres son la misma familia: verificar contra lo que el sistema hace, no contra lo que uno escribió para verificar.
