# Archivar un cambio

Cierra un cambio ya implementado: verifica que esté realmente completo, mueve lo que corresponde a la especificación permanente y deja dicho si completa el requisito que construye.

**Nunca se archiva sin confirmación explícita de la persona** ("¿archivo el cambio `<nombre>` de `<repositorio>`?").

---

## Cuándo

**Dentro del PR, antes del merge, y como último paso antes de pedir el permiso de commitear** (`cerrar-ticket`): con el cambio ya revisado, corregido y probado de punta a punta. Así la rama base recibe el código y su especificación permanente en el mismo merge, en vez de quedar con uno sin el otro hasta que alguien abra un segundo PR para mover carpetas.

**No antes de eso.** Archivar un cambio que todavía se está trabajando hace que desaparezca de los activos mientras alguien lo sigue tocando.

**Excepción: el estado del requisito espera al merge.** Es la única parte que afirma algo sobre lo **entregado**, y nada está entregado hasta que llega a la base. Ver el paso 5.

---

## Paso 1: verificar que está completo

Antes de mover nada:

- Todas las tareas hechas.
- Todos los tests en verde.
- Cada escenario del diseño con su test.
- El trabajo del cambio, commiteado o listo para commitear en la rama que va al PR.

Una lista de tareas sin marcar **no** es prueba de que el trabajo esté pendiente: es habitual que se implemente todo y nadie marque nada. Verificar contra el código y contra el historial, no contra las casillas.

Al revés también: casillas marcadas no prueban que esté hecho.

Si hay tareas sin completar de verdad, se muestran y se pregunta si se archiva igual.

---

## Paso 2: qué sobrevive al archivado

Un cambio es temporal; la especificación es permanente. Al archivar, decidir qué del diseño pasa a ser **la descripción de cómo funciona el sistema ahora**:

- Reglas de negocio que quedaron vigentes.
- Contratos que otros van a consumir.
- Decisiones con su motivo: el motivo es lo que evita que alguien las revierta sin entender.

Lo que **no** pasa: el detalle de la implementación, el plan de trabajo, las decisiones que ya se tomaron y ejecutaron.

Si nada del diseño merece sobrevivir, el cambio se archiva sin más. No hay que inventar contenido para justificar el paso.

### Paso 2b: sincronizar con MERGE, nunca con reemplazo — BLOQUEANTE

Un bloque de requisitos "modificados" **debería** contener el requisito completo tras el cambio, pero en la práctica muchas veces trae **solo lo nuevo**. Aplicarlo tal cual **borra reglas vigentes que nadie decidió derogar**: en un caso real, tres de los cuatro cambios de un mismo requisito tenían deltas incompletos, y un reemplazo literal habría borrado el rechazo de un estado inválido y el escenario de un componente degradado.

Para **cada** archivo del delta, comparar los requisitos del delta con los de la especificación vigente:

| Caso | Qué hacer |
|---|---|
| El requisito **no existe** en la especificación vigente | Agregarlo completo |
| El requisito **ya existe** | Leer los dos, párrafo por párrafo. Sumar lo nuevo y **conservar lo que la vigente tiene y el delta omite** |

**Regla: una sincronización nunca reduce el número de escenarios de un requisito**, salvo que la propuesta diga explícitamente que se deroga algo. Si el conteo baja, parar y revisar.

Al terminar, validar con la herramienta del proveedor (`sdd.cli`, si lo declara) y compararlo con el resultado **anterior**: si la lista de fallas crece con una especificación del cambio en curso, es del archivado. Lo preexistente no se arregla acá.

---

## Paso 3: cierre: ¿el cambio completa el requisito? — `cierra_rf`

Si el proyecto tiene tablero de requisitos y el cambio declara `rf:`, **antes de mover la carpeta** releer los criterios de aceptación de la ficha contra lo que quedó entregado (este cambio y los anteriores del mismo requisito) y dejar los metadatos del cambio diciendo la verdad. **Es acá donde el agente pasa el campo a `true`**: el cambio es lo último que se toca antes del merge, y lo que dice ahí es lo que `--sync-estados` va a escribir en la ficha.

| Qué queda del requisito | Metadatos del cambio |
|---|---|
| Nada: con este cambio están todos los criterios | Sin `cierra_rf` (o `true`), sin `pendiente_rf` |
| Faltan criterios y los trae otro ticket | `cierra_rf: false` y `pendiente_rf` actualizado con qué falta y quién lo trae |
| Este cambio completa lo que otro dejó pendiente | El requisito incompleto va en `rf:` y en `cierra_rf` (`rf: RF-2.14 RF-0.57` / `cierra_rf: RF-0.57`) |

Si la ficha tenía `estado_auto: false` **solo** porque se entregaba por partes, el cambio que la completa le quita `estado_auto` y `estado_motivo`: desde ahí el estado vuelve a derivarse.

**Revisar también la dirección inversa:** si el cambio implementó un requisito y **olvidó declararlo** (`rf:` ausente), es invisible para la derivación y dejaría la ficha en `cerrado` con trabajo pendiente. Agregar `rf:` ahora. Un cambio que de verdad no corresponde a ningún requisito declara `rf: ninguno`.

---

## Paso 4: archivar

Mover el cambio al archivo del repositorio que corresponda, con la herramienta del proyecto (`sdd.cli`) o, si no la hay, moviendo la carpeta a `<sdd.changesDir>/<sdd.archiveSegment>/AAAA-MM-DD-<nombre>`. La fecha del archivado es la del día y es lo que ordena las entregas de un requisito: no se inventa otra.

Al agregar al commit, **por ruta explícita** (el cambio archivado y las especificaciones tocadas): un `git add` de la carpeta entera se lleva también los cambios de otras personas que estén sin versionar en ella.

---

## Paso 5: sincronizar el estado del requisito — DESPUÉS DEL MERGE

**Este paso, y solo este, espera a que el PR esté mergeado en la base.** Los pasos 1 a 4 van dentro del PR; este afirma que un requisito está entregado, y correrlo antes marcaría como cerrado un requisito que todavía vive en una rama que podría rechazarse.

```bash
node scripts/check-requirements.js --sync-estados
```

Lee el `rf:` de cada cambio y actualiza el `estado:` de la ficha: `cerrado` si todos sus cambios están archivados, `implementacion` si alguno sigue abierto o si la última entrega declaró `cierra_rf: false`. Es un script: no hay que leer el tablero ni razonar sobre estados.

**Mirar lo que escribió antes de commitearlo.** El script recorre **todas** las fichas, no solo la del cambio que se está archivando. Después de sincronizar con la base puede cerrar requisitos de otros tickets cuyos cambios acaban de llegar archivados, y un cambio archivado no siempre es la entrega completa: un arreglo o el retiro de código viejo declaran `rf:` igual. Pasó: varias fichas saltaron de `analisis` a `cerrado` por cambios ajenos y parciales. Correr `git status`, quedarse **solo con las fichas del requisito propio** y **consultar** el resto; un salto de `analisis` a `cerrado` sin pasar por `implementacion` es la señal.

Con `cierra_rf` esto deja de depender de mirar: un cambio que declara `cierra_rf: false` deja su requisito en `implementacion`, y la corrida lo lista con su `pendiente_rf`. Lo que manda es la **última** entrega archivada: una posterior que lo completa lo cierra, y una parcial posterior lo vuelve a dejar abierto.

Nunca retrocede un estado por su cuenta: si lo derivado va hacia atrás, lo reporta sin escribir, para que una persona decida si es trabajo nuevo o un cambio abandonado.

Si el cambio declaró `rf: ninguno`, no hay nada que esperar ni que mover, y el archivado termina en el paso 4.

---

## Paso 6: verificar y reportar

Confirmar que la carpeta fue movida correctamente. Reportar:

- El cambio archivado, el repositorio y la ubicación.
- Los estados de requisitos actualizados por el paso 5, si ya corrió.
- Si todavía no hubo commit, sugerir `git-commit-workflow` (que solo se ejecuta con pedido explícito).

---

## Por qué importa que esto se haga

Los cambios que se implementan y nunca se archivan se acumulan como "trabajo activo". Meses después nadie sabe cuáles siguen abiertos de verdad, y cualquier barrido sobre los cambios activos devuelve ruido: escenarios de funcionalidades que hace rato están en producción.

**Un cambio activo que ya está mergeado es información falsa**, y las herramientas que lo leen empeoran por su culpa.
