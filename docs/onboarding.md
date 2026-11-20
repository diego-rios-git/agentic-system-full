# Onboarding

Veinticinco minutos, y terminás con el sistema funcionando, con el contexto de tu proyecto cargado y todo verificado.

Si algo no sale como dice acá, **es un problema de esta guía, no tuyo**. Avisá.

---

## 1. Requisitos (2 min)

```bash
node --version   # 18 o superior
git --version
```

Nada más. La base corre con Node pelado, sin instalar dependencias: es a propósito, para que el primer paso no sea pelear con un gestor de paquetes.

Node es para las herramientas de la base, **no para tu proyecto**: el proyecto puede ser Python, Angular, Go o lo que sea. Si tu stack no tiene pack, ver [`stack-sin-pack.md`](stack-sin-pack.md).

---

## 2. Obtener la base (3 min)

**No clones el repositorio de la base para trabajar.** Usá el botón *Use this template* en GitHub: eso te genera **tu propio repositorio**, sin historial compartido, donde tenés permiso de escritura.

Después:

```bash
git clone <url-de-tu-repositorio> mi-proyecto
cd mi-proyecto
```

---

## 3. Instalar (5 min)

```bash
node init.js
```

Te va a preguntar:

| Pregunta | Qué contestar |
|---|---|
| Nombre del proyecto | En minúsculas y guiones |
| Prefijo de ticket | El que usan en las ramas, sin el número. Si no usan tickets, decí que no |
| Topología | Varios repositorios, o uno solo |
| Repositorios | Nombre, directorio, stack y rama base de cada uno. Elegí solo los packs que te sirven; si ninguno cubre tu stack, no elijas ninguno y escribí cuál es |
| Harnesses | Qué herramientas de IA usa el equipo |

Al terminar tenés: la configuración, los packs elegidos, los documentos generados, los punteros de cada harness y los baselines calibrados.

**Ese último paso importa más de lo que parece.** Si instalás sobre un proyecto que ya tiene código, los gates encontrarían cientos de hallazgos preexistentes el primer día. Eso se lee como ruido, se apagan, y no se prenden nunca más. El `init` congela esa deuda para que el gate hable **solo de lo que agregues desde ahora**.

---

## 3b. Cargar el proyecto (5 min)

El paso anterior instaló la **estructura**. Este carga el **contenido**: qué es tu proyecto.

En tu sesión de IA:

```
Usá el skill project-loader.

Resumen: <dos o tres frases sobre qué vas a construir y para quién>
```

El agente lee tu código antes de preguntar, hace hasta cuatro preguntas por vez, y escribe en `ai/local/` el brief del proyecto, el glosario del dominio, las reglas duras y qué datos son sensibles acá.

**No lo saltees.** Sin esto el sistema queda genérico: sabe cómo se hace un módulo de backend, pero no sabe qué significa "reserva" en tu dominio ni qué nunca debe pasar. Un agente sin contexto no falla de forma visible — produce código plausible que no corresponde al negocio.

---

## 4. Clonar los repositorios de aplicación (3 min)

Solo si elegiste varios repositorios. Se clonan **adentro** del workspace, cada uno con su propio git:

```bash
git clone <url> mi-api
git clone <url> mi-app
```

Están excluidos del control de versiones del workspace: son proyectos independientes.

---

## 5. Tu configuración personal (1 min)

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

Ahí va **tu** nivel de permisos y **tu** modelo. No se versiona: cada persona decide su propio nivel de riesgo, y compartirlo impondría el criterio de quien lo escribió primero.

---

## 6. Verificar que funciona (6 min)

Tres comandos. Los tres tienen que pasar.

### Los punteros están sincronizados

```bash
node scripts/consolidate-skills.js --check
```

Espera: `Punteros sincronizados con la fuente.`

### Los gates corren

```bash
node scripts/run-gates.js --all
```

Espera un bloque por repositorio. **Leelo, no lo saltees.** Si dice que un gate *no se pudo ejecutar* o *no corrió*, eso es **sin verificar**, no *sin hallazgos*. Un gate roto que se lee como limpio es peor que no tenerlo.

### El hook de escritura funciona

Creá un archivo cualquiera bajo `ai/local/` cuyo contenido cite, entre comillas invertidas, una ruta que no exista — por ejemplo un procedimiento inventado dentro de `ai/core/procedures/`.

Si tu herramienta tiene los hooks conectados, al escribirlo te va a avisar que esa ruta no existe. Borrá el archivo después de comprobarlo.

Una ruta rota no da error visible: el agente falla la lectura y después improvisa. Por eso hay un gate.

---

## 7. Tu primera tarea

Abrí la sesión de IA **desde la raíz del workspace**, no desde adentro de un repositorio. Ahí es donde está el contexto completo.

Leé `docs/sistema-agentico.md`: son diez minutos y es la diferencia entre pedir bien y pelear con el agente.

---

## Si algo falló

| Síntoma | Qué mirar |
|---|---|
| `Configuración inválida` | El mensaje dice exactamente qué campo está mal en `ai-workspace.json` |
| `Punteros fuera de sincronía` | Alguien editó un puntero a mano. Corré `--wrappers` para regenerarlos |
| Un gate dice "no se pudo ejecutar" | El script existe pero falló. Corrélo suelto para ver el error real |
| `jscpd no disponible` | Necesita red la primera vez. No bloquea nada más |
| El agente no encuentra un procedimiento | `node scripts/consolidate-skills.js --list` te dice qué hay instalado y de dónde salió |

---

## Lo que conviene saber desde el principio

**El contenido vive una sola vez.** Los archivos en `.claude/` y `.opencode/` son punteros generados. Para cambiar el comportamiento de un skill, editás la fuente en `ai/` y regenerás. Editar un puntero lo cambia en un solo harness y lo deja distinto del resto.

**Los gates solo reportan lo nuevo.** La deuda que ya estaba está congelada. Si un gate te marca algo, lo introdujiste vos.

**Nada se commitea solo.** El agente no hace `git commit` salvo que se lo pidas explícitamente, y ese pedido incluye el push.

**Lo que adaptes en `ai/local/` es tuyo para siempre.** Una actualización de la base nunca lo toca.
