# PR Review

Orquesta la revisión completa de un cambio: corre las verificaciones automáticas **una sola vez**, y lanza los agentes de revisión en paralelo con ese resultado ya resuelto.

Funciona sobre cualquier repositorio declarado en `ai-workspace.json`, y sobre varios a la vez cuando el cambio los cruza.

---

## Por qué existe

Sin orquestador, cada agente corre los gates por su cuenta. Con tres agentes en paralelo eso es el mismo barrido determinista repetido tres veces, pagado con tokens de razonamiento en cada uno.

El orquestador lo corre una vez —gratis, es un script— y les pasa el resultado. Cada agente gasta tokens solo en lo que ningún script puede decidir.

---

## Paso 1: resolver el alcance

Leer `ai-workspace.json`. Determinar:

- **Qué repositorios** toca el cambio. Si la persona no lo dijo, mirar cuáles tienen commits por delante de su rama base.
- **Qué rama** se revisa. Por defecto, la rama actual.

### Revisar una rama distinta a la actual

**Nunca hacer `git checkout` en el repositorio principal para revisar.** Si la persona está trabajando en otra cosa, eso le mueve el piso.

Para una rama explícita, abrir el slot de revisión con el procedimiento `worktree-slots` y pasarles a los agentes ese directorio como raíz de trabajo. El slot se limpia solo cuando la persona lo pide.

---

## Paso 2: correr los gates, una vez

```bash
node scripts/run-gates.js --repo <repositorio>
```

Guardar la salida completa. Ese bloque se pega **tal cual** en el prompt de cada agente.

**Leer la salida antes de seguir.** Si dice que un gate no se pudo ejecutar o no corrió, eso no es "sin hallazgos": es *sin verificar*, y hay que decirlo en el informe final. Un gate roto que se lee como limpio es peor que no tenerlo.

---

## Paso 3: lanzar los agentes en paralelo

En un solo mensaje, para que corran concurrentes:

| Agente | Qué aporta | Cuándo se lanza |
|---|---|---|
| `qa-agent` | El código contra el diseño acordado y los criterios de aceptación | Siempre |
| `code-reviewer` | Corrección, arquitectura, rendimiento, mantenibilidad, tests | Siempre |
| `security-auditor` | Autorización, aislamiento de datos, secretos, entrada no confiable | Si el cambio toca autenticación, permisos, datos de personas, o el borde de la aplicación |

A cada uno hay que darle:

1. El repositorio y su rama base.
2. El directorio de trabajo, si es un slot.
3. El bloque `## Gates deterministas` completo, con la instrucción de **no volver a correrlos**.
4. El diseño acordado del cambio, si existe.
5. **El formato de salida**, que es lo que permite verificar lo que devuelven.

### Formato de salida

Cada agente cierra su informe con un bloque JSON. La prosa es para la persona; el bloque es para el script del paso siguiente.

````
```json
[
  {
    "file": "src/<modulo>/<modulo>.service.ts",
    "line": 42,
    "rule": "autorizacion-despues-del-efecto",
    "severity": "bloqueante",
    "summary": "El permiso se comprueba después de haber escrito.",
    "evidence": "await this.repo.save(cuenta);"
  }
]
```
````

| Campo | Para qué |
|---|---|
| `file` | Ruta relativa al repositorio. Se comprueba que exista |
| `line` | Se comprueba que exista dentro del archivo. Opcional si el hallazgo es sobre el archivo entero |
| `evidence` | El fragmento textual de esa línea. **Es el campo que hace verificable el hallazgo**: si el texto no está ahí, el hallazgo se descarta |
| `severity` | `bloqueante`, `importante` o `menor` |
| `summary` | Una frase. El detalle va en la prosa |

Un agente que no devuelve el bloque obliga a verificar a mano, que es lo que se está tratando de evitar.

---

## Paso 4: descartar lo inventado, con un script

Cada agente devuelve su lista de hallazgos en el formato acordado. Antes de leer una sola línea, pasarlas todas por la verificación:

```bash
node scripts/verify-findings.js --repo <repositorio> --input <archivo.json>
```

Comprueba tres cosas, mecánicamente: que el archivo exista, que la línea exista, y que el fragmento citado esté realmente ahí. Lo que no pasa, no llega al informe.

**Por qué un script y no una instrucción.** Esto antes decía, acá mismo, *"un hallazgo que cita una línea que no existe se descarta"*. Una regla escrita se paga en tokens en cada corrida y se cumple mientras quede atención disponible — que es justo lo que escasea después de leer tres informes. El script cuesta cero y no se puede saltear. Es la misma razón por la que los gates existen.

Lo que el script **no** dice es si el hallazgo tiene razón. Eso es lo único que hay que leer, y para eso queda el presupuesto entero.

---

## Paso 5: consolidar

Sobre lo que sobrevivió:

1. **Deduplicar.** El mismo defecto visto por dos agentes es un hallazgo, no dos.
2. **Resolver contradicciones.** Si dos agentes dicen cosas opuestas sobre el mismo código, leer el código y decidir. No trasladar la contradicción al informe.
3. **Ordenar por severidad**, no por agente.

### Antes de aceptar un hallazgo como real

Una pregunta, la que el script no puede responder:

- **¿Es un defecto o una decisión?** Puede estar documentado como una decisión deliberada en el diseño. Revisar antes de reportarlo como error.

---

## Paso 6: informe

```
## Revisión — <repositorio> · <rama>

**Gates deterministas**: <resumen en una línea; nombrar explícitamente los que no corrieron>

### Bloqueantes (N)
…

### Importantes (N)
…

### Menores (N)
…

**Recomendación**: se puede mergear / no se puede mergear, y por qué.
```

Si no hay hallazgos, decirlo. Un informe que inventa observaciones para justificar la revisión enseña al equipo a no leerlos.

---

## Paso 7: cerrar el bucle

Por cada hallazgo **confirmado y real** que ningún gate detectó, aplicar el procedimiento `gate-from-finding`: evaluar si puede convertirse en una verificación automática.

Este paso es el que hace que el sistema mejore solo. Saltearlo significa encontrar el mismo error otra vez dentro de tres meses.

---

## Restricciones

1. **No commitea.** El commit lo hace `git-commit-workflow`, con pedido explícito de la persona.
2. **No modifica código.** Si la persona pide que se arreglen los hallazgos, eso es un trabajo aparte, después de que ella los haya visto.
3. No hace `git checkout` en el repositorio principal.
4. No limpia slots de worktree por iniciativa propia.
