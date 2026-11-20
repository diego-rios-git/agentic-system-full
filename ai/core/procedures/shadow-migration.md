# Generar migraciones contra una base descartable (método sombra)

Guía para adaptar, a la pila de ESTE proyecto, la forma segura de generar una migración de esquema cuando la base de desarrollo es una sola para el repositorio principal y todos los slots de trabajo. No es un script que se corre tal cual: es el método, el porqué, y los pasos para armar el comando propio y comprobar que funciona.

**Cuándo se usa:** el proyecto declara `repos[].database` en `ai-workspace.json` (hay una base compartida) y trabaja con slots. Si la base no es compartida, o no hay slots, no hace falta.

**Solo con pedido explícito de la persona**, igual que cualquier migración: que una tarea necesite un cambio de esquema no habilita generarlo. Se avisa y se espera la orden. Ver el procedimiento de migraciones del stack (`nestjs-create-migration`, `dotnet-create-migration`).

---

## El problema

La herramienta de migraciones del ORM genera comparando **el modelo del código contra el esquema REAL de la base a la que se conecta**. Si la base es una sola para todos:

- una rama que migró dejó en la base tablas y columnas que las otras ramas todavía no tienen en su código;
- la segunda rama genera su migración contra un esquema que ya incluye lo de la primera, y la herramienta propone **borrar** lo que hizo la otra (`DROP` de lo de otro);
- peor: si la segunda migra de verdad, el esquema de todos cambia con código que todavía no está en la rama base.

Ya pasó: dos ramas migrando sobre la misma base se pisaron, y el archivo generado traía el `DROP` del trabajo ajeno. Por eso el hook `pre-bash-slot-migrations` bloquea, desde un slot, migrar, revertir, correr seeds y generar contra la base compartida, y redirige al comando que este proyecto declare en `repos[].database.generateAlternative`. Ese comando es lo que esta guía te ayuda a tener.

## El método

1. **Crear una base descartable vacía**, con un nombre propio del lugar (`<proyecto>_shadow_<slot>` o `_principal`): una por lugar, así dos slots pueden generar a la vez.
2. **Construir en ella el esquema de LA RAMA**, corriendo solo las migraciones que la rama tiene, desde cero. Si no construyen el esquema desde una base vacía, eso es un problema de la rama o del historial, y se avisa: no se arregla en la sombra.
3. **Generar la migración contra la sombra.** La diferencia es exactamente lo que la rama cambió, y es lo mismo que va a ver producción, que también se construye solo con migraciones. El archivo queda en la rama.
4. **Borrar la sombra SIEMPRE**, aunque algo haya fallado en cualquier punto (`finally`). Una sombra que queda es basura que se acumula, y una que se reusa sin recrear arrastra el estado de la corrida anterior.
5. **Avisar de lo que hay que mirar** en el archivo: cualquier `DROP`, cualquier renombre expresado como borrar + crear, y el *drift conocido* del proyecto (diferencias entre el modelo y las migraciones que son aceptadas y NO pertenecen a esta rama).

No se toca la base de desarrollo en ningún momento: ni se lee ni se escribe.

La conexión sale de la configuración del repositorio **principal** (un slot no tiene `.env`: está en `.gitignore` y un worktree no lo hereda), cambiando solo el nombre de la base. No se imprime nada de esa configuración.

## Si el proyecto usa TypeORM + PostgreSQL

Ya está hecho: `node ai/packs/nestjs/scripts/migration-generate-shadow.js <PascalCase> [--from <slot>] [--repo <repo>]`. Declaralo en `ai-workspace.json` (ver "Dónde dejar el resultado") y listo. Leé igual la sección de verificación.

## Si usa otro ORM u otro motor: adaptarlo

Copiá ese script como base a `ai/local/scripts/` (o `scripts/` del proyecto) y cambiá lo que depende de la pila. Qué responder, por pila:

| Pregunta | TypeORM | Prisma | Alembic | EF Core | Flyway / Liquibase |
|---|---|---|---|---|---|
| Qué comando construye el esquema de la rama | `migration:run` | `migrate deploy` | `alembic upgrade head` | `dotnet ef database update` | `flyway migrate` |
| Qué comando genera contra la base | `migration:generate <ruta>` | `migrate dev --create-only --name <n>` | `alembic revision --autogenerate -m <n>` | `dotnet ef migrations add <n>` | no genera: se escribe a mano (ver nota) |
| Cómo se le pasa la conexión | variables de entorno que lee el data source | `DATABASE_URL` | `sqlalchemy.url` / variable que lee `env.py` | cadena de conexión por variable de entorno o `--connection` | `-url`, `-user`, `-password` |
| Cómo se crea la base descartable | `CREATE DATABASE` desde `postgres` | ídem (o `shadowDatabaseUrl`) | ídem | ídem | ídem |
| Cómo se detecta "no hay cambios" | mensaje "No changes in database schema were found" | el comando lo informa | sale la revisión vacía | genera una migración vacía: hay que mirar el contenido | no aplica |

Notas por motor:

- **PostgreSQL:** `CREATE DATABASE "<nombre>" TEMPLATE template0` y `DROP DATABASE IF EXISTS "<nombre>"`, conectando a la base `postgres`. Hace falta el permiso `CREATEDB`; si falta, el script tiene que decirlo y no tocar nada.
- **SQL Server / MySQL:** mismo patrón con `CREATE DATABASE` / `DROP DATABASE`; el nombre de la base de administración cambia (`master`, `mysql`).
- **SQLite:** la sombra es un archivo temporal; "borrarla" es borrar el archivo.
- **Prisma** ya trae una base sombra propia (`shadowDatabaseUrl`) para `migrate dev`, pero la usa para validar el historial, no para aislar de la base compartida: leé qué conexión usa cada comando antes de confiar.
- **Flyway** no genera diffs: el método sombra sirve para *probar* que las migraciones escritas construyen el esquema desde cero, no para generarlas.

### Checklist de adaptación

Marcá cada punto antes de dar el comando por bueno:

- [ ] El nombre de la sombra sale de la config del proyecto o de una variable de entorno, no de un nombre fijo, y NUNCA puede coincidir con la base de desarrollo (comprobarlo y abortar si coincide).
- [ ] La conexión sale del repositorio principal, no del slot, y no se imprime nada de ella.
- [ ] La sombra se crea desde cero cada vez (si quedó una de una corrida cortada, es propia —lleva el prefijo— y se recrea).
- [ ] El borrado va en un `finally` (o equivalente) y **ninguna rama de error sale del programa antes de llegar ahí** (en Node, un `process.exit` dentro del `try` saltea el `finally`).
- [ ] Si no se puede borrar, avisa pero no cambia el resultado de la generación.
- [ ] Si las migraciones de la rama no construyen el esquema, falla con un mensaje que lo dice y borra la sombra.
- [ ] Si no hay cambios, lo dice, no deja ningún archivo y sale bien.
- [ ] Revisa el archivo generado y avisa de cada `DROP`, de los posibles renombres (borrar + crear) y del drift conocido.
- [ ] El nombre de la migración se valida y se pasa con la forma que la herramienta espera (la trampa habitual es un `--name=` que la herramienta ignora y genera un nombre por defecto).
- [ ] Usa las dependencias del propio proyecto (en un slot, las del principal por el enlace) y **nunca instala nada**.

## Cómo comprobar que lo adaptaste bien

Sin un servidor real todo lo que no es el motor se prueba con un fixture: un cliente de base y una herramienta de migraciones de mentira que registran lo que reciben (ver `test/migration-shadow.test.js`, que hace exactamente eso con el script de NestJS). Con el motor real, además, a mano y una vez:

1. **Camino feliz:** hacer un cambio mínimo al modelo, correr el comando, y comprobar que genera un archivo con solo ese cambio y que la sombra ya no existe (`\l` en `psql`, o el equivalente).
2. **Negativo A, falla a medio camino:** romper a propósito una migración de la rama (un SQL inválido) y correr. Tiene que fallar con un mensaje claro **y la sombra tiene que haberse borrado igual**.
3. **Negativo B, sin cambios:** correr sin tocar el modelo. Tiene que decir "no hay cambios", no dejar archivo y terminar bien.
4. **Negativo C, no toca la base compartida:** mirar el registro de la base (o hacer el cambio con la base de desarrollo apagada): el comando no puede conectarse a ella en ningún momento.
5. **Dos a la vez:** correr desde dos slots a la vez; cada uno usa su sombra y ninguno pisa al otro.

## Dónde dejar el resultado

1. El script, en `ai/local/scripts/` (si es del proyecto) o `scripts/` del proyecto. **No** en `ai/core/` ni en `ai/packs/`: eso lo actualiza la plantilla y pisaría tu adaptación.
2. Declarar el comando en `ai-workspace.json`, para que el hook redirija a él en vez de a un texto genérico:

```json
"repos": [{
  "name": "mi-api",
  "database": {
    "shared": true,
    "migrationsDir": "src/database/migrations",
    "writeCommands": ["migration:run", "migration:revert", "npm run seed"],
    "generateCommands": ["migration:generate"],
    "readOnlyAllowed": ["migration:show"],
    "generateAlternative": "node <ruta-a-tu-script> <Nombre> --from <slot>"
  }
}]
```

   Los comandos son los que el proyecto realmente corre (`dotnet ef database update`, `alembic upgrade`, `prisma migrate deploy`...), escritos como se escribirían, o un token suelto (`migration:run`) que coincide en cualquier comando que lo lleve. Un comando que no está declarado el hook no lo conoce.
3. Si el generador produce diferencias conocidas y aceptadas que NO son de la rama, anotarlas en un archivo `migration-known-drift.json` dentro de `ai/local/` (`[{ "pattern": "<regex sobre el up()>", "note": "qué es y qué hacer" }]`) para que el script las avise al terminar.
4. Probar que el hook ahora redirige: desde un slot, correr el comando de generar común tiene que quedar bloqueado y mostrar el comando alternativo.

## Después de generar

El archivo se **revisa entero** como dice el procedimiento del stack, no se edita sin autorización humana temporal (`node scripts/allow-protected-edit.js <archivo>`, lo corre el operador), y se corre **solo en el repositorio principal**, por orden del operador, después de llevar la rama (`node scripts/manage-worktree.js promote --slot <slot>`).

Recordá la ventana de despliegue: si el pipeline migra antes de desplegar, un `DROP` o un cambio incompatible rompe al código viejo mientras dure el despliegue.
