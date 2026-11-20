# Módulo: integraciones externas

**Aplica cuando** el sistema tiene que leer o escribir en otro sistema que no
controlamos: una API de terceros, un servicio de pago, un ERP, un proveedor de
identidad, un intercambio de archivos.

**Idea central**: el esfuerzo de una integración no lo fija nuestro código sino
el otro lado — su documentación, su estabilidad, sus tiempos de respuesta a
consultas y su ambiente de pruebas.

## Evidencia a relevar

- Documentación oficial de la API o del formato, con versión.
- Si hay entorno de pruebas (sandbox) y cómo se obtienen credenciales.
- Límites: frecuencia de llamadas, tamaños, ventanas de mantenimiento.
- Modelo de errores del otro lado y qué garantías da (reintentos, idempotencia).
- Contacto técnico del proveedor y su tiempo de respuesta esperable.
- Costos por uso o licencias asociadas.

## Frentes típicos de la WBS

Análisis del contrato de la integración · credenciales y entorno de pruebas ·
cliente de la API y traducción de datos · manejo de fallos y reintentos ·
sincronización o conciliación · pruebas contra el sandbox · pasaje a
producción con credenciales reales · monitoreo de la integración · documentación.

## Riesgos típicos

- Documentación incompleta o distinta del comportamiento real.
- Sandbox que no representa a producción.
- Tiempos de espera del proveedor (accesos, certificación, aprobaciones) que
  agregan plazo aunque no agreguen esfuerzo.
- Cambios de versión del otro lado durante el proyecto.

## Decisiones que suelen faltar

Qué sistema es la fuente de verdad · qué pasa cuando el otro lado está caído ·
quién gestiona la relación con el proveedor · costo por uso a cargo de quién.

## No asumir

Que el sandbox se comporta como producción · que el proveedor responde en
días · que la API documentada es la que está desplegada.
