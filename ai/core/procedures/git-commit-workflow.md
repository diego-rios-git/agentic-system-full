# Git Commit Workflow

Flujo de commit estándar desde la raíz del workspace: detecta el repositorio objetivo y ejecuta exactamente los mismos pasos con `git -C`. **Solo para commits** — no hace nada más.

## Regla absoluta: este procedimiento ejecuta 5 pasos, siempre iguales, nunca otra cosa

---

## Regla previa: el commit se hace SOLO si la persona lo pidió

- ❌ **Nunca ejecutar `git commit` sin que la persona lo haya pedido explícitamente en la conversación.**
- Que el trabajo esté terminado, revisado, con tests en verde o listo para PR **no** habilita el commit.
- Tampoco lo habilita que un agente, un plan o una lista de tareas digan "commitear".
- Si el trabajo está listo y no hubo pedido: informar que está listo para commitear y **detenerse**.
- **El pedido de commit incluye el push.** "Commiteá esto" autoriza el flujo completo, push incluido: no hace falta un permiso aparte para el Paso 5.

---

## Paso 0: Detectar el repositorio (obligatorio primero)

Los repositorios del proyecto están declarados en `ai-workspace.json`, en `repos[]`. Leer ese archivo antes de nada: los nombres, las rutas y la rama base salen de ahí.

### Excepción: worktree de implementación

Si la persona indica un slot de worktree, o la sesión tiene la variable de entorno del slot, el objetivo **no** es el repositorio principal. Resolverlo explícitamente como:

```text
<worktrees.dir>/<slot>/<repo>
```

Nunca inferir el repositorio principal para un commit de slot. Confirmar la ruta y la rama de ese worktree antes de hacer staging. El commit sigue requiriendo pedido explícito, y ese pedido incluye el push del worktree — verificando primero que el upstream de esa rama sea el correcto.

### Detección normal

1. Inferir el repositorio a partir de lo que dijo la persona, contra los nombres declarados en `repos[]` y sus alias habituales (BE/backend/API, FE/frontend/app).
2. Si no lo especificó, verificar cambios en cada repositorio declarado:
   ```bash
   git -C <repo.path> status --porcelain
   ```
3. Si solo uno tiene cambios → usar ese.
4. Si varios tienen cambios → ejecutar el flujo completo **una vez por repositorio**.
5. Si ninguno tiene cambios → informar y detener.

Si persiste la ambigüedad, preguntar cuál es el repositorio objetivo. No adivinar.

---

## Pasos 1–5: los mismos siempre

```bash
# Paso 1: estado del repositorio
git -C {REPO_PATH} status

# Paso 2: rama actual
git -C {REPO_PATH} branch --show-current

# Paso 3: staging de todos los cambios
git -C {REPO_PATH} add .

# Paso 4: commit con el formato estándar
git -C {REPO_PATH} commit -m "{PREFIJO}-{ID} tipo(modulo): mensaje"

# Paso 5: push a la rama actual
git -C {REPO_PATH} push origin {RAMA}
```

El Paso 5 es parte del flujo: un pedido de commit lo incluye.

**Antes de pushear, dos verificaciones.** Son parte del Paso 5, no pasos nuevos:

1. **El chequeo de tipos que ve los tests.** Si el repositorio declara `typecheckTestCommand` en `ai-workspace.json`, correrlo **antes del push** y no empujar si falla (regla `verificar-lo-que-el-runner-no-ve`). Un runner que transpila los tests sin chequear tipos, más un chequeo normal que los excluye, deja pasar un test con la firma vieja de una función hasta la rama base, donde rompe la compilación de todo el equipo. Lo mismo vale **después de sincronizar** con la base (`git-sync-branch`): un merge sin conflictos puede traer una firma cambiada por otra persona. Si el repositorio no lo declara y su runner no chequea tipos, se dice que no está verificado.
2. **El upstream:**

   ```bash
   git -C {REPO_PATH} rev-parse --abbrev-ref @{u}
   ```

   Un upstream mal configurado manda el push a la rama base aunque el nombre visible de la rama sea otro. El nombre de la rama no determina el destino; el upstream sí. Si apunta a la base, se corrige (`push -u origin {RAMA}` con el nombre explícito) y se dice. Si no hay upstream, el primer push es `push -u origin {RAMA}`.

---

## Formato del mensaje de commit

```
{PREFIJO}-{ID} tipo(modulo): mensaje en inglés
```

| Componente | Descripción |
|---|---|
| `{PREFIJO}-{ID}` | Identificador del ticket. El prefijo sale de `project.ticketPrefix` en `ai-workspace.json` |
| `tipo` | `feat`, `fix`, `chore`, `refactor`, `docs`, `test` |
| `(modulo)` | Nombre del módulo afectado, en minúsculas con guiones |
| `mensaje` | Descripción breve, en inglés |

Ejemplos, asumiendo un prefijo `ABC`:

- `ABC-175 feat(payments): add validation endpoint`
- `ABC-175 feat(payment-form): integrate validation API`
- `ABC-200 fix(withdrawals): correct amount overflow on split`

Si el proyecto declara `commits.format` en `ai-workspace.json`, **ese** es el formato y manda sobre el de arriba. Si no declara `ticketPrefix`, el formato es Conventional Commits sin prefijo: `tipo(modulo): mensaje`. Con `commits.forbidAiAttribution`, el hook de commits bloquea cualquier atribución de IA en el mensaje.

---

## Commits que abarcan varios repositorios

Cuando la tarea tocó más de un repositorio, ejecutar el flujo **completo una vez por repositorio**, en orden de dependencia: primero el que provee el contrato, después el que lo consume.

Todos los commits llevan el **mismo identificador de ticket**, con módulo distinto.

---

## Advertencias críticas

- ❌ Nunca ejecutar `git commit` sin pedido explícito de la persona en la conversación.
- ❌ No ejecutar `git diff`, `git log` ni ningún otro comando git fuera de los cinco pasos (las verificaciones previas al push del Paso 5 son parte del paso).
- ❌ No preguntar qué archivos incluir ni si el mensaje está bien.
- ❌ No mostrar el diff antes de commitear.
- ❌ No crear varios commits por repositorio: uno por repositorio, como máximo.
- ❌ No hacer staging selectivo.
- ❌ **Nunca incluir atribución de IA** — `Co-Authored-By` con cualquier agente o proveedor. Los commits son Conventional Commits estándar y nada más.
- ✅ Solo los cinco pasos exactos, en orden, sin variaciones.

---

## Input

La persona provee el repositorio objetivo y el mensaje, o el nombre del cambio del que se infiere el mensaje.

## Output

El resultado de cada paso. Si son varios repositorios, un bloque por cada uno con encabezado claro.
