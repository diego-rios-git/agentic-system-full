# Formato de salida de las estimaciones

Vale para `task-estimation` y `project-estimation`.

## Regla

- **Por defecto, Markdown (`.md`).**
- **PDF (`.pdf`) solo si la persona lo pide** en el pedido ("en PDF", "quiero
  un pdf para enviar"). No se genera PDF por iniciativa propia, ni "por si
  acaso" junto al `.md`.
- Un pedido ambiguo ("para mandarle al cliente") no es un pedido de PDF: se
  entrega el `.md` y se ofrece el PDF en una línea.
- El formato también puede fijarse por proyecto con `project.estimation.format`
  (`md` o `pdf`) en `ai-workspace.json`; un pedido explícito en la conversación
  gana sobre esa configuración.

## Cómo se produce el PDF

1. Se escribe **siempre el `.md` primero**, con la plantilla del procedimiento.
   Es la fuente: el PDF es una conversión de ese mismo contenido, nunca una
   versión reescrita, y ninguna cifra puede existir solo en el PDF.
2. Se convierte con la herramienta de PDF disponible en el entorno (una skill
   de PDF del harness, `pandoc`, o similar). El PDF queda junto al `.md`, con el
   mismo nombre y extensión `.pdf`.
3. Se revisa el resultado: las tablas y el rango total tienen que verse
   completos. Una tabla cortada en el PDF es un fallo.
4. **Si no hay ninguna herramienta que convierta**, no se improvisa ni se
   afirma que se generó: se entrega el `.md`, se dice que el PDF no se pudo
   producir y por qué. Nunca reportar un PDF que no existe.

## Qué se dice en el chat

Las rutas de lo generado (`.md`, y `.pdf` si se pidió y salió) y, para
`project-estimation`, lo que ya pide su paso de entrega. Nada más.
