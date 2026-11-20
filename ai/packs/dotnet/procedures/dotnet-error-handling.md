# Manejo de errores — .NET

Códigos estables por dominio, qué estado HTTP corresponde a cada situación, qué no exponer al cliente y por qué capturar sin registrar convierte un incidente en un misterio.

---

## Códigos estables, no mensajes

```csharp
public static class RecursoErrorCodes
{
    public const string NoEncontrado      = "RECURSO_NO_ENCONTRADO";
    public const string CodigoDuplicado   = "RECURSO_CODIGO_DUPLICADO";
    public const string SaldoInsuficiente = "RECURSO_SALDO_INSUFICIENTE";
    public const string EstadoInvalido    = "RECURSO_ESTADO_INVALIDO";
}
```

Por qué un código y no el texto: el mensaje cambia —se corrige una tilde, se traduce, alguien lo hace más amable— y cualquier cliente que estuviera comparando contra ese texto se rompe en silencio. El código es el contrato; el mensaje es para que lo lea una persona.

**Un archivo de códigos por dominio, creado desde el principio.** Un dominio sin su archivo de códigos es un dominio que va a lanzar excepciones genéricas, y eso no se arregla después: para entonces hay cincuenta lugares que lanzan `Exception` con un texto distinto.

---

## Una excepción de dominio con el código adentro

```csharp
public class DomainException : Exception
{
    public string Code { get; }
    public int StatusCode { get; }

    public DomainException(string code, string message, int statusCode = StatusCodes.Status400BadRequest)
        : base(message)
    {
        Code = code;
        StatusCode = statusCode;
    }
}

public static class RecursoErrors
{
    public static DomainException NoEncontrado(Guid id) =>
        new(RecursoErrorCodes.NoEncontrado, $"No existe el recurso {id}.", StatusCodes.Status404NotFound);

    public static DomainException SaldoInsuficiente() =>
        new(RecursoErrorCodes.SaldoInsuficiente, "El saldo no alcanza para la operación.", StatusCodes.Status409Conflict);
}
```

La fábrica existe para que el mismo error se lance igual desde todos lados. Lanzar `new DomainException("RECURSO_NO_ENCONTRAD0", …)` con un cero en vez de una O compila perfectamente.

---

## Qué estado HTTP corresponde

| Situación | Estado | Detalle que importa |
|---|---|---|
| El dato de entrada no tiene la forma correcta | **400** | Lo devuelve solo la validación del borde |
| No hay sesión, o el token venció | **401** | "No sé quién sos" |
| Hay sesión pero no alcanza el permiso | **403** | "Sé quién sos y no podés" |
| El recurso no existe | **404** | También cuando existe pero **no es de quien pregunta** — ver abajo |
| Choca con el estado actual: duplicado, saldo insuficiente, transición inválida | **409** | Es el más subestimado; casi todo lo que se devuelve como 400 es en realidad 409 |
| Falló algo nuestro | **500** | Sin detalle para el cliente, con todo el detalle en el registro |

**404 y no 403 cuando el recurso es de otro.** Devolver 403 confirma que el recurso existe, y eso permite enumerar identificadores ajenos preguntando de a uno. Para quien no tiene acceso, no existe.

---

## Traducir una sola vez, en un middleware

```csharp
public sealed class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (DomainException ex)
        {
            // Esperado: es una regla de negocio, no un incidente.
            logger.LogInformation("Regla de dominio: {Code} en {Path}", ex.Code, context.Request.Path);
            await Write(context, ex.StatusCode, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            // Inesperado: con el detalle completo y el identificador de la petición.
            logger.LogError(ex, "Error no controlado en {Path}", context.Request.Path);
            await Write(context, StatusCodes.Status500InternalServerError,
                "ERROR_INTERNO", "Ocurrió un error procesando la solicitud.");
        }
    }
}
```

Con un `try/catch` en cada controlador, cada uno traduce distinto y el mismo problema sale con formas diferentes según el endpoint. Un middleware lo hace una vez.

---

## Qué no se le manda al cliente

Nunca, en ninguna respuesta:

- **El texto de la excepción original ni la traza.** Nombra clases, rutas de archivos y a veces la consulta que falló. Es un mapa del sistema para quien esté probando cómo romperlo.
- **El detalle del error de base de datos.** "duplicate key value violates unique constraint …" nombra tablas, columnas e índices.
- **Datos de otro usuario**, ni siquiera para explicar el conflicto. "Ese correo ya está registrado por Juan Pérez" filtra que Juan Pérez es cliente.

El detalle completo va al registro. Al cliente le va el código, un mensaje que pueda leer, y un identificador de la petición para que lo pueda citar en un reclamo.

---

## Capturar sin registrar es peor que no capturar

```csharp
// MAL: el fallo ocurre y nadie se entera nunca
try { await _servicio.SincronizarAsync(ct); } catch { }
```

Esto es lo que convierte un incidente en un misterio. La sincronización dejó de funcionar hace tres semanas, nadie tiene un solo registro de eso, y el síntoma que llega es "faltan datos" sin ninguna pista. El gate `CORE-1.1` lo marca.

Si el error es realmente ignorable, **el motivo se escribe**:

```csharp
catch (OperationCanceledException)
{
    // El cliente cortó la conexión: no es un fallo nuestro.
}
```

Un `catch` vacío con un comentario que dice por qué es aceptable. Uno vacío y mudo, no.

---

## Registrar con contexto, no con texto suelto

```csharp
// MAL: no se puede filtrar ni agrupar
logger.LogError($"Falló el recurso {id}");

// BIEN: los campos quedan consultables
logger.LogError(ex, "Falló al procesar el recurso {RecursoId} de la cuenta {CuentaId}", id, cuentaId);
```

Con interpolación, cada mensaje es una cadena distinta y no se puede agrupar ni buscar por identificador. Con plantilla, el sistema de registro guarda los campos aparte.

**Y nunca registrar el objeto entero de una petición**: ahí van tokens, contraseñas y datos personales, y el registro suele tener menos control de acceso que la base.

---

## Verificación

1. Cada dominio tiene su archivo de códigos y su fábrica de errores.
2. Ningún controlador traduce excepciones a respuestas: lo hace el middleware.
3. Ninguna respuesta de error incluye la traza ni el mensaje del motor de base de datos.
4. No hay ningún `catch` vacío sin un comentario que explique por qué.
5. Los mensajes de registro usan plantilla con campos, no interpolación.
