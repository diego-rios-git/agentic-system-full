# Catálogo de requisitos y camino crítico

Convierte un alcance —un documento aprobado, un módulo, el cierre de una reunión, una lista de pedidos— en dos cosas: **un catálogo** breve de los requisitos que salen de ahí, y **el camino crítico**: en qué orden hay que fichar y construir, qué puede ir en paralelo y qué bloquea a qué.

Sirve antes de fichar varios requisitos de un mismo documento, o para repartir trabajo entre varias personas sin que dos fichen lo mismo o alguien arranque algo que depende de lo que todavía no existe.

Antes de empezar, `metodo-analista` (`ai/packs/analisis-funcional/procedures/metodo-analista.md`).

No es una ficha, no estima horas y no dice que nada esté implementado.

---

## 1. La base

Se lee entera la fuente que indicó la persona y se anota su versión, fecha y estado. **No se usa como precedente una fuente que no se indicó**, ni un plan o catálogo anterior si la persona pidió partir de cero.

---

## 2. El inventario

Para cada capacidad que trae la fuente:

- **La unidad de la fuente.** Un bloque, una fila, un caso de uso. No cada mención de un id.
- **Qué es:** una ficha nueva, la ampliación de un requisito existente, una revisión de algo que hay que preservar.
- **La cadena:** `quien produce el dato o el evento → este requisito → quien lo consume`. Se distinguen los productores de datos, los requisitos que tienen que existir antes, las pantallas que solo muestran, y los consumidores.
- **Si se puede fichar ya:** independiente no es lo mismo que fichable. Un requisito puede no depender de nadie y no tener todavía actores, fórmulas o permisos definidos.

Antes de contar algo como duplicado, se compara actor, entidad, disparador, resultado y dueño (`auditar-cobertura-rf`, sección 3). Las palabras parecidas no prueban duplicación.

**Lo que tiene ficha pero no está construido sigue siendo trabajo.** Solo se resta del universo un duplicado verdadero, sin residual. Y si se pide "los requisitos que hay que hacer", se cuentan todos los activos, incluidas las ampliaciones; la cuenta se muestra y se usa la misma definición en todo el documento.

Cada requisito queda clasificado en uno de:

- independiente y fichable ahora;
- fichable después de reconciliar lo que ya existe;
- tiene que existir antes que otros;
- depende de otro: va después;
- absorbido en parte: ampliar la ficha de destino;
- independiente, pero bloqueado por decisiones;
- consume un contrato que todavía no está definido.

Y con una **acción**, no solo un estado: crear la ficha, ampliar otra, resolver tal decisión primero, o no crearla porque duplica.

Ids: si la fuente no los trae, no se inventan como oficiales. Si hacen falta para ordenar, son provisorios y se dice.

---

## 3. El orden

Se arma un **grafo**, no una lista por módulo:

1. Se sacan primero las exclusiones y lo ya cubierto.
2. Se ordena por **prerrequisitos reales**: una pantalla, un reporte o una exportación no son prerrequisito de nada salvo que la fuente lo diga.
3. Se separa el orden de construcción del orden de fichado: a veces se puede fichar algo antes de que su dependencia esté construida.
4. Se arman carriles paralelos con los puntos donde se juntan.
5. Cada salida de fase tiene una condición verificable. **Una respuesta exitosa o una pantalla que existe no son una condición de salida.**

Se verifica con un script corto o a mano, de forma explícita: que cada requisito activo aparezca una vez, que no aparezca ninguno excluido, y que cada uno esté en una fase posterior a la de todo lo que necesita.

---

## 4. Los documentos

Dos archivos nuevos, sin tocar la fuente. Van a la carpeta de documentos de análisis del proyecto (por defecto, la de fichas) y no llevan `rf:` en el encabezado.

```markdown
# Catálogo de requisitos — <alcance>

**Fecha:** <AAAA-MM-DD> · **Versión:** <X.Y> · **Base:** `<fuente>`
**Estado:** propuesta de catálogo para fichar; no habilita implementación.

## 1. <grupo funcional>

| Orden | Requisito | Tipo | Qué es |
|---:|---|---|---|
| 1 | <id> — <nombre> | Ficha nueva / Ampliación de <id> / Revisión | <propósito, actor, resultado y límite en una línea> |

## 2. Dependencias y límites transversales
## 3. Pendientes
## 4. Inventario
```

```markdown
# Camino crítico — <alcance>

**Fecha:** <AAAA-MM-DD> · **Versión:** <X.Y> · **Base:** `<fuente>` y el catálogo
**Estado:** propuesta de orden; no habilita implementación.

## 1. Secuencia
| Paso | Requisito o hito | Depende de | Resultado |
|---:|---|---|---|

## 2. Dependencias críticas
## 3. Carriles en paralelo
| Carril | Qué avanza | Condición |
|---|---|---|

## 4. Condiciones de salida
| Fase | Condición verificable |
|---|---|

## 5. El camino
<diagrama en texto>

## 6. Fuera del camino
```

Si la persona pide un solo documento, van los dos bloques en uno y se dice.

---

## Control

- [ ] Los dos documentos citan la misma base.
- [ ] Cada requisito tiene tipo, una línea de qué es, y un límite o una dependencia cuando la fuente no lo cierra.
- [ ] Ningún supuesto está listado como requisito: va a pendientes.
- [ ] La cuenta de requisitos activos se muestra y coincide en todo el documento.
- [ ] El orden se verificó: nadie antes de lo que necesita, nadie dos veces, ningún excluido.
- [ ] No se publicó, subió ni modificó nada fuera de estos dos archivos.
