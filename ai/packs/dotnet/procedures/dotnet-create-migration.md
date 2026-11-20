# Crear una migración — EF Core

Generar y aplicar un cambio de esquema en el orden obligatorio.

**Solo con pedido explícito de la persona.** Una migración modifica el esquema de una base compartida; no es algo que se haga de paso mientras se resuelve otra cosa.

**Las migraciones se generan con la herramienta, no se escriben a mano.** La carpeta `Migrations/` es una ruta protegida: el hook `pre-write-protected` bloquea escribir ahí, y bloquea editar lo generado salvo con una autorización temporal que da la persona (`node scripts/allow-protected-edit.js <archivo>`; no la corre el agente). Si a lo generado le falta algo real —un `RenameColumn`, un `Down` que no deshace—, se explica qué y por qué, se espera la respuesta, y se edita solo con esa autorización. Ante cualquier error: parar y avisar.

**Desde un slot de trabajo.** Si el proyecto declara `repos[].database`, la base es una sola para el principal y todos los slots, y dos ramas que migran sobre ella se pisan. Un hook bloquea desde un slot `database update`, los seeds y `migrations add` contra la base compartida. El método sombra (generar contra una base descartable armada solo con las migraciones de la rama) aplica con el comando propio de EF Core: el procedimiento `shadow-migration` dice cómo armarlo (`dotnet ef database update` y `dotnet ef migrations add` con la cadena de conexión de la base descartable) y se declara en `repos[].database.generateAlternative`. La migración se aplica después, en el principal, por orden de la persona.

---

## El orden no es negociable

Cada paso existe porque saltearlo produce un daño concreto.

### 1. Ver el estado actual

```bash
dotnet ef migrations list --project <Proyecto.Infrastructure> --startup-project <Proyecto.Api>
```

Muestra cuáles están aplicadas y cuáles no. Generar sobre un estado desconocido produce una migración que incluye cambios de otra persona.

### 2. Aplicar las pendientes

```bash
dotnet ef database update --project <Proyecto.Infrastructure> --startup-project <Proyecto.Api>
```

**Este es el paso que más se saltea y el que más cuesta.** Si hay una migración sin aplicar, la herramienta compara el modelo actual contra una base vieja, y la migración nueva va a incluir *también* los cambios de la anterior. Eso rompe a quien ya la aplicó.

### 3. Generar

```bash
dotnet ef migrations add <NombreDescriptivo> --project <Proyecto.Infrastructure> --startup-project <Proyecto.Api>
```

El nombre describe el cambio: `AgregarReferenciaExternaARecurso`, no `Update3`. Es lo que va a leer quien revise el historial dentro de un año.

### 4. Revisar el archivo generado

**Obligatorio, siempre.** La herramienta acierta casi siempre, y "casi" es el problema. Qué mirar:

- **¿Hace lo que se esperaba, y nada más?** Cambios que no se pidieron significan que el modelo tenía diferencias previas sin migrar.
- **¿Hay un `DropColumn` o un `DropTable`?** Eso es pérdida de datos. Ver abajo.
- **¿Renombró o borró y creó?** La herramienta suele generar `DropColumn` + `AddColumn` para lo que en realidad es un renombre: **se pierden todos los datos de la columna**. Hay que reemplazarlo por `RenameColumn`, y eso es una edición de lo generado: se pide autorización (arriba).
- **¿El `Down` deshace de verdad lo que hace el `Up`?** Es lo único que permite volver atrás.
- **¿Agrega una columna no anulable sin valor por defecto a una tabla con filas?** Falla al aplicarse. Necesita valor por defecto, o los tres pasos de abajo.

### 5. Aplicar

```bash
dotnet ef database update --project <Proyecto.Infrastructure> --startup-project <Proyecto.Api>
```

### 6. Reportar

Qué cambió, si hay riesgo para los datos existentes y si hace falta coordinar el despliegue.

---

## Compatibilidad con la ventana de despliegue

**Averiguá en qué orden despliega este proyecto.** Si el pipeline migra **antes** de desplegar el código nuevo, toda migración tiene que ser compatible con el código viejo, que sigue corriendo durante la ventana de despliegue; si no sabés el orden, preguntá antes de escribir la migración.

Durante un despliegue conviven la versión vieja y la nueva. Una migración que rompe a la versión vieja produce errores mientras dura el despliegue, y si hay que volver atrás, la aplicación anterior ya no funciona contra el esquema nuevo.

**Seguro en un solo paso:**

- Agregar una tabla.
- Agregar una columna anulable, o con valor por defecto.
- Agregar un índice.

**Requiere tres despliegues:**

Quitar una columna, renombrarla, o volver obligatorio algo que era opcional.

1. **Primero**: la aplicación deja de usar la columna vieja y empieza a escribir en la nueva. El esquema todavía tiene las dos.
2. **Después**: se migran los datos que faltan.
3. **Al final**, cuando ya no queda nada corriendo contra la versión vieja: se elimina la columna.

Hacerlo en un solo paso funciona en desarrollo, donde no hay dos versiones a la vez, y falla exactamente el día del despliegue.

---

## Nunca

- **Editar una migración ya aplicada en cualquier entorno compartido.** El historial deja de reproducirse: quien ya la corrió tiene un esquema que ninguna migración describe. Si está mal, se arregla con una migración nueva.
- **Borrar una migración del historial** por el mismo motivo.
- **Aplicar migraciones automáticamente al arrancar la aplicación.** Con varias instancias, todas intentan migrar a la vez; y el día que una migración falle, la aplicación no arranca en ningún lado. Aplicar es un paso del despliegue, no del arranque.
- **Mezclar cambio de esquema y migración de datos en la misma migración**, si los datos son muchos: bloquea la tabla mientras dura, y el despliegue se queda esperando.

---

## Si la migración generada está mal

```bash
dotnet ef migrations remove --project <Proyecto.Infrastructure> --startup-project <Proyecto.Api>
```

Solo sirve **si no se aplicó todavía**. Corregir el modelo, volver a generar, revisar de nuevo.

Si ya se aplicó, no se toca: se genera una migración nueva que corrija.

---

## Verificación

1. No quedan migraciones pendientes antes de generar.
2. El archivo generado se leyó entero.
3. Ningún `DropColumn` que en realidad sea un renombre.
4. El `Down` deshace lo que hace el `Up`.
5. Si quita o vuelve obligatoria una columna, está partida en los tres pasos.
