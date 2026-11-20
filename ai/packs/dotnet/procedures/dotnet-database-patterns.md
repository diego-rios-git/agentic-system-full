# Patrones de base de datos — EF Core

Entidades, relaciones, borrado lógico, índices, transacciones y concurrencia. Y los errores que el código no delata a simple vista.

---

## Regla crítica: las migraciones no se escriben a mano

Una migración se **genera** con la herramienta, se **revisa**, y recién ahí se aplica. Ver `dotnet-create-migration`.

Escribir el archivo a mano produce una migración que no se corresponde con el modelo, y eso no se descubre hasta que alguien la corre en otro entorno.

---

## Configuración: fluida, no por atributos

```csharp
public class RecursoConfiguration : IEntityTypeConfiguration<Recurso>
{
    public void Configure(EntityTypeBuilder<Recurso> builder)
    {
        builder.ToTable("recursos");
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Nombre)
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(r => r.ReferenciaExterna)
            .HasMaxLength(32);

        builder.Property(r => r.CreadoEn)
            .HasColumnType("timestamptz")
            .HasDefaultValueSql("now()");
    }
}
```

Por qué fluida y no atributos sobre la entidad: los atributos meten conocimiento de la persistencia dentro del dominio, que es justamente lo que la separación de proyectos evita. Además, la configuración fluida puede expresar cosas que los atributos no —índices compuestos, filtros, conversiones— y tenerlas repartidas en dos lugares hace que nadie sepa dónde buscar.

Reglas:

- **La longitud se declara.** Sin `HasMaxLength`, el proveedor elige el tipo más grande que tenga y el esquema queda con columnas de texto ilimitado que nadie decidió.
- **`required` en la propiedad implica `IsRequired()` en la configuración.** Si no coinciden, el código asume que hay valor donde la base permite nulo.
- **Marcas de tiempo con zona horaria.** Sin zona, el mismo instante se lee distinto según dónde corra el servidor.

---

## El error que más cuesta encontrar: consultas de solo lectura sin `AsNoTracking`

```csharp
// Lectura para mostrar: no se va a modificar nada
var recursos = await _context.Recursos
    .AsNoTracking()
    .Where(r => r.Activo)
    .ToListAsync(ct);
```

Sin `AsNoTracking`, EF Core guarda una copia de cada entidad para detectar cambios. En un listado de miles de filas eso multiplica la memoria y el tiempo, y **no falla**: la pantalla anda, un poco más lenta cada mes. Cuando alguien lo nota, el listado ya es el más lento del sistema y nadie recuerda por qué.

La regla: **si la consulta no va a modificar lo que trae, lleva `AsNoTracking`.**

---

## El otro error mudo: `N + 1`

```csharp
// MAL: una consulta por cada recurso, descubierta en producción
var recursos = await _context.Recursos.ToListAsync(ct);
foreach (var r in recursos)
    Console.WriteLine(r.Categoria.Nombre);   // consulta acá, y acá, y acá

// BIEN: una sola consulta
var recursos = await _context.Recursos
    .Include(r => r.Categoria)
    .AsNoTracking()
    .ToListAsync(ct);
```

Con carga diferida habilitada esto no lanza ningún error: funciona, y hace mil consultas donde debería hacer una. En desarrollo, con veinte filas, es imperceptible.

**Cargar solo lo que se usa.** Un `Include` de una relación que después no se lee trae tablas enteras para nada. Si solo hacen falta tres campos, proyectar:

```csharp
.Select(r => new RecursoResumen(r.Id, r.Nombre, r.Categoria.Nombre))
```

---

## Borrado lógico

```csharp
builder.Property(r => r.EliminadoEn).HasColumnType("timestamptz");
builder.HasQueryFilter(r => r.EliminadoEn == null);
```

El filtro global evita que cada consulta tenga que acordarse. Dos cosas que sorprenden y conviene saber de antemano:

- **El filtro no se aplica a las relaciones cargadas explícitamente en algunos casos**, y tampoco a las consultas en SQL crudo. Ahí hay que filtrar a mano.
- **Un índice único sobre una columna de una entidad con borrado lógico bloquea reutilizar el valor de un registro borrado.** Si el negocio permite volver a usar un código dado de baja, el índice tiene que ser filtrado:

```csharp
builder.HasIndex(r => r.Codigo)
    .IsUnique()
    .HasFilter("eliminado_en IS NULL");
```

Sin el filtro, dar de baja y volver a crear con el mismo código falla con una violación de unicidad que apunta a una fila que el usuario no puede ver.

---

## Índices compuestos: el orden importa

```csharp
builder.HasIndex(m => new { m.CuentaId, m.CreadoEn });
```

Un índice sobre `(A, B)` sirve para filtrar por `A`, y por `A` y `B` juntos. **No sirve para filtrar solo por `B`.** Poner las columnas en el orden equivocado produce un índice que existe, ocupa espacio, se actualiza en cada escritura y no se usa nunca. El plan de ejecución lo delata; el código no.

Regla práctica: primero la columna por la que siempre se filtra, después la que ordena o acota rangos.

---

## Transacciones

```csharp
await using var tx = await _context.Database.BeginTransactionAsync(ct);
try
{
    // … varias operaciones que tienen que pasar juntas
    await _context.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
}
catch
{
    await tx.RollbackAsync(ct);
    throw;
}
```

- **Nada de red adentro.** La transacción queda abierta esperando a un tercero y sostiene sus bloqueos.
- **Lo más corta posible.** Preparar los datos antes de abrirla.
- **Un `SaveChangesAsync` ya es una transacción implícita.** Abrir una explícita para una sola operación no agrega nada.

---

## Concurrencia optimista

Dos personas editan el mismo registro; la segunda pisa lo que escribió la primera y nadie se entera.

```csharp
builder.Property(r => r.Version).IsRowVersion();
```

Con eso, guardar sobre una versión vieja lanza `DbUpdateConcurrencyException` en vez de perder el cambio en silencio. Hay que **capturarla y decidir**: reintentar con los datos nuevos, o devolver un conflicto para que la persona vea qué cambió. Dejarla propagar como error genérico convierte un conflicto de negocio en un error 500.

---

## Verificación

1. Toda consulta de solo lectura lleva `AsNoTracking`.
2. Ninguna relación se accede dentro de un bucle sin `Include` o proyección.
3. Los índices únicos sobre entidades con borrado lógico están filtrados.
4. Las transacciones no contienen llamadas de red.
5. Los cambios de esquema están en una migración generada y revisada, no aplicados a mano.
