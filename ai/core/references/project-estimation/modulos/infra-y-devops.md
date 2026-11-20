# Módulo: infraestructura y DevOps

**Aplica cuando** el pedido incluye entornos, despliegue, redes, contenedores,
pipelines, monitoreo, respaldos o migración de un servidor a otro.

**Regla propia de este módulo**: es el frente que más suele quedar sin dueño.
Si no hay una persona con experiencia real en esta infraestructura, no se
estima como si la hubiera: se marca el faltante, se ensancha el rango y se
propone quién lo cubre (ver decisiones).

## Evidencia a relevar

- Dónde corre hoy cada pieza (proveedor, máquina, red) y quién la administra.
- Cómo se despliega hoy: a mano, con script, con pipeline.
- Requisitos de disponibilidad, respaldo, recuperación y seguridad.
- Accesos disponibles (sin ellos, parte del trabajo es no verificable).
- Costos de infraestructura recurrentes, que no son parte del esfuerzo.

## Frentes típicos de la WBS

Relevamiento de lo existente · definición de entornos · provisión y
configuración · pipeline de integración y despliegue · secretos y accesos ·
respaldos y restauración probada · monitoreo y alertas · migración y corte ·
documentación operativa (runbook) · traspaso.

## Riesgos típicos

- Infraestructura existente sin documentar: el relevamiento es trabajo real.
- Falta de acceso o permisos, que frena todo lo demás.
- Corte con datos vivos: ventana de mantenimiento y plan de vuelta atrás.
- Costo recurrente que el cliente no tenía presupuestado.

## Decisiones que suelen faltar

Proveedor y quién paga la infraestructura · quién opera después del traspaso ·
ventana de corte aceptable · nivel de disponibilidad exigido.

## No asumir

Que existe un entorno de pruebas equivalente al de producción · que los
respaldos funcionan porque existen · que el equipo de desarrollo puede operar
lo que construye sin capacitación.
