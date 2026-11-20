# Create Branch

Crea una rama git con la nomenclatura estándar del proyecto. Si hay un rastreador de tickets integrado, consulta el título del ticket para construir el nombre.

## Activadores

- `/create-branch {PREFIJO}-XXX`
- `/create-branch {PREFIJO}-XXX {PREFIJO}-YYY`
- `crear rama {PREFIJO}-XXX`
- `nueva rama para {PREFIJO}-XXX`

El prefijo de ticket sale de `project.ticketPrefix` en `ai-workspace.json`.

---

## Regla bloqueante: la rama base es la declarada, no la que parezca

Cada repositorio declara su rama base en `repos[].baseBranch` de `ai-workspace.json`. **Toda rama nueva parte de ahí**, o de su equivalente remoto.

- Si la persona pide otra base, usar la que indique — pero **advertir y confirmar antes de hacer nada** si difiere de la declarada.
- Al crear la rama desde una referencia remota, verificar el upstream:
  ```bash
  git -C <repo> rev-parse --abbrev-ref @{u}
  ```
  Un upstream mal configurado hace que el push termine en la rama base aunque el nombre visible de la rama sea otro. **El nombre no determina el destino; el upstream sí.**

---

## Nomenclatura obligatoria

### Una sola tarea

```
feat/{PREFIJO}-XXX-Descripcion
fix/{PREFIJO}-XXX-Descripcion
```

### Varias tareas — un solo cambio que abarca varios tickets

```
feat/{PREFIJO}-XXX.{PREFIJO}-YYY-Descripcion-General
fix/{PREFIJO}-XXX.{PREFIJO}-YYY-Descripcion-General
```

### Reglas del nombre

| Regla | Detalle |
|---|---|
| Prefijo | `feat/` para funcionalidad, `fix/` para defectos |
| Identificadores | En orden numérico, separados por `.` si son varios |
| Descripción | Sin espacios, sin caracteres especiales, sin acentos |
| Longitud | Máximo 60 caracteres en total |
| Idioma | **Siempre inglés** — traducir si el título del ticket está en otro idioma |

Si el proyecto no declara `ticketPrefix`, el nombre es `feat/Descripcion` sin identificador.

---

## Paso 0: extraer los identificadores del pedido

Del mensaje de la persona extraer:

- **Identificadores**: normalizar siempre al formato `{PREFIJO}-XXX`, admitiendo que la persona escriba solo el número.
- **Prefijo explícito**: si escribió `feat` o `fix`, usar ese.
- **Descripción manual**: si la dio, usarla; si no, obtenerla del rastreador.
- **Repositorios objetivo**: contra los declarados en `repos[]`. Si no lo especificó, **preguntar**.

---

## Paso 1: consultar el rastreador de tickets

Si el proyecto tiene un rastreador integrado — típicamente vía una herramienta MCP — consultarlo por cada identificador y extraer el título y el tipo de incidencia.

### Inferir el prefijo

| Tipo de incidencia | Prefijo |
|---|---|
| Defecto / Bug | `fix` |
| Historia, Épica, Tarea, Subtarea, Funcionalidad | `feat` |
| Desconocido | `feat` |

Si la persona especificó `feat` o `fix` explícitamente, **usar el suyo e ignorar el rastreador**.

**Si no hay rastreador integrado**, pedirle la descripción a la persona. No inventar un título.

---

## Paso 2: construir el nombre

1. Tomar el título, del rastreador o de la persona.
2. **Traducirlo al inglés** si está en otro idioma. Obligatorio.
3. Transliterar: quitar tildes y diacríticos.
4. Eliminar caracteres especiales.
5. Capitalizar cada palabra.
6. Unir con guiones.

Ejemplo, con prefijo `ABC`: un título `"Algoritmo de rotación de cuentas"` produce `feat/ABC-360-Rotation-Algorithm`.

---

## Paso 3: confirmar antes de ejecutar

Mostrar la propuesta:

```
Nombre de la rama: feat/ABC-360-Rotation-Algorithm
Repositorio(s):    mi-api
Base:              develop

¿Confirmás?
```

Si la persona rechaza, pedir corrección y volver al Paso 2.

---

## Paso 4: crear la rama

### En un slot de worktree — preferido si hay otro trabajo activo

Si la persona pidió trabajo paralelo, nombró un slot, o los repositorios principales tienen cambios que no deben moverse, **no** ejecutar checkout en el repositorio principal. Usar el gestor de slots (ver el procedimiento `worktree-slots`), que crea la rama desde la base remota sin mover la rama en la que está trabajando la persona.

Los slots disponibles están declarados en `worktrees.slots` de `ai-workspace.json`.

### En el repositorio principal — solo con orden explícita

```bash
git -C {REPO_PATH} fetch origin
git -C {REPO_PATH} checkout {BASE}
git -C {REPO_PATH} pull origin {BASE}
git -C {REPO_PATH} checkout -b {NOMBRE_RAMA}
```

---

## Paso 5: confirmar el resultado

Para cada repositorio, mostrar el nombre de la rama creada, el repositorio y la base.

Si falla algún paso:

1. Detener inmediatamente.
2. **No** forzar con `--force`.
3. Mostrar el error completo.
4. Proponer una solución y esperar instrucción.

---

## Advertencias críticas

- ❌ Nunca ramificar desde una base distinta a la declarada sin advertirlo y confirmarlo.
- ❌ No crear la rama sin confirmar primero.
- ❌ No usar `--force` ni `--no-verify` bajo ninguna circunstancia.
- ❌ No hacer push de la rama: este procedimiento solo la crea localmente.
- ❌ No asumir el repositorio si no se especificó.
- ❌ No ejecutar checkout en el repositorio principal si la persona pidió un slot, o si hay otro trabajo activo ahí.
- ✅ Si son varios repositorios, crear la rama en todos los indicados.

---

## Input

Identificadores de ticket (obligatorio si el proyecto usa rastreador), repositorios objetivo (si falta, preguntar), prefijo y descripción (opcionales).

## Output

El nombre propuesto con su confirmación, y el resultado de la creación en cada repositorio.
