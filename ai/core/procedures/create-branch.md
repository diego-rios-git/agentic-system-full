# Create Branch

Crea una rama git con la nomenclatura estándar del proyecto, a partir de su rama base. Si hay un rastreador de tickets integrado, consulta el título del ticket para construir el nombre, y al final registra que el trabajo empezó (evento "rama creada" de `tracker-events`).

## Activadores

- `/create-branch {PREFIJO}-XXX`
- `/create-branch {PREFIJO}-XXX {PREFIJO}-YYY`
- `crear rama {PREFIJO}-XXX`
- `nueva rama para {PREFIJO}-XXX`

El prefijo de ticket sale de `project.ticketPrefix` en `ai-workspace.json`. El mismo identificador es el que lleva después el commit (`commits.format`): una rama y un commit que nombran tickets distintos son un error de trazabilidad.

---

## Regla bloqueante: la rama base es la declarada, no la que parezca

Cada repositorio declara su rama base en `repos[].baseBranch` de `ai-workspace.json`. **Toda rama nueva parte de ahí**, de su equivalente remoto (`origin/<base>`).

- Si la persona pide otra base, usar la que indique, pero **advertir y confirmar antes de hacer nada** si difiere de la declarada.
- **Si la base local está atrasada** respecto del remoto, avisarlo: la rama se crea desde `origin/<base>` (que es lo vigente) y no desde la local, y la persona tiene que saber que su copia local no está al día.
  ```bash
  git -C <repo> fetch origin <base>
  git -C <repo> rev-list --count <base>..origin/<base>    # > 0: la base local está atrasada
  ```
- **El upstream de una rama nueva tiene que estar vacío** hasta el primer push. Una rama creada desde una referencia remota hereda, por defecto, esa referencia como upstream: el push posterior terminaría en la rama base aunque el nombre visible sea otro. **El nombre no determina el destino; el upstream sí.** Se crea sin seguimiento y se verifica (Paso 5).

---

## Nomenclatura obligatoria

### Una sola tarea

```
feat/{PREFIJO}-XXX-Descripcion
fix/{PREFIJO}-XXX-Descripcion
```

### Varias tareas: un solo cambio que abarca varios tickets

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
| Idioma | **Siempre inglés**: traducir si el título del ticket está en otro idioma |

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

Según `tracker.kind` en `ai-workspace.json`:

- **`none`**: no hay rastreador. Pedirle la descripción a la persona. **No inventar un título.**
- **otro**: consultarlo con la herramienta que declare su guía (`tracker-jira-adaptar`, `tracker-github-adaptar`) por cada identificador, y extraer el título y el tipo de la tarjeta. Al leerla, aplica el evento 1 de `tracker-events`: se mira el responsable y, si es otra persona, se dice y se ofrece autoasignar; no se reasigna.

### Inferir el prefijo

| Tipo de tarjeta | Prefijo |
|---|---|
| Defecto / bug | `fix` |
| Historia, épica, tarea, subtarea, funcionalidad | `feat` |
| Desconocido | `feat` |

Si la persona especificó `feat` o `fix` explícitamente, **usar el suyo e ignorar el rastreador**.

Si el rastreador falla, **no bloquea**: se pide la descripción a la persona y se sigue (`tracker-events`, regla 8).

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
Base:              origin/{BASE}   (la local está 3 commits atrás)
Dónde:             slot implementation-1   |   repositorio principal

¿Confirmás?
```

Si la persona rechaza, pedir corrección y volver al Paso 2.

---

## Paso 4: crear la rama

### Con `worktrees.enabled`: en un slot, por defecto

Si el proyecto tiene slots (`worktrees.enabled` en `ai-workspace.json`), **la rama se abre en un slot de implementación** y no con `checkout` en el repositorio principal. Es el valor por defecto: el principal queda donde estaba, y la persona puede seguir con lo suyo.

```bash
node scripts/manage-worktree.js open --slot <slot> --repo <repo> --branch <nombre-de-la-rama> [--base <rama-base>]
```

Los slots disponibles están declarados en `worktrees.slots`. El comando crea la rama desde la base remota del repositorio sin mover la rama principal; qué slot elegir, y cómo ver cuáles están libres, lo dice `worktree-slots` (`manage-worktree.js status`). Si la persona no nombró slot y hay más de uno libre, **preguntar**: no se elige uno por ella.

Con varios repositorios, `--repo <repo>` por cada uno, o `--all`.

### En el repositorio principal: con orden explícita, o si no hay slots

Solo si la persona lo pidió expresamente, o si `worktrees.enabled` es falso:

```bash
git -C {REPO_PATH} fetch origin {BASE}
git -C {REPO_PATH} checkout -b {NOMBRE_RAMA} --no-track origin/{BASE}
```

**Sin `pull`**: la rama sale de `origin/{BASE}` directamente, así que no hace falta mover ni actualizar la base local. `--no-track` es lo que deja el upstream vacío.

---

## Paso 5: verificar el upstream

```bash
git -C {REPO_PATH} rev-parse --abbrev-ref @{u}
```

Para un slot, `{REPO_PATH}` es `<worktrees.dir>/<slot>/<repo>`.

El resultado correcto es **un error** ("no upstream configured") o vacío. Si devuelve `origin/{BASE}` (o cualquier rama que no sea la propia), **corregirlo antes de seguir**:

```bash
git -C {REPO_PATH} branch --unset-upstream
```

Y decirlo. El primer push será `git push -u origin {NOMBRE_RAMA}`, con el nombre explícito (`git-commit-workflow`).

---

## Paso 6: confirmar el resultado y registrar que empezó

Para cada repositorio, mostrar el nombre de la rama creada, el repositorio, la base y el lugar (slot o principal).

**Con la rama creada y el upstream verificado, y no antes**, aplicar el evento 2 de `tracker-events` ("rama creada" pasa la tarjeta a "En curso"; sin tracker, solo mueve la ficha del tablero si corresponde; sin tablero, no hace nada). Con varios identificadores, se mueven **todos**. Si el tracker falla, se dice que la tarjeta quedó sin mover y se sigue.

Si falla algún paso de la creación:

1. Detener inmediatamente.
2. **No** forzar con `--force`.
3. Mostrar el error completo.
4. Proponer una solución y esperar instrucción.

---

## Advertencias críticas

- Nunca ramificar desde una base distinta a la declarada sin advertirlo y confirmarlo.
- No crear la rama sin confirmar primero.
- No usar `--force` ni `--no-verify` bajo ninguna circunstancia.
- No hacer push de la rama: este procedimiento solo la crea localmente.
- No asumir el repositorio si no se especificó.
- No hacer `checkout` en el repositorio principal si hay slots disponibles y la persona no lo pidió expresamente, ni si hay otro trabajo activo ahí.
- No mover la tarjeta antes de que la rama exista y su upstream esté verificado.
- Si son varios repositorios, crear la rama en todos los indicados.

---

## Input

Identificadores de ticket (obligatorio si el proyecto usa rastreador), repositorios objetivo (si falta, preguntar), prefijo y descripción (opcionales), slot (opcional).

## Output

El nombre propuesto con su confirmación, el resultado de la creación en cada repositorio (con el upstream verificado) y el estado de la tarjeta.
