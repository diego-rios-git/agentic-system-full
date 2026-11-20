# Agregar un pack de lenguaje

Cómo hacer que los gates analicen un lenguaje que la base todavía no cubre.

---

## Qué hay que entender primero

Ningún escáner sabe qué es un archivo fuente. Lo pregunta.

```
ai/packs/<pack>/manifest.json   ← declara el perfil: extensiones, tests, sintaxis
scripts/lib/languages.js        ← fusiona los perfiles de los packs activos
scripts/check-antipatterns.js   ← pregunta: ¿es fuente? ¿es test? ¿lo salteo?
```

Antes esto no era así, y el resultado fue el punto ciego que originó este documento: `check-antipatterns.js` traía `SOURCE_EXT = /\.[cm]?[jt]sx?$/` escrito adentro, `check-tenant-isolation.js` traía `/\.[cm]?ts$/`, y cada uno definía por su cuenta qué era un test. Un backend en C# no producía **ni un solo archivo para analizar**, y los gates salían con 0 y "sin hallazgos" sin haber mirado nada. Un gate que no mira nada y dice que está limpio es peor que no tenerlo.

Agregar un lenguaje es, entonces, **declarar su perfil**. Si además querés reglas propias de ese stack, es un archivo más.

---

## El perfil

Va en el `manifest.json` del pack, bajo `language`:

```json
{
  "language": {
    "id": "python",
    "extensions": [".py"],
    "ignoreDirs": [".venv", "__pycache__", ".pytest_cache"],
    "ignorePaths": ["(^|/)migrations/", "_pb2\\.py$"],
    "testPatterns": ["(^|/)test_[^/]+\\.py$", "_test\\.py$", "(^|/)tests?/"],
    "syntax": {
      "lineComment": "#",
      "stringDelimiters": ["\"", "'"],
      "rawStringPrefixes": ["r\"", "r'", "\"\"\"", "'''"]
    },
    "envAccess": ["os.environ", "os.getenv", "settings.", "Config("]
  }
}
```

| Campo | Para qué | Si falta |
|---|---|---|
| `id` | Nombre del perfil. Un repositorio puede restringirse a unos pocos con `languages` en `ai-workspace.json` | Se usa la ruta del manifiesto |
| `extensions` | Qué archivos se analizan | **El perfil se descarta con un aviso.** Sin extensiones no hay nada que mirar |
| `ignoreDirs` | Directorios que no se recorren | Solo los universales: `.git`, `node_modules`, `bin`, `obj`, `target`, `dist`, `coverage`… |
| `ignorePaths` | Rutas generadas que nadie refactoriza | Nada se ignora por ruta |
| `testPatterns` | Qué archivo es un test | **Ningún archivo es test**, y las reglas se aplican también sobre los tests, donde los datos simulados y las direcciones locales son legítimos |
| `testTitles` | Cómo se extrae el título de un test | El lenguaje tiene tests que nadie sabe leer. El gate de cobertura de escenarios sale con 2 y lo dice, en vez de reportarlos todos como sin cubrir |
| `syntax` | Cómo recortar el comentario sin romper las cadenas | Se asume la familia C: `//` con comillas simples y dobles |
| `envAccess` | Cómo se lee la configuración inyectable | Las reglas que distinguen un valor cableado de uno inyectable marcan todo |

`ignorePaths` y `testPatterns` son **expresiones regulares en texto**, no globs. Un glob necesitaría un motor propio o una dependencia; una expresión regular la compila Node sin nada de por medio. Se evalúan contra la ruta relativa al repositorio, con barras normales. `ignorePaths` es insensible a mayúsculas —cada generador elige su capitalización, EF Core escribe `Migrations/` y TypeORM `migrations/`— y `testPatterns` es sensible, porque `UsuarioTests.cs` sigue la convención de xUnit y `usuariotests.cs` no.

---

## El título de un test

Solo importa si el proyecto usa un ciclo dirigido por especificación: es lo que permite verificar que cada escenario tiene su prueba. La correspondencia es por título porque es lo único que un script puede comprobar sin ejecutar nada.

**En muchos lenguajes el título no es una cadena.** En Jest o Vitest está a la vista; en xUnit el test es un método decorado y su nombre *es* el título; en Go es `func TestAlgo`. Por eso no alcanza con una expresión regular configurable: hay que saber además cómo convertir lo capturado en algo comparable con la frase de un escenario.

| Estrategia | Para | Cómo saca el título |
|---|---|---|
| `callback` | Jest, Vitest, Mocha, Jasmine | La cadena de `it('…')` / `test('…')` |
| `attribute-or-method` | xUnit, NUnit, MSTest, JUnit | El `DisplayName` del atributo si está; si no, el nombre del método, desarmado — `Rechaza_Un_Monto` pasa a `Rechaza Un Monto` |
| `function-name` | Go, pytest | El nombre de la función, sin el prefijo y desarmado |
| `regex` | Cualquier otro | El grupo 1 del patrón; con `"humanize": true` lo desarma igual que las anteriores |

```json
"testTitles": { "strategy": "attribute-or-method",
                "attributes": ["Fact", "Theory"], "titleField": "DisplayName" }
```

---

## Los dos campos que más silenciosamente fallan

**`rawStringPrefixes`.** Es el que produce el error que nadie nota. El recorte de comentarios rastrea las cadenas para no cortar en el `//` de `"http://localhost"`. Si el lenguaje tiene literales que ignoran los escapes —`@"C:\ruta\"` en C#, `r"..."` en Python, las cadenas triples— y no están declarados, la barra invertida final se lee como escape, la cadena nunca cierra, y **el resto de la línea se pierde para todas las reglas**. No hay error ni aviso: el gate simplemente deja de ver esa familia de casos.

**`testPatterns`.** Un lenguaje sin patrones declarados no tiene tests para la base: las reglas se aplican sobre ellos, y los tests usan direcciones locales, errores genéricos y datos simulados de forma perfectamente legítima. El resultado es ruido en el archivo donde el ruido menos se tolera.

---

## Verificarlo antes de darlo por bueno

Dos fixtures, como exige `ai/core/procedures/gate-from-finding.md`: uno que **debe** marcar y otro que **no debe** marcar. El segundo es el que importa — una regla que solo se prueba contra código malo no se distingue de una regla que marca todo.

```bash
node scripts/check-antipatterns.js --repo <repo> --json
```

Lo que hay que confirmar en el fixture que no debe marcar:

- El código correcto del lenguaje da **cero** hallazgos.
- Los archivos de `ignorePaths` no aparecen.
- Los archivos de test no aparecen.
- Un valor leído de la configuración con un valor por defecto **no** se marca como cableado — si se marca, falta una entrada en `envAccess`.

Y en el que debe marcar, que aparezca **cada** caso que pusiste. Es el que suele revelar el error: una expresión con un `\b` de más deja de matchear justo el caso más común y el fixture lo delata en el momento, no seis meses después.

---

## Reglas propias del stack

Opcional. Van en un archivo de reglas dentro del pack, en la misma ubicación que `ai/packs/dotnet/rules/antipatterns.js`, que sirve de ejemplo. El motor las carga solo si el pack está instalado.

```js
module.exports = [
  {
    id: 'PY-1.1',
    title: 'Qué detecta',
    why: 'Por qué importa — este texto se le muestra a quien lo dispara',
    test: (line, ctx) => /…/.test(line),
  },
];
```

`ctx` trae `{ file, before, envAccess, rel }`. **Usá `ctx.envAccess` en vez de escribir la forma del lenguaje en la regla**: es lo que la mantiene portable, y es el error que tuvo la regla `CORE-1.2` de esta base, que daba por sentado `process.env` y por eso marcaba como cableada toda dirección local en cualquier archivo que no fuera JavaScript.

---

## Si el proyecto usa el pack multi-tenant

Solo entonces. El aislamiento entre clientes es un pack opcional, y la mayoría de los proyectos no lo instala.

Ese gate verifica un concepto que es el mismo en cualquier stack —toda lectura lleva el filtro del cliente— pero **cómo se ve una consulta no lo es**. El script no sabe nada de ningún ORM: el dialecto lo declara el pack del stack, bajo `tenant`.

```json
{
  "tenant": {
    "dialect": "typeorm",
    "readMethods": ["find", "findOne", "count"],
    "conditionMarker": "\\bwhere\\b",
    "byIdMethods": ["findOne", "findOneOrFail"],
    "byIdCondition": "where\\s*:\\s*\\{\\s*id\\b",
    "afterFilter": "\\.filter\\s*\\(\\s*\\(?\\s*(\\w+)\\s*\\)?\\s*=>[^)]*\\b\\1\\.(?:{tenant})\\b"
  }
}
```

`{tenant}` se reemplaza por las variantes del nombre de la columna. Sin dialecto declarado el gate **no corre**: sale con 2 y lo dice. Nunca con 0 — un gate que no reconoce ni una consulta y reporta "sin hallazgos" produce confianza donde no hay verificación.

**Cuidado con las barras invertidas.** En JSON, `"\b"` no es la secuencia de expresión regular: es el carácter de retroceso, U+0008. Escribir `"\bwhere\b"` en vez de `"\\bwhere\\b"` da un patrón que compila sin error y no coincide con nada, y `"\1"` se convierte en U+0001, con lo que la referencia hacia atrás desaparece. El gate queda mudo. Está validado —un carácter de control en un patrón se rechaza con el mensaje que explica el arreglo— pero conviene saberlo antes de pisarlo.

Y no alcanza con declarar los métodos: las tres detecciones tienen que **tener sentido en ese dialecto**. Los métodos de EF Core son el caso de manual — `Where`/`FirstOrDefault` se usan igual sobre un `DbSet` que sobre una lista en memoria, donde no hay nada que aislar, y el filtro es un lambda y no un objeto `{ … }`. Declararlos sin adaptar la heurística produce ruido sobre cada LINQ del repositorio. Ver la entrada correspondiente en `ai/gate-candidates.md`.

---

## Registrarlo

Dos lugares, los dos obligatorios:

1. `template.manifest.json`, bajo `packs`, con sus archivos en `rules` y `scripts`. Sin esto **`template-sync` no lleva el pack a los proyectos**: funciona en la base y no existe río abajo.
2. `ai-workspace.json` del proyecto, en `repos[].packs`.

---

## Cuando no querés un pack entero

Para un lenguaje puntual, un repositorio puede declarar el perfil a mano y saltearse todo lo anterior:

```json
{
  "repos": [
    {
      "name": "motor",
      "path": "motor",
      "language": {
        "id": "rust",
        "extensions": [".rs"],
        "ignoreDirs": ["target"],
        "testPatterns": ["(^|/)tests/", "_test\\.rs$"]
      }
    }
  ]
}
```

Gana sobre los perfiles de los packs. Es la vía de escape para no tener que bifurcar la base por un lenguaje que aparece en un solo repositorio.

Y al revés: `"languages": ["dotnet"]` en un repositorio **restringe** qué perfiles aplican. Sirve cuando sumar sobra — una solución .NET pura no quiere que el perfil de JavaScript que aporta el núcleo se ponga a analizar sus scripts de compilación.
