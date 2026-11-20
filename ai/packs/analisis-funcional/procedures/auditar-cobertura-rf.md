# Auditar si el código cubre un requisito

Antes de fichar un requisito que puede pisarse con algo que ya existe, o antes de contestar "¿esto ya está hecho?", se emite un **dictamen de cobertura**: qué piden las fuentes, qué hay en el código, qué falta de verdad, y qué es de otro requisito y no hay que redefinir. Evita la ficha que duplica, reemplaza o contradice en silencio lo que ya está construido.

Antes de empezar, `metodo-analista` (`ai/packs/analisis-funcional/procedures/metodo-analista.md`).

Es un análisis, no una ficha, no una revisión de código y no una implementación. **No se modifica nada del repositorio.** Después del dictamen, la ficha se escribe con `ficha-desde-documento` o el cambio con `cambio-de-requisito`, solo con el residual.

Un dev con el repositorio abierto es quien mejor hace esto: puede leer el código, citar el commit y correr los tests.

---

## 1. La pregunta

Se fija una pregunta concreta, no un título:

- qué requisito, y qué duda de negocio se quiere resolver;
- qué requisitos se sospecha que son dueños o vecinos;
- qué partes del sistema podrían tenerlo ya.

---

## 2. Qué dicen las fuentes

Se leen las fuentes funcionales en su orden de precedencia (`analisis.md` de `ai/local/`, o `ai/packs/analisis-funcional/references/evidencia-y-fuentes.md`), y se arma un mapa interno:

| Pregunta | Qué dice el documento funcional | Qué dice la ficha | Qué se decidió | Veredicto |
|---|---|---|---|---|

Cada conclusión es una de: **confirmado**, **las fuentes se contradicen**, **las fuentes no dicen**, o **recomendación**. Una recomendación nunca se presenta como lo que dice la fuente.

---

## 3. De quién es

Para cada requisito vecino, se comparan cinco cosas:

| | Pregunta |
|---|---|
| Actor | ¿Quién lo inicia o lo ve? |
| Entidad | ¿Qué dato, registro u objeto de negocio es el que se crea o cambia? |
| Disparador | ¿Qué evento lo pone en marcha? |
| Resultado | ¿Qué resultado observable garantiza? |
| Autoridad | ¿Qué requisito es dueño de la decisión, el contrato, el permiso y el ciclo de vida? |

**Un comportamiento está completamente absorbido por otro requisito solo si coinciden las cinco y no queda residual.** Una ficha existente o una función con un nombre parecido no prueban cobertura.

Con eso, el requisito se clasifica en una sola de:

- **independiente**, se puede fichar;
- **ampliación** de un requisito existente;
- **absorbido en parte**, con un residual a fichar;
- **consumidor** del contrato de otro requisito;
- **duplicado**, sin residual;
- **bloqueado** por una decisión de las fuentes.

---

## 4. Qué hay en el código

1. Se anota la revisión que se mira: rama y commit de cada repositorio (`git rev-parse --short HEAD`). Si un repositorio no está, se dice.
2. Se busca por el id del requisito, el vocabulario del dominio, los nombres de las entidades, las rutas, los estados y los tickets.
3. **Se leen los archivos, los tests y las interfaces.** Un nombre de archivo no alcanza.
4. **Frontend y backend por separado.** Que la pantalla lo muestre no prueba que el servidor lo haga cumplir, y que el servidor lo tenga no prueba que alguien pueda usarlo.
5. Si hay tests que cubren el comportamiento y se pueden correr, se corren. Un test que existe no es un test que pasa.

| Capa | Estado | Evidencia | Qué significa para el requisito |
|---|---|---|---|
| Frontend | completo / parcial / no está / sin verificar | archivos, commit | qué permite hacer o ver |
| Backend | completo / parcial / no está / sin verificar | archivos, commit | qué hace cumplir o integra |

Cada afirmación de implementación cita el commit y al menos un archivo. "No está" se escribe con dónde se buscó, con qué términos y con qué confianza.

---

## 5. Fuentes contra código

| Las fuentes | El código | Conclusión |
|---|---|---|
| Lo definen | Hace lo mismo | Se reutiliza; solo se documenta el residual de tests o ajustes |
| Lo definen | Hace una parte | El requisito sigue activo; se define solo el residual y se preserva lo que existe |
| Lo definen | Hace otra cosa | No se normaliza en silencio: se nombra el conflicto, el impacto y la decisión que hace falta |
| Lo definen | No se encontró | Planificado, no construido, dentro de lo que se miró |
| No dicen nada | Hay código | Es evidencia de implementación, no una regla nueva; si cambia el alcance, se pide la decisión |

Por defecto, **compatibilidad aditiva:** se preserva lo que ya funciona, se dice qué transición hace falta si la fuente pide otra cosa, y no se redefine un contrato, un estado o un permiso solo porque el código hoy hace otra cosa.

---

## 6. El dictamen

```markdown
---
tipo: dictamen
requisito: <id>
actualizado: <AAAA-MM-DD>
---

# Dictamen de cobertura — <id> — <título>

## Fuentes
- <documento, versión y fecha>
- Código: <repo> @ <commit>, <repo> @ <commit>

## Alcance confirmado
- …

## De quién es
- Dueño: <id — nombre>
- Vecinos que consumen o dependen: …
- Fuera de alcance: …

## Qué hay en el código
| Capa | Estado | Evidencia | Qué falta o qué se reutiliza |
|---|---|---|---|

## Residual a definir
- …

## Hallazgos
| Tipo | Qué | Impacto | Qué hace falta |
|---|---|---|---|
| Ambigüedad / Conflicto / Falta / Riesgo | | | |

## Recomendación
Crear la ficha / ampliar <id> / documentar la cobertura / frenar hasta que se decida <…>.
```

Los tipos de hallazgo:

- **Ambigüedad:** falta una decisión de negocio.
- **Conflicto:** las fuentes, o las fuentes y el código, dicen cosas incompatibles.
- **Falta:** una capacidad conocida que no está construida (una pantalla, un endpoint). Es un hecho, no un riesgo.
- **Riesgo:** algo definido que puede salir mal. Lleva impacto, causa, qué lo controla y una condición objetiva de salida.

Se guarda en la carpeta de revisiones del proyecto, sin `rf:` en el encabezado, **solo si la persona lo pide**; si no, el dictamen se da en la conversación. Quien lo lee tiene que poder saber qué escribir, qué conservar, qué postergar y qué escalar, sin tomar el código como reemplazo de una decisión de negocio.

---

## Errores que ya pasaron

- Decir "no está implementado" después de una búsqueda superficial.
- Tomar una ficha existente o un nombre parecido como cobertura completa.
- Mirar solo el frontend, o solo el backend.
- Convertir lo que hace el código en una regla nueva sin que nadie la decida.
- Abrir un permiso más amplio porque un endpoint acepta un parámetro.
- Recomendar unir registros distintos por parecido.
