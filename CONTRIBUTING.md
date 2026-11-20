# Cómo se cambia esta base

Un cambio acá afecta a todos los proyectos que nazcan de esta base. Por eso el proceso es explícito y hay un solo escritor.

---

## Quién escribe

Este repositorio tiene **un único mantenedor con permiso de escritura**. El resto del equipo lo lee y genera proyectos a partir de él.

Eso no significa que no puedas cambiar nada: el repositorio que generás con *Use this template* es tuyo y ahí adaptás lo que necesites. Lo que no ocurre es que esos cambios vuelvan acá solos.

**Si algo que descubriste sirve para todos**, abrí un issue con:

- El problema concreto que resolviste, con un caso real. No hipotético.
- Qué activo agregarías, cambiarías o eliminarías.
- Si es una verificación automática: qué falla detecta, y cómo se prueba que la detecta.

---

## Principio

> Una regla escrita es una sugerencia. Una regla ejecutable es una garantía.

Antes de agregar una regla en prosa, preguntate si se puede expresar como un **script o un hook**:

- Una regla escrita se carga en **cada sesión** de **cada persona** — cuesta tokens siempre — y el modelo la puede pasar por alto.
- Una verificación ejecutable cuesta **cero tokens** y no se puede pasar por alto.

Solo lo que no es verificable mecánicamente merece ser una regla escrita.

---

## Antes de que algo entre

1. **`npm test` en verde.** Sin excepciones. Si el cambio toca un gate, además tiene que haber un test que **falle sin el arreglo** — uno que pasa antes y después no prueba nada. Ver `docs/verificar-la-base.md`.
2. **Probado en trabajo real** al menos una vez. Un activo que nunca se usó entra como `Experimental`, no como `Validado`.
3. **Sin referencias a un proyecto concreto.** Ni nombres de clientes, ni prefijos de ticket, ni URLs de repositorios, ni rutas locales. Lo que varía por proyecto va en `ai-workspace.json`, no en el activo.
4. **Documentado en el manifiesto.** Si agregás un activo, declaralo en `template.manifest.json`, en el núcleo o en el pack que corresponda.
5. **Con impacto declarado.** Si el cambio rompe un proyecto ya generado, es MAJOR y se anota en el `CHANGELOG.md`.

### Si agregás una regla

Lleva sus fixtures, en la propia regla:

```js
fixtures: {
  bad:  ['la línea que DEBE marcar'],
  good: ['la línea casi idéntica que NO debe marcar'],
}
```

El segundo es el que importa. Una regla probada solo contra código malo no se distingue de una que marca todo, y esa es la que enseña al equipo a ignorar los avisos — con lo cual se pierde el gate entero, no solo esa regla.

`--validate-rules` los corre, y una regla sin fixtures se reporta como problema.

### Si agregás un gate

Cumple el contrato o no entra: **0** verificado y limpio, **1** verificado con hallazgos, **2** no se pudo verificar y stdout vacío. `test/contract.test.js` se lo exige a todos los gates declarados, así que el tuyo queda cubierto el día que lo declarás.

El 2 es el que se olvida, y es el que sostiene todo lo demás: un gate que sale con 0 sin haber corrido produce confianza donde no hubo verificación.

### Si agregás una descripción

Dice **cuándo** usar el activo, no qué hace. Se carga en toda sesión aunque nadie lo invoque; el detalle va en el cuerpo. Ver `docs/costo-de-contexto.md`.

---

## Estados de un activo

| Estado | Criterio para entrar | Criterio para salir |
|---|---|---|
| **Experimental** | Funciona para quien lo escribió | Se usa en trabajo real por alguien más → Validado |
| **Validado** | Usado por al menos dos personas, con dueño asignado | Deja de usarse dos meses → Pendiente de revisión |
| **Pendiente de revisión** | Sin dueño, sin uso reciente, o falla conocida | Se arregla → Validado, o se deprecia |

Un activo `Pendiente de revisión` sin dueño durante un ciclo completo **se deprecia**. Acumular activos muertos es peor que no tenerlos: erosiona la confianza en todo lo demás.

---

## Reglas duras

- **Nunca subir secretos**: tokens, claves de API, contraseñas, `.env`.
- **Nunca subir rutas absolutas personales** (`D:\…`, `C:\Users\…`).
- **Nunca subir configuración personal**. Va en `settings.local.json`, que está ignorado.
- **Nunca versionar código de aplicación** acá. Esta base define cómo se trabaja, no qué se construye.

---

## Formato de commit

```
<área>: mensaje en inglés
```

Ejemplos:

```
core(gates): add duplication check
packs(nestjs): extract anti-pattern rules from the engine
scripts(sync): report divergent files instead of overwriting
docs(onboarding): clarify the baseline step
```

**Nunca incluir atribución de IA** (`Co-Authored-By` con un agente).

---

## Versionado

Ver el encabezado de `CHANGELOG.md`. Cada versión publicada debe poder adoptarse con `template-sync` sin intervención manual, salvo que esté declarada como MAJOR.
