# Project Estimation

Estima un **proyecto o frente de trabajo** (no un ticket suelto) y entrega una
estimación **defendible**: se sabe qué cubre, qué no cubre, con qué evidencia se
calculó y qué debe cambiar si aparece información nueva. El objetivo no es "la
estimación correcta" — es poder sostener el número frente a quien lo paga.

Genérico y agnóstico de stack. Lo que cambia entre tipos de proyecto vive en
los **módulos** (`ai/core/references/project-estimation/modulos/`); este
archivo solo trae el flujo y las reglas comunes.

Para estimar **un requisito individual** con el motor determinista
(complejidad 1-10, horas por capa, QA en 3 niveles) usar `task-estimation`.
Este procedimiento lo invoca desde el módulo `funcionalidad-especifica`; no lo
reemplaza ni lo duplica.

---

## Reglas — no negociables

1. **Nunca una sola cifra.** Todo total va como rango (mínimo / probable /
   máximo) con sus supuestos al lado.
2. **Esfuerzo ≠ plazo.** Las horas son trabajo; las semanas son calendario. El
   plazo sale del camino crítico, la cantidad de personas y sus horas
   productivas — nunca de dividir horas por 40.
3. **La IA no justifica una reducción grande por sí sola.** Cualquier ajuste
   por IA va como **línea separada y visible**, con la evidencia que lo
   respalda (proyecto anterior medido, tipo de tarea). Sin evidencia, el
   ajuste no pasa de −15% y se marca como supuesto. Las horas base de la WBS
   se estiman **sin** ese ajuste.
4. **Cada frente tiene responsable.** QA, DevOps/infraestructura y gestión son
   frentes con dueño explícito. Si nadie los tiene asignado, es una decisión
   abierta (paso 7), no un costo que desaparece.
5. **Lo que falta es riesgo, no supuesto.** Información faltante se registra
   como riesgo con su efecto sobre el rango. Está prohibido rellenarla con un
   valor "razonable" para que el número cierre.
6. **Trazabilidad total.** Cada hora pertenece a un ID de la WBS. La suma de la
   WBS es el total, sin horas sueltas; contingencia y ajuste por IA son líneas
   propias, nunca escondidas dentro de una tarea.

---

## Pasos

### 1. Clasificar el pedido

Elegir **un** tipo principal (o varios, si el pedido los combina — uno por
frente). Cada tipo tiene un módulo:

| Tipo | Módulo (ruta) |
|---|---|
| Prototipo que hay que llevar a producción | `ai/core/references/project-estimation/modulos/prototipo-a-produccion.md` |
| Una funcionalidad específica | `ai/core/references/project-estimation/modulos/funcionalidad-especifica.md` |
| QA y automatización de pruebas | `ai/core/references/project-estimation/modulos/qa-y-automatizacion.md` |
| Infraestructura, despliegue, DevOps | `ai/core/references/project-estimation/modulos/infra-y-devops.md` |
| Integración con sistemas externos | `ai/core/references/project-estimation/modulos/integraciones-externas.md` |
| Mantenimiento, soporte, evolutivos | `ai/core/references/project-estimation/modulos/soporte-y-evolutivos.md` |

Un proyecto completo desde cero no tiene módulo propio: se descompone en
frentes y cada frente usa el módulo que le corresponde. Si nada encaja, decirlo
y trabajar solo con el núcleo — no forzar un módulo.

### 2. Relevar evidencia

Leer el módulo elegido: lista qué pedir y qué mirar. Recorrer el repositorio,
documentación, prototipos, flujos, APIs, restricciones y el equipo disponible.
Registrar cada fuente realmente leída (ruta o documento). Lo que el módulo pide
y **no** se encontró va a la lista de faltantes del paso 6.

### 3. Armar la WBS

Usar `ai/core/references/project-estimation/wbs.md`. Cada fila: ID, tarea,
entregable, dependencia, responsable (rol), y horas mín/prob/máx.
QA, DevOps y gestión son filas, con dueño.

### 4. Estimar por escenarios, esfuerzo y plazo por separado

- Horas mín / probable / máx por tarea. El mínimo es "sin fricción", el máximo
  es "lo que razonablemente puede salir mal", no el desastre.
- Total de esfuerzo = suma de cada columna. No promediar ni "PERT-izar" en
  silencio; si se usa otra fórmula, declararla.
- **Plazo aparte**: camino crítico según dependencias, personas asignadas y
  horas productivas por persona por semana (declarar el valor usado; default
  30 h/semana con dedicación completa). Mostrar plazo mín/prob/máx también.
- Para funcionalidades sueltas dentro de la WBS, se puede usar
  `task-estimation` como fuente de las horas y citar su archivo.
- **Si el frente ya tiene fichas de requisito** (las de `redactar-requisito`
  o del pack `analisis-funcional`): cada ficha es una tarea de la WBS y sus
  horas salen de `task-estimation` sobre esa ficha: su mín/medio/máx de
  desarrollo van a las columnas Mín/Prob/Máx de la tarea, y su QA va a una
  fila `QA.n` con el nivel elegido, dicho en la fila. Las *Decisiones
  abiertas* ya subieron el máximo de esa tarea: en el registro de riesgos
  van sin horas propias, y solo cuentan para fijar la confianza. El orden y
  el camino crítico salen de las *Dependencias* de cada ficha; si el
  proyecto instaló el pack, de `catalogo-y-camino-critico`.

### 5. Riesgos, contingencia, exclusiones, confianza

- **Registro de riesgos**: cada riesgo con probabilidad, impacto sobre qué
  escenario y, si aplica, qué tarea de la WBS afecta.
- **Contingencia** como línea propia sobre el probable, según confianza:

  | Confianza | Cuándo | Contingencia |
  |---|---|---|
  | Alta | Evidencia leída completa, alcance cerrado, sin faltantes bloqueantes | 10% |
  | Media | Evidencia parcial o algún faltante importante | 20% |
  | Baja | Faltantes bloqueantes, alcance abierto o sin evidencia del código | 35% |

  Son defaults: un proyecto puede declarar otros, siempre explícitos en el
  informe.
- **Exclusiones**: lo que *no* está cubierto, escrito en positivo ("no incluye
  X"). Una exclusión no declarada es una discusión futura.
- **Confianza**: nivel + la razón en una línea. Nunca sin razón.

### 6. Faltantes y decisiones

Dos listas separadas:
- **Información faltante** (regla 5): qué no se sabe y cuánto ensancha el
  rango si resulta de un lado o del otro.
- **Decisiones necesarias para cerrar el presupuesto**: cada una con quién la
  toma, y qué cambia en el número según la respuesta.

### 7. Verificar antes de entregar

- [ ] Ningún total es una cifra sola; todos tienen rango y supuestos.
- [ ] Esfuerzo y plazo están en secciones distintas y el plazo sale del camino crítico.
- [ ] Todo ajuste por IA es una línea aparte, con evidencia o marcado como supuesto (≤ −15%).
- [ ] QA, DevOps y gestión tienen responsable, o figuran como decisión abierta.
- [ ] Ningún faltante se rellenó con un valor inventado.
- [ ] La suma de la WBS coincide con el total; ninguna hora sin ID; contingencia y ajuste IA no están dentro de tareas.
- [ ] Hay exclusiones, nivel de confianza con razón, y disparadores de re-estimación.

### 8. Entregar el informe comercial

Escribir el informe con `ai/core/references/project-estimation/informe.md`, en
el directorio de estimaciones del proyecto (`project.estimation.outputDir`, por
defecto `estimations/`) como `<nombre-proyecto>-estimacion.md`. Si ya existe,
preguntar si sobreescribir o versionar.

**Formato**: `.md` por defecto; `.pdf` solo si la persona lo pide. Reglas de
conversión y qué hacer si no se puede en
`ai/core/references/estimation-output-format.md`.

El informe es el entregable. En el chat: la ruta, el rango total, el nivel de
confianza y las decisiones que bloquean el cierre — nada más.

---

## Guardrails

- **NUNCA** entregar un total sin rango ni supuestos.
- **NUNCA** convertir horas en semanas dividiendo por la jornada; el plazo sale del camino crítico.
- **NUNCA** bajar horas "porque hay IA" sin línea propia y sin evidencia.
- **NUNCA** dejar QA, DevOps o gestión sin responsable ni sin fila en la WBS.
- **NUNCA** completar información faltante con un supuesto silencioso.
- **NUNCA** esconder contingencia dentro de las horas de una tarea.
- **NUNCA** presentar la estimación como definitiva: siempre incluir qué información nueva la cambia.
- **NUNCA** inventar evidencia: si no se leyó, no se cita.
- **NUNCA** generar PDF sin que se pida, ni reportar un PDF que no se pudo producir.
