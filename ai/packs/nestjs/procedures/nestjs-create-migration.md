# Crear una migración

Genera y aplica una migración de esquema siguiendo un orden obligatorio.

## Se ejecuta SOLO cuando la persona lo pide explícitamente

Que una tarea necesite un cambio de esquema **no** habilita generar la migración. Se avisa que hace falta y se espera la orden.

## Ante cualquier error: parar y avisar

No intentar arreglarlo sobre la marcha. Una migración a medias —generada pero no aplicada, aplicada pero no registrada, o registrada sin haberse aplicado— es mucho más difícil de deshacer que de no haber empezado.

---

## Orden obligatorio

### 1. Ver el estado actual

```bash
npm run migration:show
```

Muestra cuáles están aplicadas y cuáles pendientes.

### 2. Aplicar las pendientes primero

Si hay migraciones sin aplicar, **aplicarlas antes de generar nada**:

```bash
npm run migration:run
```

Generar sobre un esquema desactualizado produce una migración que incluye los cambios de las anteriores, y al aplicarla falla porque intenta crear algo que ya existe.

### 3. Generar

```bash
npm run migration:generate -- src/migrations/DescripcionDelCambio
```

> **Trampa habitual**: según cómo esté configurado el script, el nombre va **pelado**, no con `--name=`. Si se pasa con el prefijo, la herramienta lo ignora y genera un nombre por defecto o falla. Verificar el nombre del archivo generado antes de seguir.

### 4. Revisar lo generado — este paso no se saltea

Abrir el archivo y leerlo completo. Verificar:

- **Que contenga solo lo que corresponde a este cambio.** Es habitual que arrastre diferencias de otra rama o de un experimento local. Si aparece algo que no es de esta tarea, sacarlo.
- **Que `down()` revierta de verdad lo que hace `up()`.** El generador no siempre lo produce bien, y una reversión rota se descubre en el peor momento.
- **Que no borre datos sin que esté decidido.** Un cambio de tipo o una columna eliminada pueden perder información de forma irreversible.

### 5. Aplicar

```bash
npm run migration:run
```

### 6. Reportar

Qué archivo se generó, qué contiene y qué se sacó al revisarlo.

---

## Compatibilidad con el despliegue

**Averiguá en qué orden despliega este proyecto.** Si las migraciones corren **antes** que el código nuevo, entonces toda migración tiene que ser compatible con el código viejo, que va a seguir corriendo durante la ventana de despliegue.

Eso descarta, en un solo paso:

- Eliminar una columna que el código actual todavía lee.
- Renombrar una columna.
- Agregar una columna obligatoria sin valor por defecto.

Esos cambios se hacen en **dos despliegues**: primero uno compatible con ambas versiones, después la limpieza.

Si no sabés en qué orden despliega, **preguntá antes de escribir una migración de comportamiento**. Descubrirlo con el sitio caído es caro.

---

## Reglas

- **Nunca escribir el archivo de migración a mano.** Se genera y se revisa.
- **Nunca editar una migración ya aplicada** en cualquier entorno compartido. Se corrige con una migración nueva.
- **Nunca borrar una migración** del historial.
- Una migración por cambio lógico. Agrupar cinco cambios distintos en un archivo hace imposible revertir uno solo.
