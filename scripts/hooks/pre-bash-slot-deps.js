#!/usr/bin/env node
/**
 * pre-bash-slot-deps.js — hook PreToolUse sobre Bash.
 *
 * ## Qué problema resuelve
 *
 * El directorio de dependencias de un slot NO es una copia: es un enlace
 * (junction en Windows, symlink en Unix) al del repositorio principal. Se hace
 * así a propósito —reinstalar cuesta minutos y gigas por slot, y los lockfiles
 * son idénticos— y el precio es que todo lo que borre o reinstale ahí adentro
 * atraviesa el enlace y le pasa al principal:
 *
 *   - un `ci`/`install` empieza borrando el directorio entero; si después falla
 *     (un archivo abierto por un servidor de desarrollo es lo normal) el del
 *     principal queda a medias;
 *   - un borrado recursivo recorre el enlace y borra el contenido del DESTINO en
 *     vez del enlace.
 *
 * Ya pasó dos veces con el mismo patrón, y las dos se descubrió horas después
 * con un síntoma disfrazado (un comando "no se reconoce", un módulo que "no se
 * encuentra") que no se parece en nada a la causa. La regla ya estaba escrita
 * después de la primera vez, y volvió a pasar: por eso es un hook.
 *
 * ## Qué bloquea (solo con un slot en juego)
 *
 * Un slot está en juego si el directorio de trabajo está adentro, o si el tramo
 * del comando nombra su ruta (`npm --prefix <slot>/<repo> ci`, un `cd`).
 *
 *   (a) Reinstalar o modificar dependencias, según el perfil del repositorio del
 *       slot (`scripts/lib/deps-profiles.js`: gestores + subcomandos
 *       destructivos). El subcomando es el primer token que no es un flag
 *       después del gestor, saltando los flags con valor (`--prefix X`). Los
 *       `run`/`test`/`exec`... (safeSubcommands) pasan: `npm run update` es un
 *       script del proyecto, y `npm test add` es `test` con un argumento. La
 *       versión de origen buscaba el subcomando en CUALQUIER posición y bloqueaba
 *       `npm test add`; un guard que corta de más se desactiva a la semana.
 *
 *   (b) Borrados recursivos (`rm -r`, `Remove-Item -Recurse`, `rimraf`,
 *       `rmdir /s`, `del /s`) SOLO cuando el objetivo es el directorio de
 *       dependencias del perfil (o algo adentro) o la raíz de un slot
 *       (`<worktrees.dir>/<slot>` o `<slot>/<repo>`, también por `.`/`*`).
 *       DIFERENCIA con el origen: allá se bloqueaba cualquier borrado recursivo
 *       con un slot en juego, incluido `rm -rf <slot>/<repo>/dist`. Limpiar una
 *       carpeta de compilación es trabajo normal; el peligro es atravesar el
 *       enlace, y eso solo pasa si el borrado llega al directorio de dependencias
 *       o a una carpeta que lo contiene.
 *
 * No actúa sobre el repositorio principal: ahí `npm ci` es lo correcto. Un
 * repositorio sin perfil de dependencias no tiene nada compartido: no hace nada.
 *
 * Límites: no ve un borrado hecho desde un programa (`node -e`, `python -c`),
 * un `find -delete` ni un `git clean -x`; tampoco un `yarn` pelado (que equivale
 * a `yarn install`) porque el perfil lista subcomandos, no la ausencia de uno.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const path = require('path');

const core = require('../lib/guard-core');
const wt = require('../lib/worktree-paths');
const deps = require('../lib/deps-profiles');

const ID = 'pre-bash-slot-deps';

/** Normaliza un gestor del perfil igual que `normWord` (`npm.cmd` → `npm`). */
function managerSet(profile) {
  return new Set(profile.managers.map((m) => core.normWord(m)));
}

/** El subcomando de un comando de gestor, o `null` si no es de este perfil. */
function subcommandOf(item, profile) {
  if (!managerSet(profile).has(item.word)) return null;
  const sub = item.positional[0];
  return sub ? sub.toLowerCase() : '';
}

/** Los objetivos de un borrado recursivo, o `null` si el comando no lo es. */
function recursiveDeleteTargets(item) {
  const { word, args } = item;
  const lower = args.map((a) => a.toLowerCase());
  const nonFlags = (list) => list.filter((a) => !a.startsWith('-'));

  if (word === 'rm' || word === 'remove-item' || word === 'ri' || word === 'del' || word === 'erase') {
    const recursive = lower.some(
      (a) => (/^-[a-z]{1,3}$/.test(a) && a.includes('r')) || a.startsWith('-recurse') || a === '--recursive' || a === '/s',
    );
    if (!recursive) return null;
    const targets = [];
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (/^-(literalpath|path)$/i.test(a)) {
        if (args[i + 1]) targets.push(args[i + 1]);
        i += 1;
      } else if (/^-(include|exclude|filter|stream)$/i.test(a)) {
        i += 1;
      } else if (!a.startsWith('-') && !/^\/[a-z]$/i.test(a)) {
        targets.push(a);
      }
    }
    return targets;
  }

  if (word === 'rmdir' || word === 'rd') {
    if (!lower.includes('/s')) return null;
    return args.filter((a) => !/^\/[a-z]$/i.test(a) && !a.startsWith('-'));
  }

  if (word === 'rimraf') return nonFlags(args);
  if (['npx', 'pnpx', 'bunx'].includes(word) && nonFlags(args)[0] === 'rimraf') return nonFlags(args).slice(1);
  return null;
}

/** ¿El objetivo es el directorio de dependencias, o algo adentro? */
function touchesDepsDir(target, dirs) {
  const norm = `/${wt.posix(target).toLowerCase()}/`;
  return dirs.find((d) => norm.includes(`/${wt.posix(d).toLowerCase()}/`)) || null;
}

/** ¿El objetivo es la carpeta de los slots, un slot o el worktree de un repo? */
function isSlotRootTarget(cfg, root, cwd, target) {
  let t = wt.posix(target).replace(/\/(\*|\.)$/, '');
  if (t === '' || t === '*' || t === '.') t = '.';

  const hit = wt.parseSlotPath(cfg, t);
  if (hit && hit.rest === '') return true;

  const dir = wt.posix(cfg.worktrees.dir);
  const bare = new RegExp(`(^|/)${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^/]+)?$`, 'i');
  if (bare.test(t)) return true;

  const resolved = wt.posix(core.resolvePath(cwd || root, t)).toLowerCase();
  const wtDir = wt.posix(path.resolve(root, cfg.worktrees.dir)).toLowerCase();
  if (resolved === wtDir) return true;
  if (resolved.startsWith(`${wtDir}/`)) {
    const rest = resolved.slice(wtDir.length + 1).split('/');
    if (rest.length === 1) return true; // un slot
    if (rest.length === 2 && cfg.repos.some((r) => r.name.toLowerCase() === rest[1])) return true;
  }
  return false;
}

function header(command, what) {
  return [
    `Comando bloqueado: ${what} con un slot de worktree de por medio.`,
    '',
    `  ${String(command).trim().slice(0, 300)}`,
    '',
  ];
}

const WHY = [
  'El directorio de dependencias de un slot es un enlace (junction en Windows, symlink en Unix)',
  'al del repositorio principal. Reinstalar o borrar ahí adentro no afecta al slot:',
  'atraviesa el enlace y vacía el del principal, que queda a medias. Ya pasó dos veces; las',
  'dos se descubrieron horas después, con un error que no se parece en nada a la causa',
  '(un comando que "no se reconoce", un módulo que "no se encuentra").',
  '',
];

function advice(profile, repoName) {
  const repair = profile.repair ? `\`${profile.repair}\`` : 'la reinstalación de siempre';
  return [
    'Qué hacer en su lugar:',
    '',
    `  - Instalar o reinstalar: en el repositorio principal${repoName ? ` (${repoName})` : ''}, nunca dentro de`,
    `    un slot — por ejemplo ${repair} allá. Si hay que reinstalar, lo decide el operador.`,
    '  - Ver cómo está el directorio compartido, y repararlo si quedó a medias:',
    '      node scripts/check-deps.js           (--fix para repararlo)',
    '  - Liberar un slot: node scripts/manage-worktree.js clean --slot <slot>,',
    '    que quita el enlace antes de borrar nada.',
    '  - Si el slot necesita de verdad su propio árbol de dependencias, pedíselo',
    '    al operador: no lo resuelvas por tu cuenta.',
    '',
    'Detalle: ai/core/procedures/worktree-slots.md',
  ];
}

core.runHook(
  ID,
  (ctx) => {
    const { cfg, root, command } = ctx;
    if (!command) return null;

    for (const item of core.analyze(command, ctx.cwd)) {
      const sc = core.slotContext(cfg, root, item.cwd, item.text);
      if (!sc) continue;

      const profiles = sc.repos
        .map((repo) => ({ repo, profile: deps.profileFor(cfg, repo) }))
        .filter((p) => p.profile);
      if (profiles.length === 0) continue; // sin perfil, nada compartido

      for (const { repo, profile } of profiles) {
        const sub = subcommandOf(item, profile);
        if (sub === null) continue;
        if (profile.safeSubcommands.includes(sub)) continue;
        if (profile.destructiveSubcommands.includes(sub)) {
          return {
            reason: 'reinstala-dependencias-en-slot',
            extra: { slot: sc.slot, repo: repo.name, subcommand: sub },
            message: [
              ...header(command, 'reinstala o modifica dependencias'),
              ...WHY,
              ...advice(profile, repo.name),
            ].join('\n'),
          };
        }
      }

      const targets = recursiveDeleteTargets(item);
      if (!targets) continue;
      const dirs = profiles.map((p) => p.profile.dir);
      for (const target of targets) {
        const dir = touchesDepsDir(target, dirs);
        const slotRoot = !dir && isSlotRootTarget(cfg, root, item.cwd, target);
        if (!dir && !slotRoot) continue;
        const first = profiles[0];
        return {
          reason: dir ? 'borra-dependencias-en-slot' : 'borra-raiz-de-slot',
          extra: { slot: sc.slot, target: String(target).slice(0, 200) },
          message: [
            ...header(command, dir ? `borra \`${dir}\`` : 'borra la raíz de un slot (el enlace de dependencias queda adentro)'),
            ...WHY,
            ...advice(first.profile, first.repo.name),
            '',
            'Borrar otras carpetas del slot (compilados, caches propios) sí se puede.',
          ].join('\n'),
        };
      }
    }
    return null;
  },
  { tools: ['Bash'] },
);
