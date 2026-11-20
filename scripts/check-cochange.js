#!/usr/bin/env node
/**
 * check-cochange.js
 *
 * "Quien toca X regenera Y": un artefacto derivado que vive versionado (un
 * lockfile, una captura de referencia, un cliente generado) no puede quedar
 * atrás de su fuente en el mismo cambio.
 *
 * El motor y la forma de las reglas están en `lib/cochange.js`; las reglas las
 * declaran el núcleo, los packs, `ai/local/` o el proyecto bajo `coChange`. Este
 * script no conoce ninguna.
 *
 * Por qué existe (el incidente, en genérico): el archivo que define el menú
 * compartido por todas las vistas previas recibió cuatro entradas en cuatro
 * entregas distintas y ninguna regeneró una sola captura. La rama base quedó en
 * rojo para toda vista previa y cada rama que sincronizaba heredaba capturas
 * ajenas rotas, imposibles de distinguir de las propias. Un test no lo ve: lo
 * que falla es el CONJUNTO de archivos del cambio, no el contenido de uno.
 *
 * Contra qué compara: `origin/<baseBranch>` del repositorio (`--base` lo
 * cambia), con lo commiteado, lo modificado y lo sin trackear (`review-base.js`).
 *
 * Qué NO hace silencio:
 *   - `--repo` es obligatorio. Antes, si faltaba, el script tomaba el argumento
 *     siguiente a cualquier cosa como nombre de repositorio y daba otro error
 *     (o ninguno): ahora sale con 2 y dice cómo se usa.
 *   - Si la base no se puede leer (no existe, `git fetch` pendiente) sale con 2:
 *     sin base no se puede afirmar nada, y "no pude mirar" no es "está bien".
 *   - Sin ninguna regla declarada sale con 0 y lo dice; el orquestador, además,
 *     no lo corre en ese repositorio (`needs: coChange`) y lo muestra como
 *     "NO CORRIÓ".
 *
 * Uso:
 *   node scripts/check-cochange.js --repo mi-app [--base origin/main] [--json]
 *   node scripts/check-cochange.js --repo worktrees/review/mi-app
 */

'use strict';

const cli = require('./lib/gate-cli');
const cochange = require('./lib/cochange');

cli.run({
  name: 'cochange',
  script: 'scripts/check-cochange.js',
  usage: '[--base <ref>]',

  scan(ctx) {
    const { rules, problems } = cochange.rulesFor(ctx.cfg, ctx.repo);

    // Una regla que no cargó es una regla sin verificar: no se sigue como si no
    // existiera.
    if (problems.length > 0) {
      return cli.unverified(
        `${ctx.repo.name}: ${problems.length} regla(s) coChange inválida(s)\n  - ${problems.join('\n  - ')}`,
      );
    }

    if (rules.length === 0) {
      return cli.clean(`${ctx.repo.name}: no hay reglas coChange declaradas, nada que verificar`);
    }

    ctx.warnBase();
    const diff = ctx.diff();
    if (!diff) {
      return cli.unverified(
        `${ctx.repo.name}: no se pudo leer el diff contra ${ctx.base}`,
        '¿Falta `git fetch origin`? Pasar otra base con --base.',
      );
    }

    const found = cochange.evaluate(rules, diff.files);
    return cli.findings(found, {
      emptyMessage: `sin co-cambios pendientes (${rules.length} regla(s) contra ${ctx.base})`,
    });
  },
});
