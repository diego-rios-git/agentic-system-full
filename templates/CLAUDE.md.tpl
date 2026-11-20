# {{project.title}} — Mapa del sistema

> Generado desde la base agéntica. Editalo libremente: es tuyo y `template-sync` no lo toca.

## Repositorios

| Repositorio | Ruta | Stack | Rama base |
|---|---|---|---|
{{#each repos}}| **{{name}}** | `{{path}}` | {{packsLabel}} | `{{baseBranch}}` |
{{/each}}

{{#if isMultiRepo}}
Cada repositorio tiene su propio git. Los comandos se ejecutan con `git -C <ruta>` desde esta raíz.
{{/if}}

---

## Reglas bloqueantes

Estas no se negocian y no dependen de que alguien se acuerde: varias están respaldadas por un gate.

### Git

- **Formato de commit**: {{#if project.ticketPrefix}}`{{project.ticketPrefix}}-XXX tipo(modulo): mensaje en inglés`{{/if}}{{#unless project.ticketPrefix}}`tipo(modulo): mensaje en inglés`{{/unless}}
- **Nunca incluir atribución de IA** en un commit. Ni `Co-Authored-By` con un agente, ni ninguna variante.
- **Nunca hacer `git commit` sin que la persona lo pida explícitamente.** Que el trabajo esté listo no habilita el commit.
- **El pedido de commit incluye el push.** Verificar el upstream antes: `git -C <repo> rev-parse --abbrev-ref @{u}`. Un upstream mal configurado manda el push a la rama base aunque el nombre de la rama sea otro.

### Seguridad

- **Secretos**: no imprimir ni registrar claves, tokens ni contraseñas. Un hook bloquea la escritura antes de que ocurra.
- **Datos sensibles**: ver `ai/core/rules/datos-sensibles.md`. Si no lo pegarías en un ticket que puede leer cualquiera, no lo pegues en un prompt.

{{#if hasMultiTenant}}
### Aislamiento entre clientes

El filtro por `{{tenant.column}}` va **en la condición de la consulta**, nunca aplicado sobre el resultado. Filtrar después significa que la base ya devolvió datos de otro cliente.
{{/if}}

---

## Verificaciones automáticas

```bash
node scripts/run-gates.js --all          # todo lo verificable, una vez
node scripts/run-checks.js --all         # tipos, lint y tests que el repo declara, una vez
node scripts/consolidate-skills.js --check   # ¿alguien editó un puntero a mano?
```

Corren solas después de cada escritura, vía hook. Solo reportan lo **nuevo**: la deuda preexistente está congelada en los baselines.

---

## Dónde está el resto

| Tema | Dónde |
|---|---|
| Reglas transversales | `ai/core/rules/` |
| Procedimientos del núcleo | `ai/core/procedures/` |
| Patrones de stack | `ai/packs/<pack>/procedures/` |
| Agentes | `ai/core/agents/` |
| Activos propios del proyecto | `ai/local/` |
| Configuración del workspace | `ai-workspace.json` |
| Cómo se trabaja de punta a punta | `docs/circuito-de-trabajo.md` |
| Catálogo de activos | `INVENTORY.md` |

**Para cambiar el comportamiento de un skill o un agente, editá su fuente en `ai/` y regenerá los punteros:**

```bash
node scripts/consolidate-skills.js --wrappers
```

Eso regenera también el registro de los **hooks**. Editar un puntero de `.claude/` o `.opencode/` directamente cambia el comportamiento en un solo harness y lo deja distinto del resto; y agregar un hook de la base a mano en `.claude/settings.json` está prohibido: se declara en un `manifest.json` y se registra con ese comando.

---

## Idioma

{{#if isSpanish}}Responder siempre en español. Los identificadores de código y los mensajes de commit van en inglés.{{/if}}{{#unless isSpanish}}Idioma de trabajo: `{{project.language}}`.{{/unless}}
