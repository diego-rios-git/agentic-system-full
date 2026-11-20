# Crear una migración

Genera y aplica una migración de esquema siguiendo un orden obligatorio.

## Las tres reglas

1. **Se genera con la herramienta, siempre.** Nunca se escribe el archivo de migración a mano: un archivo mal armado no se nota hasta que corre sobre datos reales. El hook `pre-write-protected` bloquea escribir en la carpeta de migraciones.
2. **Lo generado no se edita sin autorización humana temporal.** Si al archivo le falta algo real, se explica a la persona qué falta y por qué, se espera su respuesta, y si autoriza ella corre `node scripts/allow-protected-edit.js <archivo>` (vale para ese archivo y vence sola). No la corre el agente: el punto del bloqueo es que la decisión sea de una persona.
3. **Ante cualquier error: parar y avisar.** No intentar arreglarlo sobre la marcha. Una migración a medias —generada pero no aplicada, aplicada pero no registrada, o registrada sin haberse aplicado— es mucho más difícil de deshacer que de no haber empezado.

La regla 1 estaba escrita en varios lugares de un proyecto y se incumplió igual (migraciones escritas a mano, y migraciones generadas y retocadas sin avisar): por eso las dos primeras las hace cumplir un hook y no dependen de acordarse.

## Se ejecuta SOLO cuando la persona lo pide explícitamente

Que una tarea necesite un cambio de esquema **no** habilita generar la migración. Se avisa que hace falta y se espera la orden.

---

## Dónde se trabaja: el principal o un slot

La base de datos es **una sola** para el repositorio principal y todos los slots (si el proyecto lo declara en `repos[].database`). Dos ramas que migran sobre ella se pisan.

- **En el repositorio principal:** el orden de abajo, tal cual.
- **En un slot:** los comandos que escriben en la base (`migration:run`, `migration:revert`, seeds) y el `migration:generate` común están bloqueados por un hook. Se **genera** contra una base descartable con el comando que el proyecto declara en `repos[].database.generateAlternative` (en un proyecto NestJS con TypeORM y PostgreSQL: `node ai/packs/nestjs/scripts/migration-generate-shadow.js <Nombre> --from <slot>`; el método está en `shadow-migration`), se commitea, se lleva la rama al principal (`node scripts/manage-worktree.js promote --slot <slot>`) y **ahí** se aplica, por orden de la persona.

---

## Orden obligatorio

### 1. Ver el estado actual

```bash
npm run migration:show
```

Muestra cuáles están aplicadas y cuáles pendientes. (Se puede correr desde un slot: solo lee.)

### 2. Aplicar las pendientes primero (en el principal)

Si hay migraciones sin aplicar, **aplicarlas antes de generar nada**:

```bash
npm run migration:run
```

Generar sobre un esquema desactualizado produce una migración que incluye los cambios de las anteriores, y al aplicarla falla porque intenta crear algo que ya existe. (Con el método sombra este paso no hace falta para generar, porque la base descartable se construye con las migraciones de la rama; sí hace falta antes de aplicar.)

### 3. Generar

En el principal:

```bash
npm run migration:generate -- src/database/migrations/DescripcionDelCambio
```

En un slot, el comando alternativo del proyecto (ver arriba). El nombre va en PascalCase y describe el cambio.

> **Trampa habitual**: según cómo esté configurado el script, el nombre va **pelado**, no con `--name=`. Si se pasa con el prefijo, la herramienta lo ignora y genera un nombre por defecto o falla. Verificar el nombre del archivo generado antes de seguir.

### 4. Revisar lo generado — este paso no se saltea

Abrir el archivo y leerlo completo. Verificar:

- **Que contenga solo lo que corresponde a este cambio.** Es habitual que arrastre diferencias de otra rama o de un experimento local. Si aparece algo que no es de esta tarea, avisar (sacarlo requiere autorización, regla 2).
- **Que `down()` revierta de verdad lo que hace `up()`.** El generador no siempre lo produce bien, y una reversión rota se descubre en el peor momento.
- **Que no borre datos sin que esté decidido.** Un cambio de tipo o una columna eliminada pueden perder información de forma irreversible.
- **Que un renombre no haya salido como borrar + crear.** El generador no distingue un renombre de un `DROP` seguido de un `ADD`: lo expresa como borrar la columna vieja y crear una nueva, y **se pierden todos los datos de la columna**. Si ves un `DROP COLUMN` y un `ADD` sobre la misma tabla, preguntate si es un renombre; si lo es, hay que reemplazarlo por un `RENAME`, y eso es una edición del archivo generado: se pide autorización (regla 2).

### 5. Aplicar (en el principal, por orden de la persona)

```bash
npm run migration:run
```

### 6. Reportar

Qué archivo se generó, qué contiene, qué se vio al revisarlo, y si hace falta coordinar el despliegue.

---

## Compatibilidad con la ventana de despliegue

**Averiguá en qué orden despliega este proyecto.** Si el pipeline migra **antes** de desplegar el código nuevo, entonces toda migración tiene que ser compatible con el código viejo, que va a seguir corriendo durante la ventana de despliegue: un cambio incompatible rompe producción exactamente en ese lapso (y si hay que volver atrás, el código anterior ya no funciona contra el esquema nuevo).

Eso descarta, en un solo paso:

- Eliminar una columna que el código actual todavía lee.
- Renombrar una columna (ver el cuidado de arriba: además, generado como borrar + crear, pierde los datos).
- Agregar una columna obligatoria sin valor por defecto.

Esos cambios se hacen en **dos o tres despliegues**: primero uno compatible con ambas versiones (el código deja de usar lo viejo y escribe en lo nuevo; el esquema todavía tiene las dos), después se migran los datos que faltan, y al final, cuando ya no queda nada corriendo contra la versión vieja, la limpieza.

Si no sabés en qué orden despliega, **preguntá antes de escribir una migración de comportamiento**. Descubrirlo con el sitio caído es caro.

---

## Reglas

- **Nunca editar una migración ya aplicada** en cualquier entorno compartido. Se corrige con una migración nueva.
- **Nunca borrar una migración** del historial.
- Una migración por cambio lógico. Agrupar cinco cambios distintos en un archivo hace imposible revertir uno solo.
- **Nunca correr migraciones, revertirlas ni correr seeds desde un slot**: la base es compartida.
