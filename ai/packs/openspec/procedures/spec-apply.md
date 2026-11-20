# Implementar un cambio

Ejecuta las tareas de un cambio ya diseñado y con sus tests en rojo.

---

## Precondiciones

No se empieza sin las tres:

1. El diseño está **aprobado** por la persona.
2. Los tests de los escenarios están escritos y **fallan**.
3. El alcance está dentro del umbral, o la excepción está justificada.

Si alguna falta, el procedimiento correcto es otro: `spec-propose` o `spec-driven-testing`.

---

## Durante la implementación

### El diseño manda

El diseño aprobado es el contrato. Si al implementar aparece que el diseño **no se puede cumplir** —o que cumplirlo sería un error— eso no se resuelve improvisando: se dice, se corrige el diseño, y se sigue.

Una implementación que se aparta del diseño en silencio deja el documento mintiendo, y la próxima persona que lo lea va a trabajar sobre algo que no existe.

### Las tareas no crecen

Si aparece trabajo necesario que no estaba en la lista: **parar y decirlo**. Ver `spec-scope-discipline`.

Anotar como trabajo aparte lo que sea mejora y no necesidad.

### Marcar a medida que se avanza

Una tarea se marca cuando está hecha **y verificada**, no cuando se escribió el código. Una lista de tareas donde todo está marcado y los tests fallan es peor que no tener lista.

---

## Al terminar

### Los tests pasan. Todos

No "todos menos uno que ya estaba fallando". Si un test preexistente falla, hay que saber por qué: o lo rompió este cambio, o ya estaba roto y alguien lo venía ignorando. Las dos cosas se dicen.

### Las verificaciones automáticas corren

```bash
node scripts/run-gates.js --repo <repositorio>
```

Más los comandos declarados para ese repositorio: comprobación de tipos, análisis estático, compilación.

**Si un gate reporta algo nuevo, se arregla antes de dar por terminado.** La deuda preexistente está congelada; lo que aparece es lo que introdujo este cambio.

### Cada escenario tiene su test, y pasa

El gate de cobertura de escenarios lo verifica. Un escenario sin test es una parte del diseño que nadie comprobó.

---

## Antes de decir que está listo

- ¿Todas las tareas marcadas, y marcadas porque están hechas?
- ¿Todos los tests en verde, incluidos los que ya existían?
- ¿Los gates sin hallazgos nuevos?
- ¿Cada escenario del diseño cubierto?
- ¿El código hace lo que el diseño dice, incluidos los casos límite?

Si algo quedó afuera, **decirlo explícitamente**: qué, por qué, y qué haría falta para completarlo. Un trabajo entregado como completo cuando no lo está cuesta más que uno entregado como incompleto.

---

## Lo que este procedimiento no hace

- **No commitea.** El commit lo hace `git-commit-workflow`, y solo con pedido explícito.
- **No archiva el cambio.** Eso es `spec-archive`, después de que se mergee.
- **No decide alcance.** Si hay que partir, se para y se avisa.
