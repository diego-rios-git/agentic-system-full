#!/usr/bin/env node
/**
 * check-e2e-scripts.js
 *
 * Linter de los scripts de pruebas de punta a punta: lo que ya salió mal y se
 * puede ver LEYENDO el archivo, sin ejecutarlo.
 *
 *   node ai/packs/e2e/scripts/check-e2e-scripts.js                 # lo que declara `e2e` en ai-workspace.json
 *   node ai/packs/e2e/scripts/check-e2e-scripts.js <archivo>...    # esos archivos
 *   node ai/packs/e2e/scripts/check-e2e-scripts.js --json          # lista JSON en stdout
 *   node ai/packs/e2e/scripts/check-e2e-scripts.js --autoprueba    # casos que TIENEN que marcar y que NO
 *
 * Salida: 0 limpio (o "no aplica", dicho explícitamente) · 1 hay hallazgos ·
 * 2 NO SE PUDO VERIFICAR (stdout vacío): config inválida, carpeta inexistente,
 * archivo ilegible, o no hay con qué comprobar la sintaxis.
 *
 * Por qué por línea y con regex, y no con un parser: los scripts pueden ser
 * Python, JavaScript o TypeScript, y un linter que necesita un parser por
 * lenguaje es otro proyecto. Cada regla es un patrón por línea con su caso que
 * marca y su caso que no (`--autoprueba`). Lo que no se pueda ver así no es de
 * este gate: `ai/gate-candidates.md`.
 *
 * Reglas PORTABLES (valen en cualquier proyecto):
 *
 *   E2E-0   El archivo no compila. Python y JS se comprueban con su intérprete;
 *           TypeScript no se comprueba y el informe lo dice.
 *   E2E-1   Espera fija (`sleep`, `wait_for_timeout`, `waitForTimeout`...) sin un
 *           comentario `espera: <motivo>` que la justifique. Esperar lo que se
 *           ve, no un tiempo.
 *   E2E-2   Llamadas que se cuelgan según el framework: `select_option`/
 *           `selectOption` contra selects personalizados, `wait_for_url`/
 *           `waitForURL`/`waitForNavigation`/`networkidle` contra routers del
 *           lado del cliente.
 *   E2E-3   Fecha u hora sin zona: la interfaz muestra la de una zona y el
 *           script calcula "hoy" con la de la máquina.
 *   E2E-4   Texto de un diálogo o de la página ENTERA tomado como aserción:
 *           frágil, y un falso positivo cuando otro texto de la página coincide.
 *   E2E-5   Proceso lanzado (`Popen`, `spawn`, `fork`) en un archivo que nunca
 *           lo corta: queda huérfano ocupando el puerto.
 *   E2E-6   Escritura directa en la base (`INSERT`/`UPDATE`/`DELETE`...) fuera
 *           del helper autorizado. Necesita la config `e2e`; sin ella, "no aplica".
 *   DATO-1  Un dato concreto de una base ajena: un UUID literal, o lo que
 *           declare `e2e.forbiddenData` (correos de usuarios, nombres de
 *           clientes). En la base de otra persona no existe.
 *
 * Una regla se puede apartar en UNA línea con `e2e-ok(<REGLA>): <motivo>` en un
 * comentario de la misma línea o de la anterior. El motivo es obligatorio: sin
 * él, no cuenta.
 *
 * Config (`ai-workspace.json` → `e2e`, todo opcional salvo que falte entero):
 *
 *   "e2e": {
 *     "dir": "tests/e2e",                       // carpeta de scripts (recursiva)
 *     "paths": ["docs/e2e/**\/*.md"],           // más carpetas, archivos o globs
 *     "forbiddenData": ["@miempresa\\.local", "Cliente Real S\\.A\\."],   // regex
 *     "authorizedWriteHelper": "escribir_autorizado",   // el ÚNICO camino de escritura
 *     "authorizedWriteFiles": ["tests/e2e/kit/*.py"]    // archivos que lo DEFINEN (exentos de E2E-6)
 *   }
 *
 * Contrato de gates: ai/core/procedures/gate-from-finding.md.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const config = require(path.join(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'workspace-config'));

// ---------------------------------------------------------------------------
// Qué archivos son de qué tipo
// ---------------------------------------------------------------------------

const SCRIPT_EXT = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const DOC_EXT = new Set(['.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv', '.venv', '.next']);
const MAX_BYTES = 1024 * 1024;

const isPython = (name) => path.extname(name).toLowerCase() === '.py';
const isDoc = (name) => DOC_EXT.has(path.extname(name).toLowerCase());

// ---------------------------------------------------------------------------
// Las reglas. Cada una: id, qué, cómo corregirlo y cómo detectarlo.
// `line(texto, ctx)` devuelve un mensaje (marca) o null.
// ---------------------------------------------------------------------------

/** Una región entera: un diálogo o la página completa. */
const REGION =
  '(?:(?:get_by_role|getByRole)\\(\\s*[\'"](?:dialog|alertdialog)[\'"][^)]*\\)' +
  '|locator\\(\\s*[\'"](?:body|html|\\[role=["\']?(?:alert)?dialog["\']?\\])[\'"]\\s*\\)' +
  '|document\\.body)';
const NARROW = '(?:\\.(?:first|last)(?:\\(\\))?|\\.nth\\(\\s*\\d+\\s*\\))*';
const GETTER =
  '(?:inner_text|text_content|inner_html|all_inner_texts|all_text_contents|innerText|textContent|innerHTML|allInnerTexts|allTextContents)';
const RE_REGION_GETTER = new RegExp(`${REGION}${NARROW}\\.${GETTER}\\b`);
const RE_REGION_ASSIGN = new RegExp(`^\\s*(?:const|let|var)?\\s*(\\w+)\\s*=\\s*.*${REGION}${NARROW}\\s*;?\\s*$`);
const RE_SELECTOR_ARG = new RegExp(
  `\\.${GETTER}\\(\\s*['"](?:body|html|\\[role=["']?(?:alert)?dialog["']?\\])['"]`,
);
const RE_REGION_EXPECT = new RegExp(
  `expect\\(.*${REGION}${NARROW}.*\\)\\s*\\.(?:toContainText|toHaveText|to_contain_text|to_have_text)\\b`,
);

const RE_SLEEP = [
  /\btime\.sleep\s*\(/,
  /\basyncio\.sleep\s*\(/,
  /(?<![\w.$])sleep\s*\(/,
  /\bwait_for_timeout\s*\(/,
  /\bwaitForTimeout\s*\(/,
  /\bcy\.wait\s*\(\s*\d/,
  /\bThread\.sleep\s*\(/,
  /new\s+Promise\s*\(.*setTimeout\s*\(/,
  /\bawait\s+.*setTimeout\s*\(/,
];

const RE_HANG = [
  [/\bselect_option\s*\(/, 'select_option()'],
  [/\bselectOption\s*\(/, 'selectOption()'],
  [/\b(?:page|frame)\.select\s*\(/, 'page.select()'],
  [/\bwait_for_url\s*\(/, 'wait_for_url()'],
  [/\bwaitForURL\s*\(/, 'waitForURL()'],
  [/\bwait_for_navigation\s*\(/, 'wait_for_navigation()'],
  [/\bwaitForNavigation\s*\(/, 'waitForNavigation()'],
  [/networkidle/i, 'espera de networkidle'],
];

const RE_DATE = [
  [/\bdatetime\.(?:now|today|utcnow)\s*\(\s*\)/, 'datetime sin zona horaria'],
  [/\bdate\.today\s*\(\s*\)/, 'date.today() sin zona horaria'],
  [/\bdatetime\.fromtimestamp\s*\(\s*[^,()]+\)/, 'datetime.fromtimestamp() sin zona'],
  [/new\s+Date\(\s*(['"`])\d{4}-\d{2}-\d{2}\1\s*\)/, "new Date('AAAA-MM-DD') es medianoche UTC"],
  [/\.(?:getHours|getDate|getDay|getMonth|getFullYear)\s*\(/, 'getter de fecha en la zona de la máquina'],
];
const RE_LOCALE = /\.toLocale(?:Date|Time)?String\s*\(/;

const RE_PROCESS = /\bsubprocess\.Popen\s*\(|(?<![\w.])(?:Popen)\s*\(|(?<![\w.])(?:spawn|fork)\s*\(|\bchild_process\.(?:spawn|fork)\s*\(/;
const RE_PROCESS_CLOSE = /\.(?:kill|terminate)\s*\(|taskkill|process\.kill|os\.killpg|tree[-_]?kill|killpg/i;

const RE_WRITE = [
  /\bINSERT\s+INTO\s+\S+/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  /\bDELETE\s+FROM\s+\S+/i,
  /\bTRUNCATE\s+(?:TABLE\s+)?\S+/i,
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
  /\bALTER\s+TABLE\s+\S+/i,
  /\.(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite)\s*\(/,
  /\bprisma\.\w+\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
];

const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const RULES = [
  {
    id: 'E2E-1',
    appliesTo: 'code',
    check(line) {
      if (!RE_SLEEP.some((re) => re.test(line))) return null;
      return {
        message: `espera fija: ${line.trim().slice(0, 80)}`,
        hint: 'esperar lo que se ve (un elemento, un texto, una condición); si de verdad no hay nada que esperar, dejar `espera: <motivo>` en un comentario de la misma línea',
      };
    },
    // `espera: <motivo>` es la justificación propia de esta regla.
    excused: (line, prev) => /(?:#|\/\/|\/\*)\s*espera:\s*\S/.test(line) || /^\s*(?:#|\/\/)\s*espera:\s*\S/.test(prev),
  },
  {
    id: 'E2E-2',
    appliesTo: 'code',
    check(line, ctx) {
      for (const [re, what] of RE_HANG) {
        if (!re.test(line)) continue;
        if (ctx.allowedCalls.some((a) => line.includes(a))) continue;
        return {
          message: `${what} se cuelga con selects personalizados o routers del lado del cliente`,
          hint: 'elegir con el helper del kit (clic + opción visible) y esperar una condición de la página (`wait_for_function`, un elemento que aparece), no la URL ni la red',
        };
      }
      for (const re of ctx.extraHanging) {
        if (re.test(line)) {
          return { message: `llamada declarada como colgante en e2e.hangingCalls: ${line.trim().slice(0, 60)}`, hint: 'ver la guía del proyecto' };
        }
      }
      return null;
    },
  },
  {
    id: 'E2E-3',
    appliesTo: 'code',
    check(line) {
      for (const [re, what] of RE_DATE) {
        if (re.test(line)) {
          return { message: what, hint: 'calcular "hoy" con el helper del kit que usa la zona de la interfaz; las fechas con zona explícita (`timeZone`, `tz=`, `+00:00`)' };
        }
      }
      if (RE_LOCALE.test(line) && !/timeZone/.test(line)) {
        return { message: 'toLocale*String() sin `timeZone`', hint: 'pasar `timeZone` explícito: sin él usa la zona de la máquina que corre la prueba' };
      }
      return null;
    },
  },
  {
    id: 'E2E-4',
    appliesTo: 'code',
    check(line, ctx) {
      const hit =
        RE_REGION_GETTER.test(line) || RE_SELECTOR_ARG.test(line) || RE_REGION_EXPECT.test(line) || usesWholeRegionVar(line, ctx);
      if (!hit) return null;
      return {
        message: 'texto de un diálogo entero o de toda la página como aserción',
        hint: 'acotar a la región del componente (id, aria-label, data-testid) y afirmar sobre ella',
      };
    },
  },
  {
    id: 'E2E-6',
    appliesTo: 'code-and-strings',
    needsConfig: true,
    check(line, ctx) {
      if (!RE_WRITE.some((re) => re.test(line))) return null;
      if (ctx.helper && ctx.nearby(ctx.helper)) return null;
      return {
        message: `escritura directa en la base: ${line.trim().slice(0, 70)}`,
        hint: ctx.helper
          ? `solo con orden de la persona y por \`${ctx.helper}\`, que deja en el reporte qué se escribió, por qué y quién lo autorizó; si no, generar el dato usando el producto`
          : 'generar el dato usando el producto; las escrituras directas solo con orden de la persona',
      };
    },
  },
  {
    id: 'DATO-1',
    appliesTo: 'any',
    check(line, ctx) {
      RE_UUID.lastIndex = 0;
      let m;
      while ((m = RE_UUID.exec(line)) !== null) {
        const hex = m[0].replace(/-/g, '').toLowerCase();
        if (/^(.)\1+$/.test(hex) || hex === '0'.repeat(31) + '1') continue; // 0000..., ffff..., un UUID de relleno
        return { message: `UUID literal (dato de una base concreta): ${m[0]}`, hint: 'pedir el dato por rol al kit; en la base de otra persona ese identificador no existe' };
      }
      for (const re of ctx.forbidden) {
        const f = line.match(re);
        if (f) return { message: `dato de una base ajena (e2e.forbiddenData): ${f[0]}`, hint: 'describir el rol ("el cliente con la función X") y pedirlo al kit; nunca por nombre, correo o identificador' };
      }
      return null;
    },
  },
];

/** ¿La línea usa una variable que es un diálogo o una página entera? */
function usesWholeRegionVar(line, ctx) {
  for (const name of ctx.regionVars) {
    const re = new RegExp(`(?<![\\w.])${name}${NARROW}\\.${GETTER}\\b`);
    if (re.test(line)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recorrido de un texto
// ---------------------------------------------------------------------------

function isCommentLine(trimmed, python) {
  if (python) return trimmed.startsWith('#');
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * Clasifica cada línea: 'code', 'doc' (docstring o comentario de bloque: no se
 * mira), 'str' (cadena multilínea con código adentro, p. ej. un SQL: solo
 * E2E-6 y DATO-1) o 'comment'.
 */
function classify(lines, python) {
  const kinds = [];
  let state = null; // null | { kind: 'doc'|'str', close: string }
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (state) {
      kinds.push(state.kind);
      if (raw.includes(state.close)) state = null;
      continue;
    }
    if (isCommentLine(trimmed, python)) {
      kinds.push('comment');
      if (!python && trimmed.startsWith('/*') && !trimmed.includes('*/')) state = { kind: 'doc', close: '*/' };
      continue;
    }
    if (python) {
      const m = raw.match(/("""|''')/);
      if (m) {
        const count = raw.split(m[1]).length - 1;
        if (count % 2 === 1) {
          const isDoc = /^[rRbBuUfF]{0,2}("""|''')/.test(trimmed);
          state = { kind: isDoc ? 'doc' : 'str', close: m[1] };
          kinds.push(isDoc ? 'doc' : 'str-open');
          continue;
        }
        if (/^[rRbBuUfF]{0,2}("""|''')/.test(trimmed)) {
          kinds.push('doc');
          continue;
        }
      }
    } else {
      const ticks = raw.split('`').length - 1;
      if (ticks % 2 === 1) {
        state = { kind: 'str', close: '`' };
        kinds.push('str-open');
        continue;
      }
    }
    kinds.push('code');
  }
  return kinds;
}

/** ¿Una regla está apartada en esta línea con `e2e-ok(REGLA): motivo`? */
function excusedByOk(id, line, prev) {
  const re = new RegExp(`e2e-ok\\(\\s*${id}\\s*\\)\\s*:\\s*\\S`);
  return re.test(line) || (/^\s*(?:#|\/\/)/.test(prev) && re.test(prev));
}

/**
 * Revisa un texto y devuelve `{ findings, skipped }`.
 *
 * @param {string} name nombre o ruta del archivo (decide el lenguaje)
 * @param {string} text contenido
 * @param {object} opts `{ e2e }` la config `e2e` (o `null`)
 */
function lintText(name, text, opts = {}) {
  const e2e = opts.e2e || null;
  const python = isPython(name);
  const doc = isDoc(name);
  const lines = text.split(/\r?\n/);
  const kinds = doc ? lines.map(() => 'doc-md') : classify(lines, python);

  const forbidden = ((e2e && e2e.forbiddenData) || []).map(toRegExp);
  const helper = (e2e && e2e.authorizedWriteHelper) || null;
  const baseCtx = {
    forbidden,
    helper,
    allowedCalls: (e2e && e2e.allowedHangingCalls) || [],
    extraHanging: ((e2e && e2e.hangingCalls) || []).map(toRegExp),
    regionVars: new Set(),
  };

  const findings = [];
  const skipped = new Set();
  const add = (rule, i, found) =>
    findings.push({ rule, file: name, line: i + 1, message: found.message, hint: found.hint });

  // E2E-6 necesita la config; sin ella, se dice y se sigue.
  if (!e2e && !doc) skipped.add('E2E-6 (falta la config `e2e` en ai-workspace.json)');
  if (!e2e) skipped.add('DATO-1 por e2e.forbiddenData (falta la config `e2e`)');

  // Variables que son un diálogo o una página entera, para E2E-4.
  lines.forEach((l, i) => {
    if (kinds[i] !== 'code') return;
    const m = l.match(RE_REGION_ASSIGN);
    if (m) baseCtx.regionVars.add(m[1]);
  });

  const writeExempt = e2e && matchesAny(name, e2e.authorizedWriteFiles || []);

  lines.forEach((line, i) => {
    const kind = kinds[i];
    const prev = i > 0 ? lines[i - 1] : '';
    const ctx = {
      ...baseCtx,
      nearby: (word) => lines.slice(Math.max(0, i - 4), i + 1).some((l) => l.includes(word)),
    };

    for (const rule of RULES) {
      if (doc) {
        if (rule.id !== 'DATO-1') continue;
      } else if (rule.appliesTo === 'code') {
        if (kind !== 'code') continue;
      } else if (rule.appliesTo === 'code-and-strings') {
        if (kind !== 'code' && kind !== 'str' && kind !== 'str-open') continue;
      } else if (kind === 'doc' || kind === 'comment') {
        continue;
      }
      if (rule.needsConfig && !e2e) continue;
      if (rule.id === 'E2E-6' && writeExempt) continue;

      const found = rule.check(line, ctx);
      if (!found) continue;
      if (rule.excused && rule.excused(line, prev)) continue;
      if (excusedByOk(rule.id, line, prev)) continue;
      add(rule.id, i, found);
    }
  });

  // E2E-5: un proceso lanzado y un archivo que nunca corta nada. Es del archivo
  // entero, no de una línea.
  if (!doc && !RE_PROCESS_CLOSE.test(text)) {
    lines.forEach((line, i) => {
      if (kinds[i] !== 'code' || !RE_PROCESS.test(line)) return;
      // `spawn`/`fork` solo cuentan si el archivo importa child_process (o es Python).
      if (!python && !/child_process/.test(text)) return;
      if (excusedByOk('E2E-5', line, i > 0 ? lines[i - 1] : '')) return;
      add('E2E-5', i, {
        message: 'se lanza un proceso y el archivo nunca lo corta',
        hint: 'cortarlo al terminar, por árbol (`.terminate()`, `taskkill /T /F`, `process.kill`) y verificar que el puerto quedó libre',
      });
    });
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return { findings, skipped: [...skipped] };
}

/** Un valor de config a RegExp: acepta `/patrón/flags` o un patrón a secas (sin mayúsculas). */
function toRegExp(src) {
  const m = String(src).match(/^\/(.+)\/([a-z]*)$/);
  return m ? new RegExp(m[1], m[2]) : new RegExp(String(src), 'i');
}

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  const g = glob.split('\\').join('/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i += 1;
      if (g[i + 1] === '/') {
        i += 1;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  const rel = path.relative(config.ROOT, path.resolve(config.ROOT, file)).split(path.sep).join('/');
  return globs.some((g) => globToRegExp(g).test(rel) || globToRegExp(g).test(path.basename(rel)));
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCRIPT_EXT.has(path.extname(entry.name).toLowerCase()) || DOC_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

/** Expande una entrada de `paths`: archivo, carpeta o glob. */
function expand(entry, out) {
  const abs = path.resolve(config.ROOT, entry);
  if (fs.existsSync(abs)) {
    if (fs.statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
    return;
  }
  if (!/[*?]/.test(entry)) throw new Error(`no existe: ${entry}`);
  // glob: se recorre desde la parte fija del patrón
  const fixed = entry.split(/[*?]/)[0].split(/[\\/]/).slice(0, -1).join('/') || '.';
  const base = path.resolve(config.ROOT, fixed);
  if (!fs.existsSync(base)) throw new Error(`no existe la carpeta base de ${entry}`);
  const all = [];
  walk(base, all);
  const re = globToRegExp(entry);
  for (const f of all) {
    const rel = path.relative(config.ROOT, f).split(path.sep).join('/');
    if (re.test(rel)) out.push(f);
  }
}

// ---------------------------------------------------------------------------
// Sintaxis (E2E-0)
// ---------------------------------------------------------------------------

/** Devuelve `{ error }`, `{ ok: true }` o `{ unverified: motivo }`. */
function syntaxOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    let r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status === 0) return { ok: true };
    if (ext === '.js') {
      // Un `.js` puede ser un módulo (`import`, `await` de nivel superior) si el
      // proyecto declara "type": "module": se prueba también como módulo, y solo
      // se marca si falla de las dos formas.
      const tmp = path.join(os.tmpdir(), `check-e2e-${process.pid}-${Date.now()}.mjs`);
      try {
        fs.copyFileSync(file, tmp);
        const asModule = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
        if (asModule.status === 0) return { ok: true };
        r = asModule;
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    const msg = String(r.stderr || '');
    const line = (msg.match(/:(\d+)\r?\n/) || [])[1];
    const detail = msg.split(/\r?\n/).find((l) => /Error/.test(l)) || 'error de sintaxis';
    return { error: detail.trim(), line: line ? Number(line) : 1 };
  }
  if (ext === '.py') {
    const code = 'import ast,sys\ntry:\n ast.parse(open(sys.argv[1],encoding="utf-8").read(),sys.argv[1])\nexcept SyntaxError as e:\n print("%s|%s" % (e.lineno or 1, e.msg)); sys.exit(1)\n';
    for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', code, file], { encoding: 'utf8' });
      if (r.error) continue; // no está instalado
      if (r.status === 0) return { ok: true };
      const [line, ...msg] = String(r.stdout || '').trim().split('|');
      if (line && /^\d+$/.test(line)) return { error: msg.join('|') || 'error de sintaxis', line: Number(line) };
      continue; // un intérprete que no es el que esperamos (p. ej. el stub de la tienda)
    }
    return { unverified: `no hay intérprete de Python para comprobar la sintaxis de ${path.basename(file)}` };
  }
  return { ok: true, untested: true };
}

// ---------------------------------------------------------------------------
// Autoprueba: cada regla con casos que TIENEN que marcar y casos que NO.
// (gate-from-finding, paso 4: un gate sin su fixture negativo se desactiva solo.)
// ---------------------------------------------------------------------------

const CFG = {
  authorizedWriteHelper: 'escribir_autorizado',
  forbiddenData: ['@miempresa\\.local', 'Cliente Real S\\.A\\.'],
  authorizedWriteFiles: ['kit/escritura.py'],
};

// [regla, descripción, archivo, texto, cuántos hallazgos de esa regla, config]
const CASOS = [
  ['E2E-1', 'time.sleep suelto', 's.py', 'import time\ntime.sleep(65)\n', 1],
  ['E2E-1', 'wait_for_timeout suelto', 's.py', 'page.wait_for_timeout(2500)\n', 1],
  ['E2E-1', 'waitForTimeout en JS', 's.js', 'await page.waitForTimeout(3000);\n', 1],
  ['E2E-1', 'promesa con setTimeout', 's.js', 'await new Promise(r => setTimeout(r, 5000));\n', 1],
  ['E2E-1', 'asyncio.sleep', 's.py', 'await asyncio.sleep(2)\n', 1],
  ['E2E-1', 'espera con su motivo en la línea', 's.py', 'time.sleep(70)  # espera: ventana del límite de frecuencia\n', 0],
  ['E2E-1', 'espera con su motivo en la línea anterior', 's.js', '// espera: el cron corre cada minuto\nawait page.waitForTimeout(61000);\n', 0],
  ['E2E-1', 'espera con el motivo vacío', 's.py', 'time.sleep(5)  # espera:\n', 1],
  ['E2E-1', 'esperar lo que se ve', 's.py', "page.get_by_text('Guardado').wait_for(state='visible')\n", 0],
  ['E2E-1', 'un sleep dentro de un comentario', 's.py', '# no usar time.sleep(5)\n', 0],
  ['E2E-1', 'un sleep dentro de un docstring', 's.py', '"""\nNo usar time.sleep(5) acá.\n"""\n', 0],

  ['E2E-2', 'select_option', 's.py', "page.locator('#ciclo').select_option('monthly')\n", 1],
  ['E2E-2', 'selectOption en JS', 's.ts', "await page.locator('#ciclo').selectOption('monthly');\n", 1],
  ['E2E-2', 'wait_for_url', 's.py', "page.wait_for_url('**/panel')\n", 1],
  ['E2E-2', 'waitForURL', 's.js', "await page.waitForURL('**/panel');\n", 1],
  ['E2E-2', 'networkidle', 's.js', "await page.goto(url, { waitUntil: 'networkidle' });\n", 1],
  ['E2E-2', 'el helper del kit', 's.py', "elegir(page, '#ciclo', 'monthly')\n", 0],
  ['E2E-2', 'esperar una condición de la página', 's.py', "page.wait_for_function('() => location.pathname === \"/panel\"')\n", 0],
  ['E2E-2', 'llamada permitida por config', 's.py', "page.locator('select').select_option('x')\n", 0, { allowedHangingCalls: ['select_option'] }],

  ['E2E-3', 'datetime.now() sin zona', 's.py', 'from datetime import datetime\nhoy = datetime.now().strftime("%Y-%m-%d")\n', 1],
  ['E2E-3', 'date.today()', 's.py', 'hoy = date.today()\n', 1],
  ['E2E-3', 'new Date de una fecha sin hora', 's.js', "const d = new Date('2026-09-29');\n", 1],
  ['E2E-3', 'toLocaleDateString sin timeZone', 's.js', "const t = d.toLocaleDateString('es-AR');\n", 1],
  ['E2E-3', 'getHours() local', 's.js', 'const h = new Date().getHours();\n', 1],
  ['E2E-3', 'now() con zona', 's.py', 'x = datetime.now(timezone.utc)\n', 0],
  ['E2E-3', 'toLocaleDateString con timeZone', 's.js', "d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });\n", 0],
  ['E2E-3', 'getUTCHours', 's.js', 'const h = d.getUTCHours();\n', 0],
  ['E2E-3', 'el helper del kit', 's.py', 'hoy = hoy_en_zona_de_la_interfaz()\n', 0],

  ['E2E-4', 'texto de todo el diálogo', 's.py', "t = page.get_by_role('dialog').first.inner_text()\n", 1],
  ['E2E-4', 'texto de toda la página', 's.py', "t = page.locator('body').inner_text()\n", 1],
  ['E2E-4', 'toda la página con el selector como argumento', 's.py', "t = page.inner_text('body')\n", 1],
  ['E2E-4', 'diálogo guardado en una variable', 's.py', "dlg = page.get_by_role('dialog').first\nassert 'manual' not in dlg.inner_text()\n", 1],
  ['E2E-4', 'diálogo en JS, con textContent', 's.js', "const dlg = page.getByRole('dialog');\nconst t = await dlg.textContent();\n", 1],
  ['E2E-4', 'document.body.innerText', 's.js', "const t = await page.evaluate(() => document.body.innerText);\n", 1],
  ['E2E-4', 'expect sobre el body entero', 's.ts', "await expect(page.locator('body')).toContainText('Guardado');\n", 1],
  ['E2E-4', 'un selector acotado', 's.py', "t = page.inner_text('#panel-versiones')\n", 0],
  ['E2E-4', 'la región del componente dentro del diálogo', 's.py', "dlg = page.get_by_role('dialog').first\nt = dlg.get_by_test_id('versiones').inner_text()\n", 0],
  ['E2E-4', 'texto de un badge', 's.py', "t = page.get_by_test_id('estado').inner_text()\n", 0],

  ['E2E-5', 'Popen sin corte', 's.py', 'import subprocess\np = subprocess.Popen(["npm", "start"])\n', 1],
  ['E2E-5', 'spawn sin corte', 's.js', "const { spawn } = require('child_process');\nconst p = spawn('npm', ['start']);\n", 1],
  ['E2E-5', 'Popen con terminate', 's.py', 'import subprocess\np = subprocess.Popen(["npm", "start"])\ntry:\n    pass\nfinally:\n    p.terminate()\n', 0],
  ['E2E-5', 'spawn con kill', 's.js', "const { spawn } = require('child_process');\nconst p = spawn('x');\np.kill();\n", 0],
  ['E2E-5', 'un spawn de otra biblioteca', 's.js', 'const p = spawn(creator);\n', 0],

  ['E2E-6', 'INSERT a mano', 's.py', 'uno("INSERT INTO clientes (nombre) VALUES (\'x\')")\n', 1, CFG],
  ['E2E-6', 'UPDATE a mano', 's.py', 'db(f"UPDATE pedidos SET estado = \'listo\' WHERE id = {i}")\n', 1, CFG],
  ['E2E-6', 'DELETE en un SQL multilínea', 's.py', 'sql = """\nDELETE FROM pedidos\nWHERE id = 1\n"""\n', 1, CFG],
  ['E2E-6', 'escritura de Mongo', 's.js', "await db.collection('x').insertOne({ a: 1 });\n", 1, CFG],
  ['E2E-6', 'por el helper autorizado', 's.py', 'escribir_autorizado(r, "UPDATE pedidos SET a = 1", motivo="vencer", autorizacion="operador")\n', 0, CFG],
  ['E2E-6', 'helper con el SQL en otra línea', 's.py', 'escribir_autorizado(\n    r,\n    "UPDATE pedidos SET a = 1",\n    motivo="vencer",\n)\n', 0, CFG],
  ['E2E-6', 'un SELECT', 's.py', 'db("SELECT id FROM pedidos WHERE estado = \'listo\'")\n', 0, CFG],
  ['E2E-6', 'el archivo que define el helper', 'kit/escritura.py', 'def escribir_autorizado(r, sql):\n    run("DELETE FROM x")\n', 0, CFG],
  ['E2E-6', 'sin config: no aplica', 's.py', 'uno("INSERT INTO clientes (nombre) VALUES (\'x\')")\n', 0],
  ['E2E-6', 'apartada con un motivo', 's.py', 'uno("DELETE FROM x")  # e2e-ok(E2E-6): el operador lo pidió el 29/09\n', 0, CFG],

  ['DATO-1', 'UUID literal', 's.py', 'casino_id = "3f2b8c1e-9d4a-4e2b-8f1a-0c9d8e7f6a5b"\n', 1],
  ['DATO-1', 'UUID de relleno', 's.py', 'x = "00000000-0000-0000-0000-000000000000"\n', 0],
  ['DATO-1', 'correo prohibido por config', 's.py', 'entrar("jugador@miempresa.local")\n', 1, CFG],
  ['DATO-1', 'nombre prohibido por config', 's.js', "await page.getByText('Cliente Real S.A.').click();\n", 1, CFG],
  ['DATO-1', 'dato prohibido en una guía', 'guia.md', 'Entrar con `jugador@miempresa.local`.\n', 1, CFG],
  ['DATO-1', 'el rol en vez del dato', 's.py', 'c = datos.cliente("con_retiros")\n', 0, CFG],
  ['DATO-1', 'correo de ejemplo', 's.py', 'entrar("persona@ejemplo.com")\n', 0, CFG],
  ['DATO-1', 'sin config: solo el UUID', 's.py', 'entrar("jugador@miempresa.local")\n', 0],

  ['E2E-1', 'regla apartada con un motivo', 's.js', 'await page.waitForTimeout(100); // e2e-ok(E2E-1): animación de 100 ms sin evento\n', 0],
  ['E2E-1', 'regla apartada SIN motivo', 's.js', 'await page.waitForTimeout(100); // e2e-ok(E2E-1):\n', 1],
];

function autoprueba() {
  let fallas = 0;
  for (const [regla, descripcion, archivo, texto, esperados, e2e] of CASOS) {
    const { findings } = lintText(archivo, texto, { e2e: e2e || null });
    const obtenidos = findings.filter((f) => f.rule === regla).length;
    const ok = obtenidos === esperados;
    if (!ok) fallas += 1;
    console.log(`  ${ok ? 'OK ' : 'MAL'} ${regla} ${descripcion}: esperaba ${esperados}, dio ${obtenidos}`);
  }
  console.log(`\n${CASOS.length - fallas}/${CASOS.length} casos como se esperaba`);
  return fallas ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

function unverified(reason, hint) {
  process.stderr.write(`\n  check-e2e-scripts: ${reason}.\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.stderr.write('  Tratarlo como NO VERIFICADO, no como "sin hallazgos".\n\n');
  process.exit(2);
}

function validateE2e(e2e) {
  if (e2e === undefined || e2e === null) return null;
  if (typeof e2e !== 'object' || Array.isArray(e2e)) return '`e2e` debe ser un objeto';
  if (e2e.dir !== undefined && typeof e2e.dir !== 'string') return '`e2e.dir` debe ser un texto';
  for (const k of ['paths', 'forbiddenData', 'authorizedWriteFiles', 'allowedHangingCalls', 'hangingCalls']) {
    if (e2e[k] !== undefined && (!Array.isArray(e2e[k]) || e2e[k].some((x) => typeof x !== 'string'))) {
      return `\`e2e.${k}\` debe ser una lista de textos`;
    }
  }
  if (e2e.authorizedWriteHelper !== undefined && typeof e2e.authorizedWriteHelper !== 'string') {
    return '`e2e.authorizedWriteHelper` debe ser un texto';
  }
  for (const k of ['forbiddenData', 'hangingCalls']) {
    for (const src of e2e[k] || []) {
      try {
        toRegExp(src);
      } catch (err) {
        return `\`e2e.${k}\` tiene una expresión regular inválida (${src}): ${err.message}`;
      }
    }
  }
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');

  if (argv.includes('--autoprueba')) process.exit(autoprueba());

  const files = argv.filter((a) => !a.startsWith('--'));

  let cfg = null;
  try {
    cfg = config.load({ optional: true });
  } catch (err) {
    return config.reportAndExit(err);
  }
  const e2e = cfg && cfg.raw ? cfg.raw.e2e : null;

  const bad = validateE2e(e2e);
  if (bad) return unverified(`config \`e2e\` inválida: ${bad}`);

  // Qué archivos se miran.
  const targets = [];
  try {
    if (files.length) {
      for (const f of files) {
        const abs = path.resolve(f);
        if (!fs.existsSync(abs)) return unverified(`el archivo no existe: ${f}`);
        if (fs.statSync(abs).isDirectory()) walk(abs, targets);
        else targets.push(abs);
      }
    } else if (!e2e) {
      const msg = 'NO APLICA: el proyecto no declara `e2e` en ai-workspace.json (ni `dir` ni `paths`), así que no hay scripts que revisar. Para activarlo ver el procedimiento `armar-kit-e2e`.';
      if (asJson) {
        process.stdout.write('[]\n');
        process.stderr.write(`  check-e2e-scripts: ${msg}\n`);
      } else console.log(`\n  check-e2e-scripts: ${msg}\n`);
      process.exit(0);
    } else {
      if (!e2e.dir && !(e2e.paths || []).length) {
        return unverified('`e2e` no declara ni `dir` ni `paths`', 'Declará dónde viven los scripts de pruebas de punta a punta.');
      }
      for (const entry of [e2e.dir, ...(e2e.paths || [])].filter(Boolean)) expand(entry, targets);
    }
  } catch (err) {
    return unverified(err.message, 'Revisá `e2e.dir` y `e2e.paths` en ai-workspace.json.');
  }

  const unique = [...new Set(targets)];
  const findings = [];
  const skipped = new Set();
  const notChecked = [];
  const notes = [];

  for (const abs of unique) {
    const rel = path.relative(config.ROOT, abs);
    const shown = (rel.startsWith('..') ? abs : rel).split(path.sep).join('/');
    let text;
    try {
      if (fs.statSync(abs).size > MAX_BYTES) {
        notChecked.push(`${shown} (más de 1 MB)`);
        continue;
      }
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      return unverified(`no se pudo leer ${shown}: ${err.message}`);
    }

    if (!isDoc(abs)) {
      const syn = syntaxOf(abs);
      if (syn.error) {
        findings.push({ rule: 'E2E-0', file: shown, line: syn.line, message: `no compila: ${syn.error}`, hint: 'corregir la sintaxis' });
        continue; // el resto de las reglas sobre un archivo que no compila no dice nada confiable
      }
      if (syn.unverified) notChecked.push(`${shown}: ${syn.unverified}`);
      if (syn.untested) notes.push(`${shown}: la sintaxis de ${path.extname(abs)} no se comprueba`);
    }

    const res = lintText(shown, text, { e2e });
    findings.push(...res.findings);
    res.skipped.forEach((s) => skipped.add(s));
  }

  for (const s of skipped) process.stderr.write(`  check-e2e-scripts: no aplica ${s}\n`);
  for (const n of notes) process.stderr.write(`  check-e2e-scripts: ${n}\n`);

  if (findings.length) {
    if (notChecked.length) notChecked.forEach((n) => process.stderr.write(`  check-e2e-scripts: SIN VERIFICAR ${n}\n`));
    if (asJson) process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    else {
      console.log('');
      for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.rule}  ${f.message}\n      -> ${f.hint}`);
      const byRule = {};
      for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
      console.log(`\n  check-e2e-scripts: ${findings.length} hallazgo(s) — ${Object.entries(byRule).map(([r, n]) => `${r} ${n}`).join(', ')}\n`);
    }
    process.exit(1);
  }

  // Sin hallazgos, pero con algo que no se pudo mirar: no es "limpio".
  if (notChecked.length) {
    return unverified(`no se pudo verificar: ${notChecked.join('; ')}`);
  }

  if (asJson) process.stdout.write('[]\n');
  else console.log(`\n  check-e2e-scripts: ${unique.length} archivo(s), sin hallazgos\n`);
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    // Una excepción del gate es "no se pudo verificar", nunca "está limpio".
    unverified(`error interno: ${err.message}`);
  }
}

module.exports = { lintText, CASOS };
