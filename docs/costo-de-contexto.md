# El costo de contexto

Qué paga una sesión antes de que el agente lea una sola línea de código, y cómo mantenerlo bajo.

---

## Medirlo

```bash
node scripts/check-context-budget.js
```

Devuelve el costo fijo de una sesión, dividido en las tres partidas que lo componen, y avisa cuál se pasó de su presupuesto.

No es un gate de calidad: pasarse no significa que algo esté mal escrito. Significa que se está pagando en cada tarea, y conviene saberlo antes de que sea la mitad del contexto disponible.

---

## Las tres partidas

### 1. Las descripciones de skills y agentes

La más invisible y la que más sorprende. El harness mete la `description` de **cada** activo en el prompt del sistema para poder elegir cuál invocar. Se pagan todas, en toda sesión, aunque no se use ninguno.

Con treinta activos y una descripción de tres renglones cada uno, eso es un archivo entero de texto en cada tarea.

**Una descripción dice cuándo usar el activo, no qué hace.**

```
Bien:  "Generar y aplicar una migración de esquema. Solo con pedido explícito."
Mal:   "Genera y aplica una migración de esquema en el orden obligatorio: ver
        estado, aplicar pendientes, generar, revisar, aplicar, reportar. Incluye
        la compatibilidad con la ventana de despliegue y por qué un renombre
        generado como borrar y crear pierde todos los datos."
```

Lo segundo no está mal escrito — está en el lugar equivocado. Todo eso vive en el cuerpo del procedimiento, que se carga **solo cuando se invoca**. En la descripción es peso muerto que se paga siempre.

Y hay un efecto secundario que sorprende: recortarlas **mejora** la elección. El modelo distingue mejor entre disparadores cortos y claros que entre párrafos que se parecen entre sí.

Recortar las 32 descripciones de esta base bajó el costo fijo de unos 1.975 a unos 565 tokens por sesión.

### 2. El mapa del sistema

`CLAUDE.md` y `AGENTS.md` se cargan solos, siempre. Lo que no cambia el comportamiento del agente no necesita estar ahí: un párrafo explicando la historia del proyecto se paga en cada tarea y no altera ninguna decisión.

### 3. El contexto del proyecto

`ai/local/` — el brief, el glosario, las reglas de negocio, los datos sensibles. Es el que más crece y el que nadie mira crecer: cada persona que agrega un párrafo lo agrega para siempre y para todas las sesiones.

Lo que ya está en el código o en un ticket no hace falta repetirlo. Lo que sí va: lo que un agente no puede deducir leyendo el repositorio.

---

## Ajustar el presupuesto

```json
{
  "contextBudget": {
    "descriptions": 4000,
    "systemMap": 8000,
    "local": 12000
  }
}
```

En bytes, en `ai-workspace.json`. Los valores por defecto buscan que el costo fijo de una sesión no pase de unos pocos miles de tokens.

---

## Lo que ya no se paga dos veces

Dos decisiones del diseño que existen por lo mismo:

**El orquestador de revisión corre los gates una sola vez.** Sin él, cada agente los correría por su cuenta: el mismo barrido determinista repetido tres veces, pagado con tokens de razonamiento en cada uno. Corriéndolo una vez —gratis, es un script— y pasándoles el resultado, cada agente gasta tokens solo en lo que ningún script puede decidir.

**El hook de escritura recuerda lo que ya verificó.** Un agente edita el mismo archivo varias veces por tarea: corrige, agrega, deshace. El caché guarda el resultado de cada gate por hash del **contenido**, así que un archivo que vuelve a un estado ya verificado no se vuelve a analizar. Se guarda en `.ai-gates-cache.json`, es local y se regenera solo.

---

## La regla de fondo

Una regla escrita en prosa consume tokens en cada corrida y se cumple mientras quede atención disponible. Un script cuesta cero y no se puede saltear.

Cada vez que una instrucción del sistema se puede convertir en una verificación, conviene hacerlo: se ahorra el texto **y** se gana la garantía. `verify-findings.js` nació exactamente así — era un párrafo pidiéndole al orquestador que descartara los hallazgos que citan líneas inexistentes.
