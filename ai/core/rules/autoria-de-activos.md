# Regla — Autoría de activos

Qué se exige a una regla, un procedimiento, un agente, un gate o un prompt para entrar a la base o a `ai/local/`.

---

## Una regla escrita es una sugerencia; una ejecutable es una garantía

Antes de agregar una regla en prosa a `CLAUDE.md`, `AGENTS.md` o a `ai/core/rules/`, preguntate si se puede expresar como un **script o un hook**.

- Una regla en prosa se carga en **cada sesión** de **cada persona** (cuesta tokens siempre) y el modelo la puede pasar por alto.
- Un gate ejecutable cuesta cero tokens y no se puede pasar por alto.

Solo lo que no es verificable mecánicamente merece quedar como texto. El camino para convertir uno en otro es `gate-from-finding`.

## Estados de un activo

| Estado | Criterio para entrar | Criterio para salir |
|---|---|---|
| **experimental** | Funciona para quien lo escribió | Lo usa en trabajo real alguien más → validado |
| **validado** | Usado por al menos dos personas, con dueño asignado | Deja de usarse durante dos meses → pendiente de revisión |
| **pendiente de revisión** | Sin dueño, sin uso reciente, o con una falla conocida | Se arregla → validado; o se depreca |

Un activo pendiente de revisión sin dueño durante un ciclo completo **se depreca**. **Un activo sin dueño ni uso no se publica**: acumular activos muertos es un costo de contexto y una fuente de instrucciones desactualizadas. El estado se declara en el manifiesto del activo.

Un activo que nunca se usó entra como `experimental`, no como `validado`.

## Un alias fino delega, nunca copia

Si un activo existe solo para ofrecer otro punto de entrada (un comando con otro nombre, un puntero de otro harness), **delega**: dice "leé X" y nada más.

Incidente: dos copias de la tabla de detección de proyecto (una en el agente que enruta y otra en el procedimiento que cargaba el contexto) se desincronizaron; cada una llevaba al agente a un repositorio distinto según cuál se cargara. La fuente es una; el alias la cita. Si hay que agregar un caso, se agrega en la fuente.

## Lo que un activo nunca contiene

- **Secretos**: tokens, claves, contraseñas, archivos de entorno. Ver `ai/core/rules/datos-sensibles.md`.
- **Rutas absolutas personales** (la carpeta de usuario de una máquina concreta): rutas relativas al workspace.
- **Configuración personal**: va en los archivos locales de cada herramienta, no en la base.
- **Nombres de personas, de tickets o de clientes** en los ejemplos: el incidente se cuenta en genérico.

## Cada regla conserva su porqué

Una regla sin el incidente que la originó se "simplifica" cuando alguien no entiende para qué está. Cada una lleva, en 1 a 3 líneas, el caso real, y un **cómo aplicarlo en tu proyecto**.

## Cómo aplicarlo en tu proyecto

1. Antes de abrir un PR de un activo: ¿qué problema concreto resuelve? (un caso real, no uno hipotético).
2. Si es un gate: qué falla detecta y cómo se prueba que la detecta (un fixture que marca y uno que no).
3. Si reemplaza o depreca algo: decirlo en el PR y en el manifiesto.
4. Quién lo aprueba lo define el proyecto; para lo que cambia el comportamiento de los agentes de todo el equipo (permisos, hooks que bloquean, reglas de seguridad), conviene que lo lea además alguien que vaya a convivir con la regla.
