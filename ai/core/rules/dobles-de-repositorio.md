# Regla — Un doble no es más pobre que lo que reemplaza

**Regla:** en un doble de repositorio, de acceso a datos o de servicio, una lectura devuelve una **copia** de la fila guardada, nunca el mismo objeto, y respeta la **condición** del filtro que el código real usa.

Aplica a cualquier lenguaje y a cualquier biblioteca de acceso a datos: es sobre cómo se escribe el doble, no sobre el framework.

---

## Qué pasa si no (el incidente)

El servicio muta la entidad que cargó y recién después escribe, con una condición que lo protege de dos escrituras concurrentes:

```
entidad = repo.buscar(id)
entidad.escalada_en = ahora                        # muta lo cargado
repo.actualizar(donde:   { id, escalada_en: NULO }, # la condición que protege
                valores: { escalada_en: entidad.escalada_en })
```

Si el doble devolvió **el mismo objeto** que tiene guardado, mutar la entidad ya dejó la fila mutada. La condición `escalada_en es nulo` mira la fila y la encuentra escrita: cero filas afectadas, la actualización no ocurre nunca.

El test falla, y **falla por el doble**. Lo peligroso es lo que viene después: la lectura natural es "el código está mal", y la tentación es **sacar la condición del filtro** para que el test pase. Esa condición es justamente lo que protege contra la carrera.

Pasó varias veces en la misma sesión, siempre la misma familia: **el doble era más pobre que el objeto real**, y la diferencia se leyó como un defecto del código:

1. Un doble guardaba el mismo objeto que después se usaba como entidad: dos escalamientos concurrentes daban los dos en falso.
2. Otro devolvía la fila guardada: la resolución no marcaba el registro como resuelto.
3. Un doble sin una columna nulable (en la base real llega como `null`, no ausente) y otro con claves en un estilo de nombres distinto del que expone la entidad.

---

## Cómo se aplica

```js
findOne: ({ where }) => {
  const fila = filas.find(coincide(where));
  // Copia: la entidad que alguien carga y la fila de la base son dos cosas distintas.
  return Promise.resolve(fila ? { ...fila } : null);
},
```

Y para probar una carrera de verdad, **dos lecturas independientes**:

```js
const delScheduler = { ...fila };
const delEndpoint  = { ...fila };
```

Con un solo objeto compartido, el segundo ve lo que escribió el primero y la carrera no se prueba.

**El doble respeta la condición.** Si el código real filtra por algo, el doble filtra por lo mismo. Un doble que ignora el filtro deja pasar exactamente el bug que esa condición existe para evitar.

## También en un doble de servicio

Un doble de un servicio (notificaciones, pagos, correo) **valida como lo haría la base o el servicio real**. Incidente: el doble de un servicio de avisos aceptaba cualquier identificador de origen; el servicio real lo guarda en una columna de tipo `uuid` y el código mandaba otro formato. Con la aplicación levantada **no se guardó ningún aviso**, y el productor se tragó el error. El doble ahora rechaza un identificador que no sea `uuid`, igual que la base.

---

## Principio general: aserciones que pueden fallar

Un doble pobre es una forma de que la prueba no pueda fallar. Hay otras, y se cortan con la misma pregunta: **¿esta aserción pasaría con el código borrado?**

- **Afirmar sobre una fixture propia:** si el dato lo armó el test, se está probando el armado del test. Hay que llamar al código y mirar lo que devuelve.
- **Probar un booleano con un solo valor:** un booleano se prueba con los dos valores. Si el caso contrario no se puede escribir, el campo no distingue nada, y eso es un hallazgo del código, no un detalle del test.
- **Mirar un campo y no el resultado:** una prueba de una secuencia tiene que mirar cómo termina la secuencia.

Si el proyecto tiene el pack `nestjs`, el detalle con ejemplos de backend está en `ai/packs/nestjs/rules/probar-el-borde.md`.

---

## Cómo aplicarlo en tu proyecto

1. Buscá los dobles de repositorio que ya existen: ¿devuelven copia? ¿respetan la condición?
2. Si el proyecto tiene una fábrica común de dobles, la copia va ahí, una vez, y no en cada test.
3. Un test que falla cuando el código tiene un filtro de protección **no se arregla sacando el filtro** sin antes comprobar que el doble hace lo mismo que la base.

Relacionada: `ai/core/rules/edicion-por-reemplazo.md`, que es la misma idea aplicada a las mutaciones de verificación: **verificar contra lo que el sistema hace, no contra lo que uno escribió para verificar**.
