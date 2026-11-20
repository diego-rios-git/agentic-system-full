# Cargar el proyecto

Convierte un resumen en lenguaje natural —"vamos a hacer X para Y"— en el contexto que el sistema necesita para trabajar bien: qué se está construyendo, con qué tecnología, bajo qué reglas y con qué datos hay que tener cuidado.

Es el paso que sigue a `init.js`. El `init` resuelve la **estructura**: repositorios, packs, punteros, configuración. Este procedimiento resuelve el **contenido**: qué es este proyecto y qué lo hace distinto de cualquier otro.

---

## Por qué hace falta

Sin esto, el sistema queda instalado pero genérico. Sabe cómo se hace un módulo de backend, pero no sabe que en este proyecto un "pedido" puede cancelarse hasta que se despacha, que los identificadores externos vienen de un proveedor que a veces los repite, ni que las direcciones de entrega son datos personales que no se pegan en un prompt.

Eso es exactamente lo que un agente necesita para no inventar. **Un agente sin contexto de dominio no falla ruidosamente: produce código plausible que no corresponde al negocio**, y eso se descubre en revisión, o más tarde.

---

## Cuándo se usa

- Recién instalada la base, en un proyecto nuevo.
- Al adoptar la base en un proyecto que ya existe.
- Cuando el proyecto cambió lo suficiente como para que el contexto quedó viejo.

---

## Paso 1: leer antes de preguntar

**Nunca preguntar algo que se puede averiguar.** Antes de la primera pregunta:

1. Leer `ai-workspace.json`: repositorios, packs, ramas base, prefijo de ticket.
2. Si el código ya existe, leerlo lo suficiente para inferir:
   - Stack real, desde los manifiestos de dependencias.
   - Estructura de módulos o dominios.
   - Nombres de entidades del negocio, desde el modelo de datos.
   - Cómo se despliega, si hay configuración de integración continua.
3. Leer el resumen que dio la persona.

Cada cosa averiguada es una pregunta que no hay que hacer. Un cuestionario largo se abandona a la mitad.

---

## Paso 2: preguntar en tandas cortas

**Máximo cuatro preguntas por vez.** Un formulario de veinte campos produce respuestas de una palabra; cuatro preguntas concretas producen respuestas útiles.

Empezar por lo que más cambia el comportamiento del sistema, y **saltear lo que ya se infirió** — mostrando lo inferido para que la persona lo corrija si está mal.

### Tanda 1 — Qué es

- ¿Qué hace el sistema, en una frase, para alguien que no lo conoce?
- ¿Quién lo usa? ¿Hay más de un tipo de usuario con permisos distintos?
- ¿Cuál es la operación central, la que si falla el producto no sirve?

### Tanda 2 — Tecnología

Solo lo que no se pudo inferir del código. **Y al preguntarlo, decir por qué no se pudo**: "no hay dependencias declaradas todavía", "hay dos clientes de base de datos en el manifiesto y no queda claro cuál se usa".

Sin ese motivo, una pregunta cuya respuesta está en un archivo del repositorio se lee como que el agente no miró — y a partir de ahí la persona deja de confiar en la tabla de lo inferido, que es justamente lo que ahorra las otras quince preguntas.

- ¿Qué stack, si todavía no hay código?
- ¿Dónde corre y cómo se despliega?
- ¿Hay servicios externos de los que depende?

### Tanda 3 — Reglas duras

La tanda más valiosa. Es donde se captura lo que ningún patrón genérico sabe:

- ¿Qué **nunca** debe pasar? Lo que sería un incidente, no una molestia.
- ¿Hay estados o transiciones que tienen un orden obligatorio?
- ¿Qué operaciones tienen que ser atómicas, o pasan todas o ninguna?
- ¿Hay algo que parezca razonable hacer pero que en este dominio esté mal?

La última pregunta es la que más rinde: captura el conocimiento que normalmente solo se transmite cuando alguien ya se equivocó.

### Tanda 4 — Datos sensibles

- ¿Qué dato de este sistema identifica a una persona o a un cliente real?
- ¿Cuál es el gesto cotidiano que lo expone? Adjuntar una captura, pegar una fila de una consulta, copiar un error completo.
- ¿Hay algo regulado o bajo contrato que obligue a tratar cierto dato de una forma?

### Tandas condicionales — según los packs instalados

Cada pack activo trae una pregunta que **define el comportamiento de todo el sistema** y que ningún otro proyecto puede responder por este. Preguntarla acá, no descubrirla en la primera revisión:

| Pack instalado | Qué preguntar | Por qué importa |
|---|---|---|
| `multi-tenant` | ¿Qué es un "cliente" acá, exactamente? ¿La empresa, la sede, la persona? | Define el aislamiento de **todos** los datos. Elegir mal se paga en una migración, no en un ajuste |
| `openspec` | ¿Dónde viven las especificaciones y quién aprueba un diseño? | Sin eso el ciclo arranca sin saber contra qué se audita |
| `nestjs` | ¿Las migraciones corren antes o después de que se despliegue el código nuevo? | Si corren antes, toda migración debe ser compatible con el código viejo |
| `nextjs` | ¿Hay más de un idioma, ahora o previsto? | Cambia si los textos van al sistema de traducciones desde el día uno |

Si el proyecto instaló un pack, esta pregunta **no es opcional**.

### Tanda 5 — Proceso

Solo si no se infirió de la configuración:

- ¿Cómo se nombran las ramas y los commits?
- ¿Quién aprueba un merge?
- ¿Las migraciones de esquema corren antes o después de que se despliegue el código nuevo?

La última importa más de lo que parece: si corren **antes**, toda migración tiene que ser compatible con el código viejo durante la ventana de despliegue.

---

## Paso 3: escribir el contexto

Todo va a `ai/local/`, que es **propiedad del proyecto**: una actualización de la base nunca lo toca.

### El brief del proyecto

Se escribe en `ai/local/`, a partir de `templates/project-brief.md.tpl`. La plantilla trae la estructura; no hay que inventar otra.

El **glosario** es la sección que más se subestima. Una palabra del dominio usada con un significado propio —"reserva", "cierre", "liquidación"— es la fuente más común de código que parece correcto y no lo es.

### Las reglas de negocio

En `ai/local/rules/`, a partir de `templates/rules-negocio.md.tpl`.

Cada regla lleva **qué pasa si se rompe**: una regla sin consecuencia declarada se trata como sugerencia. La plantilla incluye además una sección para lo que *parece razonable y está mal* — la de mayor valor, porque captura el conocimiento que normalmente solo se transmite después de que alguien se equivocó.

### Los datos sensibles propios

En `ai/local/rules/`, a partir de `templates/rules-datos-sensibles.md.tpl`.

Completa lo que `ai/core/rules/datos-sensibles.md` deja explícitamente abierto: qué dato de **este** proyecto identifica a alguien, y cuál es el gesto que lo expone.

### Ajustes a la configuración

Si de las respuestas surge algo que corresponde a `ai-workspace.json` —un pack que hace falta, la columna de aislamiento entre clientes, un comando de tests que no estaba declarado— proponer el cambio y aplicarlo con confirmación.

---

## Paso 4: enlazar desde el mapa del sistema

Agregar a `CLAUDE.md` una sección **Contexto del proyecto** que apunte a los archivos generados dentro de `ai/local/`, para que se carguen en cada sesión.

Sin este paso, los archivos existen y nadie los lee.

---

## Paso 5: verificar

```bash
node scripts/check-context-links.js --baseline
node scripts/consolidate-skills.js --check
```

Y mostrarle a la persona **un resumen de lo que se entendió**, no de lo que se escribió. Que lo confirme o lo corrija: un contexto equivocado es peor que ninguno, porque el agente va a actuar con confianza sobre algo falso.

---

## Marcar la procedencia de cada afirmación

Proponer opciones concretas en vez de preguntas abiertas baja mucho la fricción, y conviene hacerlo. Pero tiene un costo que hay que compensar: **una opción que el agente propuso y la persona marcó no vale lo mismo que algo que la persona afirmó por su cuenta.**

El riesgo es concreto. El modelo propone lo que suele ser cierto en dominios parecidos, suena razonable, se marca, y queda escrito como regla dura del proyecto. A partir de ahí todos los agentes lo tratan como verdad del negocio y **nadie lo vuelve a cuestionar**, porque parece dicho por la persona.

Es más grave en la pregunta sobre lo que *parece razonable y está mal*: su valor era capturar el conocimiento de quien ya se equivocó una vez. Si lo llena el modelo, queda una imitación plausible.

Por eso cada afirmación del brief y de las reglas lleva su origen:

| Marca | Qué significa |
|---|---|
| *(sin marca)* | Lo afirmó la persona, o se leyó del código |
| **`[a confirmar]`** | Lo propuso el agente y la persona lo marcó. Sigue siendo una hipótesis del modelo |
| **`[pendiente]`** | Nadie lo definió todavía |

Y al cerrar, decirlo explícitamente: *"estas N afirmaciones las propuse yo y vos las confirmaste — conviene validarlas con alguien del negocio antes de tratarlas como reglas duras."*

### Obligaciones legales y regulatorias: caso aparte

Una norma, una ley o una obligación contractual **nunca queda confirmada porque alguien del equipo técnico marcó una casilla**. Se registra siempre como `[requiere validación legal]`, incluso si la persona la confirmó.

La diferencia con el resto: una regla de negocio la puede confirmar quien conoce el negocio. Una obligación regulatoria no la puede confirmar ni el equipo ni el modelo — y el modelo es especialmente propenso a proponer la norma que *suele* aplicar en ese país y ese rubro, que suena verosímil y puede no corresponder.

Nombrar una ley concreta en la propuesta está bien: ayuda a que la persona sepa de qué se está hablando. Darla por cerrada, no.

---

## Reglas

- **No inventar.** Si algo no se preguntó y no se pudo inferir, se deja marcado como pendiente en el documento. Un dato inventado se vuelve verdad para todas las sesiones siguientes.
- **No escribir código de aplicación.** Este procedimiento produce contexto, nada más.
- **No pisar `ai/local/` sin avisar.** Si ya hay contexto cargado, mostrar qué cambiaría antes de escribir.
- **Todo en `ai/local/`.** Nada de esto va al núcleo ni a un pack: es de este proyecto y de ningún otro.
