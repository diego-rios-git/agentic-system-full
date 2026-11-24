# Registro de candidatos a gate

Errores reales ya confirmados y qué se hizo con cada uno: si ya son una verificación automática, si se está estudiando cómo, o por qué **no** se pudo automatizar. Cada entrada es una deuda del sistema de control, no del código.

Un candidato descartado **con motivo** vale tanto como uno implementado: dice qué haría falta para poder automatizarlo, y la próxima persona no repite el análisis. Por eso los descartados no se borran. Uno descartado sin motivo es una nota inútil.

Procedimiento para convertir uno en gate: `ai/core/procedures/gate-from-finding.md`.

**Este archivo se lintea** (`node scripts/check-gate-candidates.js`): cada entrada tiene un estado válido, los ⛔ dicen el motivo y los ✅ apuntan a un gate o regla que existe. Un registro que se degrada miente: dice que un error está cubierto cuando la regla ya se renombró.

---

## Estados

El primer carácter del encabezado de cada entrada.

| Estado | Significado | Qué exige el lint |
|---|---|---|
| 🟡 Candidato | Parece automatizable, sin verificar todavía | — |
| 🔵 Analizado | Se estudió cómo hacerlo; falta escribir la regla | — |
| ⛔ Descartado | No se puede automatizar hoy | `**Por qué no es gate**:` con el motivo concreto |
| ✅ Implementado | Ya es un gate; queda como registro de que el bucle funcionó | `**Gate**:` con el id de la regla, del gate, del hook, o una ruta que exista |

---

## Formato

Una entrada por candidato, bajo `## Candidatos`:

```markdown
### ⛔ <título corto del error>

- **Cuándo apareció**: revisión, QA, producción, corrección manual
- **Por qué no es gate**: el motivo concreto — requiere ejecutar el código,
  requiere estado de base de datos, es un caso único, la regla daría demasiados
  falsos positivos
- **Qué haría falta**: qué tendría que cambiar para poder automatizarlo
- **Mitigación actual**: test, procedimiento, revisión humana
```

```markdown
### ✅ <título corto del error>

- **Cuándo apareció**: …
- **Gate**: `ID-DE-LA-REGLA` (y, si hace falta, la ruta de un script que exista)
```

---

## Candidatos

_Todavía no hay ninguno. Este archivo se llena a medida que el proyecto encuentra errores reales._
