/**
 * Anti-patrones del pack `nestjs`.
 *
 * Cada regla nació de un error real que llegó a revisión o a producción. Antes
 * de agregar una, leer `ai/core/procedures/gate-from-finding.md`: hacen falta
 * un fixture que **debe** marcarse y otro casi idéntico que **no**.
 */

'use strict';

const fs = require('fs');
const path = require('path');

module.exports = [
  {
    id: 'NEST-1.1',
    title: 'Excepción genérica en vez del error del dominio',
    why:
      'Pierde el código estable y el estado HTTP: termina en un 500 aunque el cliente ' +
      'haya pedido algo que no existe. Usar la fábrica de errores del módulo.',
    test: (line) => /throw\s+new\s+Error\s*\(/.test(line),
  },
  {
    id: 'NEST-1.2',
    title: 'Bloqueo pesimista de escritura',
    why:
      'Serializa el acceso a la fila y degrada el rendimiento bajo carga. ' +
      'Preferir bloqueo optimista con una columna de versión.',
    test: (line) => /setLock\s*\(\s*['"]pessimistic_write['"]/.test(line),
  },
  {
    id: 'NEST-1.3',
    title: 'Límite fijo sin bucle ni cursor',
    why:
      'Un proceso por lotes con límite fijo procesa solo la primera página y deja el ' +
      'resto sin procesar, en silencio. Paginar con cursor o avanzar en un bucle.',
    test: (line, ctx) => {
      if (!/\btake:\s*\d+/.test(line)) return false;
      // Si hay un bucle o un cursor cerca, es paginación real.
      return !/\b(while|for)\s*\(/.test(ctx.before) && !/\bcursor\b/i.test(ctx.before);
    },
  },
  {
    id: 'NEST-1.4',
    title: 'Parámetro de ruta con identificador sin validar',
    why:
      'El segmento de la URL llega crudo al servicio. Un identificador con formato ' +
      'inválido revienta contra la base de datos y devuelve 500 en vez de 400. ' +
      'Validarlo en el parámetro con el pipe correspondiente.',
    test: (line) => {
      const m = /@Param\(\s*['"]([\w]*[iI]d)['"]\s*\)/.exec(line);
      if (!m) return false;
      // Si ya trae un pipe de validación como segundo argumento, está cubierto.
      return !/@Param\(\s*['"][\w]+['"]\s*,\s*\w/.test(line);
    },
  },
  {
    id: 'NEST-1.5',
    title: 'Sincronización automática de esquema',
    why:
      'Modifica el esquema sin migración y sin registro. Fuera de desarrollo puede ' +
      'borrar columnas con datos.',
    test: (line) => /synchronize\s*:\s*true/.test(line),
    skipFile: (rel) => /test|spec|\.local\./i.test(rel),
  },
  {
    id: 'NEST-2.1',
    kind: 'structure',
    title: 'Módulo sin catálogo de errores',
    why:
      'Un módulo sin su archivo de códigos de error termina lanzando excepciones ' +
      'genéricas. Crear errors/<modulo>.error-codes.ts desde el principio.',
    scan: (repoRoot) => {
      const modulesDir = path.join(repoRoot, 'src', 'modules');
      if (!fs.existsSync(modulesDir)) return [];

      const findings = [];
      for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const dir = path.join(modulesDir, entry.name);
        const found = [];
        const walk = (d) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else found.push(e.name);
          }
        };
        try {
          walk(dir);
        } catch {
          continue;
        }

        const hasCodes = found.some((f) => /\.error-codes\.ts$/.test(f));
        const hasErrors = found.some((f) => /\.errors\.ts$/.test(f));
        if (!hasCodes && !hasErrors) {
          findings.push({
            file: `src/modules/${entry.name}`,
            line: 0,
            code: `sin ${entry.name}.error-codes.ts ni ${entry.name}.errors.ts`,
          });
        }
      }
      return findings;
    },
  },
];
