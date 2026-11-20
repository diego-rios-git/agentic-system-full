# Cómo pedirle las cosas al agente

Diez minutos de lectura. Es la diferencia entre obtener lo que querías y pelear tres turnos con el resultado.

---

## Seis reglas

### 1. Decí qué querés lograr, no qué archivos tocar

```
Mal:  "editá pagos.service.ts y agregá un método validar"
Bien: "el sistema tiene que rechazar un pago cuando el monto supera el
       disponible, y devolver un error que el frontend pueda distinguir"
```

Nombrar el archivo te ata a tu hipótesis de dónde va el cambio. Si la hipótesis es incorrecta, el agente la sigue igual.

### 2. Decí qué NO querés que toque

Es lo que más ahorra. Un agente que no sabe dónde está el límite lo pone donde le parece:

```
"Solo el módulo de pagos. No toques la autenticación aunque veas algo raro."
```

### 3. Pegá el error completo, no tu resumen

El texto crudo —traza incluida— tiene información que tu resumen pierde. Si el error trae datos reales de una persona o un cliente, sacalos y dejá la forma: ver `ai/core/rules/datos-sensibles.md`.

### 4. Un pedido, una tarea

Tres cosas distintas en un mensaje producen tres cosas a medias. Si son tres, mandalas de a una — o pedí explícitamente que las haga en orden y pare entre cada una.

### 5. Si querés que pregunte, decilo

Por defecto el agente resuelve las ambigüedades por su cuenta. Cuando la decisión importa:

```
"Antes de implementar, decime cómo pensás resolver X y esperá que confirme."
```

### 6. Pedir un commit es pedir el push

El agente **nunca** commitea solo. Cuando se lo pedís, el flujo llega hasta el push. Si querés solo el commit, decilo.

---

## Lo que pasa solo, sin que lo pidas

No hace falta que lo repitas en cada mensaje:

| Automático | Qué hace |
|---|---|
| **Hook de secretos** | Bloquea la escritura si el contenido parece una credencial |
| **Hook de gates** | Verifica el archivo en el mismo turno en que se escribe |
| **Reglas del proyecto** | `CLAUDE.md` se carga en cada sesión |
| **Patrones del stack** | Los aporta el pack del repositorio que estés tocando |

Repetir en el prompt algo que ya es una regla cargada no lo refuerza: gasta contexto.

---

## Qué va en el prompt y qué no

| Va | No va |
|---|---|
| El objetivo, en términos de comportamiento | Reglas que ya están en `CLAUDE.md` |
| El límite del cambio | El detalle de cómo implementarlo, salvo que importe |
| Errores crudos, sin datos reales | Datos de personas o clientes |
| Cómo vas a saber que funciona | Halagos y disculpas |
| El repositorio, si es ambiguo | Volcados completos de la base |

---

## Ejemplos por tipo de tarea

### Explorar, sin implementar

```
Quiero entender cómo funciona el flujo de <X> antes de tocarlo.
Explicame qué hace hoy, dónde está cada pieza, y qué me sorprendería.
No implementes nada.
```

### Proponer un cambio

```
Necesito <comportamiento>. Proponé el cambio: qué haría falta, qué queda
afuera, y qué decisiones necesitás de mí antes de empezar.
Si son más de 15 tareas, partilo.
```

### Implementar

```
Implementá <cambio> según el diseño aprobado.
Si algo del diseño no se puede cumplir, pará y decímelo en vez de improvisar.
```

### Revisar

```
Revisá la rama actual contra <base>. Quiero saber si se puede mergear.
No arregles nada todavía: primero quiero ver los hallazgos.
```

### Diagnosticar

```
<síntoma exacto>. Pasa cuando <condición>. Esperaba <esto> y pasa <esto otro>.
[error crudo]
Encontrá la causa antes de proponer un arreglo.
```

---

## Antipatrones de prompt

| Antipatrón | Por qué falla |
|---|---|
| "Arreglá todo lo que esté mal" | Sin límite, el cambio crece hasta donde alcance el contexto |
| "Hacelo bien" | No dice nada verificable |
| "Ya sabés lo que quiero" | El agente no tiene la conversación de ayer salvo que esté en el contexto |
| "Optimizá esto" | ¿Velocidad, memoria, legibilidad? Suelen estar en conflicto |
| Repetir una regla en cada mensaje | Ya está cargada; solo gasta contexto |
| Pedir el arreglo junto con la revisión | Mezcla encontrar problemas con resolverlos, y ninguna sale bien |

---

## Cuándo delegar en un subagente

Los agentes de revisión —QA, código, seguridad— corren en su propio contexto. Conviene delegar cuando:

- La tarea requiere **leer mucho** y vos solo querés la conclusión.
- Querés **varias perspectivas en paralelo** sobre el mismo cambio.
- El trabajo es de solo lectura y no querés que toque nada.

No conviene cuando la tarea es corta, o cuando el ida y vuelta con vos es la parte importante.

Para revisar un cambio completo, `pr-review` los orquesta: corre los gates una vez y les pasa el resultado, en lugar de que cada uno repita el mismo barrido.

---

## Cuando el resultado no es el que querías

**Decí qué está mal, no "está mal".** "El error se traga la excepción original" es accionable; "eso no sirve" hace que el agente adivine, y suele adivinar que el problema era otro.

**Si se fue de alcance, decilo explícitamente.** "Volvé a lo pedido: solo el módulo de pagos, revertí lo demás."

**Si repitió un error que ya corregiste**, ese es justo el caso de `gate-from-finding`: convertirlo en una verificación automática para que no vuelva a pasar. Un error corregido a mano se corrige una vez; convertido en gate, no vuelve nunca.
