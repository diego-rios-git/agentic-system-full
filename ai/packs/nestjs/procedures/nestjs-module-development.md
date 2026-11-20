# Desarrollo de un módulo NestJS

Flujo estándar para cualquier tarea de backend sobre NestJS. Define el orden de creación de archivos y las reglas que no se negocian.

---

## Paso 1: entender antes de escribir

Antes de crear un archivo, responder:

- ¿Qué entidades toca? ¿Existen o hay que crearlas?
- ¿Qué endpoints expone y con qué contrato exacto de entrada y salida?
- ¿Qué reglas de negocio aplican, incluidos los casos límite?
- ¿Hay operaciones que deben ser atómicas — o pasa todo, o no pasa nada?

Si alguna respuesta es "no sé", **preguntá**. Escribir código sobre una suposición produce trabajo que hay que rehacer entero.

---

## Paso 2: estructura del módulo

```
src/modules/<modulo>/
├── <modulo>.module.ts
├── <modulo>.controller.ts
├── <modulo>.service.ts
├── dto/
│   ├── create-<recurso>.dto.ts
│   └── <recurso>-response.dto.ts
├── entities/
│   └── <recurso>.entity.ts
├── errors/
│   ├── <modulo>.error-codes.ts
│   └── <modulo>.errors.ts
└── <modulo>.service.spec.ts
```

Un módulo sin su archivo de códigos de error es un módulo que va a lanzar errores genéricos. Crearlo desde el principio, aunque arranque con dos entradas.

---

## Paso 3: crear en orden

El orden importa porque cada capa depende de la anterior. Saltearlo produce iteraciones de ida y vuelta:

1. **Entidad** — el modelo de datos y sus relaciones.
2. **Códigos de error** — qué puede fallar en este dominio.
3. **DTOs** — el contrato de entrada y salida.
4. **Servicio** — la lógica de negocio.
5. **Controlador** — la exposición HTTP.
6. **Módulo** — el ensamblado.
7. **Tests** — sobre el comportamiento, no sobre la implementación.

---

## Paso 4: validación en el borde

**Todo lo que entra desde afuera se valida antes de usarse.** No después.

- Cada campo del DTO lleva su decorador de validación.
- Los identificadores de recurso se validan como tales en el parámetro de ruta. Un identificador con formato inválido debe devolver un error de petición incorrecta, no reventar contra la base de datos y devolver un error de servidor.
- Habilitar la validación global con `whitelist` y `forbidNonWhitelisted`: sin eso, un campo de más que el cliente mandó llega hasta el servicio.

Ver `nestjs-dto-patterns`.

---

## Paso 5: operaciones atómicas

Si una operación toca más de una tabla y un fallo intermedio dejaría el sistema inconsistente, va **en una transacción**.

```ts
await this.dataSource.transaction(async (manager) => {
  const a = await manager.save(EntityA, { ... });
  await manager.save(EntityB, { refId: a.id, ... });
  // Si esto falla, lo anterior se revierte.
});
```

Dos escrituras seguidas **no** son atómicas. Si la segunda falla, la primera ya ocurrió y nadie la va a deshacer.

Dentro de una transacción, usar siempre el `manager` que recibe la función. Usar el repositorio inyectado en su lugar ejecuta **fuera** de la transacción: el error más común y el más difícil de ver leyendo el código.

---

## Paso 6: registrar en el módulo

```ts
@Module({
  imports: [TypeOrmModule.forFeature([Recurso])],
  controllers: [RecursoController],
  providers: [RecursoService],
  exports: [RecursoService],   // solo si otro módulo lo necesita
})
```

Exportar todo "por las dudas" convierte el grafo de dependencias en una maraña donde cualquier módulo puede depender de cualquier otro.

---

## Reglas críticas

| Regla | Por qué |
|---|---|
| **Nunca escribir una migración a mano** | Ver `nestjs-create-migration`. Se generan con la herramienta y se revisan |
| **Validar antes de ejecutar** | Validar después es un agujero de seguridad: el efecto ya ocurrió |
| **Errores del dominio, no genéricos** | Un `throw new Error()` pierde el código y el estado HTTP. Ver `nestjs-error-handling` |
| **Nada de secretos en el código** | Van en el entorno, con un valor por defecto explícito |
| **Sin consultas dentro de bucles** | Una consulta por elemento degrada todo bajo carga real |

---

## Verificación

```bash
node scripts/run-gates.js --repo <repositorio>
```

Y los comandos declarados para ese repositorio en `ai-workspace.json`: comprobación de tipos, análisis estático, compilación y tests.
