# Plantilla: documento de una funcionalidad ODD

Copiar lo que está entre las líneas a `odd/tasks/<funcionalidad>.md` y reemplazar los `<...>`. Las reglas de cada sección están en `odd-documento`.

---

```markdown
# <Funcionalidad, en pocas palabras>
Objetivo: <qué resultado espera quien lo pidió> · Rama: `<rama>` · Tests: `<repos[].testCommand, o "no declarado">`
rf: <RF-x.yy, o ninguno>

## Specs
S1. <Título corto del comportamiento>: "<las palabras de la persona, textuales>"
  - Acepta: <criterio observable: salida, código, dato guardado>
  - Check: <comando o prueba que lo demuestra>
S2. <Título corto>: "<textual>"
  - Acepta: <...>
S3. <Título corto> (supuesto): <lo que se asumió y por qué; se confirma o se cae>

## Tasks
- [ ] T1 (S1) directa · <qué hace>
- [ ] T2 (S2-S3) directa · <qué hace>

## Log
L1 <AAAA-MM-DD> pedido (textual): > <el pedido original, sin tocar>
L2 <AAAA-MM-DD> exploración: <qué se leyó, qué se encontró, `ruta:línea`>. Tamaño: grande porque <qué falla de la prueba de retomar>.
```

---

## Ejemplo lleno

```markdown
# Límite diario de transferencias
Objetivo: que nadie transfiera más de su límite diario · Rama: `feat/ABC-210-limite-diario` · Tests: `npm test`
rf: RF-3.04

## Specs
S1. Rechaza lo que supera el límite del día: "si ya mandé 90 mil y el límite es 100 mil, una de 20 mil me la tiene que rechazar con 'Superaste tu límite diario'"
  - Acepta: 422, el mensaje exacto, y el saldo y el acumulado del día sin cambios
S2. El límite se reinicia a la medianoche de Argentina: "el límite es por día, no por operación"
  - Acepta: una transferencia a las 00:01 (UTC-3) no suma lo del día anterior
S3. Transferir sin límite configurado sigue igual (supuesto): las cuentas sin límite no tienen tope

## Tasks
- [x] T1 (S1) directa · validación del acumulado + tests · RED→GREEN · 4f2a9c1
- [ ] T2 (S2) directa · corte del día con zona horaria · Riesgo: ítem 6 si no hay test de borde

## Log
L1 2026-11-03 pedido (textual): > quiero que las transferencias tengan un límite y que si te pasás te avise
L2 2026-11-03 exploración: `transfers.service.ts:88` valida solo el saldo. No hay acumulado diario. Tamaño: grande, la zona horaria espera la confirmación del cliente.
L3 2026-11-04 corrección (textual): > el límite es por día, no por operación
L4 2026-11-04 S2 reescrita; T2 reabierta. T1 sigue valiendo.
L5 2026-11-04 T1: RED `rechaza lo que supera el límite del día` (esperaba 422, vino 201). GREEN, suite 48 ok. Riesgo: ninguno.
```
