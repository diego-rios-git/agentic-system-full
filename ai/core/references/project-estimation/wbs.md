# Plantilla de WBS

Una fila por tarea. Las horas son **esfuerzo** (trabajo), no calendario, y se
estiman **sin** ajuste por IA ni contingencia — esos son líneas aparte al pie.

| ID | Frente | Tarea | Entregable | Depende de | Responsable (rol) | Mín h | Prob h | Máx h |
|---|---|---|---|---|---|---|---|---|
| 1.1 | <frente> | <qué se hace> | <qué queda hecho y verificable> | — | <rol> | | | |
| 1.2 | | | | 1.1 | | | | |
| QA.1 | Calidad | <pruebas de…> | <plan/suite/informe> | 1.x | <rol de QA> | | | |
| OPS.1 | Infra/DevOps | <entornos, despliegue…> | <pipeline/entorno> | — | <rol de DevOps> | | | |
| GES.1 | Gestión | <coordinación, reuniones, seguimiento> | <informes de avance> | — | <rol de gestión> | | | |
| | | **Subtotal WBS** | | | | | | |

Líneas al pie (nunca dentro de una tarea):

| Línea | Base de cálculo | Mín h | Prob h | Máx h |
|---|---|---|---|---|
| Contingencia | % por confianza sobre el probable | — | | — |
| Ajuste por IA | evidencia citada, o supuesto ≤ −15% | | | |
| **Total** | | | | |

## Reglas de la tabla

- **Frente** agrupa tareas (un módulo, una capa, una integración). Todo frente
  tiene al menos una tarea con responsable.
- **Responsable** es un rol (dev backend, QA, DevOps, PM), y una persona si ya
  está definida. `sin asignar` es válido solo si además figura en las
  decisiones abiertas del informe.
- **Entregable** debe poder verificarse: si no se puede decir cómo se sabe que
  está hecho, la tarea aún no está bien definida.
- **Depende de** alimenta el camino crítico del plazo. Sin dependencias
  declaradas no se puede calcular el plazo — se marca como faltante.
- Mín ≤ Prob ≤ Máx en cada fila. Una tarea con los tres valores iguales
  declara certeza total: revisarla.

## Plazo (aparte del esfuerzo)

| Dato | Valor |
|---|---|
| Camino crítico (IDs) | <cadena de tareas dependientes> |
| Personas asignadas al camino | <n> |
| Horas productivas / persona / semana | <valor usado; default 30> |
| Plazo mín / prob / máx (semanas calendario) | |
| Qué no está contando | <vacaciones, feriados, esperas del cliente…> |
