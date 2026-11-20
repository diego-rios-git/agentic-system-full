#!/usr/bin/env node
/**
 * review-base.js
 *
 * Contra qué se compara una rama, y qué archivos toca. Lo usan todos los
 * scripts de review (run-gates, run-checks y los gates que miran el diff).
 *
 * **La base es `origin/<repos[].baseBranch>`, nunca un nombre escrito acá.**
 * Y es la rama REMOTA, no la local: la local no se actualiza sola, y cuando
 * quedaba atrás, los tickets ya mergeados se colaban en el diff como si fueran
 * del cambio. En un caso real los tests acotados al diff pasaron de 2 archivos a
 * 26 y la corrida se pasó del tiempo límite. Los worktrees de los slots
 * comparten los refs remotos con la principal, así que `origin/<rama>` existe
 * igual desde un slot.
 *
 * **El diff incluye por defecto lo commiteado, lo modificado sin commitear y lo
 * sin trackear.** Una revisión ocurre ANTES de commitear: con solo
 * `base...HEAD` el diff sale vacío y se aprueba nada. (`committedOnly` devuelve
 * el comportamiento viejo, para quien compara una rama ya cerrada.)
 *
 * Los avisos van por stderr, nunca por stdout: stdout es el JSON que lee el
 * orquestador.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cwd, args) {
  try {
    // `core.quotepath=false`: sin esto git escapa los nombres con tildes
    // (`"src/men\303\272.ts"`) y el archivo no se encuentra en disco.
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * La base de comparación de un repositorio: la que pidió el operador, o
 * `origin/<baseBranch>` de la configuración.
 */
function baseFor(repo, explicit, dir) {
  if (explicit) return explicit;

  const remote = `origin/${repo.baseBranch}`;

  // Un repositorio SIN ningún remoto —uno recién creado, o que vive solo en esta
  // máquina— no tiene `origin/<base>` y nunca la va a tener: la única base real
  // es la rama local. Sin este respaldo, todo gate que compara contra la base
  // sale "no se pudo verificar" para siempre en un proyecto nuevo. Solo se aplica
  // cuando NO hay remoto: con uno configurado, una base local es justo la que se
  // queda atrás, y ahí el camino correcto es `git fetch` (el aviso lo dice).
  if (dir && !baseExists(dir, remote) && !hasRemote(dir) && baseExists(dir, repo.baseBranch)) {
    if (!notedLocalBase.has(dir)) {
      notedLocalBase.add(dir);
      process.stderr.write(
        `  aviso: ${repo.name}: no hay remoto configurado; se compara contra la rama local \`${repo.baseBranch}\`.\n`,
      );
    }
    return repo.baseBranch;
  }

  return remote;
}

const notedLocalBase = new Set();

/** ¿El repositorio de `cwd` tiene algún remoto configurado? */
function hasRemote(cwd) {
  const out = git(cwd, ['remote']);
  return out !== null && out.trim() !== '';
}

/** ¿Existe esa referencia en el repositorio de `cwd`? */
function baseExists(cwd, base) {
  const out = git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  return out !== null && out.trim() !== '';
}

/**
 * Avisa por stderr cuando la base no sirve para medir: no existe, o es una rama
 * local atrasada respecto de su remoto. No corta: el que llama decide qué hacer
 * con una base inexistente, y una base atrasada sigue siendo una comparación
 * válida si el operador la pidió.
 *
 * @returns {'ok'|'missing'|'stale'}
 */
function warnIfStaleBase(cwd, base, label = cwd) {
  if (!baseExists(cwd, base)) {
    process.stderr.write(
      `  aviso: ${label}: la base \`${base}\` no existe. ` +
        (base.startsWith('origin/') ? 'Correr `git fetch origin` primero.\n' : 'Pasar otra con --base.\n'),
    );
    return 'missing';
  }

  // Una referencia remota (`origin/x`) no tiene "su remoto" contra el cual
  // compararse sin ir a la red; solo una rama local puede estar atrasada.
  if (base.includes('/')) return 'ok';

  const remote = `origin/${base}`;
  if (!baseExists(cwd, remote)) return 'ok';

  const behind = Number((git(cwd, ['rev-list', '--count', `${base}..${remote}`]) || '0').trim());
  if (behind > 0) {
    process.stderr.write(
      `  aviso: ${label}: \`${base}\` local está ${behind} commit(s) atrás de \`${remote}\`. ` +
        `Lo ya mergeado va a aparecer como parte del cambio; usar --base ${remote}.\n`,
    );
    return 'stale';
  }
  return 'ok';
}

function parseNameStatus(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [status, ...rest] = line.split('\t');
    const file = rest.join('\t').trim();
    if (file) out.set(file, status.trim()[0]);
  }
  return out;
}

/**
 * Archivos que toca la rama, relativos al repositorio de `dir`.
 *
 * @param {string} dir carpeta del repositorio (la principal o un slot)
 * @param {string} base referencia contra la que se compara
 * @param {{committedOnly?: boolean}} [opts]
 * @returns {{files: Set<string>, added: Set<string>, modified: Set<string>, deleted: Set<string>}|null}
 *   `null` si el diff no se pudo leer. Quien consume decide: un gate de diff
 *   dice "no se pudo verificar"; un filtro de presentación NO filtra nada,
 *   porque ocultar hallazgos sin saber el diff es peor que mostrar de más.
 *
 * `--relative` hace que las rutas salgan relativas a `dir` aunque el repositorio
 * de git esté más arriba (un repositorio embebido, un fixture, topología
 * single-repo con la base en una subcarpeta).
 */
function diffFiles(dir, base, opts = {}) {
  if (!dir || !fs.existsSync(dir)) return null;

  const committedRaw = git(dir, ['diff', '--name-status', '--no-renames', '--relative', `${base}...HEAD`]);
  if (committedRaw === null) return null;

  const status = parseNameStatus(committedRaw);

  if (!opts.committedOnly) {
    const working = git(dir, ['diff', '--name-status', '--no-renames', '--relative', 'HEAD']);
    const untracked = git(dir, ['ls-files', '--others', '--exclude-standard']);
    if (working === null || untracked === null) return null;

    for (const [file, s] of parseNameStatus(working)) {
      const before = status.get(file);
      if (s === 'D') {
        // Agregado en la rama y borrado después: no queda nada que mirar.
        if (before === 'A') status.delete(file);
        else status.set(file, 'D');
      } else if (s === 'A') {
        status.set(file, before === 'D' ? 'M' : 'A');
      } else if (before !== 'A') {
        status.set(file, 'M');
      }
    }

    for (const raw of untracked.split(/\r?\n/)) {
      const file = raw.trim();
      if (!file) continue;
      status.set(file, status.get(file) === 'D' ? 'M' : 'A');
    }
  }

  const added = new Set();
  const modified = new Set();
  const deleted = new Set();
  for (const [file, s] of status) {
    // Lo que git dice que existe pero ya no está en disco, está borrado.
    if (s === 'D' || !fs.existsSync(path.join(dir, file))) deleted.add(file);
    else if (s === 'A') added.add(file);
    else modified.add(file);
  }

  return { files: new Set([...added, ...modified, ...deleted]), added, modified, deleted };
}

module.exports = { baseFor, baseExists, warnIfStaleBase, diffFiles };
