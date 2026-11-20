# Redactar un requisito

Convierte lo que la persona cuenta —desordenado, con ejemplos, a medias— en una ficha del tablero de requisitos (`requirements.dir`) que `spec-propose` pueda tomar sin volver a preguntar.

**La persona detalla; el agente estructura.** No se le pide que escriba bien: se le pregunta bien. Ella cuenta casos, el agente los convierte en reglas, ejemplos y escenarios, y se los lee de vuelta para que diga si es eso.

Sin tablero (`requirements` ausente), el procedimiento sirve igual: la ficha se entrega en el chat o en el archivo que la persona indique, y los pasos de estado se omiten.

---

## Lo que sostiene todo lo demás

1. **Nunca inventar una respuesta.** Lo que la persona no sabe o no decidió queda como `[a decidir: …]`, visible. Una decisión que el agente rellena con algo plausible se descubre implementada.
2. **Qué, no cómo.** La ficha dice qué tiene que pasar y para quién. Endpoints, tablas, tipos y nombres de componentes van en el diseño del change, no acá (la regla `requisitos`: el cuerpo no copia el contrato). Prueba: *¿cambiaría esta frase si cambia la implementación?* Si cambia, no va acá.
3. **Corta y viva.** Una ficha larga y repetida cuesta más de revisar que el código, y nadie la mantiene. Si no entra en una pantalla y media, probablemente son dos requisitos.

---

## Cómo se pregunta: con o sin herramienta de preguntas

La entrevista es por **rondas de hasta tres preguntas**.

- **Si el harness ofrece una herramienta de preguntas con opciones, se usa:** es más fácil elegir y corregir que redactar.
- **Si no, las mismas preguntas van en texto**, numeradas, **cada una con las opciones razonables ya escritas** (a, b, c) y una respuesta libre permitida. El formato es el mismo; solo cambia cómo contesta la persona.

En los dos casos, la opción que el agente recomienda va primera, marcada *(Recomendado)*, con una línea de por qué. Las preguntas abiertas solo cuando no hay opciones que ofrecer ("dame un ejemplo con horas reales").

---

## Dos modos

| La persona dice | Modo |
|---|---|
| "Necesitamos A, B y C", una lista de ideas | **Anotar**: una ficha por idea en `pendiente`, con solo *Qué pide* en dos líneas. Sin entrevista. Al final, preguntar por cuál se empieza |
| "Hagamos el requisito de X", o elige una de la lista | **Profundizar**: entrevista y ficha completa en `analisis` |

Varios requisitos se profundizan **de a uno**, terminado cada uno hasta la devolución del paso 5. Dos fichas a medias son dos fichas que nadie puede validar.

---

## Paso 0: leer antes de preguntar

No se pregunta lo que se puede averiguar.

- La ficha, si existe: `node scripts/check-requirements.js --tablero` o por título en `requirements.dir`. Si no existe, toma el siguiente id libre (`requirements.idPattern`). Un requisito que es parte de uno existente **amplía esa ficha**, no abre otra: dos fichas para el mismo id rompen la derivación del estado.
- El glosario y las decisiones cerradas del proyecto (`ai/local/`): la ficha usa **esas** palabras, sin sinónimos.
- Las reglas de negocio y de datos sensibles del proyecto.
- Lo que el sistema ya hace, si toca algo existente: la especificación permanente describe el sistema tal como está.

Con eso, la primera respuesta a la persona ya dice lo que se sabe y pregunta solo lo que falta.

---

## Paso 1: escuchar el relato y devolverlo

Pedir que cuente el caso como le salga: *"Contame cómo te imaginás que funciona, con un caso real: quién, cuándo, qué pasa."*

Devolver en **tres líneas**:

- Lo que entendí: quién, en qué situación, qué cambia para esa persona.
- Lo que ya sé por la documentación o el código.
- Lo que falta para poder escribirlo (eso guía la entrevista).

Si el relato trae varios requisitos mezclados, decirlo acá y proponer partirlos.

---

## Paso 2: la entrevista

Entre ronda y ronda, **resumir lo que quedó** en una línea. Si la persona duda, anotar `[a decidir]` y avanzar: no se insiste.

Los temas, en este orden. Saltear los que el paso 0 ya respondió.

| # | Tema | Qué se pregunta | Qué produce |
|---|---|---|---|
| 1 | **Situación** | ¿Quién lo vive? ¿En qué momento? ¿Cómo lo resuelve hoy? | *Qué pide* |
| 2 | **Resultado** | Si sale perfecto, ¿qué ve o qué cambia? ¿Cómo te darías cuenta de que anda? | Los ENTONCES |
| 3 | **Caso feliz con datos** | Un ejemplo paso a paso con nombres, días, horas y montos reales (inventados pero concretos) | *Ejemplos* y el primer escenario |
| 4 | **Disparador y estado** | ¿Qué lo dispara? ¿Qué tiene que ser cierto para que aplique? ¿Por qué canal? | Las reglas EARS |
| 5 | **Lo que sale mal** | De a uno: dato inválido, ya ocupado, duplicado, no existe, sin permiso, llega tarde, el otro no responde, un servicio externo falla. *¿Qué debería pasar?* | *Errores y casos borde* |
| 6 | **Números y límites** | Todo "rápido", "pocos", "a tiempo" se vuelve un número con unidad: ¿cuántas horas antes?, ¿cuántos como máximo? ¿Quién puede y quién no? | Reglas cuantificadas |
| 7 | **Datos de personas** | ¿Aparece algo que identifique a alguien o que sea sensible? ¿Sale hacia afuera por algún canal? | *Datos y reglas que toca* |
| 8 | **Fuera de alcance** | ¿Qué podría parecer parte de esto pero no lo es, o queda para otra fase? | *Fuera de alcance* |

Para el tema 5 no hace falta recorrer la lista entera: los que no aplican se descartan en una línea ("no hay cobro, así que no hay falla de cobro").

**Cuándo parar:** cuando se pueden escribir las reglas y un escenario por cada una, o tras cuatro rondas. Lo que siga sin respuesta queda en *Decisiones abiertas*; no se estira la entrevista.

---

## Paso 3: escribir la ficha

### Las reglas en EARS

Cada regla es **una frase, un comportamiento**, con el sujeto que lo hace y uno de estos patrones:

| Patrón | Forma | Ejemplo |
|---|---|---|
| Siempre | `El sistema debe <respuesta>.` | El sistema debe mostrar los horarios en la zona horaria de la sede. |
| Por evento | `Cuando <disparador>, el sistema debe <respuesta>.` | Cuando el cliente cancela una reserva, el sistema debe liberar el horario y avisar al responsable. |
| Por estado | `Mientras <estado>, el sistema debe <respuesta>.` | Mientras la sede tiene un día libre cargado, el sistema no debe ofrecer horarios de ese día. |
| No deseado | `Si <situación no deseada>, el sistema debe <respuesta>.` | Si el horario elegido ya fue tomado, el sistema debe ofrecer los tres horarios libres más cercanos. |
| Opcional | `Donde <característica presente>, el sistema debe <respuesta>.` | Donde el responsable tiene un calendario externo conectado, el sistema debe crear el evento al reservar. |
| Combinado | `Mientras <estado>, cuando <evento>, el sistema debe <respuesta>.` | Mientras la reserva está confirmada, cuando falten 24 horas, el sistema debe mandar el recordatorio. |

El sujeto puede ser más preciso que "el sistema" (*el panel*, *la agenda*), pero siempre el mismo para la misma cosa.

### Los escenarios

Uno por comportamiento, con datos concretos, en la forma que `spec-propose` copia al change:

```markdown
#### Escenario: el cliente cancela con más de 24 horas
Verifica R2.
- **DADO** una reserva confirmada de Ana para el martes 14 a las 10:00
- **CUANDO** Ana la cancela el domingo 12 a las 9:00
- **ENTONCES** la reserva queda cancelada y el horario del martes 10:00 vuelve a estar libre
- **Y** el responsable recibe el aviso de la cancelación
```

Declarativos: describen lo que pasa, no clics ni campos. Cada regla tiene al menos un escenario, y cada regla de *No deseado* tiene el suyo: una ficha con solo escenarios felices produce un sistema que solo anda cuando todo sale bien.

### La plantilla

```markdown
---
tipo: requisito
rf: <id según requirements.idPattern>
titulo: "<Título corto>"
estado: analisis
actualizado: <AAAA-MM-DD>
---

# <id> — <Título>

> **En una línea:** <quién> puede <qué> para <qué le cambia>.

## Qué pide

<Dos a cuatro líneas: la situación, quién la vive y qué problema hay hoy. Enlaces a donde se pensó.>

## Reglas

- **R1.** <EARS>
- **R2.** <EARS>

## Ejemplos

| Situación | Dato | Resultado |
|---|---|---|
| <caso> | <valor concreto> | <qué pasa> |

## Escenarios de aceptación

#### Escenario: <nombre>
Verifica R1.
- **DADO** …
- **CUANDO** …
- **ENTONCES** …

## Errores y casos borde

| Situación | Qué pasa | Qué ve quien lo vive |
|---|---|---|
| <falla> | <respuesta del sistema> | <mensaje o efecto> |

## Fuera de alcance

- <lo que no incluye, y si es de otra fase, cuál>

## Datos y reglas que toca

- <reglas de negocio que aplican, datos sensibles, si sale hacia afuera por algún canal. "Ninguno" también es una respuesta>

## Decisiones abiertas

- [a decidir: <pregunta concreta>] — decide <quién>. Mientras tanto: <qué se asume o qué queda bloqueado>.

## Cómo quedó

Todavía no se construyó nada.
```

Una sección sin contenido se borra, salvo *Fuera de alcance*, *Decisiones abiertas* y *Datos y reglas que toca*, que dicen "Ninguno" o "Ninguna": ausencia y olvido no se distinguen de otra forma.

En la ficha los ejemplos usan nombres inventados. **Nunca datos reales** (`datos-sensibles`): ni nombres, ni documentos, ni teléfonos de personas reales.

---

## Paso 4: revisar el texto antes de mostrarlo

Las *pruebas unitarias del texto*. Cada una que falla se corrige, no se anota.

**Palabras que no pasan** si no traen un número o una definición al lado:

> rápido, lento, fácil, simple, intuitivo, adecuado, apropiado, razonable, suficiente, algunos, varios, pocos, muchos, normalmente, generalmente, a tiempo, en lo posible, si corresponde, según el caso, etc., y/o, entre otros, debería, podría, eventualmente, mejorar, optimizar, soportar, manejar

**La lista:**

- [ ] Cada regla es una sola frase con un solo comportamiento. Una "y" entre dos verbos se parte en dos reglas.
- [ ] Cada regla tiene su escenario, y cada escenario dice qué regla verifica.
- [ ] Hay al menos un escenario de error.
- [ ] Todo lo medible tiene número y unidad.
- [ ] Ningún "esto" o "lo anterior": cada regla se entiende sola.
- [ ] Ninguna regla nombra una tabla, un endpoint, una librería o un componente.
- [ ] Los términos son los del glosario. Un término nuevo se le propone a la persona para el glosario; no se agrega sin que lo diga.
- [ ] Nada contradice las reglas de negocio del proyecto.
- [ ] Tamaño: más de ocho reglas, o reglas de dos áreas distintas, suele ser dos requisitos. Se propone partir por el límite natural (un actor, un momento) y no por la mitad.
- [ ] `node scripts/check-requirements.js` sin hallazgos nuevos (si hay tablero).

---

## Paso 5: leerla de vuelta y cerrar

Mostrar la ficha a la persona **entera**, no un resumen, y preguntar:

1. ¿Es esto lo que querés? ¿Falta algún caso?
2. Las decisiones abiertas, una por una, con opciones si las hay.

Lo que corrige se aplica. Si quedó sin decisiones abiertas, preguntar si la da por **validada**. **Solo con su sí pasa a `validado`**: es su decisión, nunca la del agente (`requisitos`). Con decisiones abiertas, queda en `analisis`, y eso también es un buen resultado: el requisito está pensado y se sabe qué falta.

Cada vez que se toca la ficha se actualiza `actualizado:`.

---

## Lo que sigue

Con la ficha en `validado`, `ciclo-de-tarea` la toma en su paso 0 y `spec-propose` la convierte en un change: las reglas pasan a requisitos, los escenarios pasan casi tal cual (`DADO/CUANDO/ENTONCES` a `GIVEN/WHEN/THEN` si el proveedor lo pide), los errores alimentan el diseño, y el fuera de alcance y las decisiones abiertas pasan a sus secciones. Si al proponer aparece algo que la ficha no responde, **se vuelve a la ficha**: es la fuente de qué se pidió.

---

## Fuentes de las que se armó

EARS (Alistair Mavin), la guía de redacción de requisitos de INCOSE, ISO/IEC/IEEE 29148, *Specification by Example* y los escenarios declarativos de Gherkin, y la plantilla de especificación con el paso de aclaración de Spec Kit.
