# Archivar un cambio

Cierra un cambio ya implementado y mergeado: verifica que esté realmente completo y mueve lo que corresponde a la especificación permanente.

---

## Cuándo

**Después del merge, no antes.** Archivar un cambio que todavía está en revisión hace que desaparezca de los activos mientras alguien lo sigue trabajando.

---

## Paso 1: verificar que está completo

Antes de mover nada:

- Todas las tareas marcadas.
- Todos los tests en verde.
- Cada escenario del diseño con su test.
- El cambio efectivamente mergeado en la rama base.

Una lista de tareas sin marcar **no** es prueba de que el trabajo esté pendiente: es habitual que se implemente todo y nadie marque nada. Verificar contra el código y contra el historial, no contra las casillas.

Al revés también: casillas marcadas no prueban que esté hecho.

---

## Paso 2: qué sobrevive al archivado

Un cambio es temporal; la especificación es permanente. Al archivar, decidir qué del diseño pasa a ser **la descripción de cómo funciona el sistema ahora**:

- Reglas de negocio que quedaron vigentes.
- Contratos que otros van a consumir.
- Decisiones con su motivo — el motivo es lo que evita que alguien las revierta sin entender.

Lo que **no** pasa: el detalle de la implementación, el plan de trabajo, las decisiones que ya se tomaron y ejecutaron.

Si nada del diseño merece sobrevivir, el cambio se archiva sin más. No hay que inventar contenido para justificar el paso.

---

## Paso 3: archivar

Mover el cambio al archivo del repositorio que corresponda, con la herramienta del proyecto.

---

## Por qué importa que esto se haga

Los cambios que se implementan y nunca se archivan se acumulan como "trabajo activo". Meses después nadie sabe cuáles siguen abiertos de verdad, y cualquier barrido sobre los cambios activos devuelve ruido: escenarios de funcionalidades que hace rato están en producción.

**Un cambio activo que ya está mergeado es información falsa**, y las herramientas que lo leen empeoran por su culpa.
