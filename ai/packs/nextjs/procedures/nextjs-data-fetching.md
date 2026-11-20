# Obtención de datos en el cliente

Hooks de consulta y de mutación. Convenciones para que los datos se compartan, se invaliden y se recuperen de forma predecible.

---

## Claves de consulta

Una clave mal formada es la causa de la mitad de los problemas de este stack: datos que no se actualizan, o que se actualizan de más.

**Centralizar las claves.** No escribirlas sueltas en cada componente:

```ts
export const recursoKeys = {
  all: ['recursos'] as const,
  list: (filtros: Filtros) => [...recursoKeys.all, 'list', filtros] as const,
  detail: (id: string) => [...recursoKeys.all, 'detail', id] as const,
};
```

Con esta forma, invalidar `recursoKeys.all` alcanza a listas y detalles de una vez.

**Todo lo que cambia el resultado va en la clave.** Si un filtro afecta la respuesta y no está en la clave, dos filtros distintos comparten caché y se muestran datos del otro.

---

## Consultas

```ts
export function useRecursos(filtros: Filtros) {
  return useQuery({
    queryKey: recursoKeys.list(filtros),
    queryFn: () => fetchRecursos(filtros),
    staleTime: 30_000,
  });
}
```

- Un hook por recurso, exportado desde un archivo propio. Llamar a `useQuery` suelto dentro de un componente hace que la clave se duplique mal en el próximo lugar que necesite lo mismo.
- **`staleTime` explícito.** Sin él, cada montaje vuelve a pedir. Con un valor demasiado alto, la pantalla muestra datos viejos después de una acción.
- El tipo de la respuesta se valida contra el contrato. Si el esquema del cliente es más estricto que lo que el servidor puede devolver —por ejemplo, un campo que puede venir vacío y el esquema lo exige— el resultado es un error de validación con el servidor respondiendo correctamente. Ese desencuentro es difícil de diagnosticar porque los registros del servidor dicen que todo salió bien.

---

## Mutaciones

```ts
export function useCrearRecurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearRecurso,
    onSuccess: () => qc.invalidateQueries({ queryKey: recursoKeys.all }),
  });
}
```

**Invalidar es más seguro que actualizar la caché a mano.** Escribir el resultado directamente en la caché deja el estado divergiendo del servidor en cuanto una regla de negocio modifique algo que el cliente no vio.

---

## Dependencias de hooks: el error que cuesta caro

**Nunca poner el objeto que devuelve `useQuery` como dependencia de un `useCallback`, `useMemo` o `useEffect`.**

```ts
// Mal: el objeto es nuevo en cada render → bucle infinito
const query = useRecursos(filtros);
const recargar = useCallback(() => query.refetch(), [query]);

// Bien: depender de la función, que es estable
const { refetch } = useRecursos(filtros);
const recargar = useCallback(() => refetch(), [refetch]);
```

El síntoma es engañoso: la aplicación se congela **sin ninguna petición de red**, porque el bucle está entre el render y el efecto, no en la obtención de datos. Buscar el problema en la red no lleva a ninguna parte.

---

## Diagnóstico rápido

| Síntoma | Causa habitual |
|---|---|
| Los datos no se actualizan tras una acción | La invalidación usa una clave que no coincide con la de la consulta |
| Se vuelve a pedir en cada render | `queryFn` o la clave se recrean; un objeto en línea como clave es distinto cada vez |
| Aparecen datos de otro filtro | El filtro no está en la clave |
| Una petición por elemento de una lista | Un hook dentro del componente de fila; subir la consulta al contenedor |
| Se congela sin peticiones | Objeto de consulta como dependencia de un hook — ver arriba |
| El servidor responde bien y la interfaz dice que falló | El esquema del cliente es más estricto que el contrato |
