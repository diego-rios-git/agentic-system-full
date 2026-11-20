# Plantilla de un cambio sobre un requisito

La usa `cambio-de-requisito`. Las secciones que no aplican dicen "No aplica para este cambio" y por qué; no se borran.

```markdown
---
tipo: cambio
requisito: <id del requisito>
cambio: CHG-<id>-NN
version: 1.0
estado: propuesto
actualizado: <AAAA-MM-DD>
---

# CHG-<id>-NN — <cambio en pocas palabras>

- **Requisito:** <id> — <título>
- **Ficha base:** versión <X>, `<ruta>`, commit `<hash corto>`
- **Objetivo:** <de dónde sale lo que se pide: documento, decisión, versión nueva>
- **Lugares afectados de la base:** <R3, flujo "…", escenario "…">
- **Estado:** propuesto | aprobado | bloqueado por decisión

## 1. Propósito y límite

**Qué problema resuelve:**

**Incluye:**

**No incluye:**

## 2. Lo que se conserva

| Lugar en la base | Comportamiento que se conserva | Cómo se verifica que sigue igual |
|---|---|---|

> Este documento cambia solo los `CHG` de la sección 3. Para todo lo demás manda la ficha base.

## 3. Las diferencias

### CHG-<id>-NN.1 — <nombre>

- **Tipo:** ADD | MODIFY | RETIRE | CLARIFY | NO CHANGE
- **Estado:** aprobado | propuesto | falta confirmado | decisión pendiente | fuera de alcance
- **Dónde:** <REEMPLAZA R3 | AGREGA DESPUÉS DE R5 | RETIRA el escenario "…">
- **Dueño:** <requisito dueño del comportamiento>

**Antes:** <lo mínimo de la base para que no haya ambigüedad>

**Después:** <el comportamiento completo que lo reemplaza, observable>

**Se conserva:** <lo que no cambia de esto>

**Fuente:** <documento, decisión y fecha>

**Qué cambia para quien lo usa:**

**Transición:** <qué pasa con lo que ya existe: datos, operaciones en curso>

## 4. Otros requisitos afectados

| CHG | Requisito | Rol (produce / es dueño / consume) | Qué cambia para él | Qué no cambia |
|---|---|---|---|---|

## 5. Alcance de la implementación

| CHG | Dónde (frontend / backend / datos / configuración / integración / pruebas) | Qué tiene que quedar | Qué hay hoy | Tratamiento |
|---|---|---|---|---|
|  |  |  | reutilizable / parcial / falta / sin revisar | confirmado / propuesto / pendiente |

No entra trabajo que no esté mapeado a un `CHG` de la sección 3.

## 6. Escenarios del cambio

#### Escenario: CA-CHG-01 — <nombre>
Verifica CHG-<id>-NN.1.
- **DADO** …
- **CUANDO** …
- **ENTONCES** …

#### Escenario: CA-NR-01 — sigue igual: <comportamiento>
Verifica que no cambia <lugar de la base>.
- **DADO** …
- **CUANDO** …
- **ENTONCES** …

## 7. Auditoría y seguridad

| CHG | Evidencia que tiene que quedar | Datos que no pueden aparecer | Quién la consulta |
|---|---|---|---|

## 8. Decisiones, riesgos y vuelta atrás

| Id | Tipo (decisión / riesgo / falta) | Qué es e impacto | Recomendación o condición | Dueño | Estado |
|---|---|---|---|---|---|

**Cómo se despliega y cómo se vuelve atrás:** <requisito o decisión técnica; no se afirma que existe si no se vio>

## 9. Trazabilidad

| CHG | Fuente | Lugar en la base | Change o tarea | Escenarios | Estado |
|---|---|---|---|---|---|

## 10. Control

- [ ] La ficha base, su versión, su commit y los lugares afectados están identificados.
- [ ] Cada `CHG` tiene tipo, estado, antes y después, fuente, dueño y lo que se conserva.
- [ ] No se reescribió la ficha completa ni se cambió nada que no esté declarado.
- [ ] Todo el trabajo de implementación está mapeado a un `CHG`.
- [ ] Regla funcional, evidencia de código, faltante y decisión pendiente están separados.
- [ ] Los escenarios cubren el cambio, los negativos, los límites y la no regresión.
- [ ] Están los requisitos afectados y los que explícitamente no.
- [ ] Sin secretos, datos personales ni hosts privados.
```
