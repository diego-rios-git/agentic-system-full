#!/usr/bin/env node
/**
 * pre-write-protected.js — hook PreToolUse sobre Edit y Write (y, si se registra
 * como hook opcional de Bash, sobre las escrituras que se hacen por la shell).
 *
 * ## Qué problema resuelve
 *
 * Un archivo que una herramienta genera (una migración, un lockfile, un cliente
 * generado) y que alguien escribe o retoca a mano no falla al guardarse: se
 * descubre cuando corre sobre datos reales. La regla "las migraciones las genera
 * la herramienta, no se editan a mano" estaba escrita en seis lugares de un
 * proyecto y se incumplió igual: hubo migraciones escritas a mano y migraciones
 * generadas y editadas sin avisar. Una regla que depende de acordarse pierde; por
 * eso es un hook.
 *
 * ## Qué hace
 *
 * Las rutas protegidas salen de `protectedPaths` en el manifiesto de los packs
 * activos y en `ai-workspace.json`:
 *
 *   { "id": "...", "globs": ["**\/src/database/migrations/*.ts"],
 *     "write": "block", "edit": "authorization" | "block",
 *     "message": "...", "procedure": "nombre-del-procedimiento" }
 *
 *   - Write sobre una ruta protegida → SIEMPRE bloqueado (se genera con la
 *     herramienta, no se escribe).
 *   - Edit → bloqueado, salvo `edit: "authorization"` con una autorización vigente
 *     en `.protected-edit-allow.json`, que crea el OPERADOR con
 *     `node scripts/allow-protected-edit.js <archivo>`. Se autoriza por NOMBRE de
 *     archivo para que valga desde la raíz y desde un slot. `edit: "block"` no
 *     tiene escape.
 *   - Cualquier otra ruta → no se mete.
 *   - El propio `.protected-edit-allow.json` es inescribible por el agente: un
 *     agente que se autoriza a sí mismo vacía el sentido del bloqueo.
 *
 * Cada bloqueo y cada permiso por autorización quedan en `.ai-gates-log.jsonl`.
 *
 * ## Límite, y cómo cubrirlo
 *
 * Este hook ve las herramientas Edit/Write. NO ve una escritura hecha por la
 * shell: `echo x > archivo`, `sed -i`, `tee`, `cp`/`mv` sobre el archivo. Para
 * cubrirlo se registra este MISMO script como un hook opcional de Bash (por
 * ejemplo `pre-bash-protected`, `event: "pre-bash"`, activable con
 * `hooks.pre-bash-protected.enabled`); cuando recibe `tool_name: "Bash"` mira las
 * redirecciones, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`rm` y los cmdlets
 * `Set-Content`/`Add-Content`/`Out-File` contra los mismos globs. Un archivo que
 * NO existe todavía se trata como Write (siempre bloqueado). Sigue sin ver lo que
 * escribe un programa (`node -e`, `python -c`): ningún hook de shell lo ve.
 *
 * Contrato: ver `scripts/lib/guard-core.js`. Fail-open ante error propio.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const core = require('../lib/guard-core');
const wt = require('../lib/worktree-paths');
const assets = require('../lib/asset-roots');

const ALLOW_NAME = '.protected-edit-allow.json';
const WRITE_TOOLS = new Set(['Write']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

// ---------------------------------------------------------------------------
// Reglas y globs
// ---------------------------------------------------------------------------

/** Las reglas de los manifiestos de los packs activos y de `ai-workspace.json`. */
function protectedRules(cfg) {
  const rules = [];
  for (const root of assets.roots(cfg)) {
    const m = assets.rawManifest(root);
    for (const r of (m && m.protectedPaths) || []) rules.push({ ...r, origin: root.id, pack: root.kind === 'pack' ? root.id : null });
  }
  for (const r of cfg.protectedPaths || []) rules.push({ ...r, origin: 'ai-workspace.json', pack: null });
  return rules
    .filter((r) => Array.isArray(r.globs) && r.globs.length > 0)
    .map((r) => ({
      id: r.id || '(sin id)',
      globs: r.globs,
      write: r.write || 'block',
      edit: r.edit || 'authorization',
      message: r.message || null,
      procedure: r.procedure || null,
      origin: r.origin,
      pack: r.pack,
    }));
}

/** `**\/x/*.ts` → expresión anclada. `**` cruza carpetas, `*` y `?` no. */
function globToRegExp(glob) {
  let g = wt.posix(glob);
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

/** El repositorio al que pertenece un archivo, o `null`. */
function repoOfFile(cfg, root, abs) {
  const posix = wt.posix(abs);
  const hit = wt.parseSlotPath(cfg, posix);
  if (hit) return cfg.repos.find((r) => r.name === hit.repo) || null;
  const lower = posix.toLowerCase();
  let best = null;
  for (const r of cfg.repos) {
    const base = wt.posix(path.resolve(root, r.path)).toLowerCase();
    if (lower === base || lower.startsWith(`${base}/`)) {
      if (!best || base.length > best.len) best = { repo: r, len: base.length };
    }
  }
  return best ? best.repo : null;
}

/** Rutas contra las que se prueba un glob: absoluta, relativa a la raíz y al repo. */
function candidates(cfg, root, abs) {
  const posix = wt.posix(abs);
  const out = [posix];
  const rel = wt.posix(path.relative(root, abs));
  if (!rel.startsWith('..')) out.push(rel);
  const hit = wt.parseSlotPath(cfg, posix);
  if (hit) out.push(hit.rest);
  const repo = repoOfFile(cfg, root, abs);
  if (repo) {
    const relRepo = wt.posix(path.relative(path.resolve(root, repo.path), abs));
    if (!relRepo.startsWith('..')) out.push(relRepo);
  }
  return out;
}

function ruleFor(cfg, root, rules, abs) {
  const cand = candidates(cfg, root, abs);
  const repo = repoOfFile(cfg, root, abs);
  for (const rule of rules) {
    // Una regla de un pack solo aplica a los repositorios que lo tienen activo.
    if (rule.pack && repo && !repo.packs.includes(rule.pack) && !(cfg.raw.packs || []).includes(rule.pack)) continue;
    for (const glob of rule.globs) {
      const re = globToRegExp(glob);
      if (cand.some((c) => re.test(c))) return rule;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

/** Autorización vigente para UN archivo (por nombre), o `null`. */
function activeAllowance(root, basename) {
  let allow;
  try {
    allow = JSON.parse(fs.readFileSync(path.join(root, ALLOW_NAME), 'utf8'));
  } catch {
    return null;
  }
  const list = Array.isArray(allow && allow.allows) ? allow.allows : allow && allow.file ? [allow] : [];
  const now = Date.now();
  return (
    list.find((a) => {
      const expires = Date.parse((a && a.expiresAt) || '');
      return Number.isFinite(expires) && expires > now && a.file === basename;
    }) || null
  );
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

function procedureLine(rule) {
  return rule.procedure ? `Procedimiento: ${rule.procedure}` : 'Procedimiento: ver la regla del proyecto para este tipo de archivo.';
}

function writeMessage(rel, rule) {
  return [
    `Escritura bloqueada en ${rel}: es un archivo que genera una herramienta, no se escribe a mano.`,
    '',
    rule.message || `La ruta está protegida (${rule.id}): el archivo se genera con la herramienta del proyecto.`,
    '',
    'Si el operador NO pidió el cambio que lo requiere: no lo generes. Seguí con el',
    'resto y avisá al cerrar la tarea que el cambio lo necesita.',
    '',
    procedureLine(rule),
  ].join('\n');
}

function editMessage(rel, base, rule) {
  const lines = [
    `Edición bloqueada en ${rel}: un archivo generado no se edita sin autorización.`,
    '',
    rule.message || `La ruta está protegida (${rule.id}).`,
    '',
  ];
  if (rule.edit === 'authorization') {
    lines.push(
      'Si al archivo generado le falta algo real, el flujo es:',
      '',
      '  1. Explicarle al operador, en el chat, qué falta y por qué.',
      '  2. ESPERAR su respuesta. No editar mientras tanto.',
      '  3. Si autoriza, él corre:',
      `       node scripts/allow-protected-edit.js ${base}`,
      '',
      'Esa autorización vale para ese archivo y vence sola. No la corras vos: el',
      'punto de este bloqueo es que la decisión sea del operador.',
      '',
    );
  } else {
    lines.push('Esta ruta no admite edición manual ni con autorización.', '');
  }
  lines.push(procedureLine(rule));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Decisión
// ---------------------------------------------------------------------------

/** `kind`: 'write' (archivo nuevo o Write) o 'edit' (modifica uno existente). */
function decide(ctx, rules, file, kind, cwd) {
  const { cfg, root } = ctx;
  const abs = core.resolvePath(cwd || root, file);
  const base = path.basename(wt.posix(abs));

  if (base === ALLOW_NAME) {
    return {
      reason: 'autoescritura-de-autorizacion',
      message: [
        `Escritura bloqueada en ${ALLOW_NAME}: la autorización la crea el operador.`,
        '',
        'Un agente que se autoriza a sí mismo vacía el sentido del bloqueo. Pedile al',
        'operador que corra `node scripts/allow-protected-edit.js <archivo>`.',
      ].join('\n'),
    };
  }

  const rule = ruleFor(cfg, root, rules, abs);
  if (!rule) return null;

  let rel = wt.posix(path.relative(root, abs));
  if (rel.startsWith('..')) rel = wt.posix(abs);

  if (kind === 'write') {
    if (rule.write === 'allow') return null;
    return { reason: 'write-a-mano', extra: { rule: rule.id }, message: writeMessage(rel, rule) };
  }

  if (rule.edit === 'authorization') {
    const allow = activeAllowance(root, base);
    if (allow) {
      core.logBlock(root, { hook: 'pre-write-protected', decision: 'allowed', rule: rule.id, file: rel, expiresAt: allow.expiresAt });
      return null;
    }
  }
  return { reason: 'edit-sin-autorizacion', extra: { rule: rule.id }, message: editMessage(rel, base, rule) };
}

// ---- Variante de Bash ------------------------------------------------------

const REDIRECT_ONLY = /^\d*>>?\|?$/;
const REDIRECT_INLINE = /^\d*>>?\|?([^&>=\s].*)$/;
const PS_WRITERS = new Set(['set-content', 'add-content', 'out-file', 'clear-content', 'new-item', 'sc', 'ac']);

/** Los archivos que un tramo de shell escribe o modifica. */
function bashTargets(item) {
  const targets = [];
  const { word, args, positional } = item;

  for (let i = 0; i < args.length; i += 1) {
    if (REDIRECT_ONLY.test(args[i]) && args[i + 1]) targets.push(args[i + 1]);
    else {
      const m = REDIRECT_INLINE.exec(args[i]);
      if (m) targets.push(m[1]);
    }
  }

  if (word === 'tee') targets.push(...positional);
  else if (word === 'sed' || word === 'perl') {
    if (args.some((a) => /^-[a-z]*i/i.test(a) || a === '--in-place')) targets.push(...positional);
  } else if (word === 'cp') targets.push(...positional.slice(-1));
  else if (word === 'mv' || word === 'rm' || word === 'del' || word === 'erase' || word === 'truncate') {
    targets.push(...positional);
  } else if (PS_WRITERS.has(word)) {
    for (let i = 0; i < args.length; i += 1) {
      if (/^-(path|literalpath|filepath)$/i.test(args[i]) && args[i + 1]) targets.push(args[i + 1]);
    }
    if (positional[0]) targets.push(positional[0]);
  }
  return targets.filter((t) => t && !/^\/dev\//.test(t) && t !== 'nul' && t !== '$null');
}

// ---------------------------------------------------------------------------

core.runHook('pre-write-protected', (ctx) => {
  const { cfg, root, tool } = ctx;
  const rules = protectedRules(cfg);

  if (tool === 'Bash') {
    if (!ctx.command) return null;
    for (const item of core.analyze(ctx.command, ctx.cwd)) {
      for (const target of bashTargets(item)) {
        const abs = core.resolvePath(item.cwd, target);
        const verdict = decide(ctx, rules, abs, fs.existsSync(abs) ? 'edit' : 'write', item.cwd);
        if (verdict) return verdict;
      }
    }
    return null;
  }

  if (!ctx.filePath) return null;
  if (WRITE_TOOLS.has(tool)) return decide(ctx, rules, ctx.filePath, 'write', ctx.cwd);
  if (EDIT_TOOLS.has(tool)) return decide(ctx, rules, ctx.filePath, 'edit', ctx.cwd);
  return null;
});
