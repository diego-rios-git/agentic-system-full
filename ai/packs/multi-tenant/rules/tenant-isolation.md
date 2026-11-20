# Regla — Aislamiento de datos entre clientes

**Fuente única de verdad** del aislamiento multi-cliente. Cualquier otra descripción queda subordinada a este archivo.

---

## La regla

**El filtro por cliente va en la condición de la consulta. Nunca sobre el resultado.**

```ts
// Mal: la base ya devolvió datos de todos los clientes
const todos = await repo.find({ where: { estado: 'activo' } });
return todos.filter((r) => r.tenantId === actual);

// Bien: la base nunca los devuelve
return repo.find({ where: { estado: 'activo', tenantId: actual } });
```

La diferencia no es de rendimiento. Filtrar después significa que los datos de otro cliente **ya salieron de la base y pasaron por el proceso**. Desde ahí se filtran solos por media docena de caminos:

- Un conteo o una paginación calculados antes del filtro.
- Un mensaje de error que incluye el registro encontrado.
- Un registro de depuración con la consulta completa.
- Un `find` que devuelve el primero y resulta ser de otro cliente.
- Cualquier refactorización futura que mueva el filtro de lugar sin darse cuenta de que era el único control.

---

## Dónde se aplica

| Operación | Qué exige |
|---|---|
| **Lectura de una lista** | La columna de cliente está en la condición |
| **Lectura de un registro** | Buscar por identificador **y** cliente, juntos. Nunca solo por identificador |
| **Escritura** | Verificar pertenencia antes de modificar |
| **Borrado** | Igual que la escritura |
| **Agregaciones y conteos** | El filtro va antes de agregar, no después |

Buscar solo por identificador y comprobar después es el mismo error que filtrar sobre el resultado: para cuando comprobás, ya lo tenés en memoria.

---

## Qué responder cuando no corresponde

Un recurso de otro cliente **no existe** desde la perspectiva de quien pregunta. Responder que no tiene permiso confirma que ese identificador es real y de alguien: eso ya es información.

La excepción es cuando la existencia no es sensible y decirlo ayuda a resolver el problema. Es una decisión, y se toma explícitamente.

---

## De dónde sale el identificador del cliente

**Del contexto autenticado. Nunca de un parámetro que mandó el cliente.**

Un identificador de cliente que viaja en el cuerpo, en la consulta o en una cabecera es un campo que cualquiera puede cambiar. Si el sistema confía en él, el aislamiento no existe.

---

## Cómo se verifica

```bash
node ai/packs/multi-tenant/scripts/check-tenant-isolation.js --repo <repositorio>
```

Detecta consultas sin el filtro, filtrado aplicado sobre el resultado, y búsquedas por identificador sin acompañar por cliente.

Es una heurística: **no prueba que el aislamiento sea correcto**, solo encuentra los casos evidentes. Un gate limpio no reemplaza la revisión del agente de seguridad.

---

## Configuración

En `ai-workspace.json`:

```jsonc
"tenant": {
  "column": "tenant_id",              // el nombre real en tu proyecto
  "exempt": ["src/modules/public/"]   // rutas sin datos de cliente
}
```

Las rutas exentas son las que legítimamente no filtran: catálogos compartidos, configuración global, tablas de referencia. **Cada exención es una decisión de seguridad**: anotá por qué, o alguien la va a copiar sin entenderla.
