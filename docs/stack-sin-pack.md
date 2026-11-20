# Tu stack no tiene pack

Esta base es **para cualquier lenguaje**. Lo que está escrito en Node son sus propias herramientas (instalador, gates, hooks), igual que git es una herramienta: tu proyecto puede ser Python, Angular, Go, PHP o lo que sea, y no necesita `package.json` ni `npm install`.

Los packs (`nestjs`, `nextjs`, `dotnet`) son **atajos**: traen ya resuelto el perfil de lenguaje, las reglas y los procedimientos de ese stack. Si el tuyo no tiene pack, no te falta nada que impida trabajar; te falta declararle a la base tres cosas que el pack habría declarado por vos. Esta guía dice cuáles, y el agente las propone en la carga del proyecto.

---

## Qué hace el sistema por vos

1. **`node init.js`** — si ningún pack de stack cubre un repositorio, pregunta qué stack usa y lo anota en `repos[].stack`. Los packs que no elegiste se borran: un activo que nadie va a usar es ruido.
2. **Skill `project-loader`** — lee el código, ve los repositorios sin pack y te **propone** (con confirmación) el perfil de lenguaje, los comandos del ecosistema y el perfil de dependencias. Nada se escribe sin que digas que sí.
3. **`node scripts/run-gates.js --all`** — un gate que no tiene con qué mirar tu código sale como **NO CORRIÓ**, nunca como limpio. Así te enterás de lo que falta declarar.

---

## Las tres cosas a declarar

Todo va en tu entrada del repositorio en `ai-workspace.json`.

### 1. El perfil de lenguaje

Le dice a los gates qué es código fuente, qué es un test y cómo se ve un comentario. Sin él, los gates de anti-patrones y de cobertura de escenarios **no ven tu código**.

Python:

```json
{
  "name": "api",
  "path": "api",
  "packs": [],
  "stack": "python/fastapi",
  "languages": ["python"],
  "language": {
    "id": "python",
    "extensions": [".py"],
    "ignoreDirs": [".venv", "__pycache__", ".pytest_cache", ".mypy_cache"],
    "ignorePaths": ["(^|/)migrations/", "(^|/)alembic/versions/"],
    "testPatterns": ["(^|/)test_[^/]+\\.py$", "_test\\.py$", "(^|/)tests?/"],
    "syntax": {
      "lineComment": "#",
      "stringDelimiters": ["\"", "'"],
      "rawStringPrefixes": ["r\"", "r'", "\"\"\"", "'''"]
    },
    "envAccess": ["os.environ", "os.getenv", "settings."],
    "testTitles": { "strategy": "function-name", "keyword": "def", "prefix": "test_" }
  }
}
```

`"languages": ["python"]` deja afuera el perfil de JavaScript que trae el núcleo: en un repositorio Python puro no hay nada que analizar con él.

Angular o React sin Next: **no hace falta perfil**. El del núcleo ya cubre `.ts`, `.tsx`, `.js`, los `*.spec.ts` / `*.test.tsx` y los imports, incluidos los `import()` de las rutas lazy. Solo si usás alias de `tsconfig` (`@app/…`), declaralos para que el gate de código inalcanzable los resuelva. Van en el `manifest.json` de `ai/local/` (lo creás si no existe), que **suma** al perfil del núcleo sin pisarlo:

```json
{
  "reachability": {
    "aliases": [{ "prefix": "@app/", "to": "src/app/" }]
  }
}
```

No redeclares `language` con `id: "javascript"` para esto: un perfil propio reemplaza la sintaxis y los patrones de import del núcleo para esas extensiones, y perdés los que no copies.

### 2. Los comandos del ecosistema

La base no trae ningún comando fijo: corre los que declares. Lo que no declares aparece como **NO DECLARADO** en la revisión (sin verificar, nunca verde).

| Campo | Python | Angular | React (Vite) |
|---|---|---|---|
| `testCommand` | `pytest -q` | `npx ng test --watch=false` | `npx vitest run` |
| `testRelatedCommand` | `pytest -q {files}` | — | `npx vitest related --run {files}` |
| `lintCommand` | `ruff check .` | `npx ng lint` | `npx eslint .` |
| `typecheckCommand` | `mypy .` o `pyright` | `npx tsc --noEmit -p tsconfig.app.json` | `npx tsc --noEmit` |

Son sugerencias de punto de partida: si el proyecto ya usa otra herramienta, va la que usa. El agente las toma de lo que encuentre en el repositorio (`pyproject.toml`, `angular.json`, `package.json`) antes de sugerir una nueva.

### 3. El perfil de dependencias (solo con slots de worktree)

Si trabajás con slots en paralelo, cada slot comparte el directorio de dependencias del principal. Declarar cuál es evita que un `pip install` dentro de un slot rompa el del principal:

```json
"deps": "python"
```

Hay perfiles para `node`, `python` y `php` en `ai/core/manifest.json`. Para otro gestor, ver el skill `shared-dependencies`.

---

## Qué no vas a tener sin pack (y no pasa nada)

- **Procedimientos del framework** (cómo se escribe un módulo, un DTO, una migración en *ese* stack). El agente trabaja con su conocimiento general y con las reglas de tu proyecto en `ai/local/`.
- **Reglas de anti-patrones propias del stack.** El motor está; las reglas las aporta un pack.
- **Gate de código inalcanzable en Python.** Su resolvedor entiende imports con forma de ruta (`./x`); Python importa módulos por nombre. Sale como NO CORRIÓ, a la vista.

Con el perfil declarado, el gate de anti-patrones corre igual que en cualquier stack: después de cada escritura, en `run-gates.js` y en la revisión.

## Cuándo armar un pack

Cuando el mismo stack se va a repetir en más de un proyecto: ahí conviene que el perfil, los comandos y los procedimientos vivan en un pack en vez de copiarse a mano. Ver [`agregar-un-pack-de-lenguaje.md`](agregar-un-pack-de-lenguaje.md).
