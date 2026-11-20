# Regla — Datos sensibles y qué hacer si se filtran

**Fuente única de verdad.** Cualquier otra descripción de qué no se comparte con una IA queda subordinada a este archivo.

---

## La regla

**Si no lo pegarías en un ticket que puede leer cualquiera, no lo pegues en un prompt.**

Todo lo que entra en una conversación con una IA sale de la máquina. Aunque el proveedor no entrene con esos datos, salieron: viajaron por la red, quedaron en un historial y pueden persistir en un registro al que no tenés acceso.

---

## Nunca se comparte

| Categoría | Qué incluye |
|---|---|
| **Secretos y credenciales** | Contenido de archivos de entorno, claves de API de cualquier integración, tokens de sesión reales, contraseñas, cadenas de conexión, claves de cifrado y sus sales |
| **Datos personales** | Nombre y documento de una persona real, datos bancarios, dirección, teléfono, correo, y cualquier historial que permita identificar a alguien |
| **Datos de clientes** | El nombre real de un cliente junto con sus volúmenes, condiciones comerciales o credenciales de integración |
| **Volcados de datos** | Copias de base de datos, exportaciones de tablas, registros de producción sin anonimizar, capturas de pantalla con datos reales |

## Sí se comparte

El esquema y los nombres de columnas, la estructura de un contrato de datos, un mensaje de error sin su carga útil, un registro de ejemplo **inventado**, el código de la aplicación y sus especificaciones.

Cuando necesitás un caso real para reproducir un fallo, compartí **la forma del dato, no el dato**:

```
amount:      "10000.00"
customer_id: <uuid>
name:        "Cliente A"
account:     "0000000000000000000000"
```

---

## Si ya compartiste algo que no correspondía

Cuatro pasos. **El orden importa: primero se corta la exposición, después se avisa.**

### 1. Si era una credencial, rotala ya

Antes que cualquier otra cosa. Una credencial expuesta sigue expuesta aunque borres el mensaje: asumí que alguien la tiene.

| Qué se filtró | Qué hacer |
|---|---|
| Clave de API de una integración | Rotar en el proveedor y actualizar el secreto en el entorno |
| Token de sesión de un usuario real | Invalidar la sesión de ese usuario |
| Contraseña o cadena de conexión de base de datos | Cambiar la credencial y revisar los accesos recientes |
| Clave de un servicio externo | Rotar en el proveedor |

### 2. Avisá al AI Technical Lead

En el momento, por el canal más rápido que tengas. No esperes a tener el diagnóstico completo: avisá primero y averiguá después.

Decí tres cosas: **qué se filtró**, **a qué herramienta**, y **si ya rotaste la credencial**.

### 3. No borres el historial

Borrar el mensaje no borra el dato de donde haya quedado, y sí destruye la evidencia de qué se expuso exactamente. Se necesita para dimensionar el alcance.

### 4. Se registra

El AI Technical Lead anota el incidente: qué se filtró, cuándo, a qué herramienta, y qué se hizo. Sirve para dos cosas: saber si un patrón se repite, y ajustar esta regla si el caso no estaba contemplado.

---

## Lo que no pasa

**Compartir un dato por error no tiene consecuencias disciplinarias.** Se reporta para contener el daño, no para buscar responsables. Una regla que da miedo reportar produce incidentes ocultos, que son peores que los conocidos.

Lo que sí es un problema es **no avisar**: convierte un incidente contenible en uno que nadie está mirando.

---

## Contexto particular del proyecto

> **Completá esta sección.** Cada proyecto tiene un tipo de dato que es el más fácil de filtrar sin pensarlo, y nombrarlo explícitamente vale más que toda la tabla de arriba.
>
> Escribí acá qué dato maneja este proyecto que identifica a una persona o a un cliente real, y cuál es el gesto cotidiano que lo expone — adjuntar una captura, pegar una fila de una consulta, copiar un registro de error completo.
>
> Esta sección vive en el proyecto, no en la base: ponela en `ai/local/rules/` para que una actualización de la plantilla no la pise.

---

## Verificación automática

Esta regla no depende de que alguien se acuerde: `scripts/hooks/pre-write-secrets.js` corre antes de cada escritura y la bloquea si el contenido tiene forma de secreto. Ver `scripts/check-secrets.js` para las reglas que detecta.

Es una heurística, no un parser de credenciales: puede dejar pasar un secreto con un nombre de variable que no reconoce. El hook reduce el riesgo, no lo elimina.
