# Plantilla del informe comercial

Estructura del entregable. El orden importa: quien decide lee primero el rango
y lo que falta, y el detalle queda debajo, a mano, para justificar cada número.

```markdown
# Estimación — <Proyecto>

**Fecha**: <fecha> · **Tipo**: <tipo/s del paso 1> · **Versión**: <v1>

## Resumen

- **Esfuerzo**: mín X h · probable Y h · máx Z h (con contingencia: Y' h)
- **Plazo**: mín A · prob B · máx C semanas calendario, con <n> personas
- **Confianza**: <Alta|Media|Baja> — <razón en una línea>
- **Para cerrar el presupuesto hace falta decidir**: <las decisiones bloqueantes, una línea cada una>

## Alcance

**Incluye**: <lista>
**No incluye**: <lista de exclusiones, en positivo: "no incluye X">

## Evidencia relevada

| Fuente | Qué se leyó | Qué respalda |
|---|---|---|
| <ruta o documento> | <sección> | <tareas o supuestos que se apoyan en esto> |

## Supuestos

<Cada supuesto con su efecto: "Si X no se cumple, el frente F sube de Y a Z h".>

## WBS y esfuerzo

<Tabla de wbs.md completa, con subtotal, contingencia, ajuste por IA y total.>

## Plazo

<Tabla de plazo de wbs.md: camino crítico, personas, horas productivas y qué no cuenta.>

## Riesgos

| Riesgo | Prob. | Impacto (qué escenario y cuánto) | Tarea afectada | Respuesta |
|---|---|---|---|---|

## Información faltante

| Qué falta | Quién puede aportarla | Efecto en el rango |
|---|---|---|

## Decisiones necesarias

| Decisión | La toma | Si la respuesta es A | Si la respuesta es B |
|---|---|---|---|

## Qué cambia esta estimación

<Disparadores de re-estimación: qué información nueva o cambio de alcance obliga a recalcular, y qué tramos toca.>
```

## Cómo escribirlo

- El resumen entra en una pantalla. Todo número del resumen se puede rastrear a
  una tabla de más abajo.
- Cada supuesto y cada faltante tiene efecto cuantificado. "Puede variar" sin
  cifra no cuenta.
- Ningún total aparece sin rango; ninguna sección de esfuerzo mezcla semanas.
- Si el lector solo pudiera leer el resumen, no debería llevarse una cifra
  única ni una promesa de plazo sin su condición.
