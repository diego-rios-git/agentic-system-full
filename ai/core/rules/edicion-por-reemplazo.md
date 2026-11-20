# Regla — Editar por reemplazo de texto

**Fuente única de verdad** para cómo se edita un archivo con un reemplazo programático (`str.replace`, `sed`, un script de Python o de Node). Cualquier otra descripción del tema queda subordinada a este archivo.

No aplica a las herramientas de edición que ya verifican la coincidencia y fallan si no la encuentran.

---

## La regla

**Un reemplazo que no verifica cuántas veces ocurrió no es una edición: es una apuesta.** Después de cada reemplazo programático hay que afirmar el número esperado de coincidencias, y detenerse si no coincide.

```python
n = s.count(viejo)
assert n == 1, 'esperaba 1 coincidencia, hubo %d' % n
s = s.replace(viejo, nuevo, 1)
```

```js
const coincidencias = s.split(viejo).length - 1;
if (coincidencias !== 1) throw new Error(`esperaba 1 coincidencia, hubo ${coincidencias}`);
s = s.replace(viejo, () => nuevo);
```

Los dos modos de fallar son igual de silenciosos:

| Coincidencias | Qué pasa sin verificación |
|---|---|
| **cero** | El archivo queda igual y el script dice que terminó bien |
| **más de una** | Se modifica código que nadie miró |

---

## Por qué (el incidente)

**Cero coincidencias.** Al verificar por mutación el arreglo de un defecto, el patrón buscaba una indentación y un fin de línea que el archivo ya no tenía: un autoformateo los había cambiado. El reemplazo no se aplicó, el script no dijo nada, y **tres corridas seguidas de la prueba de punta a punta "sin el arreglo" corrieron con el arreglo puesto**. La conclusión que estuvo a punto de sacarse —que la prueba no servía— era exactamente la contraria a la verdad.

Lo que lo delató no fue el script: fue que el log mostraba la reversión de una transacción donde el código mutado solo podía emitir una confirmación.

**Más de una coincidencia.** Un reemplazo por substring de un nombre de variable, sin límite de cantidad, alcanzó también a un método preexistente que nadie había mirado. Y un pase de acentos por substring convirtió `Contratos` en `Contratós`, `secciones` en `secciónes` y `media` en `medía`, porque `trato`, `seccion` y `dia` estaban adentro de esas palabras.

---

## Las dos consecuencias prácticas

**1. Reemplazar por límite de palabra, no por substring.** Si lo que se busca es una palabra, el patrón tiene que decirlo:

```python
re.sub(r'\bdia\b', 'día', texto)     # no toca `media`
```

**2. Cuanto más largo el patrón, más frágil.** Un bloque de diez líneas depende de la indentación, de los finales de línea y de cada espacio intermedio, y cualquier formateador automático los cambia sin avisar. Preferir, en este orden:

1. Editar **por línea**, buscando un fragmento corto y único de cada una.
2. Un regex tolerante: `\s*` entre tokens, `\r?\n` para los saltos.
3. Un bloque literal largo, solo si las dos anteriores no sirven.

---

## Cómo se verifica

Después de editar, mirar el resultado —no el código que lo produjo—:

```bash
grep -c "lo que debería estar ahora" archivo    # y que el número sea el esperado
git diff --stat archivo                          # y que las líneas sean las que esperabas
```

En una **mutación** (romper algo a propósito para comprobar que una prueba lo detecta) esto no es opcional. Una mutación que no se aplicó y da verde se lee exactamente igual que una prueba que no prueba nada, y lleva a la conclusión contraria. La mutación se **verifica aplicada** antes de correr nada: el conteo y el `git diff --stat` tienen que mostrar el cambio.

---

## Cómo aplicarlo en tu proyecto

- Si el proyecto tiene scripts de migración de texto (renombres masivos, pases de ortografía), que usen una función única de reemplazo que afirme el conteo, y que la usen todos.
- Si el proyecto tiene una guía de pruebas de punta a punta, el paso "quitar el cambio para ver que la prueba falla" cita esta regla y exige mostrar el `git diff --stat` de la mutación.
- Un autoformateador que corre al guardar cambia el archivo entre que lo leíste y que lo reemplazás: releer antes de reemplazar.

Relacionadas: `ai/core/rules/datos-sensibles.md` (qué no puede aparecer en un archivo) y `ai/core/procedures/gate-from-finding.md` (lo que sí se puede automatizar).
