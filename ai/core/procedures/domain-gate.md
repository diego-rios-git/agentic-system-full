# Gate de dominio: una política, una regla escrita, un gate que la verifica

Cómo armar, para TU proyecto, un gate que verifica una política **de dominio**: dinero, fechas con zona horaria, datos personales, unidades de medida. Está escrita para que la aplique alguien sin contexto previo: seguila de arriba abajo y al final tenés un gate probado, con baseline, declarado y corriendo en la revisión.

La base trae el **motor** (`scripts/lib/domain-gate.js`). **El vocabulario y las reglas son de tu proyecto**: la base no sabe qué es un monto ni qué es un dato personal, y no tiene por qué saberlo.

---

## Cuándo es esto y cuándo no

Es un gate de dominio cuando el error se decide por **lo que significa el nombre** de un campo y no por la forma del código:

- `parseFloat(total)` es un problema si `total` es plata, y está bien si es un contador de páginas.
- `new Date("2026-09-29")` es un problema si es una fecha de calendario (se interpreta en UTC y en otra zona cae un día antes), y está bien si es un instante.
- Un campo `email` o `documento` que llega a un log sin enmascarar.

Si el defecto se ve **leyendo una línea** sin saber qué significa nada, no es esto: es una regla común del motor de anti-patrones (`ai/core/procedures/gate-from-finding.md`).

---

## El problema, con los incidentes que le dieron forma

Cada decisión del motor existe porque alguien la tomó mal una vez. Leelas: son lo que evita que alguien "simplifique" el gate.

1. **Una regex ancha marca de más y el equipo apaga el gate.** Buscar la palabra `limit` marca como dinero la paginación (`limit=20`). La solución no es una regex más fina sino **decidir por tokens**: `limit` solo es paginación; `daily_limit` es del dominio; `amount` es del dominio; `amount_repetitions` es un contador. El motor parte el nombre en `snake_case` y `camelCase` y lo clasifica con cuatro listas (abajo).
2. **La exención por archivo dejó pasar un caso real.** La primera versión eximía el archivo entero si contenía un formateador correcto. Un solo uso bueno en cualquier parte dejaba ciega la regla para todo el archivo: así llegó a la rama base una conversión peligrosa que estaba tres líneas arriba del formateo correcto. Al corregirlo —eximir **la línea**, no el archivo— la detección pasó de 22 a 43 hallazgos: los 21 nuevos eran deuda real que el filtro por archivo escondía. Por eso el motor **se niega** a recibir una exención por archivo.
3. **El baseline con número de línea reintroduce lo aceptado.** Mover código cambia la línea y el hallazgo "nuevo" es el mismo de siempre. La huella es `regla|archivo|campo`, sin línea.
4. **Un clasificador sin el caso "no es del dominio" no se sabe si marca de más.** Por eso los fixtures incluyen nombres que NO son del dominio, y se ejecutan.

---

## Qué trae la base y qué es tuyo

| La base trae (`scripts/lib/domain-gate.js`) | Tu proyecto escribe |
|---|---|
| Clasificador de nombres por tokens | La política, en UNA regla escrita |
| Recorrido de archivos según el perfil de lenguaje, sin tests ni rutas generadas | Las 4 listas de vocabulario |
| Allowlist de puntos de conversión | Qué módulos SON el punto de conversión |
| Exención por línea | Qué línea es demostrablemente segura |
| Baseline sin número de línea, `--json`, `--baseline`, `--write-baseline`, repositorio o slot en `--repo` | Las reglas (qué se prohíbe) |
| Ejecución de fixtures: `--validate-fixtures` | Los fixtures |
| Código de salida 0 / 1 / 2 | — |

---

## Paso a paso

### 1. Escribí la política en UNA regla

En `ai/local/rules/<dominio>.md` (una sola; si la política vive repartida en cinco documentos, el gate verifica cinco cosas distintas). Tiene que decir, sin ambigüedad:

- **Qué representa** el dominio y en qué forma vive en **cada capa** (base de datos, servicio, borde HTTP, interfaz). Una política de dinero, por ejemplo, dice en qué unidad se guarda, en qué tipo se transporta y en cuál se muestra.
- **Qué está prohibido** (la lista de lo que el gate va a marcar, una por regla `R1`, `R2`…).
- **Dónde SÍ se puede convertir**: los módulos que son el punto de conversión.
- **Por qué**: el incidente, en una o dos líneas. Sin el porqué, alguien "simplifica" la regla.

El gate cita esta ruta en cada hallazgo (`policy`): quien lo recibe tiene que poder leer ahí el criterio.

### 2. Levantá el vocabulario con datos, no de memoria

Cuatro listas de **tokens** (en minúscula, una palabra cada uno):

| Lista | Qué lleva | Ejemplo (dominio "fechas") |
|---|---|---|
| `domain` | Con uno de estos basta | `date`, `fecha`, `timestamp` |
| `ambiguous` | Son del dominio **solo calificados** | `start`, `end`, `limit` |
| `qualifiers` | Califican a un ambiguo | `birth`, `expiry`, `due` |
| `disqualifiers` | Descartan el nombre aunque tenga un token del dominio; **ganan sobre todo** | `count`, `format`, `locale`, `id`, `version` |

Cómo calibrarlas:

1. Listá los identificadores reales del repositorio que contienen cada candidato a `domain` (con `grep` sobre el código, no a ojo).
2. Para cada uno preguntate: ¿es del dominio? Los que **no** lo son te dicen qué va en `disqualifiers` (`date_format`, `update_count`).
3. Los que son del dominio solo a veces te dicen qué va en `ambiguous` + `qualifiers`.
4. Repetí hasta que una muestra de 30-40 nombres reales se clasifique como lo harías a mano.

### 3. Definí las reglas

Cada regla es `{ id, title, match, fixtures }`. `match(ctx)` mira **una línea** y devuelve una lista de `{ field, message? }` (o nada):

```js
{
  id: 'DATE-1',
  title: 'Fecha de calendario construida desde un texto sin hora',
  allowlistable: true,        // la allowlist de conversión la exime
  match: ({ line, isDomainName, nameOf }) => {
    const out = [];
    for (const m of line.matchAll(/new Date\(\s*([^)]{0,80})\)/g)) {
      if (isDomainName(m[1])) out.push({ field: nameOf(m[1]) });
    }
    return out;
  },
  fixtures: { bad: [ /* … */ ], good: [ /* … */ ] },
}
```

`ctx` trae: `line`, `lines` y `idx` (por si necesitás las anteriores), `rel` (ruta relativa), `isDomainName(nombre)`, `nameOf(expresión)` (el último nombre de `a.b.c` o de `fila['x']`) y `profile` (el perfil de lenguaje). Una regla que quiere mirar tests lo declara con `includeTests: true`; por defecto no.

Una regla **angosta y correcta** vale más que una ancha y ruidosa. Empezá con la que más duele.

### 4. La allowlist: los puntos de conversión

`allowlist: ['<fragmento de ruta>/']`: los módulos donde la operación que el gate prohíbe es, por definición, legítima (el helper que convierte). Son **rutas**, se aplican **solo** a las reglas con `allowlistable: true`, y deberían ser pocas. Si la lista crece, el gate está perdonando demasiado.

### 5. La exención: por línea, nunca por archivo

`exemptLine: (line, { rel }) => boolean`. Eximí una línea solo cuando **esa línea** es demostrablemente segura (por ejemplo, formatea en el acto un valor que se descarta). **No** existe una exención por archivo, y si la intentás (`exemptFile`) el motor lanza un error: es el incidente 2. Si sentís que necesitás eximir un archivo entero, ese archivo es un punto de conversión: va a la allowlist, y se declara explícitamente.

### 6. Los fixtures

Dos clases, y **ambas con el lado que NO marca**:

- `fixtures.names` (a nivel del gate): `{ domain: [...], notDomain: [...] }` — nombres que **sí** y que **no** son del dominio. Incluí los casos difíciles: el ambiguo sin calificar, el descalificado, el `camelCase`, la expresión con puntos.
- `rules[].fixtures`: `{ bad: [líneas que marcan], good: [líneas casi idénticas que NO marcan] }`.

Se ejecutan con `--validate-fixtures`. Falla si falta cualquiera de los dos lados.

### 7. Armá el script (~25 líneas)

```js
'use strict';
const domain = require('./lib/domain-gate');

domain.run({
  name: '<dominio>',                       // nombre del gate y de su baseline
  policy: 'ai/local/rules/<dominio>.md',   // la regla escrita del paso 1
  vocabulary: { domain: [], ambiguous: [], qualifiers: [], disqualifiers: [] },
  allowlist: [],
  exemptLine: (line) => false,
  rules: [ /* paso 3 */ ],
  fixtures: { names: { domain: [], notDomain: [] } },
});
```

Va en el directorio de scripts de tu proyecto (por ejemplo `scripts/check-<dominio>.js`). Es un script de **tu proyecto**: template-sync no lo toca.

### 8. Declaralo para que corra solo

En el `manifest.json` de `ai/local/` (`gates`), con el mismo formato que los gates del núcleo:

```json
{
  "id": "<dominio>",
  "label": "Política de <dominio>",
  "script": "scripts/check-<dominio>.js",
  "source": "ai/local/rules/<dominio>.md",
  "scope": "repo",
  "args": ["--repo", "{repo}", "--baseline"],
  "baseline": true
}
```

Desde ahí lo corre `scripts/run-gates.js` una sola vez por revisión y lo reporta con su fuente.

### 9. Medilo contra el código real y congelá la deuda

```bash
node scripts/check-<dominio>.js --repo <repo> --validate-fixtures   # ¿los fixtures se comportan?
node scripts/check-<dominio>.js --repo <repo>                       # ¿qué encuentra?
```

Revisá los hallazgos **de a uno**: cada uno es deuda real o un falso positivo. Un falso positivo no se acepta: se achica la regla o se agrega el descalificador que faltaba, y se suma el caso a los fixtures. Cuando todo lo que queda es deuda real:

```bash
node scripts/check-<dominio>.js --repo <repo> --write-baseline      # desde la rama principal, nunca desde un slot
```

---

## Checklist: cómo sé que lo adapté bien

- [ ] La política está en **una** regla escrita y el gate la cita.
- [ ] `--validate-fixtures` sale 0, y los nombres de `notDomain` incluyen un ambiguo sin calificar y un descalificado.
- [ ] Cada regla tiene un `bad` que marca y un `good` casi idéntico que no.
- [ ] Una muestra de 30-40 nombres reales se clasifica como lo harías a mano.
- [ ] No hay ninguna exención por archivo; las excepciones son una allowlist corta de módulos de conversión o una `exemptLine` precisa.
- [ ] **Prueba de la exención por línea:** un archivo con un uso correcto (exento) y, varias líneas más abajo, uno incorrecto: el gate **marca el incorrecto**.
- [ ] Sin baseline el gate encuentra la deuda real; con baseline sale 0; mover una línea de lugar no la reintroduce.
- [ ] `--json` devuelve una lista (`rule`, `file`, `line`, `message`); sin repositorio clonado sale con 2 y stdout vacío.
- [ ] Está declarado en el `manifest.json` de `ai/local/` y aparece en `node scripts/run-gates.js --repo <repo>`.

## Cómo verificarlo de punta a punta

1. `--validate-fixtures` en verde.
2. Introducí a propósito, en una rama de prueba, una violación nueva en un archivo que ya tenía deuda congelada: el gate tiene que marcarla (y solo esa).
3. Corré `node scripts/run-gates.js --repo <repo>`: el gate figura con su fuente, o como "sin hallazgos" en el diff.

## Errores típicos

| Error | Consecuencia |
|---|---|
| Una regex sobre la palabra del dominio, sin tokens | Marca la paginación y los contadores; el equipo apaga el gate |
| Vocabulario sin `disqualifiers` | Cada contador y cada porcentaje es un falso positivo |
| Eximir "este archivo ya está revisado" | La regla queda ciega en ese archivo para siempre (incidente 2) |
| `good` demasiado distinto de `bad` | No prueba nada: un gate que marca todo también lo pasa |
| Escribir el baseline desde un slot | Perdona para siempre la deuda de una rama sin mergear: el gate se niega |
| La política repartida en varios documentos | Nadie sabe cuál manda y el gate no cita ninguno |

## Dónde queda el resultado

- La política: `ai/local/rules/<dominio>.md`.
- El gate: el directorio de scripts de tu proyecto, y su declaración en el `manifest.json` de `ai/local/`.
- Los fixtures: dentro del propio gate.
- El baseline: lo escribe el gate (`.<dominio>-baseline.json` en la raíz); se versiona con el proyecto.

Nada de esto vive en `ai/core/` ni en un pack: template-sync no lo pisa.
