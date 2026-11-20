# Cambiar la herramienta del ciclo dirigido por especificación

Cómo pasar de OpenSpec a otra herramienta —o a ninguna— sin reescribir el sistema.

---

## Qué es lo que no cambia

El ciclo:

```
proponer → diseñar → escribir los tests → implementar → archivar
```

Eso es una forma de trabajar, no un producto. Los cinco procedimientos que lo describen —controlar el alcance antes de escribir la propuesta, exigir el diseño aprobado antes de implementar, convertir cada escenario de aceptación en un test que **falle primero**, marcar una tarea solo cuando está verificada, archivar contra el código y no contra las casillas— valen igual con cualquier herramienta.

Lo que cambia de una a otra son tres cosas concretas:

1. **Dónde viven los documentos** de un cambio.
2. **Cómo se marca** un escenario de aceptación dentro de esos documentos.
3. **Cómo se llama** el programa que los valida, si hay alguno.

Esas tres cosas son datos.

---

## El adaptador

Lo declara un pack en su `manifest.json`, bajo `sdd`:

```json
{
  "sdd": {
    "provider": "openspec",
    "changesDir": "openspec/changes",
    "archiveSegment": "archive",
    "scenarioPattern": "^#{3,4}\\s+Scenario:\\s*(.+?)\\s*$",
    "docExtension": ".md",
    "cli": "openspec"
  }
}
```

| Campo | Qué es | Si falta |
|---|---|---|
| `provider` | Nombre del proveedor, para los mensajes | Se usa el identificador del pack |
| `changesDir` | Dónde viven los cambios, relativo al repositorio | **Obligatorio**; sin esto el adaptador se descarta con un aviso |
| `archiveSegment` | Cómo se llama el subdirectorio de los cambios ya archivados | `archive` |
| `scenarioPattern` | Expresión regular cuyo grupo 1 es el título del escenario | El formato `#### Scenario:` |
| `docExtension` | Extensión de los documentos de especificación | `.md` |
| `cli` | Nombre del programa, para que los procedimientos lo invoquen | Ninguno; los procedimientos no invocan nada |
| `changeLayout` | `dir`: cada cambio es un directorio. `file`: cada cambio es **un** documento | `dir` |
| `metaFile` | Archivo del cambio con `rf:`, `cierra_rf:` y `pendiente_rf:` (tablero de requisitos) | Con `dir`, obligatorio si hay tablero. Con `file`, no se usa: los campos van en el documento |

El gate `check-scenario-coverage` lee eso y nada más. No conoce ninguna herramienta.

### Un cambio, un documento

Con `"changeLayout": "file"`, el cambio `limite` es el archivo `<changesDir>/limite<docExtension>`, y archivado es `<changesDir>/<archiveSegment>/2026-11-04-limite<docExtension>`. La fecha del nombre es la que lee el tablero de requisitos para saber cuál fue la última entrega. Es la forma del pack `odd`:

```json
{
  "sdd": {
    "provider": "odd",
    "changesDir": "odd/tasks",
    "changeLayout": "file",
    "archiveSegment": "archive",
    "scenarioPattern": "^S\\d+\\.\\s+(.+?)(?::\\s|\\s*$)",
    "docExtension": ".md"
  }
}
```

Qué cuenta como documento de un cambio: un archivo directamente en `changesDir` (o en su archivo) con la extensión **exacta** de `docExtension`. Un `README`, o un archivo que empieza con `_` o `.`, es de la carpeta y no un cambio: el tablero no le pide `rf:`. Con `--change` se acepta el nombre (`limite`), el archivo (`limite.md`) o la ruta desde la raíz del repositorio. Un cambio pedido por nombre que no tiene documento hace salir al gate con 2: no se encontró, que es distinto de "cubierto".

Un valor de `changeLayout` que no sea `dir` ni `file` descarta el adaptador con un aviso. Si se tratara como `dir`, el gate buscaría directorios que no existen y diría "nada que verificar" sobre cambios reales.

---

## Cambiar de herramienta

Escribir un pack con esas seis claves y activarlo en lugar del anterior. Un ejemplo real, con otra estructura, otro marcador y otra extensión:

```json
{
  "sdd": {
    "provider": "spec-kit",
    "changesDir": "specs",
    "archiveSegment": "done",
    "scenarioPattern": "^\\s*-\\s+AC:\\s*(.+?)\\s*$",
    "docExtension": ".markdown"
  }
}
```

Con eso, un archivo `specs/login/acceptance.markdown` que diga

```markdown
- AC: rechaza un monto mayor al disponible
```

queda verificado igual que un `#### Scenario:` de OpenSpec. Los procedimientos no se tocan y el gate tampoco.

**Cuidado con las barras invertidas.** En JSON `"\s"` no es la secuencia de expresión regular. Un patrón mal escapado compila sin error y no coincide con nada, y entonces el gate no encuentra ningún escenario y reporta que está todo cubierto. Está validado —un carácter de control en el patrón se rechaza con un aviso— pero conviene saberlo.

---

## No usar ninguno

Es una opción, no una carencia. Un proyecto que trabaja sin especificación previa simplemente no declara proveedor: el gate sale con **0** diciendo que no hay nada que verificar.

Sale con 0 y no con 2 a propósito. El 2 significa "no pude verificar" y sirve para el gate que debería haber corrido y no pudo; acá no hay nada que verificar, que es distinto. Confundirlos haría que todo proyecto sin ciclo de especificación tuviera el CI en rojo para siempre, y a los pocos días alguien apagaría el gate — incluidos los proyectos donde sí hace falta.

---

## Lo que hay que verificar al cambiar

```bash
node scripts/check-scenario-coverage.js --repo <repo> --change <nombre>
```

Tres cosas, en este orden:

1. **Encuentra los escenarios.** Si reporta cero escenarios sobre un cambio que sí los tiene, el `scenarioPattern` no está matcheando — casi siempre por las barras invertidas.
2. **Encuentra los tests.** Si reporta *todos* los escenarios como sin test, el problema no está acá: está en la extracción de títulos del lenguaje. Ver `docs/agregar-un-pack-de-lenguaje.md`.
3. **Detecta el cambio solo.** Sin `--change`, el gate lo deduce del diff contra la rama base. Si no detecta nada, revisá que `changesDir` coincida con la ruta real, incluidos los archivados.

La primera es la que falla en silencio, y por eso conviene probar con un escenario que sabés que **no** tiene test: si aparece, el patrón anda.
