# Módulo: funcionalidad específica

**Aplica cuando** el pedido es una funcionalidad acotada dentro de un sistema
que ya existe: un módulo, un flujo, un reporte, una pantalla con su lógica.

**Motor de cálculo**: para cada requisito con documento propio, usar el
procedimiento `task-estimation` (complejidad 1-10, horas por capa, QA en 3
niveles) y traer sus horas a la WBS citando el archivo generado. Este módulo
agrega lo que ese motor no mira: el encaje con el resto del sistema.

## Evidencia a relevar

- El requisito completo, con criterios de aceptación si existen.
- El código vecino: dónde se enchufa, qué reutiliza, qué toca.
- Contratos existentes que hay que respetar (APIs, esquemas, eventos).
- Pantallas o flujos parecidos ya hechos, para calibrar.
- Estado de las pruebas en la zona que se va a tocar.

## Frentes típicos de la WBS

Análisis y diseño · backend · frontend · cambios de esquema · integración con
lo existente · pruebas nuevas y de regresión · documentación · revisión.

## Riesgos típicos

- Zona del código sin pruebas o muy acoplada (el costo real es el
  refactor previo, que hay que separar como tarea propia).
- Requisito que en realidad son varios y conviene separarlos.
- Dependencia con otro equipo o con una funcionalidad aún no terminada.

## Decisiones que suelen faltar

Criterio de aceptación exacto · qué pasa con los datos existentes · si va
detrás de una bandera de activación · quién valida con el negocio.

## No asumir

Que el código vecino está bien hecho por no haberlo leído · que "es una
pantalla más" sin ver qué lógica arrastra.
