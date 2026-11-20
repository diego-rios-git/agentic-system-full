# Servidor o cliente

Decidir dónde corre cada componente en el App Router. Es la decisión con más consecuencias del stack: define qué llega al navegador, qué puede leer secretos y qué se puede cachear.

---

## Por defecto: servidor

Un componente es de servidor salvo que declare lo contrario. **Solo se marca como cliente cuando necesita algo que el servidor no puede dar:**

| Necesita | ¿Cliente? |
|---|---|
| Estado local, efectos, referencias | Sí |
| Manejadores de eventos — clic, cambio, envío | Sí |
| API del navegador — almacenamiento local, ventana, observadores | Sí |
| Un hook de una biblioteca que use lo anterior | Sí |
| Solo mostrar datos | **No** |
| Leer de la base o de un servicio interno | **No** |
| Usar un secreto o una credencial | **No, nunca** |

Marcar todo como cliente "por si acaso" manda al navegador código que no necesita estar ahí, y con él las dependencias que arrastra.

---

## La frontera se empuja hacia abajo

El error habitual es marcar como cliente una página entera porque un botón adentro necesita un manejador de eventos.

```tsx
// Mal: toda la página al navegador por un botón
'use client';
export default function Page({ data }) {
  return <><Header /><Table data={data} /><Button onClick={...} /></>;
}

// Bien: solo el botón
export default function Page({ data }) {
  return <><Header /><Table data={data} /><ActionButton /></>;
}
// ActionButton.tsx → 'use client'
```

**Un componente de servidor puede recibir a uno de cliente como hijo.** Eso permite que un contenedor de cliente envuelva contenido renderizado en el servidor, sin arrastrarlo al navegador.

---

## Lo que cruza la frontera se serializa

Las propiedades que un componente de servidor pasa a uno de cliente viajan por la red. Eso significa:

- **No pueden ser funciones, clases ni instancias.** Solo datos planos.
- **Todo lo que se pasa es visible** en el HTML enviado al navegador. Pasar un objeto entero del que el componente usa dos campos publica el resto.

Ese es el modo más silencioso de filtrar datos: nadie lo ve en la interfaz, pero está en el código fuente de la página.

---

## Roles y permisos

**La decisión de autorización va del lado del servidor.** Ocultar un botón en el cliente es una comodidad visual, no un control de acceso: quien quiera puede llamar a la acción igual.

Si un rol determina qué datos se muestran, el filtrado ocurre antes de que los datos salgan del servidor. Enviar todo y esconder la mitad en el navegador es una fuga.

---

## Hidratación

Cuando el servidor precarga datos y el cliente los reutiliza, ambos tienen que partir de **exactamente el mismo estado**. Una diferencia produce un parpadeo, o un error de hidratación que aparece solo en producción.

Precargar en el servidor y deshidratar en el cliente, con la misma clave de consulta en los dos lados. Si las claves difieren, el cliente vuelve a pedir todo y la precarga fue trabajo tirado.
