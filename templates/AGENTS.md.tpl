# {{project.title}} — Instrucciones para agentes

Este archivo lo leen los harnesses que no tienen configuración propia. Complementa a `CLAUDE.md`, no lo reemplaza.

---

## Antes de hacer nada

1. Leer `ai-workspace.json`. De ahí salen los repositorios, sus rutas, sus stacks y sus ramas base. **No asumir ningún nombre de repositorio.**
2. Leer `CLAUDE.md` para las reglas bloqueantes.
3. Cargar solo los procedimientos que la tarea necesita. Cargar todo por las dudas gasta contexto en cada turno de la sesión, no solo en el primero.

---

## Reglas del operador

### Dónde se escribe

- **La salida por defecto va al chat**, no a un archivo. Escribir un informe que nadie pidió deja basura en el repositorio.
- Si hace falta un archivo, preguntar dónde. No inventar una ruta.
- **Nunca escribir fuera de este workspace**, ni en directorios temporales del sistema.

### Ramas

- **Nunca hacer `git checkout` para revisar algo.** La persona puede estar trabajando en otra cosa; moverle la rama le rompe el trabajo.
- Para trabajar sobre una rama distinta a la actual, usar un slot de worktree{{#if worktrees.enabled}} — están declarados en `worktrees.slots`{{/if}}.
- Los slots se limpian **solo** ante una orden explícita, y nunca a la fuerza.

### Commits

- **Nunca commitear sin pedido explícito.** Ni porque el trabajo esté terminado, ni porque una lista de tareas lo diga.
- Un commit por repositorio, como máximo.
- Sin atribución de IA, nunca.

{{#if isMultiRepo}}
### Trabajo que cruza repositorios

Primero el que define el contrato, después el que lo consume. El contrato queda escrito antes de que empiece el trabajo del consumidor: si no está escrito, el consumidor adivina, y adivina mal.

Un commit por repositorio, con el mismo identificador de ticket y módulo distinto.
{{/if}}

---

## Migraciones de esquema

{{#if hasMigrations}}
Una migración se genera **solo cuando la persona lo pide explícitamente**, y siempre con las herramientas del proyecto — nunca escribiendo el archivo a mano.

Ante cualquier error durante el proceso: **parar y avisar**. No intentar arreglarlo sobre la marcha: una migración a medias es más difícil de deshacer que de no haber empezado.
{{/if}}
{{#unless hasMigrations}}
Este proyecto no declara un flujo de migraciones. Si lo agrega, documentarlo acá.
{{/unless}}

---

## Verificaciones

```bash
node scripts/run-gates.js --all
```

Si el resultado dice que un gate **no corrió** o **no se pudo ejecutar**, eso es *sin verificar*, no *sin hallazgos*. Reportarlo como tal.

---

## Lo que este archivo no duplica

- El detalle de cada procedimiento: está en `ai/core/procedures/` y `ai/packs/`.
- Los patrones de cada stack: los aporta el pack instalado.
- El catálogo de activos con su estado y su responsable: `INVENTORY.md`.
