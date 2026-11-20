# Regla — Copy de interfaz

**Fuente única de verdad** para qué puede decir un texto visible al usuario. Es del pack `nextjs`, pero el criterio vale para cualquier interfaz.

---

## La regla

**Ningún texto visible al usuario contiene identificadores internos.**

Están prohibidos en la interfaz:

| Tipo | Ejemplos |
|---|---|
| Códigos de requisito | `RF-1.04`, `RN-2.22`, `M0.14` |
| Tickets | `PRJ-510` |
| Nombres de servicios o clases | `MetricsService`, `RotationService` |
| Nombres de tablas o columnas | `order_book`, `pending_amount`, `tenant_id` |
| Rutas de endpoint | `GET /order-book/snapshot` |
| Códigos de error crudos | `BFF.INVALID_SHAPE` sin su mensaje |

Aplica a **todo** lo que el usuario puede leer: los archivos de mensajes de i18n, los literales en JSX, `aria-label`, `title`, `placeholder`, tooltips, textos de estado vacío, y mensajes de error o toast.

---

## Por qué (el incidente)

El usuario de una interfaz de operación es un operador, no un desarrollador ni quien escribió el requerimiento. Un código de requisito no le dice qué está viendo ni qué puede hacer, y **desplaza la explicación que sí necesita**: ocupa el lugar del texto útil. En una revisión aparecieron descripciones de parámetros que terminaban en un código de requisito en lugar de decir para qué sirven.

```
MAL:  "Parámetros que alimentan el algoritmo de selección del Pool (RF-1.04)."
BIEN: "Configuración que determina cuándo esta cuenta puede ser elegida para operar."
```

El segundo texto es más largo y sirve. El primero es más corto y no dice nada que el operador pueda usar.

---

## Dónde sí va la trazabilidad

El vínculo al requisito no se pierde: cambia de lugar.

| Va en | No va en |
|---|---|
| Comentarios de código y JSDoc | Texto de la interfaz |
| Nombres de test (`describe('PRJ-603 — ...')`) | `aria-label` y `title` |
| Specs y documentos de diseño | Mensajes de error al usuario |
| Mensajes de commit | Toasts |

---

## El caso del error

Un código de error **puede** mostrarse si viene acompañado de qué hacer, y como dato secundario: para que el operador lo pueda citar al pedir soporte. Nunca como el mensaje mismo.

```
MAL:  "Error: BFF.INVALID_SHAPE"
BIEN: "No pudimos cargar el libro en vivo. Probá de nuevo en unos segundos."
BIEN: "No pudimos cargar el libro en vivo. Probá de nuevo en unos segundos.
       Si el problema sigue, informá el código BFF.INVALID_SHAPE."
```

---

## Cómo se verifica

Si el proyecto no tiene un gate, **a mano**, durante la revisión de frontend: buscar los prefijos de requisito y de ticket del proyecto (el de tickets está en `project.ticketPrefix` de `ai-workspace.json`) y los nombres de tabla en los archivos de mensajes y en los literales de JSX.

La forma es regular y el falso positivo esperable es bajo, así que es **candidata a gate**: un barrido sobre las **claves de i18n** (los valores de los archivos de mensajes, que es donde vive el texto visible) con los patrones de identificador que declare el proyecto. Es el tipo de caso para `gate-from-finding`: si la revisión encuentra uno, el siguiente paso es la regla, con su fixture que marca (`"... (RF-1.04)"`) y su fixture que no (`"Código de error: BFF.X"` acompañado de un mensaje).

## Cómo aplicarlo en tu proyecto

1. Anotá en `ai/local/rules/` los prefijos de identificador propios (requisitos, tickets, nombres de tabla frecuentes) para que la revisión los busque.
2. Revisá el archivo de mensajes de i18n y los `aria-label`: es donde más se cuelan.
3. Si el proyecto cita requisitos en comentarios y tests, la trazabilidad ya está: no hace falta pedir más.
