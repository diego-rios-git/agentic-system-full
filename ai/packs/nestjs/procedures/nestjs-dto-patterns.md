# Patrones de DTO

El contrato de entrada y salida de la API. Es lo primero que ve un consumidor y lo único que lo protege de la forma interna de los datos.

---

## Regla fundamental

**Una entidad nunca se devuelve directamente.** Siempre se mapea a un DTO de respuesta.

Devolver la entidad expone columnas internas, marcas de borrado, campos de auditoría y cualquier relación que se haya cargado. Y peor: cada campo nuevo que alguien agregue a la entidad aparece en la API sin que nadie lo decida.

---

## DTO de entrada

```ts
export class CrearRecursoDto {
  @ApiProperty({ example: 'Nombre visible', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: Estado })
  @IsOptional()
  @IsEnum(Estado)
  estado?: Estado;
}
```

Reglas:

- **Cada campo lleva su validación.** Un campo sin decorador no se valida, y con `whitelist` activado directamente se descarta en silencio — lo que parece un error del cliente cuando es una omisión del DTO.
- **`@IsOptional()` va primero** entre los decoradores de un campo opcional. Sin él, un campo ausente falla la validación.
- **Longitudes máximas explícitas.** Sin ellas, un texto de un megabyte llega hasta la base de datos.
- La configuración global va con `whitelist: true` y `forbidNonWhitelisted: true`: los campos que el DTO no declara se rechazan en vez de viajar hacia adentro.

---

## DTO de respuesta

```ts
export class RecursoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  externalRef!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
```

**`nullable` en la documentación tiene que coincidir con la realidad.** Si el campo puede venir vacío y el contrato no lo dice, el consumidor va a escribir una validación estricta que va a fallar en producción con datos reales — y el error se va a ver del lado del cliente, no del servidor, que responderá un 200 perfectamente normal. Ese desencuentro es de los más caros de diagnosticar.

---

## Opcional frente a nulo

No son lo mismo y el contrato tiene que distinguirlos:

| Forma | Significa |
|---|---|
| `campo?: T` | Puede no venir en la petición |
| `campo: T \| null` | Viene siempre, y su valor puede ser vacío |
| `campo?: T \| null` | Ambas cosas — usarlo solo si de verdad son ambas |

En una actualización parcial, la diferencia es sustantiva: **campo ausente** significa "no lo toques"; **campo nulo** significa "vacialo".

---

## Enumeraciones

```ts
@ApiProperty({ enum: Estado, enumName: 'Estado' })
@IsEnum(Estado)
estado!: Estado;
```

Sin `enumName`, cada aparición genera un tipo anónimo distinto en el esquema publicado, y los clientes generados terminan con una enumeración duplicada por endpoint.

---

## Transformación

Usar `class-transformer` **solo cuando el contrato externo obliga** a una forma distinta de la interna — por ejemplo, un nombre de campo que no se puede cambiar por compatibilidad.

Transformar por comodidad esconde la forma real del dato y hace que el DTO deje de ser el contrato: pasa a ser una capa de traducción que hay que leer entera para saber qué se recibe.

---

## Verificación

```bash
node scripts/run-gates.js --repo <repositorio>
```

Y revisar a mano lo que ningún script decide: si el `nullable` del contrato coincide con lo que el servicio puede devolver realmente.
