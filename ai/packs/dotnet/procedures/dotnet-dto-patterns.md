# Contratos de entrada y salida — .NET

Qué recibe la API, qué devuelve, y por qué una entidad nunca sale directamente.

---

## Por qué una entidad no se devuelve nunca

```csharp
// MAL
[HttpGet("{id}")]
public async Task<Usuario> Ver(Guid id) => await _context.Usuarios.FindAsync(id);
```

Tres cosas pasan acá, y ninguna es visible leyendo esa línea:

1. **Se filtra todo lo que la entidad tenga.** Hoy `Usuario` tiene nombre y correo; el día que alguien le agregue `HashDeContraseña` o `NotasInternas`, la API empieza a devolverlo. Nadie va a revisar los controladores al agregar una columna.
2. **El contrato de la API queda atado al esquema.** Renombrar una columna rompe a todos los clientes.
3. **Las relaciones se serializan o explotan.** Con carga diferida, serializar dispara consultas; con referencias circulares, la serialización falla en tiempo de ejecución.

**Siempre un tipo propio de salida.** Aunque hoy sea idéntico a la entidad: el trabajo de escribirlo es de un minuto y es lo que evita las tres cosas de arriba.

---

## Entrada y salida son tipos distintos

```csharp
public sealed record CrearRecursoRequest(
    string Nombre,
    string? ReferenciaExterna,
    Guid CategoriaId);

public sealed record RecursoResponse(
    Guid Id,
    string Nombre,
    string? ReferenciaExterna,
    string Categoria,
    DateTimeOffset CreadoEn);
```

Usar el mismo tipo para las dos direcciones obliga a que tenga campos que en una de las dos no significan nada: el `Id` que el cliente no manda al crear, el `CreadoEn` que el cliente no debería poder fijar. Un tipo con la mitad de los campos opcionales no expresa ningún contrato.

`record` y no `class`: son inmutables por defecto y comparan por valor, que es exactamente lo que se quiere de un contrato.

---

## Opcional y nulo no son lo mismo

Esta distinción es la que más errores produce, porque las dos se escriben parecido y significan cosas distintas:

| Qué significa | Cómo se declara | Qué pasa si el cliente no lo manda |
|---|---|---|
| **Opcional**: puede no venir | `string? Campo = null` con valor por defecto | Queda en el valor por defecto |
| **Nulo**: viene, y su valor es "nada" | `string? Campo` requerido | Falla la validación si falta |

En una actualización parcial la diferencia es crítica: "no mandé el campo" significa *no lo toques*, y "mandé null" significa *borralo*. Si el contrato no las distingue, la única forma de borrar un valor es indistinguible de no querer cambiarlo.

**`nullable` en el contrato tiene que coincidir con la realidad de la base.** Un campo declarado no anulable que en la base admite nulos produce una excepción de referencia nula al leer una fila vieja, mucho después de que el contrato se escribió.

---

## La validación va en el borde

Nada entra al caso de uso sin haber sido validado. Con anotaciones para lo simple:

```csharp
public sealed record CrearRecursoRequest(
    [property: Required, StringLength(120, MinimumLength = 1)]
    string Nombre,

    [property: StringLength(32)]
    string? ReferenciaExterna,

    [property: Required]
    Guid CategoriaId);
```

`[ApiController]` hace que un modelo inválido devuelva 400 automáticamente, antes de entrar al método. **Sin ese atributo, la validación se registra en `ModelState` y no pasa nada**: el método corre igual con datos inválidos, y el error aparece más adentro, disfrazado de otra cosa.

Para reglas que dependen de varios campos, un validador dedicado:

```csharp
public sealed class CrearRecursoValidator : AbstractValidator<CrearRecursoRequest>
{
    public CrearRecursoValidator()
    {
        RuleFor(x => x.Nombre).NotEmpty().MaximumLength(120);
        RuleFor(x => x.FechaHasta)
            .GreaterThan(x => x.FechaDesde)
            .WithMessage("La fecha final tiene que ser posterior a la inicial.");
    }
}
```

Lo que **no** va en la validación de entrada: si el recurso existe, si el usuario tiene permiso, si el nombre está repetido. Eso no es forma del dato, es regla de negocio, y va en el caso de uso — donde se puede probar sin levantar la API.

---

## Nada de tipos anónimos ni diccionarios como respuesta

```csharp
// MAL: el contrato no existe en ningún lado
return Ok(new { id = r.Id, nombre = r.Nombre });
```

Un tipo anónimo no aparece en la documentación generada, no se puede referenciar desde un test, y cambia sin que nada avise. Lo mismo con `Dictionary<string, object>`: compila siempre y no promete nada.

---

## La conversión vive en un solo lugar

```csharp
public static RecursoResponse ToResponse(this Recurso r) =>
    new(r.Id, r.Nombre, r.ReferenciaExterna, r.Categoria.Nombre, r.CreadoEn);
```

Repartida por los controladores, cada uno arma la respuesta un poco distinto y el mismo recurso sale con formas diferentes según el endpoint. Un solo método de conversión hace que agregar un campo sea un cambio en un lugar.

---

## Verificación

1. Ningún endpoint devuelve una entidad.
2. Los tipos de entrada y de salida son distintos.
3. `[ApiController]` está presente — si no, la validación no rechaza nada.
4. Cada campo anulable del contrato coincide con lo que la base admite.
5. Ninguna respuesta usa un tipo anónimo ni un diccionario.
