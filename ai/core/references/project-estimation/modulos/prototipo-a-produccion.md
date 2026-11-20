# Módulo: prototipo a producción

**Aplica cuando** existe algo que "ya funciona" (demo, MVP, prototipo con datos
de prueba) y se pide llevarlo a un sistema operable por usuarios reales.

**El error típico**: medir el trabajo por lo que se ve. Un prototipo muestra
pantallas; el costo de producción está en lo que no se ve — persistencia real,
seguridad, errores, despliegue, operación.

## Evidencia a relevar

- El prototipo mismo: qué corre de verdad y qué está simulado o con datos fijos.
- Dónde vive hoy el estado (base, almacenamiento del navegador, memoria).
- Si hay backend propio o el cliente habla directo con un servicio de datos.
- Autenticación y permisos: reales, de mentira o inexistentes.
- Pantallas y flujos: cuáles están terminados y cuáles solo dibujados.
- Requisitos no funcionales: cantidad de usuarios, disponibilidad, datos sensibles.

## Frentes típicos de la WBS

Modelo de datos definitivo y migración desde los datos de prueba · backend o
capa de acceso · autenticación y autorización · validación y manejo de errores
· pantallas pendientes y ajustes de las hechas · pruebas · entornos y despliegue
· observabilidad · datos iniciales y migración · documentación operativa · gestión.

## Riesgos típicos

- Decisiones del prototipo que hay que rehacer (esquema, seguridad) y que nadie
  dimensionó.
- Reglas de negocio que viven solo en la cabeza de quien pidió el prototipo.
- Datos reales con formas que el prototipo nunca vio.

## Decisiones que suelen faltar

Qué se reescribe y qué se conserva · quién opera el sistema después ·
requisitos de seguridad y cumplimiento · fecha límite y si es fija.

## No asumir

Que el prototipo se "endurece" en vez de rehacerse parcialmente · que la
seguridad ya está resuelta porque hay pantalla de login · que existe un entorno
de producción.
