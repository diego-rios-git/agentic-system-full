# Ciclo de una tarea

Toma **una** tarea y la lleva de "pendiente" a "terminada y archivada", sin saltear ningún paso, moviendo el estado de su requisito a medida que avanza (si el proyecto tiene tablero de requisitos).

Los procedimientos atómicos ya existen. Este los encadena y agrega lo que ninguno cubre solo: la revisión del propio trabajo, la prueba de punta a punta, y convertir en verificación automática el error que uno mismo acaba de cometer. De la tarea hecha al merge sigue `cerrar-ticket`; este ciclo termina con el cambio archivado y el tablero al día.

**Si la tarea vive en un slot**, la prueba de punta a punta (paso 5) y el archivado (paso 7) los hace `cerrar-ticket` en su orden: el archivado en el precierre, en el slot, y la prueba en el turno de la principal. Este ciclo, en el slot, llega hasta la revisión y la automejora, y `cerrar-ticket` sigue desde ahí.

---

## La regla que sostiene todo lo demás

**Una tarea por vez, terminada de punta a punta.**

Dos tareas a medias no son media entrega: son dos entregas rotas, y nadie sabe cuál de las dos dejó el sistema en el estado en que está.

Si en el medio aparece trabajo que no estaba en la tarea, **no se agrega**: se anota y se sigue (`spec-scope-discipline`). La excepción es descubrir que lo pedido no funciona sin eso, y entonces se dice antes de hacerlo.

---

## Los ocho pasos

Si el proyecto tiene tablero de requisitos (`requirements` en `ai-workspace.json`), cada tarea construye un **requisito**, y su ficha lleva el estado. Los movimientos están escritos en los pasos 0, 1, 4 y 7 y se hacen **sin que la persona los pida**. La regla completa está en `requisitos`. Sin tablero, esos movimientos no existen y el ciclo sigue igual.

### 0. Ubicar el requisito

Buscar la ficha que esta tarea construye: `node scripts/check-requirements.js --tablero`, o por título en la carpeta de `requirements.dir`.

| Caso | Qué se hace |
|---|---|
| Existe y está en `validado` (o más adelante) | Se sigue |
| Existe y está en `pendiente` o `analisis` | Se dice: la persona todavía no lo decidió. En `trabajo-autonomo` se sigue igual si la tarea está en un plan que la persona pidió, y se anota |
| No existe | Se crea con `redactar-requisito`, con el siguiente id libre y `estado: analisis`. Lo que pide sale del plan o del pedido, con su enlace |
| Está en `descartado` | **Parar.** Alguien decidió no hacerlo |

La tarea puede construir parte de un requisito que ya está `cerrado` (una mejora, un arreglo): se usa esa ficha y el change nuevo la reabre en el paso 1 (una persona decide si es trabajo nuevo: el sync nunca retrocede un estado solo).

**Si hay tarjeta** (`tracker.kind` distinto de `none`), explorar es el evento 1 de `tracker-events`: se mira el responsable y se ofrece autoasignarla; no se mueve.

### 1. Proponer el cambio

`spec-propose`. Sale un change con propuesta, diseño, escenarios y tareas. **Se declara el requisito en el change** (`rf:`; y `cierra_rf: false` con `pendiente_rf` si entrega solo una parte): sin eso la derivación no ve el vínculo.

**Ficha:** declarado el `rf:`, se sincroniza el estado, que pasa a `implementacion`:

```bash
node scripts/check-requirements.js --sync-estados
```

(Corre solo sobre fichas con evidencia; no archiva nada ni cierra nada: todavía hay un change abierto. El `--sync-estados` que cierra requisitos es el de **después del merge**, `cerrar-ticket`.) Un change abierto que ninguna ficha reclama hace fallar el gate de requisitos.

**Antes de escribir una línea**, aplicar `spec-scope-discipline`: contar las tareas. Por encima del umbral, se parte.

**Las decisiones abiertas se señalan, no se resuelven implementando.** Si una decisión cambia el negocio (qué se cobra, qué dato se guarda, qué ve el usuario), **parar y preguntar**. Si solo cambia cómo se escribe el código, decidir, dejarlo escrito y seguir.

### 2. Tests en rojo

`spec-driven-testing`. Cada escenario se vuelve un test cuyo título lo nombra.

**Verlos fallar es parte del paso.** Un test que nunca se vio fallar no prueba nada: puede estar verificando algo trivialmente cierto, o no estar ejecutándose.

Si hace falta, crear la pieza con su firma y el cuerpo lanzando un error de "no implementado": así los tests fallan **por comportamiento** y no por un módulo que no existe, y se ven los N en rojo en vez de una suite que no carga.

### 3. Implementar

`spec-apply`. Hasta que pasen **todos**, no la mayoría.

**El diseño manda.** Si al implementar aparece que no se puede cumplir, se corrige el diseño y se dice: no se improvisa en silencio, porque entonces el documento queda mintiendo.

Si un test falla y el código parece correcto, considerar que **el equivocado sea el escenario**: pasa que un escenario trae la aritmética mal o mezcla dos reglas. Se corrige ahí; no se afloja el test.

### 4. Revisar el propio trabajo

**Ficha:** con los tests en verde, el requisito pasa a `testing` (a mano: es el único estado intermedio que no se deriva) y se actualiza `actualizado:`. Ahí queda durante la revisión y la prueba de punta a punta.

**Si la tarea vive en una rama** (un slot, no la rama base), antes de revisarla se trae la base con `git-sync-branch`: revisar código que no es el que se va a mergear es revisar otra cosa.

Correr las verificaciones y **leer lo que dicen**:

```bash
node scripts/run-gates.js --repo <repo>
```

Más el chequeo de tipos que ve los tests, si el repositorio lo declara (`verificar-lo-que-el-runner-no-ve`).

> **Cómo se detecta que un gate encontró algo:** a veces el nombre del gate **desaparece** de la línea "sin hallazgos nuevos". No hay alarma. Hay que comparar contra la corrida anterior, y tratar "no corrió" como **no verificado**.

Por cada hallazgo, decidir: ¿es real o es falso positivo? Un falso positivo se documenta en el código y se congela con `--write-baseline`. Uno real se arregla.

Además, releer el cambio buscando lo que ningún script ve:

- ¿La autorización se decide **antes** del efecto, y no después de haber escrito?
- ¿Algún dato sensible puede terminar en un log, en un mensaje de error o en una respuesta que no lo necesita?
- ¿Las operaciones que tienen que ser atómicas están en una transacción, con el mecanismo de esa transacción?
- ¿Los casos límite del diseño están cubiertos, o solo el camino feliz?
- **¿El cambio mueve datos o identidad entre registros** (unir, conciliar, transferir)? Probarlo con los dos que lo pueden disparar: el dueño legítimo y quien tipeó un dato ajeno. Y mirar **a quién llega cada aviso** después.
- **¿El cambio reemplaza una protección** (un candado, un token, una validación)? Listar qué garantizaba la vieja (entre procesos, entre réplicas, tras un reinicio, durante un despliegue con dos instancias) y comprobar que la nueva cubre lo mismo. Un mecanismo que "reemplaza" un candado compartido por uno local a un proceso no cubre lo mismo.

Para un cambio grande o riesgoso, `pr-review` lanza los agentes de QA, código y seguridad en paralelo. En el trabajo autónomo, la revisión la hacen además agentes **sin contexto de cómo se hizo** (ver `trabajo-autonomo`).

### 5. Prueba de punta a punta

Los tests de integración prueban una pieza. Este paso prueba **el recorrido completo, como lo haría quien lo usa**.

Qué significa según lo que exista:

| Si la tarea... | La prueba es |
|---|---|
| Solo agrega lógica de dominio | El recorrido completo contra la base de datos real, encadenando las operaciones como ocurrirían de verdad |
| Expone una interfaz de red | Levantar la aplicación y pegarle a los puntos de entrada, con sesión real |
| Toca la interfaz de usuario | Levantar la aplicación y usarla |
| Toca una integración externa | Simular la entrada con una carga real y seguir la conversación completa |

**Encadenar las operaciones importa más que probarlas sueltas.** Una operación que se crea, se modifica y se cancela recorre tres transacciones y dos transiciones; cada una anda sola, y el encadenado es donde aparece lo que no se previó.

Si falla, se corrige y se vuelve al paso 4. Cómo se hace, paso a paso, es `prueba-e2e`; cómo lo hace este proyecto (levantar, mirar logs, mirar la base) lo dice la guía propia que ese procedimiento pide en `ai/local/`.

### Antes de creerle a una prueba: ¿probé lo que creo que probé?

Una verificación rota da un resultado **tranquilizador y falso**, que es peor que no verificar.

| Qué pasó | Qué parecía |
|---|---|
| El proceso viejo seguía escuchando en el puerto y el nuevo murió al arrancar | Que la corrección no funcionaba |
| Una ruta en formato de otra shell, que el intérprete del sistema no resuelve | Que la regla no detectaba nada |
| Un `echo "listo"` después de un comando encadenado con `;` | Que el comando anterior había salido bien |

Antes de concluir algo de una prueba:

- Si se levantó un proceso, **mirar su log** y confirmar que arrancó. No alcanza con que el puerto responda: puede estar respondiendo el de antes.
- Si una verificación devuelve "cero hallazgos", confirmar que **encuentra algo cuando debe**: introducir el problema a propósito y ver que lo marque.
- Ante un resultado que contradice lo que se acaba de escribir, sospechar primero de la prueba.
- **Un mensaje de éxito impreso a mano no es una verificación.** Encadenado con `;` se imprime igual cuando el comando falló; con `&&` al menos depende de él.
- **Una verificación que da lo mismo con la acción contraria no prueba la acción.** "Unir dos registros" no se verifica con "la lista queda vacía": pasa igual si son personas distintas y también si el pedido no hace nada. Por cada acción, preguntarse qué deja **solo ella** en la base, y verificar eso. Para confirmarlo, correr la prueba una vez con la acción contraria y verla fallar.
- **Una lista de "lo que no puede aparecer en el log" solo sirve con valores rastreables.** Una palabra común no se puede buscar; un texto con una marca única, sí.

### 6. Automejorar

**El paso que casi todos saltean, y el único con retorno creciente.**

Mirar hacia atrás en la tarea que se acaba de terminar y preguntarse:

1. **¿Qué error cometí?** No "¿hubo errores?": hubo. Cuál.
2. **¿Ese error puede repetirse?** Si puede pasarle a otro, en otro archivo, en otro módulo, es un patrón.
3. **¿Se puede detectar sin ejecutar el código?** Entonces es un gate: `gate-from-finding`, con sus dos fixtures.
4. **Si no se puede automatizar**, va a la lista de candidatos del proyecto **con el motivo concreto**. Un candidato descartado con su porqué es información; descartado en silencio, no.

Un error corregido a mano dos veces antes de que alguien lo convierta en regla funcionó las dos veces porque alguien leyó con atención. Esa atención no escala.

También vale acá: ¿algo quedó más complicado de lo necesario? `simplify` limpia sin cazar defectos.

### 7. Archivar el cambio

`spec-archive`. Verificar contra el código y el historial, **no contra las casillas marcadas**. Incluye releer la ficha contra lo entregado y dejar `cierra_rf` diciendo la verdad.

Lo que sobrevive es **cómo funciona el sistema ahora**, en la especificación permanente. Lo que no sobrevive: el plan de trabajo, el detalle de implementación, las decisiones ya ejecutadas.

Un change activo que ya está terminado es información falsa, y las herramientas que lo leen empeoran por su culpa.

**Ficha:** el estado `cerrado` **no** se sincroniza todavía si el cambio va a pasar por un PR: espera al merge (`cerrar-ticket`, paso 3.4). En un flujo sin PR (se integra directo y la persona lo pidió), se sincroniza acá:

```bash
node scripts/check-requirements.js --sync-estados
node scripts/check-requirements.js        # tiene que salir sin hallazgos
```

### 8. Actualizar el tablero

El estado ya se movió. Lo que queda es lo que un estado no dice:

- En la **ficha**: si cambió lo que el requisito hace, el párrafo "Qué pide"; en "Cómo quedó", las specs nuevas; y **qué quedó afuera y por qué**. Si lo que quedó afuera es otro requisito, se crea su ficha en `pendiente` y se enlaza.
- En el **plan** de la tarea (si hay `autonomous.plan`): la tarea pasa a cerrada con lo que salió distinto. El plan cuenta la historia del trabajo; el estado del requisito no se escribe ahí.
- Si apareció una decisión de producto, va donde el proyecto guarda sus decisiones (`ai/local/`).

**El commit no es parte de este ciclo.** Lo pide la persona, y cuando lo pide incluye el push (`git-commit-workflow`). **Excepción:** en `trabajo-autonomo`, la persona ya autorizó commit y push al cerrar cada tarea **solo si lo declaró** (`autonomous.commit`).

---

## Cuándo parar y preguntar

> **En `trabajo-autonomo` no se para**: cada situación de esta tabla se decide de la forma más conservadora y reversible, y se anota en la bitácora para que la persona la revise.

No todo se resuelve solo. Parar cuando:

| Situación | Por qué no se decide solo |
|---|---|
| Una decisión cambia **qué se cobra, qué se guarda o qué ve un usuario** | Es del negocio, no de la implementación |
| La tarea depende de una credencial o de una cuenta que no existe | No se inventa: se dice qué falta y quién lo consigue |
| El alcance pasó del umbral y no hay corte natural | Partir es del que decide qué entra |
| Aparece una contradicción entre dos documentos del dominio | Se señala; resolverla durante una implementación es cómo se propaga |

Preguntar cuesta un mensaje. Adivinar cuesta una tarea entera.

---

## Antes de decir que una tarea terminó

- [ ] Todos los tests en verde, incluidos los que ya existían
- [ ] Los gates sin hallazgos nuevos, o con los falsos positivos documentados y congelados
- [ ] El chequeo de tipos de los tests, si el repositorio lo declara
- [ ] Cada escenario del diseño con su test
- [ ] La prueba de punta a punta hecha, no asumida
- [ ] El paso de automejora ejecutado: gate creado, o candidato anotado con su motivo
- [ ] El change archivado, con su descripción permanente
- [ ] La ficha con su change declarado (`rf:`, `cierra_rf:`), el estado sincronizado y lo que quedó afuera
- [ ] `check-requirements.js` sin hallazgos (si hay tablero)

Si algo quedó afuera, **decirlo explícitamente**: qué, por qué, y qué haría falta. Un trabajo entregado como completo cuando no lo está cuesta más que uno entregado como incompleto.
