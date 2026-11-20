# Manejo de errores

Cada módulo declara qué puede fallar en su dominio, con un código estable y un estado HTTP correcto.

---

## Por qué no alcanza con lanzar una excepción genérica

```ts
throw new Error('El recurso no existe');
```

Ese error pierde tres cosas: el **código estable** que el cliente puede interpretar sin leer el texto, el **estado HTTP** correcto — termina en un 500, que significa "el servidor se rompió" cuando en realidad el cliente pidió algo que no existe — y el **contexto** para diagnosticarlo.

Además, el texto del mensaje pasa a ser el contrato de hecho: en cuanto alguien lo traduce o le corrige una tilde, rompe al cliente que lo estaba comparando.

---

## Estructura por módulo

```
src/modules/<modulo>/errors/
├── <modulo>.error-codes.ts   ← el catálogo
└── <modulo>.errors.ts        ← la fábrica
```

### Catálogo

```ts
export const RecursoErrorCodes = {
  NOT_FOUND: 'RECURSO_NOT_FOUND',
  ALREADY_EXISTS: 'RECURSO_ALREADY_EXISTS',
  INVALID_STATE: 'RECURSO_INVALID_STATE',
} as const;
```

Los códigos son **estables**: una vez publicados, no cambian. Un cliente puede estar ramificando sobre ellos.

### Fábrica

```ts
export class RecursoErrors {
  static notFound(id: string) {
    return new NotFoundException({
      code: RecursoErrorCodes.NOT_FOUND,
      message: `Recurso ${id} no encontrado`,
    });
  }

  static invalidState(actual: string, esperado: string) {
    return new ConflictException({
      code: RecursoErrorCodes.INVALID_STATE,
      message: `El recurso está en estado ${actual}, se esperaba ${esperado}`,
    });
  }
}
```

Uso:

```ts
const recurso = await this.repo.findOne({ where: { id } });
if (!recurso) throw RecursoErrors.notFound(id);
```

La fábrica concentra en un lugar la decisión de qué estado HTTP corresponde a cada caso. Sin ella, la misma condición termina devolviendo 404 en un servicio y 400 en otro.

---

## Qué estado HTTP corresponde

| Situación | Estado |
|---|---|
| Entrada mal formada o inválida | 400 |
| Sin autenticar, o credenciales inválidas | 401 |
| Autenticado pero sin permiso | 403 |
| El recurso no existe, o no es accesible para quien pregunta | 404 |
| Conflicto con el estado actual — duplicado, transición inválida | 409 |
| Válido en forma pero rechazado por una regla de negocio | 422 |
| Fallo inesperado del servidor | 500 |

**404 frente a 403 es una decisión de seguridad.** Responder 403 sobre un recurso ajeno confirma que ese recurso existe. Cuando la existencia misma es información sensible, corresponde 404.

---

## Qué no exponer

- Trazas de pila, nombres de tabla, consultas.
- El mensaje crudo de una excepción de base de datos.
- Datos de otra persona o de otro cliente dentro del mensaje.

Un error para el cliente dice **qué pasó y qué puede hacer**. El detalle para diagnosticar va al registro del servidor, no a la respuesta.

---

## Registro

Al registrar un error, incluir identificadores y contexto — **nunca la carga útil completa de la petición**, que puede traer credenciales o datos personales.

Si el proyecto tiene una lista de campos a ocultar en los registros, un campo sensible nuevo hay que agregarlo **cuando se lo crea**, no en la revisión. Acordarse de la lista de ocultamiento es justamente lo que nadie hace.

---

## Errores capturados

```ts
// Mal: el fallo ocurre y nadie se entera
try { await algo(); } catch {}

// Bien: o se registra con contexto, o se deja propagar
try {
  await algo();
} catch (err) {
  this.logger.error({ err, recursoId: id }, 'falló al procesar');
  throw RecursoErrors.processingFailed(id);
}
```

Capturar y descartar es la forma más barata de convertir un incidente en un misterio. Hay un gate que lo detecta.
