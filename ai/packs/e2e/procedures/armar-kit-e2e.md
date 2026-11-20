# Armar el kit de pruebas de punta a punta del proyecto

Guía para que una persona, o un agente sin contexto, deje armado **el kit** con el que el proyecto corre `prueba-e2e`: los helpers que se repiten en todos los scripts, la plantilla, la guía y la configuración del linter de scripts.

El procedimiento `prueba-e2e` dice **qué** hacer en cada paso. Este dice **cómo se arma lo que lo hace posible** en *tu* stack. No trae helpers de dominio de ningún proyecto: trae el contrato que cada helper debe cumplir y el porqué, y vos lo escribís en el lenguaje y el framework de tu proyecto.

---

## El problema

Sin kit, cada script de prueba reinventa lo mismo, y lo reinventa mal en una de las formas conocidas:

- **Esperas fijas** (`sleep 3`) que andan en una máquina y fallan en otra.
- **Un límite de frecuencia** (HTTP 429) que tumba la corrida a la mitad, porque no hay reintento y el script no sabe esperar.
- **Datos por nombre**: el script entra con un usuario que existe en la base de quien lo escribió y no en la de nadie más.
- **Fechas con la zona de la máquina**: la interfaz muestra la de una zona y el script calcula "hoy" con otra, y la prueba falla dos horas por día.
- **Un 17/17 con una captura que mostraba un texto cortado.**
- **Datos escritos con `INSERT`**, que se saltan las reglas del producto y no prueban nada del flujo.

Y el resultado de cada incidente se pierde: la guía que lo explicaba se borró un día y el agente siguiente no sabía cómo se hacía. El kit y la guía son el lugar donde esas lecciones **quedan**.

---

## Qué se entrega y dónde

| Pieza | Dónde queda |
|---|---|
| La guía del proyecto (`e2e-guia.md`), con bitácora y anexos | `ai/local/references/` |
| El kit: helpers, plantilla y descubridor de datos | La carpeta de pruebas del proyecto (la que declara `e2e.dir`) |
| La configuración del linter de scripts | `e2e` en `ai-workspace.json` |
| Los scripts de cada ticket | Una subcarpeta local, **fuera del control de versiones** (`.gitignore`) |
| Un `prueba-e2e` propio, si hace falta cambiar pasos | Un procedimiento `prueba-e2e.md` en `ai/local/procedures/` (reemplaza al de la base) |

Nada de esto se escribe en `ai/core/` ni en `ai/packs/`: la próxima actualización de la base lo pisaría.

---

## Método

### Paso 1: entender cómo corre el proyecto

Antes de escribir nada, contestá leyendo el repositorio (los `README`, los archivos de composición, los scripts de arranque, la configuración de las pruebas existentes):

1. ¿Cómo se levanta todo, en qué orden, en qué puertos, y cómo sé que está listo?
2. ¿Qué base y qué servicios son compartidos con otros espacios de trabajo? (Por eso se corre solo en la principal.)
3. ¿Cómo se entra: qué roles hay, dónde están sus credenciales, hay segundo factor, hay límite de intentos?
4. ¿Qué framework de navegador hay ya (Playwright, Cypress, Selenium)? Si ya hay uno, **se usa ese**.
5. ¿Hay procesos programados, cachés o límites de frecuencia que cambien lo que se ve?
6. ¿En qué zona horaria muestra las fechas la interfaz?

Lo que no puedas contestar leyendo, se le pregunta a la persona **una vez** y la respuesta va a la guía.

### Paso 2: la guía primero

Creá `e2e-guia.md` en `ai/local/references/` con las respuestas de arriba, un tema por sección (arranque, login, datos, navegador, base, procesos programados, fechas, limpieza, capturas), y una sección final de **bitácora** y de **lecciones → destino**. Cada punto: regla, ejemplo y porqué, **sin nombres de ninguna base ni credenciales**.

La guía va antes que el código. Es lo único que no se vuelve a descubrir.

### Paso 3: los helpers del kit

Cada helper se escribe **una vez**, con un comentario que diga el porqué. Lenguaje y framework: los del proyecto. Contratos:

| Helper | Contrato | Por qué |
|---|---|---|
| **Resultado de un escenario** | Un objeto con un ID, un estado (`OK`, `FALLA`, `NO CONCLUYENTE`), el motivo y la evidencia. Un resumen que imprime la tabla y devuelve el código de salida | El código de salida **0 todo OK, 1 algo FALLA, 2 NO CONCLUYENTE** es lo que lee quien lo corre. El 2 existe para que "no pude probar" no se lea como verde |
| **Cliente HTTP con reintento ante 429** | Ante un 429 espera lo que diga la cabecera de reintento (o un tiempo fijo documentado) y reintenta con un tope. Todo reintento queda anotado | Un límite de frecuencia no es un fallo del producto: tumbar la corrida por eso es perder la hora |
| **Estado entre corridas** | Un archivo local (no versionado) donde el script anota lo que cambió **antes** de cambiarlo (interruptores, configuraciones) y desde donde la limpieza lo restaura | La limpieza no puede depender de que el script llegue al final |
| **Fechas con zona** | `hoy()` y las conversiones usan la zona de la interfaz, nunca la de la máquina; ninguna fecha sin zona | Incidente: la interfaz mostraba el día anterior a medianoche UTC y la prueba falló "a veces" |
| **Datos por rol** | Un descubridor que busca en *tu* base un dato que cumpla un rol (`cliente("con_retiros")`, `persona("admin")`) y devuelve identificadores; si falta, dice cómo conseguirlo **usando el producto**. Nunca un nombre, un correo ni un id escritos a mano | En la base de otra persona los nombres no existen |
| **Credenciales** | Se leen del entorno (una variable por usuario) y **nunca se imprimen**; si faltan, se piden a la persona | Ver `ai/core/rules/datos-sensibles.md` |
| **Navegador** | Abrir un contexto por persona, guardar y reusar la sesión, elegir una opción de un select personalizado (clic y opción visible), esperar un toast o un elemento, sacar una captura con nombre y número | Los selects nativos y la espera de URL se cuelgan con muchos design systems y routers del lado del cliente: el linter los marca |
| **Capturas** | Una carpeta por corrida, con un nombre que el reporte pueda citar | El paso de mirar las capturas las necesita |
| **Escritura autorizada** | El **único** camino para escribir directo en la base: exige motivo y quién lo autorizó, y los deja en el reporte | `prueba-e2e` prohíbe el `INSERT` por cuenta propia: esto es la válvula con rastro |
| **Lectura de la base** | Una consulta de solo lectura que devuelve filas, para verificar el efecto de cada escritura | Un 200 no prueba que se guardó |
| **Corte de procesos** | Cortar por árbol lo que el script lanzó, y verificar que el puerto quedó libre | Un proceso huérfano ocupa el puerto de la corrida siguiente |

Un helper que no tenga cabida en este contrato (porque es de tu dominio) va al kit **de tu proyecto**, con el mismo criterio: sin datos de una base, con el porqué en un comentario.

### Paso 4: la plantilla

Un script que **corre solo**: el escenario P0 (el entorno responde) más un escenario de ejemplo de solo lectura, y devuelve 0, 1 o 2. Al arrancar, se revisa con el linter de scripts y, si tiene hallazgos, no corre:

```bash
node ai/packs/e2e/scripts/check-e2e-scripts.js <script>
```

Un ticket copia la plantilla, no la edita.

### Paso 5: configurar el linter de scripts

En `ai-workspace.json`:

```jsonc
"e2e": {
  "dir": "tests/e2e",                              // donde viven el kit y los scripts
  "paths": ["ai/local/references/*.md"],          // más archivos, carpetas o globs (la guía también se revisa)
  "forbiddenData": ["@miempresa\\.local", "Cliente Real S\\.A\\."],   // datos concretos de tu base que no pueden aparecer
  "authorizedWriteHelper": "escribir_autorizado", // el nombre del helper de escritura autorizada
  "authorizedWriteFiles": ["tests/e2e/kit/*.py"]  // los archivos que lo DEFINEN
}
```

Sin esta sección el linter dice **NO APLICA** (explícitamente) y las reglas portables siguen valiendo cuando le pasás un archivo. Declararlo como gate del proyecto es una línea en el manifiesto del pack `e2e`.

El linter revisa por línea, sin ejecutar: espera fija sin `espera: <motivo>`, llamadas que se cuelgan, fechas sin zona, el texto de un diálogo o de una página entera como aserción, procesos que nadie corta, escrituras directas en la base y datos de una base ajena. Una línea se aparta con `e2e-ok(<REGLA>): <motivo>`; sin motivo no cuenta.

### Paso 6: la prueba de que anda

Corré `node ai/packs/e2e/scripts/check-e2e-scripts.js --autoprueba`: tiene que dar todos los casos como se esperaba. Después sumá **tus** casos: cuando una lección de una prueba se vea leyendo el script, es una regla del linter (`prueba-e2e`, paso 9) y entra con su caso que marca y su caso que no.

---

## Lo que NO se copia

- **Helpers de dominio** de otro proyecto (cómo se crea un pedido, un retiro, una cita): son de ese dominio.
- **Nombres, correos o identificadores** de la base de quien escribió el kit.
- **La skill `webapp-testing`**: es una referencia **opcional** para el lado del navegador, y no se copia a este repositorio. Es Playwright en Python, con licencia **Apache 2.0**: se puede usar y redistribuir **conservando su archivo `LICENSE` y sus avisos**. Si tu proyecto usa Playwright, leela para ver cómo levanta y detiene un servidor alrededor de un script (su script `with_server`, en la carpeta `scripts` de esa skill) y su método de reconocer la página antes de actuar. Ojo: sus ejemplos esperan `networkidle`, que el linter de este pack marca porque se cuelga con muchas aplicaciones; adaptalo a esperar un elemento visible. Si querés adoptarla, instalala **entera** (con su licencia) en el lugar donde tu herramienta busca skills, no mezclada con la base.

---

## Cómo sé que lo adapté bien

- [ ] La guía existe en `ai/local/references/`, y un agente sin contexto levanta la aplicación y corre P0 solo con ella.
- [ ] La guía y el kit no contienen un nombre, un correo ni un identificador de ninguna base, ni una contraseña.
- [ ] La plantilla corre y devuelve 0 con el entorno arriba, y **2** con un servicio apagado.
- [ ] Cada helper de la tabla del paso 3 existe (o hay una razón escrita para que no exista) y dice su porqué.
- [ ] El `e2e` de `ai-workspace.json` está declarado, y el linter marca un script de prueba con una espera fija y con un `INSERT`.
- [ ] `--autoprueba` da todos los casos como se esperaba.
- [ ] Los scripts de un ticket están fuera del control de versiones; el kit, dentro.

## Cómo verificarlo

1. Apagá un servicio y corré la plantilla: `echo $?` tiene que dar 2.
2. Escribí un script con `time.sleep(5)` (o `waitForTimeout(5000)`): el linter tiene que marcarlo y no dejarlo correr. Agregale `# espera: <motivo>` y tiene que dejar de marcarlo.
3. Escribí un `INSERT` en un script: tiene que marcarlo. Pasalo por el helper autorizado: ya no.
4. Poné un correo de la lista `forbiddenData` en la guía: tiene que marcarlo.
5. Dale la guía a otro agente, sin contexto, y pedile un escenario simple. Cada pregunta que haga es un punto que falta.

## Dónde dejar el resultado

Todo en `ai/local/` y en la carpeta de pruebas del proyecto. Si descubriste algo que sirve a **cualquier** proyecto (una trampa de un framework, una regla nueva del linter), no lo dejes solo acá: proponelo a la base con `gate-from-finding` y `ai/core/rules/autoria-de-activos.md`.
