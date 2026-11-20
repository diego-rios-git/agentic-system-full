# Inventario de activos — {{project.title}}

Catálogo de lo que hay, en qué estado está y quién responde por ello.

**Generado el {{generatedAt}} desde la base v{{template.version}}.** Las filas se regeneran; la columna **Responsable** y las notas que agregues al final se conservan solo si las movés a `ai/local/`.

---

## Estados

| Estado | Significa |
|---|---|
| **Validado** | Usado en trabajo real, con responsable asignado. Se puede confiar |
| **Experimental** | Funciona, pero no lo probó el equipo. Usar con criterio |
| **Pendiente de revisión** | Sin responsable o sin uso reciente. Candidato a arreglarse o deprecarse |

Un activo `Pendiente de revisión` sin responsable durante un ciclo completo **se deprecia**. Acumular activos muertos erosiona la confianza en todo el resto.

---

## Agentes

| Agente | Qué hace | Origen | Estado | Responsable |
|---|---|---|---|---|
{{#each agents}}| `{{name}}` | {{shortDescription}} | {{origin}} | {{state}} | — |
{{/each}}

---

## Skills y procedimientos

| Skill | Qué hace | Origen | Estado | Responsable |
|---|---|---|---|---|
{{#each skills}}| `{{name}}` | {{shortDescription}} | {{origin}} | {{state}} | — |
{{/each}}

---

## Verificaciones automáticas

| Gate | Qué detecta | Alcance | Origen |
|---|---|---|---|
{{#each gates}}| `{{id}}` | {{label}} | {{scope}} | {{origin}} |
{{/each}}

Todos corren con baseline: la deuda preexistente está congelada y solo se reporta lo que se introduce desde ahora.

Los baselines viven en `.<gate>-baseline.json`, indexados por repositorio. Para recalcular el de uno:

```bash
node scripts/check-<gate>.js --repo <repositorio> --write-baseline
```

---

## Packs instalados

{{#if packs}}
| Pack | Qué aporta |
|---|---|
{{#each packs}}| **{{name}}** | {{description}} |
{{/each}}
{{/if}}
{{#unless packs}}
Ninguno: este proyecto usa solo el núcleo.
{{/unless}}

---

## Deuda conocida

_Anotá acá lo que sabés que está mal y todavía no se arregló._

Un inventario que solo lista lo que funciona es propaganda. Lo que hace útil a este documento es la parte incómoda: qué activo nadie usa, qué gate tiene falsos positivos conocidos, qué procedimiento quedó viejo respecto del código.

---

## Candidatos a gate descartados

Ver `ai/gate-candidates.md`: errores confirmados que no se pudieron automatizar, con el motivo. Sirve para no repetir el análisis.
