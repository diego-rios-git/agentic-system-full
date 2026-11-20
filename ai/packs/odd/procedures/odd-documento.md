# ODD: el documento de la funcionalidad

Un solo archivo por funcionalidad grande: las specs que se leen por referencia, las tareas y la bitácora. Lo crea el paso 5 de `odd-protocolo`, **antes de la primera escritura de código**, sin pedir permiso para eso.

Una tarea chica no tiene documento. Si dudás, la prueba de retomar decide (`odd-protocolo`, Tamaño).

La plantilla para copiar: `ai/packs/odd/references/plantilla-documento.md`.

---

## Por qué uno solo, y por qué así

El documento **es la especificación que leen los subagentes**. Se les pasa una referencia (`Spec: odd/tasks/<funcionalidad>.md, T2, S3-S4`) y no un resumen, porque cada resumen pierde algo y nadie sabe qué. Si el documento cita a la persona textual, lo que llega al último eslabón es lo que la persona dijo.

El orden es fijo, con lo estable primero y lo que crece al final: así un agente que lee "hasta `## Log`" se lleva todo lo que necesita sin cargar la historia.

---

## Dónde

`odd/tasks/<funcionalidad>.md`, en el repositorio que el cambio toca (relativo a su raíz, como cualquier ciclo de la base).

- **Nombre:** descriptivo y apto para archivo. Con ticket, el ticket adelante: `ABC-123-transferencias`. Extensión `.md` en minúsculas. Un `README` o un archivo que empieza con `_` no cuenta como funcionalidad: sirve para notas de la carpeta o un borrador.
- **Una funcionalidad, un nombre.** Se reusa al retomar. Nunca se pisa el documento de otra.
- **Si cruza repositorios**, un documento por repositorio con el mismo nombre. El del repositorio que define el contrato se escribe primero, y el consumidor lo lee, no lo supone.

---

## El formato

### Encabezado

Dos o tres líneas: objetivo, rama, y el comando de tests (de `repos[].testCommand`; si no está declarado, se dice). Debajo, si el proyecto tiene tablero de requisitos, los metadatos **en líneas propias**:

```
rf: RF-4.03
cierra_rf: false
pendiente_rf: "CA-04 (exportar) -> otro ticket"
```

Las reglas de esos tres campos son las de `requisitos`. Con tablero, **todo documento abierto declara `rf:`** (o `rf: ninguno`): un cambio abierto que ninguna ficha reclama hace fallar el gate de requisitos.

### `## Specs`

Una línea por requisito, numerada:

```
S1. Rechaza un monto mayor al disponible: "si quiero mandar más de lo que tengo me tiene que decir 'Saldo insuficiente' y no mover nada"
```

- **El título corto**, antes de los dos puntos, dice el comportamiento en pocas palabras. Es lo que copia el nombre del test: el gate de cobertura de escenarios empareja ese título con los títulos de test.
- **Después de los dos puntos**, las palabras de la persona: sus frases, sus mensajes de error, sus comandos y sus ejemplos, **textuales y en su idioma**. Se numeran y se ordenan; no se resumen ni se reescriben.
- **No se agregan requisitos que nadie pidió.** Un supuesto se marca como `(supuesto)`.
- Debajo de cada spec, con viñetas indentadas, van los criterios de aceptación y los checks que aplican.

### `## Tasks`

Una línea por tarea:

```
- [x] T1 (S1-S2) directa · validación del monto + tests · RED→GREEN · a1b2c3d
- [ ] T2 (S3) delegada (escritor: paralelo con T3) · auditoría del movimiento
```

ID estable, las `S#` que cubre, la ruta (directa o delegada, con el disparador), el estado y la evidencia: RED/GREEN observado y el commit que la contiene cuando lo haya. Una casilla se marca **solo** con el resultado y sus checks observados. Una casilla no es una aprobación ni un recibo de revisión.

### `## Log`

La bitácora, siempre al final:

```
L1 2026-11-03 pedido (textual): > quiero que las transferencias...
L2 2026-11-04 corrección (textual): > no, el límite es por día, no por operación
L3 2026-11-04 T1: RED `rechaza un monto mayor al disponible` falló por el 200; GREEN con la suite (48 ok).
```

- `L1` es el pedido original, **textual**.
- Cada corrección de la persona entra textual, con su fecha.
- Además: el análisis del problema, el porqué de los cambios que se aceptaron, la evidencia de verificación, el avance y el paso siguiente. Breve: no es un diario de cada decisión.

---

## Cuando algo cambia

**Un cambio de requisito no rehace todo.** Se agrega su entrada textual al `## Log`, se reescribe **solo** la spec afectada y se reabre **solo** su tarea. Lo terminado que sigue valiendo, se queda.

- Una tarea nueva de verdad se agrega; una invalidada se reabre con el motivo, y se revisan sus checks.
- **Un hallazgo no autoriza agrandar el alcance** ni se acepta solo. Alcance de negocio nuevo pide la autorización de la persona.
- Lo que falló, no se pudo correr, se omitió o quedó pendiente se anota como tal.

---

## Retomar

1. Leer el documento. Si el harness tiene memoria persistente, buscar también su copia (abajo).
2. Reconciliar las dos con el código y con la prueba que existe: ¿lo marcado como hecho sigue en verde?
3. Seguir con la próxima tarea sin terminar.

No se deduce qué trabajo está activo del recuerdo más reciente de la memoria: puede ser de otra funcionalidad.

---

## La copia en memoria, si hay

Si el harness tiene memoria persistente (por ejemplo Engram), se guarda una copia del documento **completo** —no un resumen ni un aviso de avance— con su ruta, en el tema `odd/<funcionalidad>/tasks` y con alcance de proyecto. Se actualiza en cada transición.

- Las dos escrituras no son atómicas: se releen las dos.
- Si la memoria no está disponible, se sigue con el archivo, se anota "copia pendiente" y se sincroniza después. No bloquea el trabajo ni se declara hecha.
- Ante dos versiones que no se pueden reconciliar, se guardan las dos y se pregunta solo por el conflicto real.

Sin memoria persistente, el archivo alcanza: está en el repositorio.

---

## Archivar

Cuando todas las tareas están hechas con su prueba observada (o con la orden de frenar citada), el documento se mueve al archivo:

```bash
git mv odd/tasks/<funcionalidad>.md odd/tasks/archive/<AAAA-MM-DD>-<funcionalidad>.md
```

Antes de moverlo:

- Releer cada `S#` contra lo entregado: **contra el código y el historial, no contra las casillas**.
- Si hay ficha, releerla contra lo entregado y dejar `cierra_rf` diciendo la verdad (`requisitos`).
- Dejar en el `## Log` la última entrada: qué quedó afuera y por qué.

**En un slot**, el archivado va en el precierre de `cerrar-ticket`, igual que cualquier cambio. El estado `cerrado` de la ficha se sincroniza **después del merge**, no al archivar.

La fecha del nombre es la que lee el tablero de requisitos para saber cuál fue la última entrega. Un documento terminado que sigue abierto es información falsa: el tablero lo cuenta como trabajo en curso.
