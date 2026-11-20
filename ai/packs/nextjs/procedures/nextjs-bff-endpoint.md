# Endpoint del backend para el frontend

Manejadores de ruta que median entre el navegador y los servicios internos.

---

## Por qué existe esta capa

**El navegador nunca habla directamente con la API interna.** Todo pasa por un manejador de ruta del propio frontend.

Tres motivos concretos:

1. **Las credenciales no llegan al navegador.** El token de servicio vive en el servidor; el navegador solo lleva una cookie de sesión que no puede leer.
2. **El contrato se adapta.** El frontend pide lo que necesita mostrar, no lo que la API decidió exponer.
3. **Se puede cambiar el backend sin tocar el cliente.**

---

## Sesión

**El token de sesión va en una cookie inaccesible desde JavaScript.** Nunca en almacenamiento local ni de sesión: cualquier script inyectado en la página lo lee.

La cookie se marca además como segura y con política de mismo sitio.

---

## Estructura

```ts
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const params = parseQuery(request);      // validar lo que entra
  const data = await api.get('/recursos', { params, token: session.token });

  return Response.json(toClientShape(data));
}
```

Reglas:

- **Validar lo que entra**, incluso viniendo del propio frontend. Un parámetro llega desde el navegador, y el navegador está bajo control de quien lo usa.
- **No reenviar el error interno tal cual.** Traducirlo: el mensaje de la API puede exponer estructura interna.
- **No registrar la carga útil completa** de la petición ni de la respuesta: puede traer credenciales o datos personales.

---

## Errores

Mapear cada error del servicio interno a una respuesta que el cliente pueda usar:

| Del servicio | Al cliente | Qué ve la persona |
|---|---|---|
| 401 | 401 | Sesión vencida, hay que volver a entrar |
| 403 | 403 | No tiene permiso |
| 404 | 404 | No existe |
| 409 | 409 | Conflicto — el mensaje del dominio sirve |
| 5xx | 502 | Algo falló del otro lado, reintentar |
| Sin respuesta | 504 | El servicio no respondió |

**Un error del servicio no es un error del frontend.** Devolver 500 para todo hace que el cliente no pueda distinguir "no tenés permiso" de "se cayó el servidor", y termine mostrando el mismo mensaje inútil para ambos.

---

## Lo que no va acá

- **Lógica de negocio.** Si el manejador decide algo que debería decidir el servicio, esa regla queda duplicada y las dos copias se van a separar.
- **Acceso directo a la base de datos**, salteando el servicio.
- **Cachés propias** sin una razón explícita: dos capas de caché con vidas distintas producen incoherencias imposibles de reproducir.
