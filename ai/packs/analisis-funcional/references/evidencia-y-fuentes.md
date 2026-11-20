# Evidencia y fuentes

Referencia común de los procedimientos del pack `analisis-funcional`. Dice qué cuenta como evidencia, cómo se ordenan las fuentes cuando se contradicen y qué no prueba cada una.

---

## Cada afirmación es una de estas

| Clase | Qué es | Cómo se escribe |
|---|---|---|
| **Fuente** | Lo dice un documento que el proyecto reconoce | Con el documento y el lugar: "SRS v0.6, §4.2" |
| **Decisión** | La tomó alguien con autoridad para tomarla | Con quién y cuándo: "decidió PM, 12/09" |
| **Evidencia de código** | Está en el repositorio, en una revisión concreta | Con repo, rama o commit y archivo |
| **Propuesta** | La sugiere el agente o alguien sin autoridad | Rotulada como propuesta, nunca como regla |
| **Pendiente** | Nadie la definió | `[a decidir: …] — decide <quién>` |

Nunca se mezclan en una frase como si todas fueran lo mismo. **Lo aprobado nunca se rotula "propuesta"**, y lo propuesto nunca pasa a regla porque nadie objetó.

**Lo que la fuente no dice, no existe.** Un plazo, un monto, un estado, un permiso o un endpoint que no está escrito es una pregunta, no un dato que el agente completa con lo que "suele hacerse".

---

## Qué fuente manda

Cada proyecto declara sus fuentes y su orden en `analisis.md` de `ai/local/` (ver `ai/packs/analisis-funcional/references/contexto-del-proyecto.md`). Si no lo declara, este es el orden por defecto, de mayor a menor:

1. Lo que la persona con autoridad confirma en la conversación, con fecha.
2. Una decisión registrada (archivo de decisiones, acta, registro del proyecto).
3. El documento funcional vigente que aprobó el cliente (SRS, documento de módulo).
4. La ficha vigente del requisito.
5. Reuniones y transcripciones, como aclaración y en orden de fecha.
6. Tickets, propuestas de desarrollo, prototipos.
7. El código, **solo como evidencia** de lo que existe.
8. Un supuesto del agente, rotulado como tal.

Reglas para el orden:

- **Si dos fuentes se contradicen, no se elige en silencio.** Se escriben las dos, el impacto, y la decisión que hace falta. Recién con esa decisión se aplica una.
- **Una decisión posterior reemplaza a la anterior, pero no la borra.** Se aplica en todo el documento —reglas, flujos, escenarios, casos borde, configuración— y la anterior queda como antecedente. Después se busca en todo el texto lo que quedó contradiciendo la nueva.
- **Un documento con número de versión más alto no está aprobado por eso.** La aprobación sale de una persona o de un registro.
- **"No está" exige haber buscado.** Antes de decir que algo no existe o que no hay acceso, se busca de nuevo en las fuentes que nombró la persona, en el repositorio y en la carpeta de documentos del proyecto.

---

## Leer es leer entero

Buscar sirve para encontrar, no es leer: devuelve fragmentos, y lo que no se buscó se pierde. **Toda fuente que la persona nombra se lee entera.** Si una no se pudo leer (no abre, es un audio sin transcribir, falta acceso), se dice con su nombre, y lo que dependa de ella no puede darse por listo.

Rápido quiere decir menos preguntas, **nunca menos lectura**.

---

## Qué no prueba cada cosa

| Esto | No prueba |
|---|---|
| Código en el repositorio | Que esté aprobado, que esté en producción, la configuración real, los permisos efectivos, que funcione con datos reales |
| Un archivo o endpoint con un nombre parecido | Que el comportamiento esté completo |
| Una respuesta exitosa de un tercero, una pantalla de "listo" | Un resultado de negocio: que se acreditó, que se pagó, que se aprobó |
| Una búsqueda sin resultados | Que algo no exista; solo que no apareció con esos términos en esos lugares |
| Un test en el repositorio | Que pase; solo pasa si se corrió |
| La UI que oculta un botón | Que el permiso esté protegido: eso lo hace el servidor |
| Lo que un dev o un informe dice del código | Que el código sea así, si no se leyó el código |
| Un prototipo | Que el alcance esté aprobado |
| Código de otro producto | Nada sobre este |

Cuando se cita código: repositorio, rama o commit, archivo, qué se reutiliza y **qué no demuestra**. Y "no encontré" se escribe con dónde se buscó, con qué términos y en qué revisión.

---

## Reuniones y transcripciones

Una reunión es **evidencia**, no un cambio de requisito.

- Se lee la transcripción entera y se cita la reunión y la fecha.
- Un acuerdo explícito de quien tiene autoridad cuenta como decisión de reunión. Una pregunta, una idea al pasar o un "podríamos" no son decisiones.
- Se clasifica cada afirmación: hecho confirmado, decisión del equipo, hipótesis, decisión pendiente del cliente, fuera de alcance.
- Lo técnico que se mencionó en una reunión interna (una herramienta, un prototipo) no pasa a ser alcance aprobado.
- Si la reunión contradice un documento, se escriben los dos y se pide la decisión.

---

## Preservar lo que llega

Lo que alguien entrega como fuente se guarda **tal como llegó**, con su nombre y la fecha, en la carpeta de fuentes del proyecto. Si llegó pegado en el chat, se guarda el texto completo en un `.md` fechado. Si importa poder probar que no cambió, se anota su hash (`git hash-object <archivo>` alcanza).

Una fuente nunca se edita. Si hace falta corregirla, se escribe un documento nuevo que la cita.

---

## Datos sensibles

Las fichas, los dictámenes y las revisiones no llevan credenciales, tokens, datos personales reales, saldos, documentos de identidad ni hosts privados. Los ejemplos usan datos inventados. Lo que haga falta nombrar va como `[REDACTED]`. Aplica `ai/core/rules/datos-sensibles.md`.
