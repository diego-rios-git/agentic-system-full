# Probar de punta a punta con la aplicación levantada

Procedimiento para verificar un cambio contra la aplicación **real**: levantada, con login real, datos generados usando el producto, capturas y efectos comprobados en la base. No es un test más: es lo que dice si el cambio funciona con todas las piezas juntas.

Este archivo es un **esqueleto y una guía**. El *qué hacer en cada paso* es de cualquier proyecto; el *cómo lo hace este proyecto* (cómo levanta la aplicación, qué datos usa, con qué framework prueba) lo escribe quien lo adopta y queda en `ai/local/`. Ver "Adaptarlo a tu proyecto" al final.

---

## Por qué existe (los incidentes)

- **La guía de pruebas de punta a punta del equipo se borró** (una limpieza de archivos) y un agente fresco no sabía cómo se hacía: cada persona lo reinventaba. Por eso el paso 0 es bloqueante y, si la guía no existe, **crearla es el primer paso**.
- **Una prueba dio 17/17 y la captura mostraba un texto cortado** y un botón mal rotulado que ninguna aserción veía. Por eso hay un paso de mirar las capturas.
- **Una mutación que no se aplicó** hizo correr tres veces "sin el arreglo" con el arreglo puesto: la conclusión "la prueba no sirve" era la contraria a la verdad. Por eso la mutación **se verifica aplicada** (`ai/core/rules/edicion-por-reemplazo.md`).
- **Cada lección se repetía en el ticket siguiente**: se resolvía en el momento y no quedaba en ningún lado. Por eso el último paso clasifica cada lección y le da un destino.

---

## Cuándo usarlo

- El cambio tiene pantalla o flujo y hay que ver que funciona **con todo levantado**, no solo con dobles.
- Hay que ver una pantalla en un estado que depende de otros actores.
- Una revisión pide confirmar algo que el código estático no puede acreditar (un estado visual, un efecto en la base).

**Cuándo no:**

| Si lo que querés es… | Usá |
|---|---|
| El contrato del cambio, en rojo antes de implementar | Las pruebas de especificación del proyecto, con dobles |
| Concurrencia o SQL real, repetible | Las pruebas de integración, con una base de pruebas aparte |
| Leer un dato de la base | La herramienta de lectura del proyecto |

Las capas no compiten: primero pasan los unitarios y la integración, y recién entonces esta. **Si la integración falla, no se sigue**: el problema está en la lógica, no en el entorno.

---

## Paso 0: leer la guía del proyecto — BLOQUEANTE

La guía de pruebas de punta a punta **del proyecto** es lo que casi siempre ahorra la hora que se pierde: cómo se arranca, cómo se entra, qué datos existen, qué trampas tiene el framework. Leerla completa antes de escribir nada.

- La buscás en `ai/local/references/` (por convención, `e2e-guia.md`) o donde `ai-workspace.json` o el `CLAUDE.md` del proyecto la declaren.
- **Si no existe, crearla es el primer paso.** No se improvisa un script sin guía: lo que descubras al armarlo se pierde. Cómo armarla: si el proyecto tiene el pack `e2e`, el procedimiento `armar-kit-e2e`; si no, "Adaptarlo a tu proyecto" al final de este archivo.
- Si el cambio tiene anexo propio en la guía (algo específico de un requisito), también.

---

## Paso 1: dónde se corre — BLOQUEANTE

**Solo en la principal**, nunca en un slot: la base, los servicios y los puertos son uno solo para todo el workspace.

1. Si la rama vive en un slot, pedir el turno de la principal y después `promote` (`worktree-slots`, *El turno de la principal*; `cerrar-ticket`, fase 2), o trabajar sobre la rama que la persona deje en la principal. Al terminar, `release` devuelve la principal y el turno.
2. Verificar la rama de cada repositorio: `git -C <repo> branch --show-current`.
3. Si la rama trae una migración, **la corre la persona** (o el procedimiento de migraciones con su orden). Sin la migración, la prueba verifica otra cosa.
4. **Los servidores los levanta la persona**, o el agente si se lo pide. Nunca reiniciar el servidor de desarrollo de otra persona por cuenta propia.
5. Base y puertos **únicos** para esta corrida: si algo ya escucha en el puerto, **leer el log antes de probar**: puede estar contestando el proceso de antes y la prueba verificaría código viejo.

---

## Paso 2: el plan — antes de escribir código

Una tabla, con un identificador por escenario. Sale de los escenarios del diseño y de los criterios de aceptación; no se inventa cobertura.

| ID | Qué hace | Esperado | Con el código viejo |
|---|---|---|---|
| P0 | El entorno está levantado (servicios, base, aplicación) | todo responde | igual |
| E1 | … | … | … |
| N1 | (negativo) el rol que no debe poder | rechazado, y la base no cambió | … |
| A1 | (aislamiento) el cliente o tenant ajeno | no ve ni modifica | … |

- **P0 siempre.** Si no pasa, no se corre nada más.
- **La columna "con el código viejo"** dice qué distingue al cambio. Si no se puede escribir nada ahí, el escenario no prueba el cambio.
- **Negativos y aislamiento, no solo el camino feliz**: el rol que no debe poder, el cliente ajeno, el error del backend que la interfaz debe mostrar bien.
- Para cada escenario: **qué usuario** y **cómo se generan sus datos** (paso 3).
- Qué queda sucio al terminar y cómo se limpia (paso 7).

**Mostrarle el plan a la persona y esperar su visto bueno** cuando haga falta una cuenta cuya sesión se revoca al abrir otra, haya una acción irreversible, o algún dato no se pueda generar usando el producto.

---

## Paso 3: los datos — usando el producto

En este orden de preferencia:

1. **Ya existen**: se buscan **por rol** ("el cliente con la función X activa"), nunca por nombre, correo o identificador escritos a mano: en la base de otra persona no existen. El kit del proyecto tiene un descubridor que los busca, y si falta un rol dice cómo conseguirlo usando el producto.
2. **Se crean usando el producto**, por la API o la interfaz, como lo haría una persona.
3. **Seeds** (cargas de datos de desarrollo): solo con orden de la persona. Pisan datos de todos, incluidas contraseñas cambiadas a mano.
4. **Escritura directa en la base** (`INSERT`/`UPDATE`/`DELETE`): **nunca por cuenta propia**. Solo con orden explícita de la persona, cuando el producto no permite hacerlo en desarrollo, y **solo por el helper autorizado** del proyecto, que deja en el reporte qué se escribió, por qué y quién lo autorizó.

Nunca: una migración para cargar datos, ni escribir en la base "para destrabar" sin preguntar.

> **Por qué nunca `INSERT` a mano.** Un dato escrito a mano se salta las reglas del producto: la prueba pasa sobre un estado que el producto nunca produce, y no prueba nada del flujo real. Además puede dejar la base en un estado que rompe a quien la use después (por ejemplo, texto plano en una columna que el producto cifra).

---

## Paso 4: el script

Se copia la plantilla del kit del proyecto, no se parte de cero:

```bash
cp <plantilla-del-kit> <carpeta-local-del-script>/<ticket>.<ext>
```

La carpeta de los scripts de un ticket **no se commitea** (va en `.gitignore`): lo que sirva a otros tickets sube al kit compartido.

- **Al arrancar, el script se revisa solo** con el linter de scripts (si el proyecto tiene el pack `e2e`: el script `check-e2e-scripts` de `ai/packs/e2e/scripts/`, con el archivo como argumento). Un script con hallazgos no corre y dice qué corregir.
- Un escenario = una función que devuelve un resultado, con el ID de la tabla del plan.
- **Antes de escribir una protección, buscarla en los helpers del kit** (reintentos, esperas por lo que se ve, fechas con zona, capturas).
- **Reconocer antes de actuar**: la primera corrida mira (campos, botones, textos) y recién después actúa; obligatorio si la acción es irreversible.
- **Un contexto de navegador por persona.** Guardar la sesión y reutilizarla.
- **Contraseñas y tokens nunca se imprimen.**
- **Después de cada escritura, verificar el efecto en la base**: un 200 no prueba que se guardó.
- Captura en cada paso que el reporte vaya a citar.
- **Los textos esperados se copian del archivo de mensajes de la aplicación**, no de memoria.
- **Aserciones acotadas**: nunca el texto de un diálogo o de una página entera como aserción (frágil y propenso a falsos positivos); se busca en la región del componente.

---

## Paso 5: correr

```bash
<comando-del-proyecto> <script>              # sin ventana
<comando-del-proyecto> <script> --ver        # si la persona quiere mirar
<comando-del-proyecto> <script> --solo P0,E2 # solo algunos escenarios
```

**Código de salida: 0 todo OK · 1 algo FALLÓ · 2 NO CONCLUYENTE.** El 2 **no es verde**: significa que algo impidió probar (el entorno, un dato que falta), y se reporta diciendo qué. **Nunca canalizar el comando a `tail` o `head`**: el estado de salida de un pipeline es el del último comando y una falla sale en verde.

### Correrlo también contra el código viejo

Si el cambio es el arreglo de un defecto, la prueba tiene que **fallar sin el cambio**. Si pasa con el código viejo, la prueba no prueba.

1. **Quitar el cambio del working tree**, no con un commit ni un `stash` de toda la rama: solo del archivo que corresponde.
2. **Verificar que la mutación se aplicó** antes de correr nada: contar la coincidencia y mirar `git diff --stat <archivo>` (`ai/core/rules/edicion-por-reemplazo.md`). Una mutación que no se aplicó y da verde se lee como "la prueba no sirve".
3. Correr **solo los escenarios del cambio**.
4. **Volver el archivo** (`git checkout -- <archivo>`) y verificar con `git diff --stat` que quedó como estaba.
5. Mientras tanto, **nada más puede estar leyendo ese archivo**: una suite en segundo plano o una revisión verían el código viejo y darían un resultado que no es el de la rama.

Si algo en el log contradice la hipótesis (por ejemplo, una reversión de transacción donde el código mutado solo podía confirmar), parar y verificar que la mutación está aplicada.

---

## Paso 6: mirar las capturas — BLOQUEANTE

Mirar **cada** captura citada antes de dar un escenario por bueno. Un resultado 17/17 puede esconder un texto cortado, un botón mal rotulado, una superposición.

**Las mira un subagente, no la sesión principal.** Cada imagen abierta queda en el contexto y se vuelve a pagar en cada turno siguiente. La sesión principal lanza un subagente con la lista de capturas y, para cada una, **qué tiene que verse**:

> `03-pendiente.png`: la fila del pedido dice "Pendiente", el monto no está cortado y el botón dice "Cancelar".

El subagente abre cada una, **también busca lo que el criterio no nombra** (texto cortado, etiquetas equivocadas, superposiciones) y devuelve **solo las que fallan**, con el motivo, en 30 líneas o menos. Una captura que falla no se reabre en la principal: se corrige y se vuelve a mandar.

Excepción: si la persona pide ver una captura, esa se abre en la principal.

---

## Paso 7: dejar el entorno como estaba

- Datos de prueba vivos: darlos de baja por el producto (cancelar, rechazar, borrar lógico), no por la base.
- Interruptores o configuraciones tocadas: volverlas al valor que se anotó **antes** de tocarlas.
- Procesos que lanzó el agente: cortarlos **por árbol** y verificar que el puerto quedó libre. Los de la persona no se tocan.
- La base, sin conexiones trabadas: si el kit tiene un escenario de cierre que lo verifica, y falla, se reporta: es un defecto, no un problema del entorno.

---

## Paso 8: reportar

```
Prueba e2e <ticket> — rama <rama de cada repo> — <fecha>

| ID | Escenario | Estado | Evidencia |
|----|-----------|--------|-----------|
| P0 | Entorno   | OK     | —         |
| E1 | …         | OK     | 02-vista.png |
| E2 | …         | FALLA  | esperado X, obtenido Y — archivo:línea si se ubicó |

Resultado: N/N OK · N FALLA · N NO CONCLUYENTE
Con el código viejo: <qué escenarios fallaron sin el cambio, y la mutación verificada (git diff --stat)>
Datos: qué se creó y cómo (API/UI); escrituras directas autorizadas: ninguna, o cuál, por qué y quién la autorizó
Entorno: qué quedó distinto de como estaba, si algo

Lecciones (paso 9):
| Lección | Destino | Dónde quedó |
```

- **NO CONCLUYENTE no es OK.** Se dice qué impidió probar.
- Citar la consulta junto a cada número que salga de la base.
- Sin datos personales: alcanzan los conteos o los identificadores.
- Por defecto el reporte va al chat; al ticket o al PR, solo si la persona lo pide.

---

## Paso 9: clasificar lo aprendido — OBLIGATORIO

**Una prueba de punta a punta no termina con el reporte: termina cuando cada lección tiene destino.** Es lo que hace que la próxima, de cualquier persona con otro agente y otra base, no repita la misma hora perdida.

**Qué cuenta como lección:** todo lo que hizo perder tiempo, todo defecto del producto que la prueba encontró, y todo arreglo del script que se repetiría en otro ticket.

Se hacen las preguntas en orden; la primera que da **sí** decide (es el criterio de `gate-from-finding`: primero ¿puede repetirse?, después ¿se ve leyendo el archivo, sin correrlo?):

| # | Pregunta | Destino |
|---|---|---|
| 1 | ¿Es un defecto **del producto** que se ve leyendo el código? | **Gate de código** (`gate-from-finding`); el defecto además va a un ticket |
| 2 | ¿Es un error **del script** que se ve leyendo el script? | **Gate de script**: una regla en el linter, con sus casos (marca / no marca) |
| 3 | ¿La protección se escribiría igual en el próximo script? | **Helper** del kit, sin nada del ticket, con un comentario que diga el porqué |
| 4 | ¿Es conocimiento del entorno o del producto que sirve a cualquier prueba? | **Guía**: un punto en su tema, con regla, ejemplo y porqué, sin nombres de tu base |
| 5 | ¿Solo sirve para probar este requisito? | **Anexo**: un archivo corto y genérico por requisito |
| 6 | ¿Fue un caso único que no se va a repetir? | **Nada**: se dice en el reporte y listo |

Si la respuesta a 1 o 2 es "sí, pero no se puede automatizar", se anota en `ai/gate-candidates.md` con el motivo y la lección sigue bajando: casi siempre termina en un helper o en la guía.

### Para cerrar

1. El reporte termina con la tabla **Lección → destino → dónde quedó**.
2. Una línea en la bitácora de la guía con qué se probó y a dónde fue cada lección.
3. Correr los gates de lo que se tocó (el linter de scripts sobre el kit y la guía, y los gates de código si hubo uno).
4. **Nada queda solo en la memoria.** Si una lección se guardó en la memoria del agente, también va al repositorio: la memoria es de una persona y de una máquina; el repositorio es del equipo.
5. Los cambios se commitean cuando la persona lo pide.

---

## Lo que este procedimiento NO hace

- No corre en un slot.
- No escribe en la base ni corre seeds sin la orden de la persona.
- No abre una sesión que revoque la de la persona sin avisar.
- No commitea el script del ticket.
- No imprime contraseñas, tokens ni datos personales.
- No da por bueno un escenario sin haber mirado su captura.
- No nombra clientes, usuarios ni identificadores de una base: pide por rol.
- No termina sin clasificar cada lección, ni deja una solo en la memoria.

---

## Adaptarlo a tu proyecto

Este procedimiento no sabe cómo levanta *tu* aplicación. Quien lo adopta —una persona o un agente sin contexto— lo adapta una vez y deja el resultado en `ai/local/`. La referencia opcional para el lado del navegador es la skill `webapp-testing` (Playwright en Python, licencia Apache 2.0, que se puede redistribuir conservando su licencia y sus avisos); el pack `e2e` explica cómo usarla sin copiarla.

### Qué averiguar y dónde dejarlo

Contestá esto leyendo el proyecto (no preguntando todo a la persona) y dejalo en un archivo `e2e-guia.md` dentro de `ai/local/references/`:

| Pregunta | Qué va en la guía |
|---|---|
| ¿Cómo se levanta la aplicación completa? (comandos, orden, puertos, variables) | Pasos exactos, y cómo saber que ya está lista |
| ¿Dónde corre cada cosa y qué es compartido? | Base, servicios, puertos únicos: por qué solo en la principal |
| ¿Cómo se entra? (usuarios por rol, sesión, segundo factor, límites de intentos) | Roles y cómo conseguir sus credenciales **sin escribirlas** en el repositorio |
| ¿Qué datos hacen falta y cómo se generan usando el producto? | Por rol; qué hacer si falta uno |
| ¿Con qué se maneja el navegador y qué trampas tiene? | Framework, esperas, selectores, selects personalizados, navegación |
| ¿Cómo se mira la base? | La herramienta de lectura y su límite |
| ¿Hay procesos programados, caches o límites de frecuencia que afecten? | Cómo forzarlos o esperarlos |
| ¿Qué zona horaria muestra la interfaz? | Cómo calcular "hoy" |
| ¿Cómo se limpia? | Qué queda vivo y cómo darlo de baja |

Si el pedido es un script y no una guía, **primero la guía**: es la lección que no se pierde.

### Y el procedimiento propio

Si el proyecto necesita cambiar pasos de este archivo (levantar con un compose propio, por ejemplo), poné un procedimiento `prueba-e2e.md` dentro de `ai/local/procedures/`, con el mismo nombre: **el de `ai/local/` reemplaza al de la base**. Conservá los pasos 2, 5 (código viejo y código de salida 2), 6, 8 y 9: son los que evitan los incidentes de arriba.

### Cómo sé que lo adapté bien

- [ ] Un agente sin contexto, leyendo solo la guía, levanta la aplicación y corre el escenario P0 sin preguntar nada.
- [ ] La guía no contiene un nombre, un correo ni un identificador de ninguna base, ni una contraseña.
- [ ] Dice explícitamente qué rol se usa para cada tipo de escenario y cómo conseguir sus datos.
- [ ] Dice cómo se manejan las trampas del framework de navegador del proyecto (esperas, selects, navegación).
- [ ] Hay una plantilla de script que corre sola (P0 más un escenario de solo lectura), y devuelve 0, 1 o 2.
- [ ] El linter de scripts está configurado (`e2e` en `ai-workspace.json`) y marca un script de prueba con un error conocido.
- [ ] La guía tiene una bitácora y una sección "lecciones → destino".

### Cómo verificarlo

1. Corré la plantilla tal cual contra tu entorno: P0 tiene que dar OK.
2. Rompé algo a propósito (apagá un servicio) y corrélo: tiene que dar **2 NO CONCLUYENTE**, no verde.
3. Corré el linter sobre un script con una espera fija sin justificar: tiene que marcarla.
4. Pedile a otro agente, sin contexto, que ejecute un caso simple siguiendo solo la guía. Lo que pregunte es lo que falta en la guía.
