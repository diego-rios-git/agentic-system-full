# Verificar la base

Cómo se prueba a sí mismo este sistema, y cómo agregar una prueba cuando aparece un defecto.

---

## Por qué existe

Un gate que reporta "sin hallazgos" sin haber corrido no se ve como un fallo: se ve como un proyecto limpio. Ese es el defecto más caro que puede tener esta base, porque produce confianza donde no hubo verificación, y nadie lo busca.

Ha pasado seis veces. Un gate que salía con 0 sin la herramienta instalada. Otro que salía con 0 con el repositorio sin clonar — y después un tercero, y un cuarto, con el mismo patrón. Una huella de baseline idéntica para todos los hallazgos, con lo que congelar uno los congelaba todos. Un analizador que solo miraba archivos ya versionados, y por lo tanto nunca los que un agente acababa de crear.

Ninguno se habría encontrado leyendo el código. Todos se encontraron corriendo los gates contra código de prueba y mirando el **código de salida**.

---

## Correr las pruebas

```bash
npm test
```

Node trae el ejecutor de tests desde la versión 18: no hay ninguna dependencia que instalar. Tarda unos segundos.

---

## Qué se prueba

| Archivo | Qué verifica |
|---|---|
| `test/gates.test.js` | Que cada gate encuentre lo suyo y **no marque el código correcto** |
| `test/contract.test.js` | Que ningún gate mienta sobre si pudo verificar |
| `test/rules.test.js` | Que cada regla se comporte como dicen sus propios fixtures |
| `test/verify-findings.test.js` | Que un hallazgo que cita código inexistente se descarte |

El más importante es el segundo, y conviene entender por qué.

### El contrato

Todo gate cumple lo mismo, sin importar qué mire:

```
0   se verificó y no hay hallazgos
1   se verificó y hay hallazgos, listados en stdout como JSON
2   NO se pudo verificar — y entonces stdout queda vacío
```

La tercera línea es la que se olvida. `contract.test.js` recorre **los gates declarados en los manifiestos**, no una lista escrita en el test, y le exige a cada uno las tres. Un gate nuevo —del núcleo, de un pack, del proyecto— queda sujeto al contrato el día que se declara, sin que nadie tenga que acordarse de agregarlo.

La primera vez que se corrió encontró dos gates que lo violaban.

---

## Los fixtures

`test/fixtures/` tiene repositorios mínimos, uno por lenguaje, y cada uno trae dos archivos que importan por igual:

```
<lenguaje>-repo/src/malo.<ext>     lo que DEBE marcar
<lenguaje>-repo/src/bueno.<ext>    lo que NO debe marcar
```

**El segundo es el que importa.** Un gate probado solo contra código malo no se distingue de un gate que marca todo, y ese es el que enseña al equipo a ignorar los avisos — con lo cual se pierden todos, no solo el ruidoso.

Los repositorios se declaran en `test/fixtures/ai-workspace.test.json`, con la misma forma que la configuración de un proyecto real. Los gates la leen a través de la variable `AI_WORKSPACE_CONFIG`, así que corren **exactamente igual** que en un proyecto: mismo código, mismos argumentos, misma salida.

Hay dos variables de entorno para esto, y solo para esto:

| Variable | Para qué |
|---|---|
| `AI_WORKSPACE_CONFIG` | Apunta a otra configuración. Sin ella, la del proyecto |
| `AI_BASELINE_DIR` | Dónde se escriben los baselines. Sin ella, la raíz |

La segunda existe para que un test que ejercita el congelamiento no pise los baselines reales del repositorio donde corre.

---

## Los fixtures de una regla viajan con la regla

Además de los repositorios de prueba, **cada regla declara sus propios ejemplos**:

```js
{
  id: 'NET-1.2',
  test: (line) => …,
  fixtures: {
    bad:  ['var x = ObtenerAsync().Result;'],
    good: ['return r.Result;'],
  },
}
```

Se corren con:

```bash
node scripts/check-antipatterns.js --repo <repo> --validate-rules
```

Y una regla sin fixtures se reporta como problema. Esto era antes una exigencia escrita en `gate-from-finding`; ahora se ejecuta, que es la diferencia entre una regla que se cumple y una que se cumple *cuando hay tiempo*.

Cuando la regla mira las líneas anteriores, el fixture puede declararlas:

```js
fixtures: {
  before: 'const q = useQuery({ queryKey: k });',
  bad: ['const fn = useCallback(() => hacer(q), [q]);'],
  good: ['const fn = useCallback(() => hacer(q), [q.refetch]);'],
}
```

Sin poder declarar `before`, esas reglas nunca marcarían durante la validación y su fixture correcto pasaría por el motivo equivocado — que es una forma de test verde que no prueba nada.

---

## Agregar una prueba cuando aparece un defecto

El orden importa, y es el mismo que para cualquier corrección:

1. **Escribir la prueba que falla.** Si no falla antes del arreglo, no está probando el defecto.
2. Arreglar.
3. Confirmar que pasa.

Dónde va cada cosa:

- Un gate que reporta mal → `gates.test.js`, con un fixture nuevo si hace falta.
- Un gate que miente sobre su código de salida → normalmente no hace falta escribir nada: `contract.test.js` ya lo cubre para todos. Si es un caso que el contrato no contempla, se agrega ahí y queda cubierto para todos a la vez.
- Una regla que marca de más o de menos → un fixture en la propia regla.

---

## Lo que estas pruebas no hacen

No prueban que las reglas sean **buenas ideas**, ni que los procedimientos estén bien escritos, ni que un pack de un lenguaje describa bien ese lenguaje. Eso lo decide quien conoce el stack.

Lo que prueban es más angosto y más importante: que cuando el sistema dice que verificó, haya verificado.

---

## Las pruebas que viajan a un proyecto

Las pruebas de `test/` se instalan con la base, y `init` descarta los packs que el proyecto no eligió. Una prueba de un pack ausente no debe **fallar** —no es un defecto— ni pasar en silencio: se **omite con el motivo a la vista** con `packsMissing(['<pack>'])` de `test/helpers.js`. Al agregar una prueba que necesite un pack, hay que marcarla así.

Hay una prueba que arma un proyecto vacío a partir de la base, corre `init` y verifica el conjunto (`test/init-proyecto-vacio.test.js`): packs, hooks registrados, punteros en sincronía, registro de candidatos vacío, rutas citadas, `run-gates --all` y el recorrido de un slot. Es la única que mira las piezas **juntas**; solo corre en la base.
