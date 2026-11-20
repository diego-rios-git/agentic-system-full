# Módulo: QA y automatización

**Aplica cuando** el pedido es verificar un sistema (manual o automatizado),
armar una suite de pruebas o subir la cobertura de algo existente.

**Distinción que hay que hacer explícita**: probar lo nuevo, regresión de lo
viejo y automatizar son tres trabajos distintos con costos distintos. Un
pedido de "QA" casi nunca aclara cuál.

## Evidencia a relevar

- Qué pruebas existen hoy, cuánto tardan y si están en verde.
- Criterios de aceptación o comportamientos esperados por escrito.
- Herramientas ya usadas en el proyecto para pruebas.
- Entornos disponibles para probar y si tienen datos representativos.
- Quién hace QA hoy y con qué dedicación.

## Frentes típicos de la WBS

Estrategia y plan de pruebas · preparación de datos y entornos · casos manuales
· automatización por capa (unitaria, integración, extremo a extremo) · ejecución
y reporte de defectos · ciclos de corrección y reverificación · mantenimiento de
la suite · integración con el pipeline.

## Riesgos típicos

- Sin criterios de aceptación no hay contra qué probar: el faltante ensancha
  el rango, no se inventa el criterio.
- Pruebas automáticas inestables que consumen más de lo que ahorran.
- Los ciclos de corrección dependen del desarrollo, no del QA.

## Decisiones que suelen faltar

Nivel de cobertura buscado · qué se automatiza y qué queda manual · quién
corrige los defectos y en cuánto tiempo · criterio de salida (qué significa
"listo para producción").

## No asumir

Que la persona de QA es la misma que desarrolla · que los ciclos de corrección
están incluidos en el precio del QA · que automatizar es una inversión de una
sola vez.
