# Verificar lo que el runner de tests no ve

**Regla:** si el runner de tests no chequea tipos, corré el chequeo que sí los ve antes del push, y también después de sincronizar la rama con su base.

---

## Por qué existe

El runner de tests de un repositorio pasó a transpilar los specs sin chequear tipos, por velocidad. El chequeo de tipos normal del proyecto, a su vez, **excluye** los specs. Resultado: un spec que seguía llamando a una función con su firma vieja pasaba los tests, pasaba el chequeo de tipos, llegó a la rama base y rompió la compilación de todo el equipo. Ninguna verificación mala falló: ninguna de las dos miraba ese archivo.

Es el caso general de "cada herramienta ve una parte, y lo que queda entre las partes no lo ve nadie".

---

## Qué hacer

1. **Saber qué ve cada herramienta.** Cada repositorio declara en `ai-workspace.json`:
   - `testCommand`: el runner. Si transpila sin chequear tipos, no valida firmas.
   - `typecheckCommand`: el chequeo de tipos normal. Si excluye los tests, no ve los specs.
   - `typecheckTestCommand`: el chequeo que SÍ mira los tipos de los tests. `null` significa "no aplica": el runner ya los chequea, o el lenguaje compila los tests con el resto.
2. **Correr `typecheckTestCommand` antes de cada push**, en cada repositorio que lo declare. Lo cubre `git-commit-workflow` y lo repite `cerrar-ticket` antes de empujar.
3. **Correrlo también después de sincronizar** (`git-sync-branch`) con la base: un merge sin conflictos puede traer una firma cambiada por otra persona y dejar tus specs apuntando a la vieja. El merge no avisa; el chequeo sí.
4. Si el repositorio tiene un runner que no chequea tipos y **no declara** `typecheckTestCommand`, no se asume que está bien: se reporta como **no verificado** y se le pide a la persona que lo declare, o que diga que no aplica.

---

## Cómo se adapta a un proyecto

| El repositorio... | `typecheckTestCommand` |
|---|---|
| Usa un runner que chequea tipos (o compila los tests junto con el código) | `null` o ausente |
| Usa un runner que transpila sin chequear y un chequeo normal que excluye los specs | El comando que incluye los specs: típicamente el mismo chequeo con la configuración que los incorpora |
| No tiene tipos estáticos | `null`; la verificación equivalente es otra, y se declara en `ai/local/` |

**Cómo sé que lo adapté bien:** introduzco a propósito un spec con una firma vieja, corro el comando y tiene que fallar. Si da verde, el comando no mira lo que creía.

---

## Lo que esta regla no cubre

No reemplaza al runner ni al chequeo normal: los complementa. Tampoco dice qué comando es: ese dato es del proyecto y vive en su configuración, nunca en la base.
