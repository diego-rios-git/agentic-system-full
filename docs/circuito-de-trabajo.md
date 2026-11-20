# El circuito de trabajo

Cómo se trabaja de punta a punta con esta base: desde que se piensa un requisito hasta que se mergea, y cómo cada error que aparece en el camino mejora el sistema. Es lo que dejó de ser una pieza suelta en la 1.2.0.

Nada de lo que sigue asume un lenguaje, un framework, un tracker ni un host de PRs. Lo que depende del proyecto se declara en `ai-workspace.json` o va en un **pack**; y lo que depende de *cómo lo hace tu proyecto* viene como **guía** que un agente sin contexto lee y adapta, en vez de código que fingiría servirle a todos.

---

## El recorrido

```
REQUISITO        redactar-requisito → ficha en el tablero      (check-requirements)
   │
   ▼
SLOTS EN PARALELO   create-branch → open en un slot            (manage-worktree)
   │                spec-propose → tests en rojo → implementar
   │                hooks vigilan: secretos, rutas protegidas, dependencias, migraciones
   │                cerrar-ticket, fase 1 (precierre, en el slot y en paralelo):
   │                git-sync-branch → run-checks + run-gates (una vez)
   │                pr-review modo S (agentes sin contexto) → corregir → archivar
   │                punto de control (solo sin autorización) → commit y push
   ▼
PRINCIPAL          fase 2, POR TURNO: turn → promote → migraciones   (la base y los
   │               prueba-e2e → release, que despierta al siguiente   puertos son únicos)
   ▼
CIERRE             fase 3, sin la principal: PR → mover la ficha/tarjeta → merge
   ▼
MEJORA DEL SISTEMA gate-from-finding: todo error confirmado se vuelve una verificación
                   automática, o queda en el registro con la razón de por qué no se pudo
```

Cada paso está en un procedimiento que el agente carga solo cuando hace falta. `cerrar-ticket` los ordena; no los reemplaza.

---

## Slots: varias tareas a la vez, una sola base de datos

La base de datos y los puertos son únicos, así que lo que no se puede paralelizar ocurre en **la principal**, que queda libre mientras tanto.

```bash
node scripts/manage-worktree.js open --slot implementation-1 --repo mi-api --branch feat/ABC-1-algo
#   …código, tests, y se GENERA la migración (no se corre), commit y push, todo en el slot…
node scripts/run-gates.js --repo mi-api --from implementation-1     # los gates leen del slot
#   …review y correcciones también en el slot (pr-review modo S)…
node scripts/manage-worktree.js turn --slot implementation-1 --session <nombre>   # 0: es tuyo · 3: en cola
node scripts/manage-worktree.js promote --slot implementation-1 --repo mi-api
#   …la principal tiene la rama: migrar y e2e…
node scripts/manage-worktree.js release                             # vuelve a la base y pasa el turno
#   …PR y merge, sin la principal…
```

- **El turno de la principal.** Varias sesiones cierran tickets a la vez; la principal la usa una por vez, en orden de llegada, y solo para migrar y probar. La que queda en cola no espera con un loop: la despierta con un mensaje la que hace `release`. Guía de uso con el prompt de cada caso: [`docs/trabajo-en-paralelo.md`](trabajo-en-paralelo.md).

- **`open`** en una rama nueva la crea desde `origin/<base>` **sin upstream**. Con upstream a la base, "Sync Changes" del editor empuja trabajo a la rama base.
- **El slot `review`** se reutiliza: pasa a otra rama si está limpio, en detached y su HEAD está contenido en alguna rama. Los slots de implementación **no** se reusan.
- **`promote` / `release` verifican todo antes de tocar nada** y se niegan, sin `--force`, si hay cambios sin commit, commits sin pushear o un upstream equivocado. `promote` además exige el turno.
- **`clean`** nunca borra trabajo: se niega con cambios sin commit, y un directorio sin `.git` con archivos lo nombra y no lo toca.
- **Dependencias compartidas.** Un slot enlaza el directorio de dependencias del principal (junction en Windows, symlink en Unix) en vez de reinstalar. El riesgo es que una reinstalación dentro del slot atraviese el enlace y vacíe el del principal. Qué operación destruye y cuál no **se mide, no se supone**: ver `ai/core/procedures/shared-dependencies.md`.
- **Status line.** Muestra el slot, las ramas, el modelo con su esfuerzo, el contexto y el costo. El slot es una *inferencia* (cwd, y si no, la última herramienta usada); sus límites están en `worktree-slots.md`.

---

## Los gates y lo que significa cada resultado

```bash
node scripts/run-gates.js --repo mi-api [--from <slot>] [--base <ref>] [--json] [--todo]
node scripts/run-checks.js --repo mi-api [--from <slot>] [--scope diff|full]
```

Cada gate corre **una vez** y el resultado se pega en el prompt de cada revisor. Hay tres estados y solo uno es verde:

| Estado | Qué significa |
|---|---|
| **Sin hallazgos** | Se verificó y no hay nada |
| **NO CORRIÓ** (con el motivo) | No aplica a este repo: no hay tablero, no hay reglas de co-cambio, el stack no consulta la base |
| **NO SE PUDO EJECUTAR** | Debía correr y no pudo: herramienta ausente, base ilegible, tiempo agotado |

Los dos últimos son **"sin verificar"**, nunca "limpio". Es el invariante que sostiene toda la base.

- Los hallazgos se separan en los del **diff** y los de afuera; el exit code solo cuenta los del diff.
- Un repo **sin remoto** compara contra su rama local. Con remoto compara contra `origin/<base>`: una base local atrasada cuela en el diff cambios ya mergeados.
- `--write-baseline` desde un slot se rechaza: congelaría la deuda de una rama sin mergear.

Gates nuevos de la 1.2.0: `unreachable` (código nuevo que nadie importa), `encoding` (texto con la codificación rota), `cochange` (quien toca X regenera Y), `verify-rules` (toda regla trae sus dos fixtures), `requirements` (tablero), `gate-candidates` (el registro) y, con el pack `e2e`, el linter de scripts de pruebas.

---

## Hooks y status line

Se declaran en el `manifest.json` de su origen con eventos neutrales (`pre-write`, `post-write`, `pre-bash`) y se registran en cada harness con:

```bash
node scripts/consolidate-skills.js --wrappers       # registra
node scripts/consolidate-skills.js --check          # ¿hay algo fuera de sincronía?
```

**Editar a mano `.claude/settings.json` para agregar un hook de la base está prohibido**: la próxima actualización no lo sabría. Lo que el proyecto tiene por su cuenta (permisos, hooks propios, su propia status line) no se toca. Un registro heredado de la base —el relativo de la 1.1.0, o uno escrito a mano— se **adopta**: se reemplaza por el administrado y se avisa, para que el mismo script no corra dos veces.

| Hook | Se instala cuando | Qué impide |
|---|---|---|
| `pre-write-secrets` | siempre | un secreto pegado en un archivo |
| `post-edit-checks` | siempre | feedback tarde: corre el gate del archivo editado |
| `pre-write-protected` | un pack o el proyecto declara `protectedPaths` | escribir o editar a mano un archivo generado (migraciones) |
| `pre-bash-slot-deps` | `worktrees.enabled` | reinstalar o borrar dependencias dentro de un slot |
| `pre-bash-slot-migrations` | `worktrees.enabled` y `repos[].database` | migrar, sembrar o generar migraciones contra la base compartida desde un slot |
| `pre-commit-attribution` | `commits.forbidAiAttribution` | atribución de IA en el mensaje de un commit |
| `pre-commit-gates` | `hooks.pre-commit-gates.enabled` | commitear con hallazgos del diff |
| `pre-bash-heredoc` | `hooks.pre-bash-heredoc.enabled` | heredocs que la shell de Windows corrompe |

Cualquiera se apaga con `"hooks": { "<id>": { "enabled": false } }`. Una autorización para editar una ruta protegida la crea **la persona**, no el agente: `node scripts/allow-protected-edit.js <archivo> [--minutes N]`.

OpenCode recibe los mismos hooks como plugins generados que delegan en el mismo script. No tiene un evento equivalente a `post-write`, y `consolidate-skills` lo dice.

---

## Qué se configura

Todo es opcional: un `ai-workspace.json` de 1.1.0 sigue siendo válido y no activa nada nuevo. Ver `templates/ai-workspace.example.json`.

| Campo | Para qué |
|---|---|
| `tracker.kind` | `none` · `jira` · `github`. Sin tracker, el agente mueve la ficha del tablero si hay uno, y si no, no hace nada |
| `forge.kind` | `none` · `github` · `bitbucket` · `gitlab`: dónde se abre el PR |
| `worktrees.slots` | texto o `{ name, kind: implementation \| review }` |
| `repos[].database` | la base compartida: qué comandos escriben, cuáles generan, cuáles leen, y el comando alternativo para generar |
| `repos[].deps` | solo si no hay pack: `"node"`, `"python"`, `"php"` o un perfil propio |
| `repos[].consumes` | de qué repos depende: define el orden de merge |
| `repos[].typecheckTestCommand` | el chequeo de tipos que **sí** mira los tests |
| `commits`, `hooks`, `protectedPaths` | ver la tabla de hooks |
| `requirements` | el tablero de requisitos |
| `autonomous` | `trabajo-por-sesion`: una sesión sin interacción por tarea |
| `e2e`, `review.outputDir` | pack `e2e` y review de una rama ajena |

---

## Lo que viene como guía y no como código

Para un agente sin contexto: cada una trae el problema, el incidente, el método, cómo adaptarlo a *tu* stack, una checklist de "cómo sé que lo adapté bien" y dónde dejar el resultado (`ai/local/`).

| Guía | Qué te enseña a armar |
|---|---|
| `shared-dependencies` | medir qué operación destruye el directorio de dependencias compartido de tu gestor, antes de blindarlo |
| `shadow-migration` | generar migraciones contra una base descartable, para tu ORM y tu motor |
| `domain-gate` | un gate a partir de una regla de dominio escrita (dinero, fechas con zona, datos personales) |
| `prueba-e2e` y, en el pack `e2e`, `armar-kit-e2e` | la prueba de punta a punta de tu app y el kit de helpers |
| `tracker-jira-adaptar`, `tracker-github-adaptar` | cómo se mueven las tarjetas en tu tracker |
| `contrato-backend-frontend` (pack `fullstack`) | quién manda cuando dos repos comparten un contrato |
| `metodo-analista` y el resto del pack `analisis-funcional` | sacar fichas de un documento, cambiarlas, revisarlas y cruzarlas con el código; lo propio del proyecto va en `analisis.md` de `ai/local/` |

Hay variantes ya hechas donde el stack es conocido: `ai/packs/nestjs/scripts/migration-generate-shadow.js` (TypeORM + PostgreSQL).

---

## Qué NO hace

- **No corre migraciones ni toca la base compartida** desde un slot, y no las corre sin que la persona lo pida.
- **`cerrar-ticket` es un esqueleto**: no tuvo una primera corrida guiada de punta a punta en un proyecto con la base. Pasa lo mismo con `prueba-e2e`. El turno de la principal sí corrió en otro proyecto, con su script en PowerShell; acá se probó con tests contra git de verdad.
- **Despertar a otra sesión** necesita que el harness pueda mandarle un mensaje (en Claude Code, `SendMessage`). Sin eso, la que libera la principal le avisa al operador.
- **Los comandos de lanzamiento de sesión** (`launch`, `headless`) de cada harness no se probaron contra la herramienta real; el mecanismo sí.
- **El guard de dependencias** no ve un borrado hecho desde un programa (`node -e`, `find -delete`) ni `git clean -x`.
- **Los límites de la status line** (es una inferencia) están en `ai/core/procedures/worktree-slots.md`.
