# Qué lleva cada sección de una ficha

Referencia de `redactar-requisito`. La ficha es una sola: las mismas secciones de siempre, más las **secciones de profundidad** cuando el requisito las necesita. Este archivo dice qué tiene que traer cada una para que la ficha alcance, no cómo se pregunta.

**La regla de fondo:** cada afirmación es una de cuatro cosas —lo que dice una fuente, una decisión tomada, evidencia del código, o un pendiente— y se nota cuál. Una sección alcanza cuando permite **una sola interpretación razonable** del comportamiento que le toca. No se mide en páginas ni en cantidad de títulos.

Lo que las fuentes no definen —una tabla, un campo, un endpoint, un estado, un plazo, un permiso— no se escribe: va a *Decisiones abiertas* con quién decide.

---

## Cuándo una ficha necesita profundidad

| Si el requisito tiene… | Suma |
|---|---|
| Un recorrido con varios pasos o actores | *Flujos* |
| Una entidad que cambia de estado | *Estados* |
| Algo que una persona configura | *Configuración*; si configurar es el requisito entero, `perfil: configuracion` y la tabla completa de parámetros |
| Un cálculo, umbral o clasificación | `perfil: calculo` en el encabezado, y la fórmula en *Reglas* |
| Un evento o señal que otro consume | `perfil: senal` en el encabezado, y *Dependencias* |
| Permisos distintos por perfil | La matriz completa de quién ve y hace qué en *Reglas*, y qué ve quien no tiene acceso |
| Una interfaz | *Flujos* con alternativos y errores, y qué ve cada perfil |
| Una integración con un tercero | *Dependencias* con el contrato, y en *Flujos* qué pasa si no responde |
| Dinero, permisos o datos sensibles que hay que poder reconstruir | *Auditoría* |
| Otros requisitos o servicios de los que depende o a los que entrega | *Dependencias* |
| Supuestos o riesgos que no son decisiones | *Riesgos y supuestos* |
| Una versión anterior | *Historial* (obligatoria desde la segunda versión) |

Una ficha que no tiene nada de esto se queda con las secciones de siempre, y está bien: **profundidad no es largo**. El error contrario también existe: la misma regla repetida en tres secciones. Se borra solo la repetición real —misma condición, mismo resultado, sin sumar actor, excepción ni trazabilidad—, nunca una precondición, una excepción o un límite para que la ficha "no sea larga".

---

## Las secciones de siempre

### En una línea

Quién puede qué, para qué le cambia. Si no entra en una línea, probablemente son dos requisitos.

### Qué pide

Tiene que responder, sin leer el resto:

- qué garantiza y qué problema de negocio resuelve;
- quién lo vive y en qué momento interviene (el disparador);
- qué resultado se ve cuando sale bien;
- **el límite:** qué no decide, no ejecuta, no reemplaza ni prueba. Por ejemplo, si una vista es informativa y no autoriza una acción, o si un registro aporta evidencia pero no decide un resultado;
- cuál es la fuente de verdad cuando hay dinero, estados, permisos o integraciones;
- en qué se diferencia de una capacidad parecida con la que se puede confundir.

No repite reglas ni flujos.

### Reglas

Cada regla es una frase, un comportamiento, en EARS (`redactar-requisito`). Además:

- **atómica y verificable:** condición, actor, resultado observable y, cuando aplica, lo prohibido ("no debe…");
- con dinero, permisos, estados o integraciones, dice **qué prueba el éxito y qué no lo prueba**: una respuesta exitosa de un tercero, una pantalla de confirmación o la ausencia de error no son un resultado de negocio;
- sin fragmentos sueltos (`estado: activo`) ni nombres de enum que no traen conducta.

Con `perfil: calculo`, una regla lleva la fórmula completa:

```text
<resultado> = <expresión>
```

con cada variable y su fuente, la unidad, el redondeo (o la decisión pendiente con quién decide), el operador de frontera (`>` o `≥`) y una tabla con un caso **dentro**, uno **en el límite** y uno **fuera**:

| Caso | Datos | Resultado |
|---|---|---|
| Dentro | … | … |
| Límite | … | … |
| Fuera | … | … |

### Ejemplos

Casos con datos concretos e inventados. Si hay distintos actores, orígenes o modalidades, uno representativo de cada variante.

### Escenarios de aceptación

El formato es el de `redactar-requisito` (`#### Escenario:`, `Verifica R…`, DADO / CUANDO / ENTONCES). Cada escenario es ejecutable desde afuera: estado inicial concreto, actor y vía, acción de prueba y resultado inequívoco, incluido lo que **no** debe pasar.

Cubrir, según el alcance: éxito; rechazo; límite o igualdad; ausencia o dato inválido; duplicado o concurrencia; error, demora o respuesta ambigua de un tercero; reintento o recuperación; autorización y visibilidad; aislamiento entre clientes o actores; no regresión de lo que ya funcionaba.

**Cada flujo tiene al menos un escenario**: el principal, cada alternativo y cada error. Los que siempre se olvidan: el camino feliz completo, la entrada rechazada y "una parte falla sin afectar a la otra". Una regla sin escenario se justifica en *Decisiones abiertas*.

### Errores y casos borde

| Situación | Qué pasa | Qué ve quien lo vive |
|---|---|---|

Cada caso resuelve si el proceso continúa, se detiene, se deriva, queda pendiente, prohíbe el reintento o deja evidencia. Se describe lo visible ("cancela y deja todo como estaba"), no el mecanismo ("rollback").

### Fuera de alcance

Lo que parece parte de esto y no lo es, y si es de otra fase o de otro requisito, cuál. "Ninguno" también es una respuesta.

### Datos y reglas que toca

Las entidades de negocio que intervienen —no tablas ni campos—, y para cada una lo que haga falta de esto:

| Qué representa | Qué no representa | Alcance | Fuente de verdad | Quién la crea y quién la ve |
|---|---|---|---|---|

Además: las reglas de negocio del proyecto que aplican, los datos sensibles y si algo sale hacia afuera por algún canal. Ninguna matriz de cobertura de código va acá: eso es *Cómo quedó*.

### Decisiones abiertas

```markdown
- [a decidir: <pregunta concreta>] — decide <quién>. Mientras tanto: <qué se asume o qué queda bloqueado>.
```

Cada una con impacto, dueño y si bloquea. Una decisión que ya se tomó no está acá: está aplicada en las reglas y anotada en el archivo de decisiones del requisito, si el proyecto lo lleva.

### Cómo quedó

Antes de construir: "Todavía no se construyó nada". Si se revisó código existente, la **capa técnica**, separada de la funcional:

| Comportamiento | Estado | Evidencia | Qué no demuestra |
|---|---|---|---|
| R3 — … | reutilizable / parcial / falta / diverge / sin revisar | repo, rama o commit, archivo | … |

La evidencia del código dice qué existe en esa revisión. No prueba que esté aprobado, ni que esté en producción, ni que funcione con datos reales. Una búsqueda sin resultados no prueba que algo no exista: dice dónde y con qué términos se buscó.

---

## Las secciones de profundidad

Van **entre las de siempre**, en el orden de la plantilla de `redactar-requisito`.

### Flujos

Cada flujo con:

1. nombre y actor que lo inicia;
2. disparador y precondiciones;
3. pasos observables y ordenados;
4. bifurcaciones, rechazos y a quién se deriva;
5. qué queda garantizado si sale bien, y qué si falla o no hay respuesta;
6. qué evidencia queda;
7. qué requisito toma el paso siguiente, si sale de este.

Con un tercero: qué respuesta habilita continuar, cuál detiene, qué pasa sin respuesta y si el reintento está permitido, prohibido o es de otro.

### Estados

Solo si hay una entidad con ciclo de vida propio. Si no lo hay, la sección no va: **no se fabrica un diagrama** para una regla, un parámetro o una señal.

```text
borrador --enviar--> pendiente --aprobar--> activo
                     pendiente --rechazar--> rechazado
```

| Desde | Evento o condición | Hacia | Quién lo dispara | Qué no puede pasar |
|---|---|---|---|---|

Con estado inicial, terminales y las transiciones prohibidas.

### Configuración

Solo parámetros con dueño y efecto definidos:

| Parámetro | Para qué | Valores válidos | Por defecto | Alcance | Quién lo cambia | Desde cuándo rige | Qué no modifica |
|---|---|---|---|---|---|---|---|

Una tabla con solo nombres de parámetros no cumple. Un default que nadie definió es `[a decidir]`, no un número plausible. Si el requisito consume la configuración de otro, se nombra al dueño y no se la redefine.

### Auditoría

Solo si la fuente la exige o hay dinero, permisos o datos sensibles:

| Evento | Cuándo | Datos mínimos | Datos prohibidos | Quién lo consulta | Cuánto se guarda |
|---|---|---|---|---|---|

"Debe ser trazable" no alcanza.

### Dependencias

| Requisito o servicio | Qué le da a este | Qué recibe de este | Límite de responsabilidad |
|---|---|---|---|

No se lista un requisito por cercanía temática. **Leé la ficha del vecino** y fijate qué espera recibir: si esta entrega menos, es un riesgo abierto. Para un servicio externo: contrato, qué respuesta no es concluyente y quién recupera.

Con `perfil: senal`, la señal se describe acá o en *Reglas*: quién la produce, bajo qué condición, qué evidencia lleva, cómo se evita el duplicado y quién actúa después.

### Riesgos y supuestos

| Riesgo o supuesto | Evidencia | Impacto | Qué lo controla | Dueño |
|---|---|---|---|---|

Un supuesto dice qué lo hace necesario, qué comportamiento condiciona y qué pasa si es falso. No se convierte en regla sin decisión.

Cierra con un **análisis crítico** corto y concreto, no decorativo: qué supuesto invalidaría un flujo, qué tensión hay con otros requisitos, qué alternativa se descartó, qué vacío es peligroso y qué pasa si no se resuelve.

### Historial

| Versión | Fecha | Qué cambió | Por qué | Quién decidió |
|---|---|---|---|---|

Solo contenido, nunca estilo. Desde la segunda versión, además, la **matriz de no regresión**: cada regla, escenario, caso borde, parámetro y dependencia de la versión anterior marcada como `preservado`, `ampliado`, `corregido` (con la evidencia) o `retirado` (con la decisión). Lo que no aparece en la tabla se perdió sin querer.

---

## Control antes de darla por lista

- Cada sección cumple lo de arriba, y lo que no aplica dice por qué.
- Ninguna afirmación sin fuente, decisión o evidencia: lo demás está en *Decisiones abiertas*.
- Lo que una fuente afirma, la ficha lo afirma igual: un "falta confirmado" no se baja a "sin verificar".
- Todo id va con su nombre: `R3 — Unicidad por sede`, `RF-2.04 — Alta de sedes`, no el id solo.
- La ficha habla del requisito, no de la conversación ni de quién la pidió.
- Si el proyecto tiene fichas modelo, se compara con la del mismo tipo: si esta es claramente más pobre en reglas, casos borde o escenarios con valores, no está lista aunque tenga todas las secciones.
