# Manual de uso de IA por roles

Qué se espera de cada rol, qué no se comparte, y dónde la IA no decide.

> **Adaptalo.** Este documento describe roles genéricos. Si en tu organización se llaman distinto o las responsabilidades están repartidas de otra forma, movelo a `ai/local/` y editalo: una actualización de la base no lo va a pisar.

---

## 1. Base común

Aplica a todos los roles, sin excepción.

### 1.1 Reglas que no se negocian

- **Nada de secretos en un prompt.** Ver §1.2.
- **Nada se commitea sin pedido explícito.** Que el trabajo esté terminado no habilita el commit.
- **Ningún commit lleva atribución de IA.**
- **Toda salida de un modelo se valida antes de usarse.** Ver §1.3.

### 1.2 Qué no se comparte con un modelo

**Si no lo pegarías en un ticket que puede leer cualquiera, no lo pegues en un prompt.**

| Categoría | Qué incluye |
|---|---|
| Secretos y credenciales | Archivos de entorno, claves de API, tokens de sesión, contraseñas, cadenas de conexión |
| Datos personales | Nombre y documento de alguien real, datos bancarios, dirección, teléfono, correo |
| Datos de clientes | Nombre real de un cliente junto con sus volúmenes o condiciones comerciales |
| Volcados | Copias de base, exportaciones, registros de producción sin anonimizar, capturas con datos reales |

Sí se comparte: el esquema, la estructura de un contrato, un error sin su carga útil, un registro de ejemplo **inventado**, y el código.

Fuente completa, incluido qué hacer si algo se filtró: `ai/core/rules/datos-sensibles.md`.

### 1.3 Validación humana mínima

Antes de aprobar cualquier salida de un modelo, seis preguntas:

1. ¿Hace lo que se pidió, o algo parecido?
2. ¿Toca solo lo que debía tocar?
3. ¿Qué pasa en el caso límite —valor ausente, colección vacía, fallo a mitad de camino?
4. ¿Los datos que entran desde afuera se validan **antes** de usarse?
5. ¿Las afirmaciones sobre el código existente son ciertas? **Abrí el archivo y comprobalo.**
6. ¿Los tests prueban comportamiento, o copian la implementación?

La quinta es la que más se saltea y la que más caro sale: un informe que cita una línea que no existe es convincente y es falso.

### 1.4 Dos malentendidos frecuentes

**"El agente ya sabe."** No tiene la conversación de ayer salvo que esté en el contexto de hoy. Lo que no está escrito en el proyecto o en el mensaje, no existe.

**"Lo revisó la IA, está bien."** Un modelo revisando su propia salida comparte sus puntos ciegos. Los gates cubren lo verificable mecánicamente; el resto lo cubre una persona.

---

## 2. Las verificaciones automáticas

```bash
node scripts/run-gates.js --all
```

Corren solas después de cada escritura y **solo reportan lo nuevo**: la deuda preexistente está congelada.

Dos cosas que hay que saber leer:

- **Un gate que dice "no se pudo ejecutar" es *sin verificar*, no *sin hallazgos*.** Un gate roto que se lee como limpio es peor que no tenerlo.
- **Un falso positivo es aceptable si la regla es angosta.** Si una regla produce falsos positivos seguido, hay que achicarla: el equipo aprende a ignorar los avisos y ahí se pierde el gate entero.

---

## 3. AI Technical Lead

**Responsabilidad.** Que la base sea usable, esté al día y se use. Aprueba lo que entra.

**Límite del rol.** No es mesa de ayuda ni soporte individual. No mide el éxito por cantidad de agentes publicados.

| Uso recomendado | Para qué |
|---|---|
| Convertir errores confirmados en gates | El único mecanismo con retorno creciente del sistema |
| Revisar los activos periódicamente | Sin esta revisión, la base envejece y muere |
| Portar a la base lo aprendido en un proyecto | Nadie más lo va a hacer |

**Dónde no decide la IA.** Qué activo entra a la base común, y qué regla se vuelve bloqueante para todos.

**Lo que hay que sostener en el tiempo:** la cadencia de revisión. Es el único control real contra el envejecimiento, y no está automatizado.

---

## 4. Tech Leads y referentes técnicos

**Responsabilidad.** Que lo que se mergea en su proyecto cumpla, venga de donde venga.

**Límite del rol.** No aprueban cambios a la base común por su cuenta; sí opinan antes de que se aprueben.

| Uso recomendado | Para qué |
|---|---|
| Revisión orquestada antes de mergear | Corre los gates una vez y lanza los agentes en paralelo |
| Auditoría de seguridad en cambios sensibles | Autorización, aislamiento de datos, secretos |
| Adaptar procedimientos en `ai/local/` | Lo que es propio del proyecto y no de la base |

**Antes de mergear**, verificar a mano lo que ningún script decide: que el código haga lo que el diseño dice, que el alcance sea el aprobado, y que los casos límite estén cubiertos.

**Dónde no decide la IA.** Si un cambio se mergea. Si una excepción a una regla está justificada.

---

## 5. Developers

**Responsabilidad.** Lo que entregan, lo hayan escrito ellos o un modelo. **La firma es de quien mergea.**

| Uso recomendado | Para qué |
|---|---|
| Explorar antes de tocar | Entender qué hace hoy y qué sorprende |
| Escribir tests desde la especificación | Antes de implementar, y tienen que fallar |
| Explicación educativa de un cambio | Para entender código ajeno |
| Diagnóstico de un fallo | Con el error crudo, sin datos reales |

**Antes de abrir un PR**: los tests pasan —todos—, los gates no reportan nada nuevo, y el cambio hace lo que decía el pedido, sin lo que nadie pidió.

**Cuando el agente repite un error que ya corregiste**, decilo: ese es el caso de `gate-from-finding`. Corregido a mano se corrige una vez; convertido en gate, no vuelve nunca.

**Dónde no decide la IA.** Si el trabajo está terminado. Si una excepción vale la pena. Si un caso límite se puede ignorar.

---

## 6. Product Managers

**Responsabilidad.** Que lo pedido esté claro antes de que empiece el trabajo.

| Uso recomendado | Para qué |
|---|---|
| Redactar criterios de aceptación | En forma de escenarios observables |
| Detectar ambigüedades en un pedido | Antes de que se implemente sobre una suposición |
| Estimar orden de magnitud | Para priorizar, **no** para comprometer una fecha |

**Un escenario que no se puede convertir en test está mal escrito**: es demasiado vago, o describe algo que no se puede observar. Ese es el momento de arreglarlo, no después.

**Si el proyecto instaló el pack `analisis-funcional`**, ahí está el método completo: sacar fichas de un documento del cliente (`ficha-desde-documento`), especificar un cambio sobre una ficha (`cambio-de-requisito`), revisar si una ficha está lista (`revisar-ficha`) y ordenar varios requisitos por dependencias (`catalogo-y-camino-critico`). Lo usa igual un dev que necesita la ficha para arrancar: las decisiones que quedan abiertas le llegan escritas, con quién las decide.

**Información**: nada de datos de clientes reales en un prompt, ni siquiera para "dar contexto".

**Dónde no decide la IA.** La prioridad, el alcance de una entrega, y qué es aceptable para el negocio.

---

## 7. Gerencia

**Responsabilidad.** Decidir sobre inversión, riesgo y alcance del programa.

| Uso recomendado | Para qué |
|---|---|
| Resúmenes de estado | A partir de información que ya existe |
| Comparar alternativas | Con los supuestos explícitos |

**Qué mirar para saber si esto funciona**: si la base se usa en trabajo real, si los gates siguen encendidos meses después, y si alguien que no es el AI Technical Lead pudo empezar solo.

**Qué no mirar**: cantidad de agentes publicados, cantidad de prompts, cantidad de licencias. No miden nada.

**Las métricas nunca se usan para evaluar a una persona.** En el momento en que se usan así, dejan de ser confiables: la gente optimiza el número, no el trabajo.

**Dónde no decide la IA.** Presupuesto, contrataciones, prioridades del negocio, y qué riesgo se acepta.

---

## 8. Lo que este manual todavía no define

Escrito acá para que no se pierda:

- **Métricas de adopción.** Qué se mide, cómo, y cada cuánto.
- **Qué referente se consulta** por proyecto para un cambio de alto riesgo.
- **Qué pasa si alguien no sigue una regla bloqueante.** Hoy no hay consecuencia definida, y eso está bien mientras el equipo sea chico — pero hay que decidirlo antes de que deje de serlo.

---

## 9. Versión

v1.0. Para cambiarlo, movelo a `ai/local/` y editalo ahí: así sobrevive a las actualizaciones de la base.
