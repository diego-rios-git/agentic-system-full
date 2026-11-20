# Patrones de base de datos — TypeORM

Entidades, relaciones, índices y transacciones.

---

## Regla crítica: las migraciones no se escriben a mano

Una migración se **genera** con la herramienta, se **revisa**, y recién ahí se aplica. Ver `nestjs-create-migration`.

Escribir el archivo a mano produce una migración que no se corresponde con el estado real del esquema, y eso no se descubre hasta que alguien la corre en otro entorno.

---

## Estructura de una entidad

```ts
@Entity('recursos')
export class Recurso {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  externalRef!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Reglas:

- **El tipo se declara explícitamente.** La inferencia funciona hasta que alguien cambia el tipo de TypeScript y el esquema deja de coincidir en silencio.
- **`nullable: true` en la columna implica `| null` en el tipo.** Si no coinciden, el código va a asumir que hay valor donde no lo hay.
- **Marcas de tiempo con zona horaria.** Sin zona, el mismo instante se lee distinto según dónde corra el servidor.

---

## Patrones comunes

### Borrado lógico

```ts
@DeleteDateColumn({ type: 'timestamptz' })
deletedAt!: Date | null;
```

TypeORM excluye los borrados automáticamente. **Pero solo en las consultas del repositorio**: un constructor de consultas los incluye salvo que se le indique lo contrario. Es la forma más común de que aparezcan registros borrados en un listado.

### Restricciones de unicidad

```ts
@Entity('recursos')
@Unique('uq_recursos_slug', ['slug'])
```

Una restricción en la base es la única garantía real. Comprobar antes de insertar deja una ventana entre la comprobación y la escritura: bajo concurrencia, los dos pasan.

### Relaciones

```ts
@ManyToOne(() => Padre, (p) => p.hijos, { onDelete: 'RESTRICT' })
@JoinColumn({ name: 'padre_id' })
padre!: Padre;

@Column({ type: 'uuid' })
padreId!: string;
```

Declarar también la columna del identificador evita traer la relación entera solo para leerlo.

**Decidir `onDelete` explícitamente.** El valor por defecto rara vez es el que se quiere, y descubrirlo en producción significa que ya se borró algo en cascada que no debía.

---

## Índices

Un índice por cada campo por el que se filtra o se ordena de forma habitual.

```ts
@Index('idx_recursos_estado_creado', ['estado', 'createdAt'])
```

En un índice compuesto, **el orden de las columnas importa**: sirve para filtrar por la primera, o por la primera y la segunda, pero no por la segunda sola.

Los campos con restricción de unicidad ya tienen índice: agregar otro es peso muerto en cada escritura.

---

## Transacciones

```ts
await this.dataSource.transaction(async (manager) => {
  const pedido = await manager.save(Pedido, { ... });
  await manager.save(Movimiento, { pedidoId: pedido.id, ... });
});
```

**Dentro de la transacción, usar siempre el `manager` que se recibe.** Usar `this.repository` en su lugar ejecuta esa consulta **fuera** de la transacción: si algo falla después, esa escritura no se revierte. Es un error que el código no delata a simple vista.

### Concurrencia

Ante escritura concurrente sobre la misma fila, preferir **bloqueo optimista** — una columna de versión — antes que bloqueo pesimista. El bloqueo pesimista serializa el acceso y degrada el rendimiento bajo carga; el optimista falla rápido y el que perdió reintenta.

```ts
@VersionColumn()
version!: number;
```

---

## Consultas en el servicio

```ts
// Bien: una consulta
const recursos = await this.repo.find({
  where: { estado: In(estados) },
  relations: { padre: true },
});

// Mal: una consulta por elemento
for (const id of ids) {
  await this.repo.findOne({ where: { id } });   // ← degrada bajo carga
}
```

Para lotes grandes, paginar con cursor o con un bucle que avance: un `take` fijo sin bucle procesa solo la primera página y deja el resto sin procesar, **en silencio**.

---

## Qué evitar

| Práctica | Por qué |
|---|---|
| `synchronize: true` fuera de desarrollo | Modifica el esquema sin migración y sin registro |
| SQL armado concatenando texto externo | Inyección. Usar parámetros |
| `find()` sin `where` sobre una tabla grande | Trae todo a memoria |
| Lógica de negocio en la entidad | La entidad describe datos; las reglas viven en el servicio |
| Migraciones escritas a mano | Ver la regla crítica al principio |
