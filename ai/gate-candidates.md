# Registro de candidatos a gate

Errores reales ya confirmados y qué se hizo con cada uno: si ya son una verificación automática, si se está estudiando cómo, o por qué **no** se pudo automatizar. Cada entrada es una deuda del sistema de control, no del código.

Un candidato descartado **con motivo** vale tanto como uno implementado: dice qué haría falta para poder automatizarlo, y la próxima persona no repite el análisis. Por eso los descartados no se borran. Uno descartado sin motivo es una nota inútil.

Procedimiento para convertir uno en gate: `ai/core/procedures/gate-from-finding.md`.

**Este archivo se lintea** (`node scripts/check-gate-candidates.js`): cada entrada tiene un estado válido, los ⛔ dicen el motivo y los ✅ apuntan a un gate o regla que existe. Un registro que se degrada miente: dice que un error está cubierto cuando la regla ya se renombró.

---

## Estados

El primer carácter del encabezado de cada entrada.

| Estado | Significado | Qué exige el lint |
|---|---|---|
| 🟡 Candidato | Parece automatizable, sin verificar todavía | — |
| 🔵 Analizado | Se estudió cómo hacerlo; falta escribir la regla | — |
| ⛔ Descartado | No se puede automatizar hoy | `**Por qué no es gate**:` con el motivo concreto |
| ✅ Implementado | Ya es un gate; queda como registro de que el bucle funcionó | `**Gate**:` con el id de la regla, del gate, del hook, o una ruta que exista |

---

## Formato

Una entrada por candidato, bajo `## Candidatos`:

```markdown
### ⛔ <título corto del error>

- **Cuándo apareció**: revisión, QA, producción, corrección manual
- **Por qué no es gate**: el motivo concreto — requiere ejecutar el código,
  requiere estado de base de datos, es un caso único, la regla daría demasiados
  falsos positivos
- **Qué haría falta**: qué tendría que cambiar para poder automatizarlo
- **Mitigación actual**: test, procedimiento, revisión humana
```

```markdown
### ✅ <título corto del error>

- **Cuándo apareció**: …
- **Gate**: `ID-DE-LA-REGLA` (y, si hace falta, la ruta de un script que exista)
```

---

## Candidatos


### ⛔ Objeto liberable creado sin `using` en C#

- **Cuándo apareció**: al escribir las primeras reglas de Semgrep para el pack `dotnet`. Una conexión o un flujo que no se cierra no falla enseguida: agota el pool bajo carga y el error aparece lejos de su causa, así que es un candidato ideal a gate.
- **Por qué no es gate**: no se consiguió una regla que marcara el caso malo **y** dejara pasar el bueno. Con el patrón sobre la expresión (`new SqlConnection(...)`) marca también los `using var c = new SqlConnection(...)` correctos, porque el `pattern-not` sobre la sentencia completa no aplica a un match de expresión. Con el patrón sobre la sentencia (`var $X = new SqlConnection(...);`) no marca nada: el analizador de C# de la edición libre de Semgrep no hace corresponder ese patrón con una declaración de variable. Probado con las dos formas contra los mismos fixtures.
- **Qué haría falta**: análisis de flujo, no de forma — hay que saber si el objeto se libera **después**, se guarda en un campo que se libera en `Dispose`, o se devuelve para que lo libere quien llama. Las tres son legítimas y ninguna se distingue mirando la sentencia. Con `mode: taint` de Semgrep podría acercarse; no se intentó porque excede lo que este gate debería costar.
- **Mitigación actual**: el analizador de .NET marca CA2000 para varios de estos casos con el análisis de flujo que Semgrep no hace acá. Activarlo en el proyecto rinde más que insistir con esta regla.

### ⛔ Llamada de red dentro de una transacción de base de datos en .NET

- **Cuándo apareció**: junto con la anterior. La transacción queda abierta esperando a un tercero, sosteniendo sus bloqueos: si el tercero tarda, la base se degrada para todos.
- **Por qué no es gate**: la regla funciona con `pattern-inside: using (...) { ... }`, pero eso marca la llamada externa dentro de **cualquier** `using`, incluido un `FileStream`, donde no hay ninguna transacción. Acotarla a la transacción real —`using ($T $TX = $CTX.Database.BeginTransaction(...))`— deja de encontrar el caso: probado también en la forma de método que abre la transacción y llama después, con el mismo resultado.
- **Qué haría falta**: que el patrón reconozca la declaración dentro del `using` de C#, que es la misma limitación del analizador que bloquea el candidato anterior. Vale reintentarlo contra una versión nueva de Semgrep, con los fixtures ya escritos.
- **Mitigación actual**: revisión humana. El procedimiento de patrones de base de datos del pack del stack lo describe como error a buscar.

### ⛔ Aislamiento por tenant en consultas de EF Core

- **Cuándo apareció**: al generalizar los gates a lenguajes que no son JavaScript. `check-tenant-isolation.js` ya lee sus métodos de lectura desde `tenant.readMethods` en el manifiesto de un pack, así que declarar los de EF Core es una línea de datos.
- **Por qué no es gate**: declarar los métodos no alcanza. La heurística de las tres detecciones está escrita contra la forma de TypeORM: busca un `where` en el fragmento de la llamada y un objeto `{ id: … }` en la condición. En LINQ no hay ninguna de las dos cosas — el filtro es un lambda (`.Where(c => c.Id == id)`) y el mismo `Where`/`FirstOrDefault`/`ToList` se usa sobre listas en memoria, donde no hay nada que aislar. Conectar la lista sin adaptar la heurística produce ruido sobre cada LINQ del repositorio, y un gate ruidoso enseña a ignorar los avisos.
- **Qué haría falta**: reescribir las tres detecciones contra la forma de LINQ, distinguiendo una consulta sobre `DbSet`/`IQueryable` de una sobre una colección en memoria. Es análisis de tipos, no de texto: el candidato natural es una regla de Semgrep para C#, no una expresión regular.
- **Mitigación actual**: revisión humana y el agente `security-auditor`, que audita el aislamiento entre clientes sin depender de este gate.
