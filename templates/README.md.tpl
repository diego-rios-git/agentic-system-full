# {{project.title}}

Workspace de desarrollo asistido por IA: agentes, reglas, patrones y verificaciones automáticas.

Generado desde [la base agéntica]({{template.repository}}) v{{template.version}}.

---

## Estructura

```
{{project.name}}/
├── ai/
│   ├── core/            ← activos comunes, vienen de la base
{{#each packs}}│   ├── packs/{{name}}/
{{/each}}│   └── local/           ← activos propios de este proyecto
├── scripts/             ← verificaciones y automatizaciones
├── .claude/ .opencode/  ← punteros generados, no se editan a mano
├── ai-workspace.json    ← configuración del workspace
{{#each repos}}├── {{path}}/{{#if isRepoDir}}{{/if}}
{{/each}}└── CLAUDE.md AGENTS.md
```

{{#if isMultiRepo}}
Los repositorios de aplicación son proyectos Git independientes y están excluidos de este repositorio. Se clonan adentro:

```bash
{{#each repos}}git clone <url-{{name}}> {{path}}
{{/each}}```
{{/if}}

---

## Primeros pasos

```bash
# Tu configuración personal, no se versiona
cp .claude/settings.local.json.example .claude/settings.local.json

# Verificar que todo está en su lugar
node scripts/consolidate-skills.js --check
node scripts/run-gates.js --all
```

Abrí la sesión de IA **desde esta raíz**: es donde vive el contexto completo.

Si es tu primera vez, seguí `docs/onboarding.md`.

---

## Repositorios

| Repositorio | Ruta | Stack | Rama base |
|---|---|---|---|
{{#each repos}}| **{{name}}** | `{{path}}` | {{packsLabel}} | `{{baseBranch}}` |
{{/each}}

---

## Cómo se cambia el comportamiento de un agente

El contenido vive **una sola vez** en `ai/`. Cada harness tiene un puntero corto que remite ahí.

```bash
# 1. Editá la fuente en ai/
# 2. Regenerá los punteros
node scripts/consolidate-skills.js --wrappers
```

Editar un puntero directamente lo cambia en un solo harness y lo deja distinto del resto. Por eso existe `--check`.

---

## Actualizar la base

```bash
node scripts/template-sync.js --dry-run   # ver qué cambiaría
node scripts/template-sync.js             # aplicarlo
```

Actualiza `ai/core/`, `ai/packs/` y `scripts/`. **No toca** `ai/local/`, la configuración, los baselines ni este archivo. Si modificaste algo del núcleo, te lo reporta en vez de pisártelo.

Leé la salida del `--dry-run` antes de aplicar. Tres cosas que no se resuelven solas: un pack nuevo **no llega** si no lo declarás en la configuración, un archivo que la base eliminó se reporta pero no se borra, y un archivo que editaste a mano queda sin actualizar hasta que lo resuelvas. El detalle, en `docs/actualizar-la-base.md`.

---

## Documentos

| Documento | Para qué |
|---|---|
| `CLAUDE.md` | Mapa del sistema y reglas que se cargan en cada sesión |
| `AGENTS.md` | Instrucciones para los harnesses sin configuración propia |
| `INVENTORY.md` | Catálogo de activos, con estado y responsable |
| `docs/onboarding.md` | Empezá por acá |
| `docs/actualizar-la-base.md` | Traer las mejoras publicadas en la base |
| `docs/sistema-agentico.md` | Cómo escribir el prompt de cada tarea |
| `docs/manual-ia-por-roles.md` | Qué se espera de cada rol y qué no se comparte |
