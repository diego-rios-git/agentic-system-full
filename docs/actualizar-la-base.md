# Actualizar la base

Cómo traer a un proyecto ya generado las mejoras publicadas en la base agéntica.

---

## Por qué no es un `git merge`

*Use this template* crea un repositorio **sin historia compartida** con la plantilla. No hay antepasado común, así que no hay merge posible.

`template-sync` no usa git para decidir: compara **hashes** contra `template.lock.json`, el registro que se escribió al instalar. Eso le permite responder, archivo por archivo, la única pregunta que importa: *¿este archivo sigue como lo dejó la base, o alguien lo cambió acá?*

---

## Los tres comandos

```bash
node scripts/template-sync.js --dry-run          # ver qué cambiaría, sin escribir
node scripts/template-sync.js                    # aplicarlo
node scripts/consolidate-skills.js --wrappers    # solo si cambiaron activos (el sync avisa)
```

**Leer la salida del `--dry-run` antes de aplicar.** No es una formalidad: ahí aparecen las dos categorías que necesitan decisión, y ninguna de las dos se resuelve sola.

### Qué hace con cada archivo

| Situación | Qué hace |
|---|---|
| Está igual que en el registro | Lo pisa. Nadie lo tocó |
| Cambió en este proyecto | **No lo toca.** Lo reporta como divergente |
| Es nuevo en la base | Lo agrega |
| La base lo eliminó | Lo reporta. **No lo borra** |
| Es del proyecto | Ni lo mira |

Lo que nunca se toca: `ai/local/`, `ai-workspace.json`, los baselines, `CLAUDE.md`, `AGENTS.md`, `README.md`, `INVENTORY.md`.

---

## Las dos categorías que necesitan decisión

### Divergentes

Un archivo de la base que alguien editó acá. El sync lo respeta y no lo actualiza, para no borrar ese trabajo sin avisar.

**Resolverlos, no dejarlos.** Un archivo del núcleo que se queda atrás mientras el resto avanza puede dejar una combinación que no funciona: si un script viejo depende de un módulo que cambió de forma, falla. Y el sync los va a seguir reportando en cada corrida hasta que se resuelvan.

Tres salidas:

1. **Llevar el cambio a `ai/local/`.** Un procedimiento con el mismo nombre en `ai/local/` gana sobre el del núcleo, y el sync nunca lo toca. Es la vía limpia para una adaptación que solo vale en este proyecto.
2. **Descartar el cambio local** y quedarse con la versión de la base: `--force`.
3. **Fusionar a mano**, si el cambio local sigue teniendo sentido con lo nuevo.

### Eliminados

Un archivo que la base ya no tiene. No se borra solo: puede que el proyecto todavía lo use. Revisar y borrar si corresponde.

---

## Qué NO llega solo

**Los packs.** El sync trae únicamente los packs declarados en `ai-workspace.json`. Si la base publicó un pack nuevo y el proyecto lo quiere, primero se declara y después se vuelve a sincronizar:

```json
{ "name": "mi-api", "path": "mi-api", "packs": ["dotnet"] }
```

```bash
node scripts/template-sync.js
```

Esto vale también para un pack que se descartó al instalar: agregarlo a la configuración y sincronizar lo trae de vuelta. No hace falta clonar la plantilla ni copiar nada a mano.

---

## Después de actualizar

```bash
npm test                                    # si el proyecto tiene los tests de la base
node scripts/run-gates.js --all
```

**Un CI que pasa de verde a rojo no siempre es una regresión.** Hay dos motivos legítimos, y conviene descartarlos antes de dar marcha atrás:

- **Gates que antes reportaban limpio sin haber corrido.** Si estaban en verde con la herramienta ausente o el repositorio sin clonar, no estaban verificando lo que parecía.
- **Código que nunca fue analizado.** Al instalar el pack de un lenguaje que la base antes ignoraba, aparecen los hallazgos que estuvieron ahí desde el primer día.

Para el segundo caso, congelar la deuda preexistente antes de leerla como problema nuevo:

```bash
node scripts/check-antipatterns.js --repo <repo> --write-baseline
```

Eso es lo mismo que hace `init.js` al instalar: el gate arranca en silencio y solo habla de lo que se agrega desde ahora. Ver `scripts/baseline-report.js` para revisar después qué quedó congelado.

---

## Si algo no funciona

### «No hay template.lock.json»

El sync sale con código 2. Pasa cuando se copió el árbol sin correr `init.js`, o cuando el registro se perdió. Dos salidas:

```bash
node init.js                                        # genera el registro
node scripts/template-sync.js --from ../agentic-system   # sincronizar contra una copia local
```

### «No se pudo clonar»

El sync clona la plantilla desde la URL guardada en el registro. Si el repositorio es privado, hacen falta credenciales de git donde corre el comando. `--from` evita la red por completo.

### El comando corre y no trae nada

El sync clona la **rama por defecto** de la plantilla. Un cambio que todavía vive en una rama sin mergear no llega: hay que esperar a que esté en la rama principal.

---

## Actualizar a 1.1.0 desde 0.1.0

La primera actualización grande de la base. Qué esperar, en concreto.

**No hay migración.** `ai-workspace.json` sigue en `version: 1` y todos los campos que se agregaron son opcionales. La versión entera se adopta con un `template-sync` y nada más.

**Un archivo huérfano.** El gate de cobertura de escenarios, que vivía en el subdirectorio `scripts` del pack `openspec`, aparece como eliminado: subió al núcleo —hoy es `scripts/check-scenario-coverage.js`— porque verifica un contrato y no una herramienta concreta. El archivo viejo se puede borrar: ya no lo declara ningún manifiesto, así que no se ejecuta.

**Divergentes con riesgo.** Los escáneres pasaron a resolver qué archivos analizar a través de `scripts/lib/languages.js`. Si `check-antipatterns.js`, `check-duplication.js` o `check-tenant-isolation.js` aparecen como divergentes, hay que resolverlos: una versión vieja de cualquiera de los tres conviviendo con el resto falla.

**Para que un repositorio que no es de JavaScript deje de estar sin analizar**, hay que instalar el pack de su lenguaje. Antes de esta versión los gates no miraban un solo archivo `.cs`, `.java` o `.go` y aun así reportaban "sin hallazgos":

```json
{ "name": "mi-api", "path": "mi-api", "packs": ["dotnet"] }
```

Y después calibrar la baseline, porque van a aparecer todos los hallazgos que nunca se vieron.

**Opcional.** `pip install semgrep` habilita el gate de reglas estructurales. Sin él ese gate sale con código 2 —no verificado— y todo lo demás funciona igual.

---

## Actualizar a 1.2.0 desde 1.1.0

Trae el circuito de trabajo completo (ver `docs/circuito-de-trabajo.md`). **No hay migración de configuración**: `ai-workspace.json` sigue en `version: 1` y todo lo que se agregó es opcional.

```bash
node scripts/template-sync.js --dry-run
node scripts/template-sync.js
node scripts/consolidate-skills.js --wrappers      # ahora TAMBIÉN registra los hooks
```

**Este último paso ya no es opcional.** Hasta 1.1.0 los hooks eran un bloque que `init.js` copiaba una sola vez a `.claude/settings.json`, y la actualización nunca lo tocaba: un hook nuevo no llegaba a ningún proyecto. Ahora los declara el manifiesto y los registra `consolidate-skills`. Lo que el proyecto tenga en ese archivo por su cuenta no se toca; un registro heredado de la base se **adopta** (se reemplaza por el administrado y se avisa), para que el mismo script no corra dos veces.

**Lo que puede poner el CI en rojo, con razón:**

- **`verify-rules`.** Si el proyecto tiene reglas propias de anti-patrones sin `fixtures` (una que marca y una que no), el gate las lista. Es deuda real, y se puede congelar y pagar de a una:
  ```bash
  node scripts/verify-rules.js --repo <repo> --write-baseline
  ```
- **`encoding`** (texto con la codificación rota) mira todo archivo de texto versionado, no solo TypeScript. Congelar lo que ya había: `node scripts/check-encoding.js --repo <repo> --write-baseline`.
- **Gates que antes salían 2 y ahora dicen "NO CORRIÓ".** El de aislamiento entre clientes en un repo de frontend ya no es un error permanente: el pack `nextjs` declara que no consulta la base.

**El registro de candidatos a gate de un proyecto de 1.1.0** trae tres entradas de ejemplo de la base (casos de .NET) en el formato viejo, sin estado en el encabezado: el lint las marca (`GC-1`). Si no son del proyecto, se borran; si lo son, se les agrega el estado (🟡 🔵 ⛔ ✅) según la leyenda del propio archivo. Un proyecto nuevo ya arranca con el registro vacío.

**Dos cosas que ya no viajan con la base** porque son del proyecto: `ai/gate-candidates.md` (su registro de errores confirmados) y los archivos de estado local (`.ai-gates-log.jsonl`, `.ai-gates-unverified.json`, `.protected-edit-allow.json`, que `init` agrega al `.gitignore`; en un proyecto existente hay que agregarlos).

**Hooks opcionales.** `pre-commit-attribution`, `pre-commit-gates` y `pre-bash-heredoc` no se instalan solos: se encienden con `commits.forbidAiAttribution` y `hooks.<id>.enabled`.

---

## Un proyecto que viene de 0.1.0 con piezas traídas a mano

El caso: el proyecto adoptó la base en 0.1.0 y, mientras tanto, **trajo a mano piezas de otro sistema** a `ai/local/` y a `scripts/`: procedimientos del ciclo de tarea, un gate de requisitos, un hook de migraciones, un script de generación de migraciones. Esas piezas ahora viven en el núcleo, y dejarlas hace dos cosas malas: un procedimiento con el mismo nombre en `ai/local/` **pisa** al del núcleo en silencio (y se pierde lo nuevo), y un hook registrado a mano corre junto al administrado.

Esto es el orden que se probó sobre una copia de un proyecto real. Cada paso depende del anterior.

**0. Antes de empezar:** árbol de git limpio y todo commiteado. Casi todo lo que sigue se deshace con `git`, pero `--force` no.

**1. Mirar sin escribir.**

```bash
node scripts/template-sync.js --dry-run
```

Vas a ver tres grupos: *nuevos* (todo lo del circuito), *se actualizan* (los que nadie tocó) y *divergentes* (los que el proyecto modificó). Los divergentes son el trabajo de los pasos 2 y 5.

**2. Sacar de los archivos de la base lo que es del proyecto.** Si el proyecto agregó skills **dentro** de `ai/packs/<pack>/manifest.json` (con sus procedimientos en `ai/packs/<pack>/procedures/`), esos archivos figuran como divergentes y, con `--force`, se perderían. Se mueven a donde corresponde: los procedimientos a la carpeta `ai/local/procedures/` y las entradas al manifiesto de `ai/local/`. Un archivo de la base que se edita a mano es un archivo que no se puede actualizar.

**3. Declarar en `ai-workspace.json` lo que antes era código local.** Cada pieza que sube al núcleo se configura en vez de copiarse:

```jsonc
{
  "repos": [{
    "name": "api", "path": "api", "packs": ["nestjs"],
    "database": {
      "migrationsDir": "src/database/migrations",
      "writeCommands": ["migration:run", "migration:revert", "seed"],
      "generateCommands": ["migration:generate"],
      "readOnlyAllowed": ["migration:show"],
      "generateAlternative": "node ai/local/scripts/<generar-migracion>.js",
      "statusCommand": "npm run migration:show"
    }
  }, { "name": "app", "path": "app", "packs": ["nextjs"], "consumes": ["api"] }],
  "commits": { "forbidAiAttribution": true },
  "hooks": { "pre-commit-gates": { "enabled": true }, "pre-bash-heredoc": { "enabled": true } },
  "requirements": { "dir": "docs/requisitos", "idPattern": "^RF-\\d+\\.\\d+$", "format": "obsidian", "vault": "docs" },
  "autonomous": { "plan": "docs/<plan>.md", "taskHeading": "^##\\s+(\\S+)\\s+—\\s+(.+?)\\s*$", "doneMarker": "✅", "harness": "claude" }
}
```

Los nombres de los scripts de base de datos son **los de tu proyecto**; los de arriba son un ejemplo.

**4. Borrar de `ai/local/` lo que ahora vive en el núcleo.** Antes de borrar cada uno, **compará con la versión del núcleo** y llevá lo que sea del dominio del proyecto (la checklist de multi-tenancy, los ejemplos propios, la bitácora) a una regla en `ai/local/rules/`: el núcleo trae el método, no tu dominio.

| Lo que el proyecto tiene | Ahora vive en | Qué hacer |
|---|---|---|
| Procedimiento local `ciclo-de-tarea` | procedimiento `ciclo-de-tarea` | borrar; la checklist de dominio, a una regla de `ai/local/rules/` |
| Procedimiento local `trabajo-autonomo` | `trabajo-autonomo` | borrar; configurar `autonomous` |
| Procedimiento local `git-sync-branch` | `git-sync-branch` | borrar; `repos[].database.statusCommand` lista las migraciones pendientes |
| Procedimiento local `redactar-requisito` | `redactar-requisito` | borrar |
| Procedimiento local `prueba-e2e` | `prueba-e2e` (esqueleto) | **decidir**: dejarlo (gana el local, y se pierde el esqueleto) o renombrarlo a la guía propia del *cómo* y usar el del núcleo |
| Regla local `requisitos` | la regla `requisitos` del núcleo | borrar |
| Script local `check-vault` (con su test) y el gate `vault` del manifiesto local | gate `requirements` (`scripts/check-requirements.js`) | borrar los tres; configurar `requirements` |
| Hook local `pre-bash-slot-migrations` (en `ai/local/scripts/hooks/`) | hook `pre-bash-slot-migrations` | borrar; configurar `database` |
| Script local `trabajo-por-sesion` (versión `.mjs`) | `scripts/trabajo-por-sesion.js` | borrar; configurar `autonomous` |
| Script local `migration-generate-shadow` | variante del pack `nestjs` | **conservar** si trae lo propio (el drift conocido del esquema) y apuntarlo en `database.generateAlternative`; o pasar a la variante del pack, con el drift conocido en un archivo `migration-known-drift` dentro de `ai/local/` |
| `scripts/hooks/pre-commit-attribution.js`, `pre-commit-gates.js`, `pre-bash-heredoc.js` | los mismos nombres, en la base | **borrar la copia propia** (ver paso 5) |
| agentes y reglas de dominio (`revisor-de-tarea`, reglas `negocio`, anti-patrones propios) | — | conservar |

**5. Borrar las copias propias de los hooks que la base ahora trae.** Si el proyecto tiene `scripts/hooks/pre-commit-*.js` o `pre-bash-heredoc.js`, el sync los ve como divergentes y no los pisa. Se borran antes, para que el sync los agregue como nuevos. (Los de la base cubren los mismos patrones de atribución —incluidas las URLs de sesión— y suman los casos de `bash -c`.)

**6. Sincronizar.**

```bash
node scripts/template-sync.js --dry-run
```

Los divergentes que queden tienen que ser solo los que ya revisaste: típicamente los dos `manifest.json` de packs (ya sin tus skills) y los scripts que el proyecto corrigió. **Si el proyecto corrigió a mano algún script de la base, esa corrección tiene que estar en la base antes de pisarlo.** Un ejemplo real: `check-antipatterns.js` analizaba un archivo suelto —lo que hace el hook de escritura— fuera de `src/` con reglas pensadas para `src/`; el proyecto lo corrigió local y la 1.2.0 lo incorpora. Verificalo antes de `--force`. Recién entonces:

```bash
node scripts/template-sync.js --force
```

Y borrar el huérfano que el sync reporta como eliminado: el gate de cobertura de escenarios que vivía en `ai/packs/openspec/scripts/` (subió al núcleo en 1.1.0; ya no lo declara ningún manifiesto).

**7. Registrar los hooks y regenerar los punteros.**

```bash
node scripts/consolidate-skills.js --wrappers
node scripts/consolidate-skills.js --check
```

Acá se ve la adopción: por cada hook que el proyecto tenía registrado a mano —incluso el que apuntaba a `ai/local/`— aparece una línea `adoptado el registro heredado de <hook>`. Después de esto, `.claude/settings.json` no se edita más a mano para hooks.

**8. Actualizar lo que cite lo que borraste.** `INVENTORY.md`, `CLAUDE.md` y las reglas locales suelen nombrar archivos de `ai/local/` que ya no existen. El gate de rutas citadas los encuentra:

```bash
node scripts/check-context-links.js --scope workspace --baseline
```

**9. Congelar la deuda de los gates nuevos**, para que el CI hable solo de lo que se agregue desde ahora:

```bash
node scripts/verify-rules.js --repo <repo> --write-baseline
node scripts/check-encoding.js --repo <repo> --write-baseline
```

**10. Comprobar que no se perdió nada.** Con el tablero de requisitos, el resultado del gate nuevo tiene que ser el del script que reemplaza, sobre las mismas fichas:

```bash
node scripts/check-requirements.js              # vs. el check-vault.js viejo
node scripts/check-requirements.js --sync-estados
node scripts/run-gates.js --all
```

En la prueba sobre una copia de un proyecto real, las 51 fichas dieron el mismo resultado limpio que el script viejo y `--sync-estados` coincidió ("ningún estado para cambiar"). Un `NO SE PUDO EJECUTAR` en `unreachable` o en la comparación contra la base suele ser un repositorio sin `origin` o sin traer: `git fetch origin`.

---

## Lo que conviene revisar una vez por versión

```bash
node scripts/check-context-budget.js    # qué paga una sesión antes de empezar
node scripts/baseline-report.js         # qué hay congelado y desde cuándo
node scripts/consolidate-skills.js --check
```

Ninguno bloquea nada. Son para que dos cosas que crecen en silencio —el contexto que se carga en cada sesión y la deuda congelada— sigan siendo decisiones y no acumulación.
