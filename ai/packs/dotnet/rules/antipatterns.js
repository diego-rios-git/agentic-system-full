/**
 * Anti-patrones de C# / .NET.
 *
 * Cada regla es **angosta y correcta**. Una regla ancha y ruidosa enseña al
 * equipo a ignorar los avisos, y ahí se pierde el gate entero — no solo esa
 * regla. Ver `ai/core/procedures/gate-from-finding.md`.
 *
 * Las tres que están acá comparten una propiedad: el código compila, pasa la
 * revisión visual, y falla en producción de una forma que no apunta a su causa.
 * Un `.Result` no se rompe en la máquina de quien lo escribió; se rompe bajo
 * carga, en un servidor, sin excepción y sin registro.
 */

'use strict';

module.exports = [
  {
    id: 'NET-1.1',
    title: 'async void fuera de un manejador de eventos',
    why:
      'Una excepción dentro de un `async void` no se puede capturar desde afuera: no hay Task ' +
      'que esperar ni observar. Se propaga al contexto de sincronización y termina el proceso. ' +
      'Devolver `Task` — o `ValueTask` — para que quien llama pueda esperarla y manejarla.',
    test: (line) => {
      if (!/\basync\s+void\s+\w+\s*\(/.test(line)) return false;
      // Los manejadores de eventos son la única firma donde `async void` es
      // obligatorio: el delegado del evento devuelve void y no hay alternativa.
      return !/\b(object\s+sender|EventArgs|EventHandler)\b/.test(line);
    },
  },

  {
    id: 'NET-1.2',
    title: 'Espera sincrónica sobre una tarea',
    why:
      '`.Result`, `.Wait()` y `.GetAwaiter().GetResult()` bloquean el hilo mientras la tarea ' +
      'necesita ese mismo hilo para continuar. El resultado es un bloqueo mutuo que no aparece ' +
      'en desarrollo y sí bajo carga, sin excepción y sin registro. Propagar `await` hacia ' +
      'arriba hasta el borde asincrónico.',
    test: (line) => {
      if (/\.GetAwaiter\(\)\s*\.GetResult\(\)/.test(line)) return true;
      if (/\.Wait\(\s*\)/.test(line) && !/\bWaitHandle|\bMonitor\b|\bTask\.WaitAll/.test(line)) return true;

      // `.Result` es ambiguo: también es la propiedad de un `IActionResult`, de
      // un `OperationResult` propio y de cualquier tipo con esa forma. Solo se
      // marca cuando la línea muestra que hay una tarea de por medio.
      if (!/\.Result\b/.test(line)) return false;
      // Sin `\b` antes de `Async`: la convención de .NET es sufijar el nombre
      // del método, así que en `ObtenerAsync()` no hay límite de palabra donde
      // empieza `Async` — el caso más común de todos quedaba sin marcar.
      return /(Async\s*\(|Task[<.]|ContinueWith|Task\.Run|Task\.FromResult)/.test(line);
    },
    // `Main` puede bloquear legítimamente: es el borde del proceso, y antes de
    // C# 7.1 no había otra forma de arrancar código asincrónico.
    skipFile: (rel) => /(^|\/)Program\.cs$/.test(rel),
  },

  {
    id: 'NET-1.3',
    title: 'SQL construido por interpolación o concatenación',
    why:
      'Un valor interpolado dentro de `FromSqlRaw`, `ExecuteSqlRaw` o un `CommandText` es ' +
      'inyección de SQL: el contenido de la variable pasa a ser parte de la consulta. Usar ' +
      '`FromSqlInterpolated` / `ExecuteSqlInterpolated`, que parametrizan el valor, o pasar ' +
      'los parámetros explícitamente.',
    test: (line) => {
      // Interpolación o concatenación dentro de la llamada cruda de EF Core.
      if (/\b(FromSqlRaw|ExecuteSqlRaw|ExecuteSqlRawAsync|FromSqlRawAsync)\s*\(\s*\$?"/.test(line)) {
        return /\$"/.test(line) || /"\s*\+/.test(line);
      }
      // Dapper y ADO.NET crudo: el SQL se arma en la propia línea.
      if (/\bCommandText\s*=\s*\$"/.test(line)) return true;
      if (/\b(Query|Execute)(Async|FirstOrDefault|Single)?\w*\s*\(\s*\$"\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(line)) {
        return true;
      }
      return false;
    },
  },
];
