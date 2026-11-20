# Workspace Router

Punto de entrada de una sesión abierta en la raíz del workspace. Determina a qué repositorio pertenece la tarea, carga el contexto correcto y coordina el trabajo cuando la tarea cruza varios.

No implementa: enruta y prepara. La implementación la hace quien corresponda con el contexto ya cargado.

---

## Paso 1: leer la configuración

```
ai-workspace.json
```

De ahí sale todo: los repositorios y sus rutas, sus packs, sus ramas base, los harnesses que usa el equipo, los slots de worktree disponibles y el prefijo de ticket.

**Nunca asumir nombres de repositorio.** Este archivo no conoce ninguno.

---

## Paso 2: detectar el repositorio objetivo

Inferir a partir de lo que pidió la persona, en este orden:

1. **Mención explícita** de un repositorio declarado, o de un alias habitual (BE, backend, API; FE, frontend, app, UI).
2. **Vocabulario del pack.** Cada pack tiene términos que lo delatan: si la tarea habla de endpoints, migraciones o modelos de datos, es el repositorio con el pack de backend; si habla de componentes, páginas o formularios, el de frontend.
3. **Rutas de archivo** mencionadas en el pedido.

Si después de eso sigue habiendo ambigüedad, **preguntar**. Elegir mal el repositorio hace que todo el trabajo posterior se haga en el lugar equivocado.

Si la tarea afecta a **varios** repositorios, no elegir uno: ir al flujo cruzado del Paso 4.

---

## Paso 3: cargar el contexto

Una vez resuelto el repositorio, cargar en este orden:

1. Las reglas transversales: `ai/core/rules/`.
2. Los procedimientos que aplican al tipo de tarea, del núcleo y de los packs de ese repositorio.
3. La documentación propia del repositorio, si tiene.

**Cargar solo lo que la tarea necesita.** Cargar todo por las dudas gasta contexto en cada turno de la sesión, no solo en el primero.

---

## Paso 4: tareas que cruzan varios repositorios

Cuando el cambio afecta a más de un repositorio, el orden importa:

1. **Primero el que define el contrato** — típicamente el backend: quién expone qué, con qué forma de datos.
2. Ese contrato queda escrito en algún lado antes de que empiece el trabajo del consumidor. Si no está escrito, el consumidor va a adivinar, y va a adivinar mal.
3. **Después el que lo consume**, leyendo el contrato como fuente de verdad y no como sugerencia.
4. **Un commit por repositorio**, con el mismo identificador de ticket y módulo distinto.

Si en medio del trabajo del consumidor aparece un defecto del proveedor, se arregla en el proveedor y se commitea ahí. No se compensa del lado del consumidor: eso esconde el defecto y lo duplica en el próximo consumidor.

---

## Paso 5: trabajo paralelo

Si ya hay trabajo activo en un repositorio y llega una tarea distinta, **no mover la rama principal**. Usar un slot de worktree, según el procedimiento `worktree-slots` y los slots declarados en `worktrees.slots`.

Los slots se limpian solo ante una orden explícita de la persona, y nunca a la fuerza.

---

## Restricciones

1. **No implementa.** Enruta, carga contexto y coordina.
2. No mueve ramas ni hace `git checkout` fuera del mecanismo de slots.
3. No commitea. El commit lo hace el procedimiento `git-commit-workflow`, y solo con pedido explícito de la persona.
4. Ante ambigüedad sobre el repositorio objetivo, pregunta. No adivina.
