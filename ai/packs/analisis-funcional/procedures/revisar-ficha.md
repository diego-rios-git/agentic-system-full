# Revisar una ficha

Una revisión crítica e independiente de una o varias fichas de requisito, para saber si están listas para estimar, proponer o implementar. **No resume, no reescribe, no aprueba por defecto y no corrige en silencio:** encuentra lo que impide una implementación determinista, segura y verificable, con evidencia, y lo deja como preguntas para quien decide.

Antes de empezar, `metodo-analista` (`ai/packs/analisis-funcional/procedures/metodo-analista.md`).

No sirve para escribir una ficha: eso es `ficha-desde-documento` o `redactar-requisito`. Si después de la revisión la persona pide corregir la ficha, es otro paso, con su pedido.

---

## Lo que no se negocia

1. **Evidencia primero.** Cada hallazgo cita el lugar exacto de la ficha (regla, flujo, escenario, tabla) o de la fuente.
2. **No inventar.** Una decisión que falta se reporta como pendiente; nunca se completa con "lo que suele hacerse".
3. **Hecho e inferencia, separados.** Lo que dice la ficha va por un lado; el riesgo que el revisor infiere, por otro.
4. **La prueba del determinismo.** Si dos personas competentes pueden implementar comportamientos distintos a partir de la ficha, es un hallazgo.
5. **Sin corrección silenciosa.** La ficha revisada no se toca.
6. **Severidad proporcional.** *Bloqueante* es solo lo que impide implementar de forma determinista, segura o verificable. Una mejora que no cambia el comportamiento no es bloqueante.

---

## 1. Alcance y fuentes

1. Leer **entera** la ficha y las fuentes de las que dice salir.
2. Leer las fichas de los requisitos vecinos que nombra y los que comparten actor o entidad.
3. Si hay repositorio y la ficha dice algo del código, mirarlo solo para lo que se afirma.
4. Clasificar cada fuente: principal, secundaria, no disponible o superada. Si una fuente cambió después de que se escribió la ficha (`git log`), se lee la versión nueva y se marca la diferencia.

Si una fuente no está disponible, se dice. **La falta de evidencia no se convierte en una nota baja sin explicar por qué.**

---

## 2. El barrido

Desde las miradas de análisis funcional, arquitectura, desarrollo, QA, seguridad y producto. Cada área se evalúa con evidencia, o se marca *No aplica* o *Sin evidencia*, con el porqué.

| Área | Qué se busca |
|---|---|
| Reglas | Palabras ambiguas, resultados que chocan, regla sin dueño, falta lo prohibido |
| Flujos y estados | Falta el disparador, una precondición, una transición, la cancelación, el resultado de una falla, el actor o la postcondición |
| Datos y configuración | Sin definir: obligatoriedad, formato, rango, unidad, redondeo, zona horaria, default, dueño |
| Escenarios | Subjetivos, no observables, sin condición inicial o sin resultado; flujos sin escenario |
| Integraciones | Falta el contrato, el error, la demora, el reintento, el duplicado |
| Seguridad y auditoría | Rol o alcance ambiguo, permiso que solo protege la UI, datos sensibles, auditoría sin datos mínimos |
| Interfaz | Faltan los estados de carga, vacío y error, la navegación, qué ve quien no tiene permiso |
| Concurrencia y persistencia | Faltan unicidad, duplicados, carreras, historial |
| Volumen y observabilidad | Sin volumen, paginación, límites ni métricas cuando hacen falta |
| Trazabilidad | Objetivo, alcance, reglas, escenarios y dependencias que no coinciden entre sí |
| Precisión | Un cálculo sin fórmula, frontera o tabla dentro/límite/fuera; una configuración sin default ni dueño; una señal sin productor ni deduplicación (`ai/core/references/requisitos/contenido-por-seccion.md`) |

---

## 3. Duplicación y fronteras

Obligatorio, aunque la conclusión sea que no hay nada.

1. Listar las fichas relacionadas.
2. Compararlas por objetivo, actor, entidad, disparador, acción, estado, resultado, pantalla y dueño. **Un nombre parecido no es un duplicado.**
3. Clasificar cada par en una sola de: *duplicación dentro del mismo módulo*, *duplicación entre módulos*, *reutilización legítima*, *dependencia transversal* o *sin solapamiento*.
4. Para una duplicación real: los dos documentos, qué se solapa, la evidencia de cada lado, el riesgo, quién debería ser el dueño y la pregunta para decidir.

**Nunca se ordena fusionar ni borrar una ficha por inferencia.** Se recomienda una decisión: consolidar, partir responsabilidades, definir el límite o confirmar la reutilización.

---

## 4. Los hallazgos

Uno por problema, numerados `REV-001`, `REV-002`…:

| Campo | Qué lleva |
|---|---|
| Prioridad | Bloqueante, Alta, Media o Baja |
| Categoría | Ambigüedad, Alcance, Reglas, Datos, Flujos, Escenarios, Seguridad, Integración, Interfaz, Concurrencia, Dependencia, Duplicación, Precisión |
| Qué pasa | El problema concreto, sin esconder una solución adentro |
| Evidencia | Cita corta y lugar exacto |
| Riesgo | Qué cuesta si no se resuelve: tiempo, calidad, seguridad, experiencia |
| Pregunta | Una sola, que se pueda contestar, sobre comportamiento observable |
| Decide | El rol que tiene que contestar |

Las preguntas: una decisión por pregunta, con actor, condición, acción y resultado, y sin sugerir la respuesta dentro de una pregunta marcada como pendiente.

---

## 5. El veredicto

- **¿Lista para implementar?** *Sí*, *Sí, con condiciones* (cuáles) o *No*.
- **Completitud**, de 0 a 100 %, con una frase de por qué.
- **Riesgo general**: muy bajo, bajo, medio, alto o crítico.
- Cantidad de hallazgos por prioridad y por categoría.
- Las decisiones pendientes, numeradas.
- Una recomendación que se siga de los hallazgos y no los contradiga.

Con *Sí* o *Sí, con condiciones*, la ficha se puede estimar: `task-estimation` por ficha y, para el total de un frente, `project-estimation` (`ai/core/procedures/`). La revisión no estima; con *No*, la estimación avisa antes de seguir.

---

## 6. El informe

```markdown
---
tipo: revision
requisito: <id, o varios separados por coma>
actualizado: <AAAA-MM-DD>
---

# Revisión — <id> — <título>

## 1. Alcance y fuentes revisadas
## 2. Límites de la evidencia
## 3. Resumen y veredicto
## 4. Hallazgos
## 5. Contradicciones
## 6. Duplicación y fronteras
## 7. Dependencias y riesgos técnicos
## 8. Calidad de los escenarios
## 9. Decisiones pendientes
## 10. Preguntas para quien decide
## 11. Trazabilidad
## 12. Control final
```

Se guarda en la carpeta de revisiones del proyecto (`analisis.md` de `ai/local/`; por defecto `<carpeta de fichas>/revisiones/`). **Sin `rf:` en el encabezado.** Si son varias fichas, un solo informe con ids únicos y un veredicto conjunto, salvo que pidan uno por ficha.

**Control final:**

- [ ] La ficha y las fuentes disponibles se leyeron enteras; los límites están dichos.
- [ ] Cada hallazgo tiene evidencia, riesgo, pregunta, quién decide y una prioridad proporcional.
- [ ] Cada contradicción cita los dos pasajes.
- [ ] La tabla de duplicación está, aunque diga que no hay nada.
- [ ] No se inventó comportamiento, contrato, default ni política.
- [ ] El veredicto, la completitud y la recomendación coinciden con los hallazgos.

---

## Cuando llega una ronda de preguntas de desarrollo

Si desarrollo o QA manda una lista de dudas, defectos o "preguntas antes de cerrar" sobre un requisito, es una revisión de cierre, antes de tocar la ficha:

1. Se guarda el documento como fuente.
2. Se separan tres cosas: la regla funcional aprobada, lo que afirma desarrollo, y lo que infiere el revisor. **Lo que se afirma del código, de la base o de producción no es un hecho hasta que se mira la fuente.**
3. Cada pregunta, una decisión independiente con su recomendación, para quien decide.
4. "El backend está completo" no es "el requisito está cerrado": si un caso necesita pantalla para operarlo y no la tiene, eso queda como condición para activarlo.
5. Las decisiones que se toman van al archivo de decisiones y, cuando la persona lo pide, a un cambio (`cambio-de-requisito`).
