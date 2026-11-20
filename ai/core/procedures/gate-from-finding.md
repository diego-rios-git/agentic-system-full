# De un error encontrado a un gate que lo impide

Procedimiento para cerrar el bucle: cada vez que se confirma un error real —en una revisión, en QA, o porque una persona corrigió algo que la IA escribió mal— se evalúa si puede volverse una verificación automática.

**Por qué importa:** un error corregido a mano se corrige una vez. Un error convertido en gate no vuelve a pasar, para nadie, gratis y para siempre. Es el único mecanismo del sistema con retorno creciente: la regla cuesta unos cientos de tokens **una vez** y después atrapa ese error sin costo.

Sin este procedimiento, la conversión depende de que alguien se acuerde meses después. A veces pasa. La mayoría de las veces, no.

---

## Cuándo se dispara

| Momento | Quién |
|---|---|
| Una revisión confirma un hallazgo real, no un falso positivo | El orquestador de revisión, en su fase final |
| Una persona corrige código que escribió un agente | Quien corrigió |
| Un defecto llega a QA o a producción | Quien hace el análisis posterior |

No se dispara por un falso positivo ni por una preferencia de estilo sin consecuencia. El filtro es: **¿si esto se repite, cuánto duele?**

---

## Paso 1 — ¿Es un patrón o un caso único?

Un caso único —una condición mal escrita, un error de tipeo en una constante— no genera regla. Un patrón sí: algo que **puede repetirse en otro archivo, por otra persona, en otro módulo**.

Señales de que es patrón:

- Ya pasó más de una vez, aunque haya sido en lugares distintos.
- Viene de un malentendido sobre cómo funciona una biblioteca, no de un descuido puntual.
- Nace de una convención del proyecto que no es evidente leyendo el código.

Si es caso único: **no hay gate.** Anotarlo y seguir.

## Paso 2 — ¿Se puede detectar sin ejecutar el código?

Un gate lee texto o estructura; no corre la aplicación. Si detectar el error requiere ejecutar el flujo, ver una respuesta real de la red, o conocer el estado de la base de datos, **no es un gate: es un test**. Escribir el test y anotar el caso en `ai/gate-candidates.md` con el motivo.

## Paso 3 — Elegir el mecanismo

| Qué hay que mirar | Mecanismo | Dónde |
|---|---|---|
| Una línea aislada, texto plano | Expresión regular | Nueva regla en el motor de anti-patrones, dentro del pack que corresponda |
| Estructura: qué llama a qué, qué está dentro de qué, un decorador, un envoltorio | AST | Nueva regla en el archivo de reglas AST del pack |
| Un valor mal tipado o mal convertido en el borde | Tokenización | Extender el gate del pack que define esa regla |
| Bloque repetido en dos lugares | Ya cubierto | Gate de duplicación |
| Una ruta citada que no existe | Ya cubierto | `scripts/check-context-links.js` |
| Un secreto en el contenido a escribir | Ya cubierto | `scripts/check-secrets.js` |

**Regla práctica:** si para describir el error necesitás decir *"dentro de"*, *"que llama a"* o *"que viene de"*, es AST. Si alcanza con *"una línea que dice"*, es expresión regular.

**Dónde vive la regla:** si el error depende de un framework o de una convención de stack, va en el pack de ese stack, no en el núcleo. Un gate en el núcleo tiene que valer para cualquier proyecto.

## Paso 4 — Escribir la regla CON sus dos fixtures

Los fixtures van **dentro de la regla**, no en un archivo aparte ni en la cabeza de quien la escribió:

```js
{
  id: 'XX-1.1',
  title: '…',
  why: '…',
  test: (line, ctx) => /…/.test(line),
  fixtures: {
    bad:  ['la línea que DEBE marcar'],
    good: ['la línea casi idéntica que NO debe marcar'],
  },
}
```

- **`bad`**: el código que tiene el error. La regla **debe** marcarlo.
- **`good`**: el código correcto, lo más parecido posible al anterior. La regla **no debe** marcarlo.

**`good` es el que importa, y es el que más se saltea.** Sin él no hay forma de saber si la regla marca de más — y una regla probada solo contra código malo no se distingue de una que marca todo.

Si la regla mira las líneas anteriores, el fixture las declara con `before`.

Correrlos:

```bash
node scripts/check-antipatterns.js --repo <repo> --validate-rules
```

Una regla sin fixtures se reporta como problema. Esto era antes una exigencia escrita acá; ahora se ejecuta, que es la diferencia entre una regla que se cumple y una que se cumple cuando hay tiempo.

Después, probar contra el código real del repositorio antes de conectarla. Si aparece un hallazgo, revisarlo uno por uno: puede ser deuda real —va al baseline— o un falso positivo de la regla, y entonces hay que achicarla.

> **Precedente que vale recordar.** Una regla escrita para detectar escrituras en un método de solo lectura usó un patrón amplio —cualquier método que empezara con `assign`, `create` o `update`— y empezó a marcar constructores de consultas, que son lecturas. Se achicó al único prefijo con evidencia real.
>
> **Una regla angosta y correcta vale más que una ancha y ruidosa.** Los falsos positivos matan la credibilidad de un gate más rápido que cualquier otra cosa: basta con que el equipo aprenda a ignorar sus avisos una vez.

## Paso 5 — Baseline y registro

```bash
# Congelar la deuda preexistente: el gate falla solo ante lo nuevo
node scripts/check-<gate>.js --scope <repo> --write-baseline

# Verificar que queda limpio
node scripts/run-gates.js --repo <repo>
```

Declarar la regla en el `manifest.json` del núcleo o del pack, bajo `gates`. Registrarla en `INVENTORY.md` con qué fixtures se validó y qué limitaciones conocidas tiene.

## Paso 6 — Si NO se pudo hacer gate

Anotarlo en `ai/gate-candidates.md` con **el motivo concreto**. Un candidato descartado con motivo es información: dice qué haría falta para poder automatizarlo, y la próxima persona no repite el análisis.

---

## Anti-objetivo

Esto **no** es para convertir cada preferencia de estilo en un bloqueo. Un gate que frena por algo que no duele es fricción, y la fricción se termina desactivando.

El criterio sigue siendo el de `CONTRIBUTING.md`: **si la consecuencia es un incidente o una pérdida de datos, va en un gate. Si es una molestia menor, va escrito en un procedimiento.**
