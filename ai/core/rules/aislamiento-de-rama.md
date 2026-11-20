# Regla — Aislamiento de rama

**Fuente única de verdad.** Los agentes de revisión y de auditoría la **referencian**: no la copian.

**Por qué es una regla aparte.** El mismo bloque de aislamiento estaba copiado en cinco agentes y cada copia evolucionó por su lado: cuando se agregó la línea `REVIEW_ROOT:` hubo que tocar cinco archivos, y una de las copias quedó con la instrucción vieja. Se extrae una vez y los agentes la citan.

---

## La regla

**En el repositorio principal nunca se hace `git checkout`, `git switch`, `git reset` ni `git clean`.** La persona ya está parada ahí, con trabajo sin commitear, y mover el piso le rompe lo que tiene.

Tampoco se crean worktrees efímeros ni carpetas temporales para revisar: para una rama distinta se usa el slot que provee el procedimiento `worktree-slots`, y solo ese.

## `REVIEW_ROOT`

La herramienta que lanza subagentes **no fija su directorio de trabajo**: un subagente arranca en la raíz del workspace aunque el orquestador esté mirando un slot.

Por eso, cuando la revisión no es de la rama actual en la principal, el orquestador pone como **primera línea** del prompt:

```
REVIEW_ROOT: <ruta del repositorio, dentro del slot>
```

Si el prompt trae esa línea, **esa ruta es la raíz de trabajo**: toda ruta de repositorio y todo `git -C <repo>` se leen contra `REVIEW_ROOT`. Leer la principal en ese caso revisa otra rama, y las líneas citadas no son las del cambio.

Si el prompt no trae la línea, la revisión es de la rama actual en la principal: se trabaja sobre el repositorio declarado en `ai-workspace.json`.

## Lo que el agente de revisión no hace

- No edita archivos, no commitea, no mueve ramas.
- No crea ni limpia slots: los gestiona `worktree-slots`.
- No ejecuta migraciones ni escribe sobre servicios compartidos (base de datos, cachés, colas) entre el workspace principal y los slots: son uno solo para todos.

## Cómo se acredita

Al terminar, el agente reporta la rama y `git -C <raíz> status --porcelain` de lo que revisó. Si el estado cambió respecto de antes de empezar, algo mutó el árbol y hay que decirlo.

## Cómo aplicarlo en tu proyecto

Los slots y sus nombres salen de `worktrees` en `ai-workspace.json`; la ruta de un repositorio dentro de un slot, de `scripts/lib/worktree-paths.js`. Si el proyecto tiene sus propios agentes de revisión en `ai/local/agents/`, que abran con una referencia a este archivo en vez de pegar el bloque.
