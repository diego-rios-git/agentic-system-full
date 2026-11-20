# Desarrollo de una funcionalidad en .NET

Flujo estándar para una tarea de backend: qué entender antes de escribir, dónde va cada cosa y en qué orden crearla.

---

## Paso 1: entender antes de escribir

Antes de tocar código, responder cuatro cosas leyendo el repositorio:

1. **¿Ya existe algo parecido?** Buscar un caso de uso o un servicio del mismo dominio y seguir su forma. Una funcionalidad que no se parece a sus vecinas obliga a leerla entera cada vez.
2. **¿Qué proyecto de la solución le corresponde?** Poner lógica de negocio en el proyecto de infraestructura, o una consulta de base de datos en el controlador, es lo que rompe la arquitectura sin que ningún compilador se queje.
3. **¿Qué contrato expone?** Qué entra, qué sale, qué puede fallar.
4. **¿Toca el esquema?** Si sí, la migración va aparte y con su propio procedimiento. Ver `dotnet-create-migration`.

---

## Paso 2: dónde va cada cosa

La forma más extendida separa la solución en cuatro proyectos, cada uno con una regla de dependencia que no se negocia:

```
<Solucion>.Domain/          entidades y reglas del negocio — no referencia a nadie
<Solucion>.Application/     casos de uso, contratos, validación — referencia a Domain
<Solucion>.Infrastructure/  base de datos, servicios externos — referencia a Application
<Solucion>.Api/             controladores y arranque — referencia a Application e Infrastructure
```

**La flecha apunta siempre hacia adentro.** `Domain` no conoce a nadie; si una entidad necesita leer la base de datos, la que está mal es la entidad. El síntoma de que esto se rompió es una referencia a EF Core dentro de `Domain`: en cuanto aparece, el dominio deja de poder probarse sin base de datos y los tests empiezan a necesitar contenedores.

Si el proyecto usa cortes verticales por funcionalidad en vez de capas, la regla equivalente es que un corte no llama a otro: se comunican por el dominio o por eventos. Seguí la que el repositorio ya use; mezclar las dos es peor que cualquiera de las dos.

---

## Paso 3: crear en orden

Cada paso depende del anterior. Saltearlo produce idas y vueltas:

1. **Entidad o modelo de dominio** — qué es la cosa y qué invariantes tiene.
2. **Códigos de error** — qué puede fallar en este dominio. Ver `dotnet-error-handling`.
3. **Contratos de entrada y salida** — qué recibe y qué devuelve. Ver `dotnet-dto-patterns`.
4. **Caso de uso** — la lógica, en `Application`.
5. **Acceso a datos** — la implementación concreta, en `Infrastructure`.
6. **Controlador** — la exposición HTTP, delgada.
7. **Tests** — sobre el comportamiento observable, no sobre la implementación.

---

## Paso 4: el controlador no piensa

Un controlador recibe, delega y traduce el resultado a una respuesta HTTP. Nada más.

```csharp
[HttpPost]
public async Task<IActionResult> Crear(CrearRecursoRequest request, CancellationToken ct)
{
    var resultado = await _casoDeUso.EjecutarAsync(request.ToCommand(), ct);
    return resultado.EsExitoso
        ? CreatedAtAction(nameof(Ver), new { id = resultado.Valor.Id }, resultado.Valor)
        : Problem(resultado.Error);
}
```

Lo que **no** va en un controlador: una consulta con `_context`, una regla de negocio, un `if` sobre el rol del usuario que decida qué datos devolver. Todo eso queda fuera de los tests del caso de uso y solo se ejerce levantando la aplicación entera.

**`CancellationToken` se propaga siempre.** ASP.NET Core lo cancela cuando el cliente corta la conexión; sin propagarlo, la consulta sigue corriendo contra la base para nadie. Bajo carga, eso es la diferencia entre degradarse y caerse.

---

## Paso 5: operaciones atómicas

Todo lo que tiene que pasar junto va en una transacción, y **dentro de la transacción se usa el contexto de esa transacción**, no el inyectado.

```csharp
await using var tx = await _context.Database.BeginTransactionAsync(ct);
try
{
    _context.Cuentas.Add(cuenta);
    await _context.SaveChangesAsync(ct);

    _context.Movimientos.Add(movimiento);
    await _context.SaveChangesAsync(ct);

    await tx.CommitAsync(ct);
}
catch
{
    await tx.RollbackAsync(ct);
    throw;
}
```

**Ninguna llamada de red adentro.** Un `HttpClient` dentro de la transacción la mantiene abierta esperando a un tercero, sosteniendo sus bloqueos: si el tercero tarda, la base se degrada para todos. La llamada externa va después de confirmar, o en una cola.

---

## Paso 6: registrar la inyección de dependencias

Un servicio que no se registra compila y falla al arrancar, con un mensaje que nombra la interfaz y no dice quién la pedía. Registrar con el tiempo de vida correcto:

- **Scoped** — lo habitual. Uno por petición, y es lo que corresponde a todo lo que use el contexto de EF Core.
- **Singleton** — solo si no tiene estado mutable ni depende de nada scoped. Un singleton que recibe un `DbContext` es un error que aparece como conexión cerrada bajo carga, mucho después.
- **Transient** — barato y sin estado.

---

## Reglas críticas

- **La flecha de dependencia apunta hacia adentro.** `Domain` no referencia a nadie.
- **`async` en toda la cadena, sin `.Result` ni `.Wait()`.** Bloquear un hilo esperando una tarea que necesita ese mismo hilo produce un bloqueo mutuo que no aparece en desarrollo y sí bajo carga, sin excepción y sin registro. El gate `NET-1.2` lo marca.
- **Nada de `async void`**, salvo un manejador de eventos. Una excepción ahí no se puede capturar desde afuera y termina el proceso. El gate `NET-1.1` lo marca.
- **Un `GET` no cambia estado.** Los clientes, los proxies y los reintentos lo dan por sentado; un reintento de red termina aplicando el efecto dos veces. El gate `NET-2.1-get-que-escribe` lo marca.
- **La configuración se lee de `IConfiguration` o `IOptions`**, nunca cableada. Una dirección local en el código llega a producción sin forma de cambiarla.

---

## Verificación

Antes de dar la tarea por terminada:

1. Compila sin advertencias nuevas.
2. Los tests del caso de uso pasan **sin levantar la aplicación** — si necesitan la aplicación entera, la lógica quedó en el controlador.
3. Los gates del repositorio corren limpios.
4. Si tocó el esquema, la migración está generada, revisada y aplicada.
