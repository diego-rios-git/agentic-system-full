# Proponer un cambio

Crea la propuesta de un cambio antes de escribir una línea de código: qué se va a hacer, cómo, y cómo se sabrá que está bien.

---

## Por qué antes y no después

Un cambio implementado sin diseño acordado se revisa contra la intuición de quien revisa. Con diseño, se revisa contra lo que se acordó — y la diferencia entre ambos es el hallazgo.

Además, el diseño es lo único que le permite a un consumidor —otro repositorio, otro equipo— empezar a trabajar sin adivinar.

---

## Paso 1: entender el pedido

Antes de proponer, tener respuesta para:

- **Qué problema resuelve**, en términos de quien lo va a usar. No en términos técnicos.
- **Qué queda afuera.** Escribirlo explícitamente vale tanto como lo que queda adentro.
- **Cómo se sabrá que funciona.** Si no se puede escribir, el pedido todavía no está claro.

Si algo falta, **preguntar**. Una propuesta construida sobre una suposición se descubre cuando ya está implementada.

**Si el requisito tiene ficha** (tablero de requisitos), se lee primero: es la fuente de qué se pidió. Si al proponer aparece algo que la ficha no responde, **se vuelve a la ficha** (`redactar-requisito`), no se resuelve en el diseño.

---

## Paso 2: aplicar la disciplina de alcance

Contar las tareas **antes** de escribir la propuesta. Ver `spec-scope-discipline`: por encima del umbral, se parte.

Es más barato partir una propuesta que partir una implementación.

---

## Paso 3: artefactos

### Propuesta

Qué se va a hacer y por qué. Incluye lo que queda afuera, y las decisiones que hay que tomar antes de empezar.

### Diseño

**El contrato.** Es el documento contra el que se va a auditar la implementación:

- Endpoints o interfaces, con su forma exacta de entrada y salida.
- Modelo de datos: qué se agrega, qué cambia, qué se migra.
- Reglas de negocio, incluidos los casos límite.
- Qué pasa cuando falla: cada error posible y qué se responde.

Si el cambio cruza repositorios, **el diseño se escribe antes de que empiece el trabajo del consumidor**. Sin eso, el consumidor adivina.

### Escenarios de aceptación

Cada comportamiento esperado, en la forma:

```
#### Scenario: <nombre que describe el caso>
- **WHEN** <situación>
- **THEN** <resultado esperado>
```

Estos escenarios no son decorativos: **cada uno debe terminar teniendo un test**, y hay un gate que lo verifica. Un escenario que nadie puede convertir en test está mal escrito — es demasiado vago o describe algo que no se puede observar.

Cubrir el camino principal **y** los casos que fallan. Una propuesta con solo escenarios felices produce una implementación que solo funciona cuando todo sale bien.

### Tareas

La lista de trabajo, en orden de dependencia. Cada tarea debe poder marcarse como hecha sin ambigüedad.

---

## Paso 3b: declarar el requisito que construye — OBLIGATORIO si hay tablero

Si el proyecto tiene tablero de requisitos (`requirements` en `ai-workspace.json`), todo cambio declara a qué requisito pertenece en su archivo de metadatos (el que nombra `sdd.metaFile` del proveedor; con OpenSpec, `.openspec.yaml`). Se escribe **en el mismo momento en que se crea el cambio**, cuando la ficha del requisito ya está en contexto: no cuesta nada ahora y no se puede reconstruir después.

```yaml
rf: RF-7.22                  # uno o varios ids separados por espacio: rf: RF-4.05 RF-4.06
cierra_rf: false             # ¿este cambio completa el requisito? ver abajo
pendiente_rf: "CA-04 y CA-05 (las acciones) -> otro ticket"
```

**Por qué importa.** Los cambios se nombran por su ticket, no por el requisito, así que sin este campo el vínculo requisito-cambio no existe en ningún lado. Es lo que permite que `node scripts/check-requirements.js --sync-estados` mueva solo el estado de la ficha, en vez de que alguien revise a mano todos los requisitos. Y la omisión no es inocente: un cambio que implementaba un requisito y olvidó declararlo es **invisible** para la derivación, que concluye que el requisito no tiene cambios abiertos y lo deja en `cerrado` con trabajo pendiente.

**Si el cambio no nace de un requisito** (un arreglo de infraestructura, una refactorización, un re-skin), se declara `rf: ninguno`. No se omite la línea: la omisión es justo lo que el gate marca, y `ninguno` la vuelve una decisión visible.

### `cierra_rf`: ¿este cambio completa el requisito?

Al declarar `rf:`, comparar el alcance del cambio con los criterios de aceptación de la ficha. **Si el cambio entrega solo una parte**, declararlo, con lo que falta y quién lo trae:

| Qué queda del requisito | Metadatos del cambio |
|---|---|
| Nada: con este cambio están todos los criterios | Sin `cierra_rf` (equivale a `true`), sin `pendiente_rf` |
| Faltan criterios y los trae otro ticket | `cierra_rf: false` y `pendiente_rf` con qué falta y quién lo trae |
| Este cambio completa lo que otro dejó pendiente | El requisito incompleto va en `rf:` y en `cierra_rf` (`rf: RF-2.14 RF-0.57` / `cierra_rf: RF-0.57`: completa el segundo, el primero todavía no) |

`cierra_rf` acepta `true`, `false` o la lista de ids que **sí** completa. Sin el campo, el cambio cuenta como `true`: cuando se archiva y se mergea, el requisito pasa a `cerrado`. Así se cerraron varios requisitos de más, uno con sus acciones todavía sin hacer. El paso a `true` se vuelve a revisar al archivar (`spec-archive`).

Una vez declarado, se sincroniza el estado (`--sync-estados`): la ficha pasa a `implementacion`.

---

## Paso 4: decisiones abiertas

Lo que no se puede decidir sin la persona va en una sección propia, **no enterrado en el texto**. Una decisión abierta que nadie ve se resuelve sola —mal— durante la implementación.

---

## Antes de dar por buena la propuesta

- ¿El diseño alcanza para implementar sin volver a preguntar?
- ¿Cada escenario se puede convertir en un test?
- ¿Está escrito qué queda afuera?
- ¿Las tareas están dentro del umbral, o la excepción está justificada?
- ¿Las decisiones abiertas están señaladas como tales?
- ¿El cambio declara su requisito (`rf:`, o `rf: ninguno`) y, si entrega una parte, `cierra_rf: false` con `pendiente_rf`?

---

## Lo que sigue

1. La persona aprueba el diseño.
2. `spec-driven-testing` convierte los escenarios en tests **que deben fallar**.
3. `spec-apply` implementa hasta que pasen.

Ese orden no es ceremonia: escribir los tests después de implementar produce tests que confirman lo que el código hace, no lo que debería hacer.
