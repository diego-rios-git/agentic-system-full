# Sistema Agéntico — Base para proyectos

Base de trabajo con IA para arrancar un proyecto sin construir todo de cero: agentes, reglas, patrones de diseño, flujos de revisión y verificaciones automáticas, listos el primer día.

> **Estado: v1.3.0.** Políglota y sin atarse a ninguna herramienta: el lenguaje, el ORM, el marco de tests, el harness de IA y la herramienta de especificación se declaran como datos en el manifiesto de un pack. El harness es opcional — el contenido vive en `ai/` y el sistema funciona sin ninguno configurado. Trae el **circuito de trabajo completo** —requisito, slots en paralelo, revisión, prueba de punta a punta, cierre y mejora del propio sistema—: ver [`docs/circuito-de-trabajo.md`](docs/circuito-de-trabajo.md).

---

## Qué resuelve

Cada proyecto nuevo repite el mismo trabajo: escribir las reglas que el agente debe respetar, definir cómo se revisa el código, decidir qué patrones sigue el backend, cuáles el frontend, y qué se verifica solo. Ese trabajo ya está hecho.

---

## Cómo se usa

### 1. Obtener tu copia

**No clones este repositorio para trabajar.** Usá el botón *Use this template* de GitHub: te genera **tu propio repositorio**, sin historial compartido, donde tenés permiso de escritura.

```bash
git clone <url-de-tu-repositorio> mi-proyecto
cd mi-proyecto
```

### 2. Instalar la estructura

```bash
node init.js
```

Pregunta el nombre del proyecto, el prefijo de ticket, la topología, los repositorios con su stack y qué harnesses usa el equipo. Con eso instala **solo lo que corresponde**, borra los packs que no elegiste, genera los punteros de cada harness y calibra los baselines.

### 3. Cargar el proyecto

```
Usá el skill project-loader.

Resumen: vamos a hacer un sistema de reservas para consultorios médicos.
Los pacientes reservan turnos desde la web, los profesionales gestionan su
agenda, y hay una recepción que puede reasignar.
```

Este paso es el que muchos se saltean y es el que más cambia el resultado.

El `init` resuelve la **estructura**. El cargador resuelve el **contenido**: qué es este proyecto, qué palabras del dominio significan algo particular acá, qué nunca debe pasar, y qué dato no se pega en un prompt.

Sin eso, el sistema queda instalado pero genérico: sabe cómo se hace un módulo de backend, pero no sabe que un "turno" se puede reasignar hasta que el paciente entra al consultorio. **Un agente sin contexto de dominio no falla ruidosamente: produce código plausible que no corresponde al negocio.**

El agente lee tu código antes de preguntar, pregunta en tandas de hasta cuatro, y escribe el contexto en `ai/local/` — que es tuyo y ninguna actualización lo toca.

### 4. Empezar

```bash
node scripts/run-gates.js --all      # verificar que todo está en su lugar
```

Sale con **0** si todo corrió limpio, **1** si algún gate encontró algo, y **2** si algo *no se pudo verificar* — un gate caído, o un repositorio que todavía no clonaste. El 2 no es un error del comando: es la diferencia entre "sin hallazgos" y "sin verificar", y es la que un CI necesita poder leer.

Abrí la sesión de IA **desde la raíz** y leé `docs/sistema-agentico.md`.

---

## Qué recibís

### Agentes

| Agente | Qué hace |
|---|---|
| **workspace-router** | Detecta a qué repositorio pertenece la tarea y carga el contexto correcto |
| **project-setup-agent** | Convierte un resumen del proyecto en el contexto del sistema |
| **qa-agent** | Audita la implementación contra el diseño y los criterios de aceptación |
| **code-reviewer** | Corrección, arquitectura, rendimiento, mantenibilidad, tests. Sugiere, no modifica |
| **security-auditor** | Autorización, aislamiento de datos, secretos, entrada no confiable |
| **spec-agent** | Ciclo propuesta → diseño → tests → implementación → archivado *(pack openspec)* |

Los de revisión salen con edición deshabilitada de verdad, no como sugerencia en el texto.

### Procedimientos

**Del núcleo:** cargar el proyecto, revisión orquestada (tres modos), flujo de commit, creación de ramas, slots de worktree con `promote`/`release`, sincronizar la rama, ciclo de tarea y trabajo autónomo, prueba de punta a punta, cierre de un ticket, redactar un requisito, convertir un error en un gate, y explicación educativa de código.

**Guías para un agente sin contexto:** lo que depende de cómo lo hace *tu* proyecto no viene como código fijo sino como un procedimiento que un agente lee y adapta a tu stack —dependencias compartidas entre slots, migraciones contra una base descartable, gates de dominio, el kit de pruebas de punta a punta, tu tracker—. Ver `docs/circuito-de-trabajo.md`.

**Por pack:** los patrones concretos de cada stack.

### Verificaciones automáticas

| Gate | Qué detecta |
|---|---|
| Rutas citadas | Referencias a archivos que no existen — hacen que el agente improvise |
| Secretos | Bloquea la escritura **antes** de que ocurra |
| Anti-patrones | Motor sin reglas propias: las aportan los packs |
| Duplicación | Bloques repetidos que deberían extraerse |
| Aislamiento por cliente | El filtro va en la consulta, no sobre el resultado *(pack multi-tenant)* |
| Cobertura de escenarios | Cada escenario del diseño necesita su test *(pack openspec)* |
| Código que nadie importa | Un archivo nuevo que ningún otro alcanza: la capa existe, la capacidad no |
| Codificación del texto | Caracteres rotos (`Ã³`) que hacen que un test pase sin poder fallar |
| Co-cambio | Quien toca un archivo debe regenerar su derivado (lockfile, captura, cliente) |
| Fixtures de las reglas | Toda regla trae un caso que marca y uno que no |
| Tablero de requisitos | El estado de un requisito sale de la evidencia del repo, no de la mano |

Todos con baseline: **solo reportan lo nuevo**. La deuda que ya estaba queda congelada al instalar, que es lo único que evita que el equipo los apague el primer día.

Corren solos después de cada escritura, vía hook.

---

## Núcleo y packs

El **núcleo** es agnóstico de stack y se instala siempre. Los **packs** son opcionales:

| Pack | Para qué |
|---|---|
| `nestjs` | Módulos, base de datos, DTOs, errores de dominio, migraciones |
| `nextjs` | Componentes, servidor vs. cliente, obtención de datos, endpoints intermedios |
| `multi-tenant` | Aislamiento de datos entre clientes, con su verificación |
| `openspec` | Ciclo dirigido por especificación, con disciplina de alcance |
| `analisis-funcional` | Fichas a partir de un documento, cambios sobre una ficha, revisión, cobertura contra el código y camino crítico. Para PMs, analistas y devs |

Un pack entra solo si es un **patrón de arquitectura reutilizable**. Una regla de negocio —cómo representar dinero, cómo numerar facturas— es del proyecto, no de la base.

---

## Topologías

**Multi-repo** — la base en la raíz, los repositorios de aplicación adentro, cada uno con su propio git.

**Repo único** — la base convive con el código.

Ambas soportadas, y también **adoptar la base en un proyecto que ya existe**: ahí el `init` congela la deuda actual en los baselines para que los gates no arranquen en rojo.

---

## Actualizaciones

```bash
node scripts/template-sync.js --dry-run   # ver qué cambiaría
node scripts/template-sync.js             # aplicarlo
```

| Se actualiza | No se toca nunca |
|---|---|
| `ai/core/`, `ai/packs/`, `scripts/`, documentación base | `ai/local/`, configuración, baselines, `CLAUDE.md`, `README.md` |

Si modificaste un archivo del núcleo, **no te lo pisa**: te lo reporta como divergente y decidís vos. Y sigue reportándolo en las corridas siguientes hasta que lo resuelvas.

Tres cosas que el caso feliz no cubre y conviene saber antes de correrlo: los packs nuevos **no llegan solos**, un archivo que la base eliminó se reporta pero no se borra, y el CI puede pasar a rojo con razón. Todo eso está en **`docs/actualizar-la-base.md`**.

---

## Una sola fuente, varios harnesses

El contenido vive **una sola vez** en `ai/`. Cada harness recibe un puntero corto que remite ahí:

```bash
node scripts/consolidate-skills.js --wrappers   # regenerar
node scripts/consolidate-skills.js --check      # ¿alguien editó un puntero a mano?
```

Editar un puntero cambia el comportamiento en un solo harness y lo deja distinto del resto. Por eso existe `--check`.

Soportados: Claude Code, OpenCode y `AGENTS.md`. Para agregar otro, ver `docs/agregar-un-harness.md`.

---

## Documentos

| Documento | Para qué |
|---|---|
| `docs/onboarding.md` | **Empezá por acá.** Veinte minutos, termina verificado |
| `docs/sistema-agentico.md` | Cómo escribir el prompt de cada tarea |
| `docs/manual-ia-por-roles.md` | Qué se espera de cada rol y qué no se comparte |
| `docs/trabajo-en-paralelo.md` | Varios tickets a la vez: el prompt de cada caso, el turno de la principal y la cola |
| `docs/agregar-un-harness.md` | Sumar una herramienta que no viene incluida |
| `CONTRIBUTING.md` | Cómo se cambia esta base |

---

## Requisitos

Node 18 o superior, y git. Nada más: **el proyecto que generes corre sin instalar dependencias**, a propósito.

La única excepción es el gate de duplicación, que usa `jscpd` vía `npx --yes`: sin red no puede correr, y en ese caso lo dice —sale con código 2— en vez de reportar "sin hallazgos". Si preferís que no dependa de la red, instalalo una vez con `npm install` (esta base declara `jscpd` como dependencia de desarrollo; `npx` prefiere la copia local si existe).

---

## Quién escribe acá

Este repositorio tiene **un único mantenedor**. El equipo lo lee y genera proyectos a partir de él; los cambios que cada uno haga viven en su propio repositorio.

Si algo que descubriste sirve para todos, abrí un issue. Ver `CONTRIBUTING.md`.
