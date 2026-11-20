# Slots de worktree

Gestiona espacios de trabajo aislados para implementar o revisar una rama **sin mover la rama del repositorio principal**.

---

## Cuándo se usa

| Situación | Por qué un slot |
|---|---|
| Hay que revisar un PR y ya hay trabajo en curso | Hacer `checkout` le rompe el trabajo a quien lo tiene |
| Dos tareas distintas en paralelo | Cada una en su slot, sin pisarse |
| Probar algo sin ensuciar el árbol actual | El principal queda intacto |

Los slots disponibles están declarados en `worktrees.slots` de `ai-workspace.json`.

---

## Comandos

```bash
# Qué hay abierto
node scripts/manage-worktree.js status

# Abrir
node scripts/manage-worktree.js open --slot review --repo <repo> --branch <rama>

# Cerrar
node scripts/manage-worktree.js clean --slot review
```

Al abrir, la rama se resuelve así:

1. Si existe **local**, se abre en modo desprendido. Una rama no puede estar activa en dos worktrees a la vez, y sacársela al repositorio principal sería exactamente lo que este mecanismo evita.
2. Si existe **en el remoto**, se crea siguiéndola.
3. Si no existe, se crea nueva desde la rama base declarada para ese repositorio.

---

## Reglas

**Nunca hacer `git checkout` en el repositorio principal para revisar.** Es la razón por la que existe todo esto.

**Los slots se limpian solo cuando la persona lo pide.** Un slot abierto no molesta; uno cerrado por iniciativa propia puede llevarse trabajo.

**Nunca forzar la limpieza.** Si el slot tiene cambios sin commitear, el comando se niega y lo dice. Eso es deliberado: pueden ser horas de trabajo que nadie más tiene. Commitear o descartar es una decisión de la persona.

**No abrir el mismo slot dos veces.** Cerralo antes de reutilizarlo.

---

## Infraestructura compartida

Si el proyecto levanta servicios —base de datos, cachés, colas— el slot **los comparte** con el workspace principal: es la misma máquina.

Eso significa que **no** se corren migraciones, cargas de datos ni verificaciones contra servicios reales desde un slot sin coordinarlo. Dos worktrees migrando la misma base al mismo tiempo dejan un esquema que no corresponde a ninguna de las dos ramas.

---

## Cómo lo usan los agentes

Un agente de revisión **no** crea ni limpia slots: los gestiona este procedimiento, y quien orquesta le pasa el directorio del slot como raíz de trabajo.

Si un agente propone abrir un worktree por su cuenta, o crear un directorio temporal para revisar, está saliéndose del mecanismo: los temporales sueltos quedan, se llenan de dependencias y nadie los borra.
