# Agregar un harness

Cómo hacer que **cualquier** herramienta de IA trabaje con las mismas reglas que el resto — la que usa tu equipo hoy y la que aparezca el año que viene.

---

## Lo primero: el harness no es indispensable

El contenido del sistema vive **una sola vez**, en `ai/`. Ahí están los procedimientos, los agentes y las reglas. Los gates, los packs, las baselines y el ciclo de trabajo funcionan sin que exista ningún `.claude/`, ningún `.opencode/` ni ningún otro directorio de herramienta.

Lo que un harness recibe es una **proyección**: un archivo corto, con el frontmatter que esa herramienta espera, que remite al archivo real.

```
ai/core/procedures/pr-review.md          (200 líneas)  ← el contenido
.claude/skills/pr-review/SKILL.md         (18 líneas)  ← puntero
.opencode/skills/pr-review/SKILL.md       (18 líneas)  ← puntero
```

De ahí se sigue algo que conviene tener presente antes de configurar nada:

```json
{ "harnesses": [] }
```

Eso es válido. Un proyecto sin ninguna herramienta configurada tiene el sistema completo: los gates corren, los packs aplican, las reglas valen. Simplemente no se generan punteros.

---

## Un harness es un bloque de datos, no código

Agregar una herramienta **no requiere tocar ningún script**. Se declara un bloque, se corre el generador, y esa herramienta recibe todo el contenido de `ai/` proyectado a su formato: todos los procedimientos, todos los agentes, con sus restricciones de herramientas y su modelo.

Hay dos lugares donde declararlo, y la diferencia importa:

| Dónde | Para qué | Quién lo mantiene |
|---|---|---|
| `template.manifest.json` → `harnesses` | El catálogo que trae la base | La plantilla; `template-sync` lo actualiza |
| `ai-workspace.json` → `harnessDefinitions` | El que agrega **tu proyecto** | Vos; la plantilla no lo toca nunca |

**Usá el segundo.** Es la vía para trabajar con una herramienta que la plantilla todavía no conoce sin bifurcarla y sin esperar a que la incorpore. Con el mismo identificador, el del proyecto gana sobre el de la base, así que también sirve para corregir un dialecto que quedó viejo.

```json
{
  "harnesses": ["claude", "cursor"],

  "harnessDefinitions": {
    "cursor": {
      "title": "Cursor",
      "skillsDir": ".cursor/skills",
      "skillFile": "SKILL.md",
      "agentsDir": ".cursor/agents",
      "frontmatter": {
        "description": "inline",
        "mode": false,
        "tools": "map",
        "model": "alias"
      }
    }
  }
}
```

```bash
node scripts/consolidate-skills.js --wrappers
```

Y ya está: `.cursor/` queda con todos los skills y todos los agentes.

---

## Los campos

| Campo | Qué es | Si falta |
|---|---|---|
| `title` | Nombre legible, aparece en los punteros y los documentos | Se usa el identificador |
| `skillsDir` | Dónde van los punteros de procedimiento | No se generan punteros de skill |
| `skillFile` | Nombre del archivo dentro de cada skill | `SKILL.md` |
| `agentsDir` | Dónde van los punteros de agente | No se generan punteros de agente |
| `frontmatter` | El dialecto — ver abajo | Se asume el mínimo: descripción en bloque, sin modo, sin herramientas, sin modelo |
| `modelMap` | Traducción del tier genérico al nombre propio de la herramienta | Obligatorio solo si `model` es `"mapped"` |

Omitir los dos directorios es legítimo, no un error: describe una herramienta que lee el `AGENTS.md` de la raíz y no tiene árbol propio. Es el caso de `agents-md`.

### El dialecto del frontmatter

Es lo único que difiere de verdad entre herramientas, y cada diferencia es un campo:

| Campo | Valores | Qué produce |
|---|---|---|
| `description` | `"block"` | `description: >` con el texto indentado debajo |
| | `"inline"` | En la misma línea |
| `mode` | `true` / `false` | Si emite `mode: subagent` |
| `tools` | `"list"` | Lista separada por comas de las permitidas |
| | `"map"` | Mapa de booleanos (`write: false`) |
| | `"none"` | No emite herramientas |
| `model` | `"alias"` | El tier tal cual: `opus` |
| | `"mapped"` | Traducido con `modelMap`: `anthropic/claude-opus-5` |
| | `"none"` | No emite modelo |

`readOnlyTools` acompaña a `tools: "list"` y es obligatorio ahí. La razón: un agente que declara `edit: false` no debe poder editar en **ninguna** herramienta. Un mapa de booleanos lo expresa directo, pero una herramienta que no recibe `tools` suele darle todas, y entonces la restricción queda como una sugerencia de texto que el modelo puede ignorar. Enumerar las permitidas es lo que la hace real.

---

## Lo que hay que averiguar de la herramienta nueva

Cuatro preguntas. **Averiguá las respuestas contra la documentación o probando, no las supongas**: un frontmatter con un campo inventado se ignora en silencio y el activo simplemente no aparece.

| Pregunta | Campo |
|---|---|
| ¿Dónde busca sus skills y sus agentes? | `skillsDir`, `agentsDir`, `skillFile` |
| ¿La descripción va en bloque o en línea? | `frontmatter.description` |
| ¿Cómo declara un agente de solo lectura? | `frontmatter.tools`, `readOnlyTools` |
| ¿Cómo nombra los modelos? | `frontmatter.model`, `modelMap` |

Las dos últimas son las que más difieren y las que más silenciosamente fallan.

---

## Verificarlo

```bash
node scripts/consolidate-skills.js --wrappers
node scripts/consolidate-skills.js --check
```

Después, abrí uno de los punteros generados y confirmá tres cosas en la herramienta real:

1. **Aparece en su lista de skills o agentes.** Si no aparece, el frontmatter tiene un campo que esa herramienta no entiende.
2. **Un agente de solo lectura no puede escribir.** Pedile explícitamente que edite un archivo. Si lo hace, `tools` está mal declarado y la restricción es decorativa.
3. **El puntero lleva al contenido.** El modelo tiene que leer el archivo de `ai/` y seguirlo, no responder solo con lo que dice el puntero.

Un harness mal declarado no falla con un error: simplemente no genera lo que esperabas, o genera algo que la herramienta ignora. Por eso la comprobación es contra la herramienta, no contra la salida del script.

---

## Lo que nunca hay que hacer

**Editar un puntero a mano.** El cambio se pierde en la próxima generación y, mientras tanto, esa herramienta se comporta distinto de las demás sin que nadie lo sepa. `--check` detecta exactamente eso y lo reporta como "editado a mano".

Si el contenido tiene que cambiar, se cambia en `ai/`. Si lo que tiene que cambiar es el formato del puntero, se cambia el dialecto en la declaración del harness.

---

## Un harness solo para algunos activos

Un skill o un agente puede restringir a qué harnesses se expone, con `harnesses` en el manifiesto que lo declara:

```json
{ "name": "db-query", "harnesses": ["claude"] }
```

Sirve para el activo que depende de una capacidad que solo una herramienta tiene. Sin ese campo, el activo se expone a todos los que el proyecto declare — que es lo que se quiere casi siempre.
