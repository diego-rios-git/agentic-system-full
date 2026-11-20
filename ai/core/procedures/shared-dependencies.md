# Dependencias compartidas entre la principal y los slots

**Guía para adaptar a TU proyecto.** Esta guía no trae la respuesta a "qué comando vacía mis dependencias": te enseña a **medirla** en tu gestor y a dejar el resultado escrito. Está pensada para que la aplique un agente que no conoce el proyecto.

---

## 1. El problema

Un slot (ver `worktree-slots`) es un worktree nuevo: tiene el código y **nada más**. Instalar las dependencias de nuevo en cada slot cuesta minutos y cientos de megas, y es idéntico entre ramas con el mismo lockfile. Por eso la base **enlaza** el directorio de dependencias de la principal dentro del slot (junction en Windows, symlink de directorio en el resto).

El precio: **todo lo que escriba o borre a través del enlace, lo escribe o borra en la principal**. Y el síntoma aparece horas después, disfrazado de otra cosa.

## 2. El incidente (contado en genérico)

Dos veces en cinco días el directorio de dependencias de la principal quedó vacío, y las dos veces se descubrió horas más tarde por errores que no se parecen a la causa:

```
"<ejecutable>" no se reconoce como un comando
Cannot find module '<paquete>'
```

Lo que despistó: **el repositorio se veía sano**. El directorio existía y tenía el mismo número de carpetas de primer nivel de siempre. Lo que faltaba era el directorio de ejecutables y el contenido de algunos paquetes: justo lo que nadie mira. **Contar carpetas de primer nivel no sirve; hay que mirar el contenido** (`node scripts/check-deps.js` lo hace).

La primera explicación que se escribió fue "un borrado recursivo atraviesa el enlace". **Era falsa en la plataforma donde se midió**, y blindar esa puerta dejó abierta la verdadera: lo que vaciaba el destino era el **reinstalador** del gestor y `git worktree remove` cuando había un enlace **anidado** en el árbol del slot.

## 3. El método: medí qué operación destruye ANTES de blindar

No supongas. Una regla que dice "este comando es peligroso" porque suena peligroso protege la puerta equivocada y deja una falsa sensación de seguridad. El método:

1. **Armá el escenario mínimo**: un directorio destino con archivos (uno suelto y uno en una subcarpeta), un enlace a él dentro de una carpeta "slot".
2. **Aplicá UNA operación a través del enlace** y mirá si el destino conserva sus archivos.
3. **Anotá el resultado en la tabla** (operación → ¿atraviesa?), con plataforma y versiones.
4. Repetí por cada operación que alguien pueda correr dentro de un slot: borrar, reinstalar, podar, limpiar la caché, el comando de limpieza del propio gestor.
5. **Blindá solo lo que midió "atraviesa"** y dejá pasar lo demás: un guard que corta de más se desactiva a la semana.

`test/deps-link.test.js` ya hace esta medición para las operaciones comunes y **reporta lo que midió** en la plataforma donde corre (si una no se reproduce, lo dice como NOTA; no falla). Corrélo:

```bash
node --test test/deps-link.test.js
```

### La tabla: operación → ¿atraviesa el enlace?

Medida con la base, a modo de ejemplo (Windows 11, Node 24.14, git 2.33, npm 11.19, PowerShell 5.1, enlace = junction):

| Operación sobre/dentro del enlace | ¿Vacía el destino? |
|---|---|
| `unlink` / `rmdir` del enlace | **No** (quita el enlace) |
| `fs.rmSync(enlace, { recursive })` | **No** |
| `fs.rmSync(slot, { recursive })` con el enlace adentro | **No** |
| `rm -rf <slot>` | **No** |
| `cmd rmdir /s /q <slot>` | **No** |
| PowerShell `Remove-Item -Recurse -Force <slot>` | **No** |
| **`git worktree remove` con un enlace ANIDADO** | **Sí** |
| **`npm ci` con `node_modules` enlazado** | **Sí** (borra el contenido del destino) |

Esa tabla es **de esa plataforma**. Los comentarios del proyecto de origen decían que `rm -rf` y `Remove-Item -Recurse` atravesaban el enlace; la medición dijo que no. Otra versión de PowerShell, otro sistema o otro gestor pueden dar otra cosa. **Completá la tuya** para tu gestor:

| Operación | ¿Atraviesa? (medido) | Fecha / versión |
|---|---|---|
| `<gestor> install` (sin lockfile) | | |
| `<gestor> ci` / reinstalación limpia | | |
| `<gestor> prune` / `remove` / `uninstall` | | |
| `<gestor> cache clean` | | |
| borrado recursivo del slot (`rm -rf`, `Remove-Item`) | | |
| `git worktree remove` con un enlace anidado | | |
| comando de limpieza de la build de tu stack | | |

### El caso del enlace anidado

Una build puede dejar un enlace **dentro de un directorio de salida** (un bundler que copia el árbol y las dependencias a una carpeta `standalone`, por ejemplo): `<slot>/<repo>/<salida>/…/<dir de dependencias>` apunta a la principal. Nadie que lea la regla piensa en esa carpeta. Al cerrar el slot, `git worktree remove` recorrió el árbol, entró en ese enlace y vació el destino, y el mensaje decía "cerrado".

Por eso `manage-worktree.js clean` hace el barrido de **todos** los enlaces del árbol (con `lstat`; se quitan con `unlink`/`rmdir`, nunca con un borrado recursivo sobre un enlace) **antes** de `git worktree remove`, y si alguno sobrevive, aborta. Y por eso cuenta los ejecutables de la principal antes y después y avisa si bajó.

## 4. Adaptar al proyecto: paso a paso

1. **Identificá el directorio de dependencias de cada repo** y su lockfile. Mirá el `depsProfiles` de `ai/core/manifest.json`: hay perfiles `node` (`node_modules`), `python` (`.venv`) y `php` (`vendor`). Un repo sin directorio de dependencias propio (p. ej. uno que restaura en una caché global) **no necesita nada de esto**: no declares perfil.
2. **Declará el perfil** del repo en `ai-workspace.json`:
   ```json
   "repos": [{ "name": "<repo>", "path": "<ruta>", "deps": "node" }]
   ```
   o con campos pisados (`{ "profile": "node", "destructiveSubcommands": [...] }`), o un perfil completo propio (`{ "dir": "...", "lockfile": "...", "managers": [...], ... }`). Los packs del stack ya referencian su perfil (`worktree.deps.profile`).
3. **Corré la medición** (sección 3) y completá la tabla de tu gestor.
4. **Cargá lo medido en el perfil**: `managers` (los ejecutables del gestor), `destructiveSubcommands` (los subcomandos que midieron "atraviesa" o que reescriben el directorio) y `safeSubcommands` (los que midieron seguros). El hook `pre-bash-slot-deps` corta lo destructivo **solo con un slot de por medio**; en la principal es justo lo que hay que correr.
5. **Definí la salud** (`health`) y el **comando de reparación** (`repair`) que de verdad reinstala. Verificá que el que elegiste restaura archivos y no solo recrea enlaces de ejecutables (una reparación "liviana" deja el repo pareciendo sano y fallando más adelante).
6. **Revisá tu `.gitignore`**: un patrón con barra final (`node_modules/`) **no ignora un enlace** en Unix, y el enlace aparecería como "cambio sin commitear". Usá el nombre sin barra.
7. **Dejá el resultado** (la tabla completada, qué perfil, qué comandos se cortan y por qué) en una regla propia dentro de `ai/local/` (una por repo, o una sola). `ai/local/` es del proyecto: la actualización de la base no lo pisa.

## 5. Cómo sé que lo adapté bien (checklist)

- [ ] La tabla de mi gestor está completa, con **fecha y versiones**, y cada fila es una medición, no una suposición.
- [ ] `node scripts/check-deps.js` sale 0 en la principal, y sale 1 si vacío a propósito el directorio de ejecutables **sin cambiar el conteo de carpetas de primer nivel**.
- [ ] Una dependencia declarada **opcional** y no instalada **no** hace fallar `check-deps.js`.
- [ ] `check-deps.js` detecta el enlace **invertido** (el directorio de la principal siendo un enlace a un slot).
- [ ] Abrí un slot con `--link-deps`: el directorio está enlazado; con un lockfile distinto, **no** se enlaza y avisa.
- [ ] Dejé un enlace anidado a propósito (`<slot>/<repo>/<salida>/enlace` → principal), corrí `clean`, y la principal conserva sus ejecutables.
- [ ] Un comando destructivo de mi gestor, escrito dentro de un slot, es cortado por el hook; el mismo comando en la principal **pasa**; un comando seguro (`run`, `test`) dentro del slot **pasa**.
- [ ] Lo medido y decidido quedó en `ai/local/`.

## 6. Cómo verificarlo y repararlo

```bash
node scripts/check-deps.js [--repo <repo>] [--json]    # 0 sano · 1 roto · 2 no se pudo verificar
node scripts/check-deps.js --repo <repo> --fix          # corre profile.repair y vuelve a verificar
```

Verifica el **contenido**, no el conteo de carpetas: el directorio de ejecutables tiene al menos `health.minBin` entradas, y cada dependencia declarada (sin las opcionales) tiene su manifiesto instalado. Detecta el enlace invertido. `--fix` **no** repara un enlace invertido a ciegas: un reinstalador a través de él vaciaría el destino; hay que quitar el enlace primero.

Antes de reparar, parar lo que use ese directorio (dev server, watchers) y borrar las salidas de build: una build vieja de otra rama deja tipos generados apuntando a lo que ya no existe.

## 7. Si un slot necesita de verdad su propio árbol

Pasa: una rama que agrega una dependencia trae otro lockfile, y ahí `open` ya se niega a enlazar. **La decisión es del operador**, no del agente: instalar aparte son minutos y cientos de megas, y hacerlo por cuenta propia dentro de un slot enlazado es justo lo que vació la principal.
