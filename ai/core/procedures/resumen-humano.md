# Resumen humano de un documento

Convierte un documento largo —un requisito, una especificación, la documentación de una API, un informe consolidado— en un resumen que una persona lee entero y entiende sin tener las otras cuarenta páginas del sistema en la cabeza.

**Motor**: lectura. Nada más. No toca código ni git.

**La prueba de que el resumen sirve:** la persona lo lee, cierra el archivo, y puede explicarle el tema a un compañero sin volver a abrirlo.

---

## El problema que resuelve

Hoy la documentación la escribe una IA para que la lea otra IA. Eso está bien: es completa, es precisa, no se olvida de ningún caso borde. Y es ilegible para la persona que tiene que decidir con ella.

Tres cosas la vuelven ilegible, y este procedimiento ataca las tres:

| Lo que hace el documento fuente | Por qué duele | Qué hace este procedimiento |
|---|---|---|
| Cita códigos de requisito, de regla, de criterio, como si el lector los tuviera memorizados | El lector **no** los tiene. Cada sigla es una interrupción: o va a buscarla, o sigue leyendo sin entender | Reemplaza la sigla por lo que **dice**, en la misma oración |
| Enumera campos, tipos, estados y variables | Es material de implementación, no de comprensión. Ocupa el 40% del texto y no explica nada | Lo saca. Un dato técnico sobrevive solo si el caso de uso no se entiende sin él |
| Describe reglas en abstracto ("la operación debe ser idempotente") | Una regla abstracta se lee, se asiente y se olvida | La vuelve un ejemplo con números y nombres. Se recuerda |

---

## Qué NO es

- **No estima.** La estimación (`task-estimation`) corre aparte, con el fuente crudo, nunca con este resumen.
- **No diseña ni propone.** No agrega "yo haría X". Si el documento no lo dice, el resumen no lo dice.
- **No enseña a programar** (`code-professor`).
- **No reemplaza al fuente.** Es una puerta de entrada. Cuando alguien va a implementar, vuelve al original, y el resumen dice dónde está.

---

## Paso 0: qué se resume y adónde va

```
Fuente:  la ruta (o las rutas) que la persona pasó
Destino: la carpeta que la persona indicó | el chat | preguntar
```

- **Si la persona nombró una carpeta:** ahí va, un archivo `.md` por fuente, y el chat solo confirma con una línea.
- **Si pidió "en el chat":** se devuelve en el mensaje, sin escribir archivo.
- **Si no dijo nada:** preguntar (chat o carpeta) con la herramienta de preguntas del harness si la hay, o en texto si no. No adivinar: escribir un archivo que nadie pidió ensucia el repositorio, y volcar doscientas líneas en el chat cuando querían un archivo obliga a copiar y pegar.

Nombre del archivo: el del fuente, en kebab-case, sin fecha ni versión, con sufijo `-resumen` (`informe-de-integracion-v1.8-2026-09-11.md` pasa a `informe-de-integracion-resumen.md`). Si ya existe: avisar y preguntar si se sobrescribe o se versiona (`-v2`).

---

## Paso 1: leer el fuente completo

Leer **todo**. No muestrear, no leer los títulos y deducir el resto.

Un resumen hecho sobre una lectura parcial miente con seguridad: la regla que cambia todo suele estar en la sección 9 de la ficha 12, justo donde la lectura por muestreo no llega.

Si el archivo supera las 500 líneas, leerlo por tramos y recién armar el resumen cuando se leyó el último. Nunca escribir la primera sección mientras todavía queda documento sin leer: el orden de importancia casi nunca coincide con el orden del archivo.

---

## Paso 2: decidir la forma

Hay dos formas, y usar la equivocada arruina el resultado.

**Forma A: documento único** (un solo tema: un requisito, una especificación, la documentación de una API chica). Estructura de secciones, del Paso 4.

**Forma B: carpeta de fichas** (el fuente agrupa N requisitos, N endpoints o N módulos independientes; se reconoce por un índice con más de 5 ítems numerados, o por una estructura que se repite idéntica N veces). Un mapa arriba y una **ficha compacta por ítem**, del Paso 5.

La señal decisiva es si los ítems son **independientes entre sí**. Dieciséis requisitos que se pueden construir en distinto orden son Forma B. Un requisito con dieciséis reglas que se sostienen entre sí es Forma A.

---

## Paso 3: las cuatro reglas de traducción

Aplican a **cada oración** que se escribe, en las dos formas.

### Regla 1: ninguna sigla sobrevive sola

Toda referencia a otro documento (códigos de requisito, de regla, de criterio, "Módulo N") se resuelve de una de estas tres maneras, en este orden de preferencia:

1. **Se reemplaza por lo que dice.** Si el fuente explica en algún lado qué es, se usa esa explicación y se borra la sigla.
2. **Se reemplaza por una descripción funcional entre paréntesis**, si el fuente no lo explica pero se deduce del contexto.
3. **Se borra**, si era solo un sello de trazabilidad.

```
No:  "El chat aplica la visibilidad de adjuntos internos conforme a la regla 7.11.10."
Sí:  "En el chat de la disputa, si Soporte marca un mensaje como interno, ese mensaje
      y su archivo adjunto los ve solo Soporte. Los demás mensajes los ven los tres
      participantes."

No:  "Ámbito: R2; acceso inválido: R2."
Sí:  (se borra: es un sello de trazabilidad, no le dice nada al lector)
```

**Excepción única:** si la sigla es el nombre con el que el equipo llama a la cosa todos los días (un identificador de ticket, `{PREFIJO}-123`), se conserva. Un ticket es una dirección, no una referencia a resolver.

### Regla 2: cada regla lleva su ejemplo con números

Una regla abstracta no se retiene. Un ejemplo sí. Todo lo que en el fuente sea una regla de negocio, un criterio de aceptación o una restricción se escribe como **la regla en una oración + el ejemplo concreto**.

```
No:  "La operación financiera debe ser idempotente y recuperable ante incertidumbre."
Sí:  "Si el mismo aviso de pago llega dos veces, se acredita una sola vez.
      Ejemplo: el proveedor avisa 'depósito de 50.000 OK', el sistema acredita, y tres
      minutos después el mismo aviso vuelve a llegar porque hubo un reintento. El saldo
      sigue en 50.000, no en 100.000."
```

Los números del ejemplo se **inventan** (son ilustrativos), pero la mecánica **no**: tiene que ser exactamente la que describe el fuente. Si se inventa un número, que sea redondo y obvio (50.000, 3 tramos, 2 minutos) para que nadie lo confunda con un dato del documento.

### Regla 3: fuera todo lo que es material de implementación

Se borra sin preguntar:

- Tablas de campos, tipos, cargas, esquemas.
- Listas de estados **salvo** que el flujo no se entienda sin ellas. Si sobreviven, se traducen: `EN_ESPERA_DE_EVENTO` pasa a "esperando que el proveedor avise".
- Secciones de control y trazabilidad ("Origen:", "Tipo:", "Estado: insumo para desarrollo", "Cobertura de corte:").
- Fórmulas de firma, encabezados, ejemplos de pedido/respuesta, salvo que el documento **sea** la documentación de una API, donde son el tema (ver el Paso 6).
- Repeticiones. Los documentos generados por IA repiten la misma regla en tres secciones distintas de cada ficha. Se dice **una vez**, en el lugar donde más se entiende.

### Regla 4: se dice lo que el documento dice, y nada más

Si el documento no define algo, el resumen **lo declara como no definido**. No se completa con lo razonable, ni con lo que dice el código, ni con lo que dijo alguien en otra conversación.

```
Sí:  "Todavía sin definir: cómo se firma el aviso que manda el proveedor. Sin eso
      no se puede implementar la validación."
```

Esa sección es de las más útiles del resumen: es lo que hay que ir a preguntar.

---

## Paso 4: Forma A, plantilla de documento único

```markdown
# <Nombre en lenguaje natural, no el del archivo>

> <Una sola oración: qué es esto y para qué existe. Si el lector solo lee
> esta línea, tiene que quedarse con la idea principal.>

**Quién lo pidió / para quién es:** <en una línea>
**Qué tan cerrado está:** <decidido y listo para construir | decidido pero
faltan detalles técnicos | todavía en discusión>

---

## De qué se trata

<2 a 4 párrafos cortos. Sin jerga. Si una analogía ayuda, va, pero una sola
y tiene que ser honesta.>

## Los casos de uso

### 1. <El caso en lenguaje natural: "Un cliente deposita dinero">

**Quién:** <actor> · **Cuándo:** <disparador>

1. <paso, en presente y en criollo>
2. <paso>

**Si sale mal:** <el camino alternativo más probable, en una o dos oraciones>

**Ejemplo:** <el mismo caso con nombres y números concretos>

### 2. <siguiente caso>

## Las reglas que no se pueden romper

| La regla | Qué pasa si se rompe |
|---|---|
| <regla en una oración, con su ejemplo corto> | <la consecuencia real> |

## Vocabulario

<Solo los términos que aparecen arriba y que no son de uso común. Una oración cada uno. Si la lista pasa de 8 términos, quedó jerga sin traducir: volver al Paso 3.>

| Término | Qué es |
|---|---|

## Lo que todavía no está definido

- <cada hueco real, y qué bloquea>

## Para ir al detalle

Fuente: `<ruta>` (<N> líneas).
<Si aplica: qué sección del fuente mirar para cada tema.>
```

**Presupuesto de largo (solo Forma A):** el resumen no puede pasar de

| Fuente | Resumen |
|---|---|
| hasta 300 líneas | 60 líneas |
| 300 a 1.000 | 120 líneas |
| 1.000 a 2.500 | 200 líneas |
| más de 2.500 | 250 líneas, o Forma B |

Si el borrador se pasa, **no se achica la letra chica**: se sacan casos de uso secundarios y se dejan los principales. Un resumen incompleto pero legible sirve; uno completo pero de 400 líneas es el problema original otra vez.

---

## Paso 5: Forma B, plantilla de carpeta de fichas

```markdown
# <Nombre en lenguaje natural>

> <Una oración: qué es todo esto junto.>

**Qué tan cerrado está:** <...>
**Cuántas piezas:** <N>, agrupadas en <M> bloques.

---

## El mapa

<Un párrafo que explique cómo se conectan los bloques entre sí. Si un diagrama de texto de 5 líneas ayuda, va.>

| # | Pieza | Qué hace, en una línea | Depende de |
|---|---|---|---|

---

## <Bloque 1>

### <ID> — <nombre en lenguaje natural>

**Qué hace:** <1-2 oraciones>
**Quién lo usa:** <actores>
**La regla que más importa:** <una, con su ejemplo>
**Sin definir:** <o "nada">

---

## Lo que falta para poder empezar

- <los huecos transversales, los que bloquean varias piezas a la vez>

## Para ir al detalle

Fuente: `<ruta>` (<N> líneas). Cada ficha de arriba corresponde a una sección del fuente con el mismo ID.
```

**Presupuesto de largo en Forma B:** entre 8 y 14 líneas por ficha, y hasta 60 líneas entre el mapa, los huecos y el cierre. **La tabla del Paso 4 no aplica acá**: un fuente de 2.000 líneas con 16 piezas independientes no entra en 200 líneas sin dejar piezas afuera, y dejar piezas afuera es peor que un archivo un poco más largo. Si una ficha necesita más de 14 líneas, es candidata a su propio resumen aparte en Forma A.

**Repetición entre fichas:** los documentos generados por IA repiten el mismo hueco ("falta el contrato técnico") en las 16 fichas. En el resumen se dice **una vez**, en la sección de huecos del final. En la ficha solo queda lo que es propio de esa pieza.

---

## Paso 6: variante para documentación de una API

Es el caso donde la Regla 3 se invierte: los puntos de entrada, los encabezados y el formato de autenticación **son** el tema, no ruido. Pero la mecánica sigue siendo la misma: se explica **para qué sirve cada llamada**, no se transcribe el esquema.

```markdown
# <Proveedor> — cómo se integra

> <Una oración: qué hace este proveedor.>

**Autenticación:** <en dos oraciones: qué se manda y cómo se arma>
**Formato:** <estilo, método, dirección base>

## El flujo completo, de punta a punta

1. <paso, con el punto de entrada entre paréntesis>

**Ejemplo:** <un recorrido concreto con un monto y un id inventados>

## Las llamadas

| Para qué | Punto de entrada | Qué devuelve, en una línea |
|---|---|---|

## Los estados que puede tener una transacción

| Estado | Qué significa realmente | ¿Es final? |
|---|---|---|

## Las trampas

- <cada cosa que el documento menciona al pasar y que rompe una integración: el monto puede cambiar, el aviso llega dos veces, una respuesta de éxito no es un pago>

## Lo que el documento no dice

- <...>
```

La sección **Las trampas** es la razón de ser de esta variante. En la documentación de una API, lo caro está siempre en una nota al pie: *"el monto solicitado puede cambiar durante el proceso"*. Esa línea vale más que las otras veinte páginas y hay que rescatarla.

---

## Paso 7: revisar antes de entregar

Releer el borrador entero haciendo de cuenta que no se leyó el fuente. Tres preguntas:

1. **¿Hay alguna sigla que no entendería alguien que no trabaja en esto?** Si la hay, volver a la Regla 1.
2. **¿Hay alguna regla sin ejemplo?** Si la hay, volver a la Regla 2.
3. **¿Se puede leer entero sin saltear?** Si no, sacar casos de uso secundarios hasta que sí.

---

## Paso 8: reportar

Si se escribió archivo, el chat dice una línea:

```
Listo: `<ruta del resumen>` — <N> líneas del fuente en <M> líneas.
```

Y **como máximo tres viñetas** con lo que más sorprendió del documento: una trampa, una decisión ya cerrada que cambia el alcance, o un hueco que bloquea. Nada más: el resumen ya está escrito, no se lo repite en el chat.

Si la persona pidió el resumen en el chat, se devuelve el resumen y listo.

---

## Checklist antes de frenar

- [ ] Se leyó el fuente **completo** antes de escribir la primera línea.
- [ ] No sobrevive ninguna sigla de documento sin haber sido reemplazada por lo que dice, salvo un ticket usado como dirección.
- [ ] Cada regla de negocio tiene su ejemplo concreto con nombres o números.
- [ ] No hay tablas de campos, tipos, cargas ni esquemas (salvo en la variante de API del Paso 6, y ahí traducidos a "para qué sirve").
- [ ] No hay secciones de control o trazabilidad del fuente.
- [ ] Los estados técnicos que sobrevivieron están traducidos a lenguaje natural.
- [ ] Existe la sección de lo que **no** está definido, y dice qué bloquea cada hueco.
- [ ] El resumen respeta el presupuesto de largo de su forma: la tabla del Paso 4 si es Forma A, el presupuesto por ficha del Paso 5 si es Forma B.
- [ ] En Forma B, ningún hueco transversal se repite ficha por ficha.
- [ ] El vocabulario no pasa de 8 términos (Forma A).
- [ ] El resumen dice dónde está el fuente, con su ruta.
- [ ] Nada en el resumen está inventado: cada afirmación sale del fuente, y los números de los ejemplos son obviamente ilustrativos.
- [ ] Si se escribió archivo, el chat es una línea más tres viñetas como mucho.

---

## Lo que nunca se hace

- Resumir sobre una lectura parcial: la regla que cambia todo está en la sección que no se leyó.
- Dejar una sigla de documento sin resolver "porque se entiende por contexto": no se entiende, por eso existe este procedimiento.
- Copiar una tabla del fuente tal cual. Si hace falta una tabla, se escribe de nuevo con las columnas que le sirven al lector.
- Completar un hueco del documento con lo razonable, con lo que dice el código o con lo que se habló en otra conversación: se declara como hueco.
- Agregar recomendaciones, estimaciones, diseño o "yo propondría": este procedimiento traduce, no opina.
- Presentar un número inventado de un ejemplo como si fuera un dato del documento.
- Pasarse del presupuesto de largo recortando la claridad: se recortan casos de uso, no se comprime la prosa.
- Usar el resumen como fuente para estimar, diseñar o implementar: para eso se vuelve al original.
- Escribir el archivo en una carpeta que la persona no indicó.
