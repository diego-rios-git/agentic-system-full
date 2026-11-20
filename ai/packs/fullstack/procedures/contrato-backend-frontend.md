# Contrato entre el repositorio que expone y el que consume

Guía para trabajar un cambio que cruza dos repositorios (típicamente un backend y un frontend) sin que el consumidor adivine lo que el proveedor expone.

Aplica a cualquier par de repositorios declarados en `ai-workspace.json`, con cualquier stack. No dice cómo se escribe un controlador ni un componente: eso lo dicen los procedimientos del pack de cada repositorio.

---

## El problema (los incidentes)

- **Desfase de estrictez.** El proveedor declaraba un campo como nulable; el esquema de validación del consumidor no lo admitía. El proveedor respondía 200 y el consumidor fallaba al validar la respuesta. Nadie lo vio leyendo el componente: había que comparar el esquema contra el contrato.
- **Compensar en el lado equivocado.** Un defecto del proveedor se "arregló" en el consumidor. Funcionó, escondió el defecto y lo duplicó en el próximo consumidor.
- **Cada endpoint pasó su prueba y la pantalla no cargaba** para ningún rol: dos endpoints con roles incompatibles. Nadie probó la pantalla.
- **El consumidor adivinó** lo que no estaba escrito, y adivinó mal.

---

## Cómo funciona

### Paso 1: identificar quién define el contrato

De `repos[]` en `ai-workspace.json`: el que expone (proveedor) y el que consume. Si hay más de un consumidor, el proveedor es uno solo.

Si el cambio no toca lo que el proveedor expone (solo lógica interna), **no hay contrato que cruzar**: trabajar cada repositorio por separado.

### Paso 2: el proveedor primero, y su contrato queda escrito

Implementar y verificar en el proveedor con los procedimientos de **su** pack. Antes de pasar al consumidor, el contrato **está escrito** en algún lado, que el proyecto elige y la guía de este paso deja claro:

- los endpoints o mensajes: ruta, método, quién puede llamarlos;
- las formas de entrada y de salida, **con qué campos son opcionales y cuáles pueden ser nulos**;
- los códigos de error y sus estados;
- los estados posibles de cada recurso y qué transiciones hay.

Puede ser el diseño del cambio, un esquema de la API generado, o ambos. Lo que no sirve: "está en el código". Si no está escrito, el consumidor va a adivinar.

### Paso 3: el consumidor lee el contrato como fuente de verdad

1. Leer el contrato del proveedor (no el código del proveedor: el contrato).
2. **Mapear cada punto de contacto**: cada endpoint que el consumidor usa, cada forma de respuesta, cada error, cada estado, contra una pieza del consumidor.
3. **Comparar los esquemas de validación del consumidor contra el contrato**, campo por campo:

| El contrato dice | El esquema del consumidor debe… | Si no |
|---|---|---|
| Un campo opcional | admitir su ausencia | falla cuando el proveedor lo omite |
| Un campo nulable | admitir `null` | falla en el 200 |
| Un enumerado con N valores | admitir los N | falla con el valor nuevo |
| Un texto sin formato | no imponer uno | rechaza datos válidos |
| Un número sin tope | no imponer uno | idem |

   El esquema del consumidor **nunca es más estricto** que el contrato: si lo es, el proveedor responde bien y el consumidor falla.
4. **Los errores**: cada código del contrato tiene un tratamiento en el consumidor (un mensaje legible, no el código crudo).
5. Si el consumidor pasa por una capa intermedia que reenvía al proveedor, el contrato se verifica **en esa capa también**.

### Paso 4: probar la pantalla, no solo cada endpoint

Un cambio que cruza repositorios necesita al menos una prueba que recorra lo que el usuario recorre, con todo levantado: `prueba-e2e`. Incluye el caso de **cada rol** que debería poder entrar, y el que no. Cada endpoint puede estar bien y la pantalla estar rota por la combinación.

### Paso 5: si aparece un defecto del proveedor

Se arregla **en el proveedor**, se commitea ahí, y el consumidor lo vuelve a leer. Si el arreglo del proveedor no es viable ahora, se anota como deuda del proveedor con el síntoma, **no** se compensa en el consumidor sin dejarlo escrito.

### Paso 6: commits

Un commit por repositorio, con el mismo identificador de tarea y el módulo distinto. Nunca los dos repositorios en un commit.

---

## Cómo aplicarlo en tu proyecto

1. **Declará dónde queda escrito el contrato**: una línea en el `CLAUDE.md` del proveedor ("el contrato de un cambio vive en…").
2. **Declará cómo se genera o se verifica el esquema**, si el proyecto lo tiene (un archivo OpenAPI generado, tipos compartidos, un esquema de validación derivado). Un esquema generado desde el contrato elimina el desfase de estrictez entero: si existe, usarlo.
3. Dejá en `ai/local/rules/` la lista de los pares de repositorios del proyecto y cuál es el proveedor de cada uno.

## Cómo sé que lo apliqué bien

- [ ] Antes de empezar el consumidor, puedo señalar dónde está escrito el contrato del cambio.
- [ ] Cada esquema de validación del consumidor admite todo lo que el contrato admite (nulos, opcionales, valores del enumerado).
- [ ] Cada código de error del contrato tiene un mensaje en el consumidor.
- [ ] Hay una prueba que recorre la pantalla con cada rol relevante.
- [ ] No hay compensaciones de un defecto del proveedor en el consumidor.
- [ ] Hay un commit por repositorio.

## Cómo verificarlo

En la revisión (`pr-review`, prompt `review-contrato-diseno`, sección del contrato): pedir al revisor que mapee los puntos de contacto y compare los esquemas. Un hallazgo de integración confirmado que ningún gate detectó es candidato a `gate-from-finding`; cuando no se puede automatizar con la arquitectura actual, se anota en `ai/gate-candidates.md` con lo que haría falta (típicamente: un esquema compartido).
