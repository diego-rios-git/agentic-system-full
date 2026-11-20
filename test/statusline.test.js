#!/usr/bin/env node
/**
 * Status line (`scripts/statusline.js`): en qué slot trabaja la sesión.
 *
 * El slot es una INFERENCIA (cwd → última herramienta del transcript → cache de
 * la sesión → principal) y cada eslabón se prueba por separado, incluidos los
 * que fallan: transcript ausente, corrupto, demasiado viejo, slot ya cerrado, y
 * la excepción, que nunca debe romper la línea.
 *
 * Corre la copia del script dentro de un workspace temporal real
 * (test/slot-workspace.js), con JSON por stdin construido con JSON.stringify.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildWorkspace, LINK_SKIP, git, write } = require('./slot-workspace');

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI, '');

/** Corre la status line con `input` por stdin. Devuelve `{ raw, text, code }`. */
function statusline(w, input, env = {}) {
  const cleanEnv = { ...w.env };
  delete cleanEnv.NO_COLOR;
  delete cleanEnv.CLAUDE_EFFORT; // el entorno de quien corre el test no debe colarse
  Object.assign(cleanEnv, env);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'scripts', 'statusline.js'), '--ai-managed'], {
    cwd: w.ws,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: cleanEnv,
    timeout: 30000,
  });
  return { raw: r.stdout, text: strip(r.stdout), code: r.status, stderr: r.stderr };
}

/** Línea de transcript con un tool_use. */
const toolUse = (input, name = 'Bash') =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

const sessions = [];
let counter = 0;
const sid = () => {
  const id = `test-${process.pid}-${Date.now()}-${counter++}`;
  sessions.push(id);
  return id;
};
test.after(() => {
  const dir = path.join(os.tmpdir(), 'claude-statusline-slots-fixture');
  for (const id of sessions) fs.rmSync(path.join(dir, `${id}.txt`), { force: true });
});

function transcript(w, lines) {
  const file = path.join(w.tmp, `transcript-${counter++}.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function workspaceWithSlots() {
  const w = buildWorkspace();
  w.pushOtherBranch('api', 'feat/rev');
  assert.strictEqual(w.manage(['open', '--slot', 'implementation-1', '--repo', 'api', '--branch', 'feat/impl']).code, 0);
  assert.strictEqual(w.manage(['open', '--slot', 'review', '--repo', 'api', '--branch', 'feat/rev']).code, 0);
  return w;
}

test('cwd dentro de un slot gana sobre todo lo demás; color por tipo; rama o detached@sha', () => {
  const w = workspaceWithSlots();
  try {
    const t = transcript(w, [toolUse({ command: 'ls api/src' })]); // el transcript dice "principal": el cwd manda
    const impl = statusline(w, { cwd: w.slotDir('implementation-1', 'api'), session_id: sid(), transcript_path: t });
    assert.match(impl.text, /^● implementation-1 │ api: feat\/impl/);
    assert.ok(impl.raw.includes('\x1b[32m'), 'implementation en verde');
    assert.doesNotMatch(impl.text, /web:/, 'solo se muestran los repos abiertos en el slot');

    const review = statusline(w, { workspace: { current_dir: path.join(w.ws, 'worktrees', 'review') }, session_id: sid() });
    assert.match(review.text, /^● review │ api: detached@[0-9a-f]{7,}/);
    assert.ok(review.raw.includes('\x1b[33m'), 'review en amarillo');

    const principal = statusline(w, { cwd: w.ws, session_id: sid() });
    assert.match(principal.text, /^● principal │ api: main │ web: main/);
    assert.ok(principal.raw.includes('\x1b[34m'), 'principal en azul');
  } finally {
    w.cleanup();
  }
});

test('sin cwd en un slot: gana el ÚLTIMO tool_use que menciona un slot o un repo principal', () => {
  const w = workspaceWithSlots();
  try {
    const slotPath = path.join(w.slotDir('implementation-1', 'api'), 'src', 'x.ts'); // con barras invertidas en Windows
    const reviewCmd = `node scripts/run-gates.js --repo api --from worktrees/review/api`;

    const t1 = transcript(w, [toolUse({ command: 'ls web' }), toolUse({ file_path: slotPath }, 'Edit')]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t1 }).text, /^● implementation-1/, 'ruta absoluta con \\ escapadas en el JSON');

    const t2 = transcript(w, [toolUse({ file_path: slotPath }, 'Edit'), toolUse({ command: reviewCmd })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t2 }).text, /^● review/, 'el último gana');

    const t3 = transcript(w, [toolUse({ command: reviewCmd }), toolUse({ command: 'git -C api status' })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t3 }).text, /^● principal/, 'volver a la principal también se detecta');

    const t4 = transcript(w, [toolUse({ command: reviewCmd }), JSON.stringify({ type: 'user', message: { content: 'conversación sin herramientas' } })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t4 }).text, /^● review/, 'mensajes sin herramienta no mueven el slot');

    // Una mención sin slot ni repo (un comando cualquiera) no decide nada.
    const t5 = transcript(w, [toolUse({ command: reviewCmd }), toolUse({ command: 'echo hola' })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t5 }).text, /^● review/);
  } finally {
    w.cleanup();
  }
});

test('el último slot se cachea por sesión: sin transcript, la sesión sigue en su slot; otra sesión no', () => {
  const w = workspaceWithSlots();
  try {
    const session = sid();
    const t = transcript(w, [toolUse({ command: 'ls worktrees/implementation-1/api' })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: session, transcript_path: t }).text, /^● implementation-1/);
    // Ahora el transcript ya no lo menciona (o no existe): queda lo cacheado.
    assert.match(statusline(w, { cwd: w.ws, session_id: session, transcript_path: path.join(w.tmp, 'no-existe.jsonl') }).text, /^● implementation-1/);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid() }).text, /^● principal/, 'otra sesión no hereda el cache');
  } finally {
    w.cleanup();
  }
});

test('un slot cacheado que ya se cerró deja de mostrarse: vuelve a principal', () => {
  const w = workspaceWithSlots();
  try {
    const session = sid();
    const t = transcript(w, [toolUse({ command: 'ls worktrees/implementation-1/api' })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: session, transcript_path: t }).text, /^● implementation-1/);
    assert.strictEqual(w.manage(['clean', '--slot', 'implementation-1']).code, 0);
    assert.match(statusline(w, { cwd: w.ws, session_id: session }).text, /^● principal/);
  } finally {
    w.cleanup();
  }
});

test('transcript ausente, corrupto, vacío o con la primera línea cortada: nunca rompe', () => {
  const w = workspaceWithSlots();
  try {
    const garbage = path.join(w.tmp, 'basura.jsonl');
    fs.writeFileSync(garbage, '{no es json\n\u0000\u0001 binario\n{"type":"assistant","message":{"content":[{"type":"tool_use","input":{"command":"ls worktrees/review/api"}}]}}\n{"type":"assistant","mess');
    const r = statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: garbage });
    assert.strictEqual(r.code, 0);
    assert.match(r.text, /^● review/, 'las líneas rotas se saltean y la válida se usa');

    const empty = path.join(w.tmp, 'vacio.jsonl');
    fs.writeFileSync(empty, '');
    for (const t of [empty, path.join(w.tmp, 'no-existe.jsonl'), w.tmp /* un directorio, no un archivo */, null]) {
      const x = statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t });
      assert.strictEqual(x.code, 0, `transcript ${t}`);
      assert.match(x.text, /^● principal/);
    }

    for (const stdin of ['', 'esto no es json', '[]', 'null']) {
      const x = statusline(w, stdin);
      assert.strictEqual(x.code, 0, `stdin ${JSON.stringify(stdin)}`);
      assert.ok(x.text.length > 0, 'no deja la línea vacía');
    }
  } finally {
    w.cleanup();
  }
});

test('la cola del transcript es de 512 KB: lo anterior no cuenta', () => {
  const w = workspaceWithSlots();
  try {
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } });
    const lines = [toolUse({ command: 'ls worktrees/review/api' })];
    for (let i = 0; i < 400; i++) lines.push(filler); // ~800 KB después de la mención
    const t = transcript(w, lines);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: t }).text, /^● principal/, 'fuera de la cola, sin cache: principal (límite documentado)');

    const near = transcript(w, [...lines.slice(300), toolUse({ command: 'ls worktrees/review/api' })]);
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), transcript_path: near }).text, /^● review/, 'dentro de la cola sí');
  } finally {
    w.cleanup();
  }
});

test('una excepción deja `● slot ?` y exit 0', () => {
  const w = buildWorkspace();
  try {
    const r = statusline(w, { cwd: 12345 });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.text, '● slot ?');
  } finally {
    w.cleanup();
  }
});

test('fuera de un workspace (sin ai-workspace.json): solo la carpeta, sin slot', () => {
  const w = buildWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-fuera-'));
  try {
    const r = statusline(w, { cwd: path.join(outside, 'mi-carpeta'), model: { display_name: 'Opus' } });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.text, 'mi-carpeta │ Opus');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    w.cleanup();
  }
});

test('modelo con effort, contexto y costo con umbrales de la config', () => {
  const w = buildWorkspace({ config: { statusline: { costWarnUsd: 1, costAlertUsd: 2 } } });
  try {
    const base = {
      cwd: w.ws,
      session_id: sid(),
      model: { display_name: 'Opus 5.5' },
      effort: { level: 'high' },
      context_window: { current_usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 81000 }, used_percentage: 8.4 },
    };
    const low = statusline(w, { ...base, cost: { total_cost_usd: 0.5 } });
    assert.match(low.text, / │ Opus 5\.5 · high │ ctx 84k \(8%\) │ USD 0\.50$/);
    assert.ok(low.raw.includes('\x1b[32mUSD 0.50'), 'verde bajo el umbral');
    assert.ok(statusline(w, { ...base, cost: { total_cost_usd: 1.5 } }).raw.includes('\x1b[33mUSD 1.50'), 'amarillo desde costWarnUsd');
    assert.ok(statusline(w, { ...base, cost: { total_cost_usd: 2 } }).raw.includes('\x1b[31mUSD 2.00'), 'rojo desde costAlertUsd');

    // Sin effort ni contexto ni costo: esas partes no aparecen.
    assert.doesNotMatch(statusline(w, { cwd: w.ws, session_id: sid(), model: { display_name: 'Sonnet' } }).text, /ctx|USD|·/);
    // El effort también puede venir del entorno.
    assert.match(statusline(w, { cwd: w.ws, session_id: sid(), model: { display_name: 'Sonnet' } }, { CLAUDE_EFFORT: 'low' }).text, /Sonnet · low/);
  } finally {
    w.cleanup();
  }
});

test('costo con los umbrales por defecto (10 y 20)', () => {
  const w = buildWorkspace();
  try {
    const at = (usd) => statusline(w, { cwd: w.ws, session_id: sid(), cost: { total_cost_usd: usd } }).raw;
    assert.ok(at(9.99).includes('\x1b[32m'));
    assert.ok(at(10).includes('\x1b[33m'));
    assert.ok(at(20).includes('\x1b[31m'));
  } finally {
    w.cleanup();
  }
});

test('la raíz es el ancestro MÁS EXTERNO con ai-workspace.json (single-repo: el slot trae el suyo)', { skip: LINK_SKIP }, () => {
  const w = workspaceWithSlots();
  try {
    // En topología single-repo el checkout del slot incluye su propio ai-workspace.json.
    const inner = path.join(w.slotDir('implementation-1', 'api'), 'ai-workspace.json');
    write(inner, fs.readFileSync(path.join(w.ws, 'ai-workspace.json'), 'utf8'));
    const r = statusline(w, { cwd: w.slotDir('implementation-1', 'api'), session_id: sid() });
    assert.match(r.text, /^● implementation-1 │ api: feat\/impl/, 'se reconoce el slot desde la raíz externa, no desde el ai-workspace.json del slot');
    git(w.slotDir('implementation-1', 'api'), ['status', '--porcelain']);
  } finally {
    w.cleanup();
  }
});
