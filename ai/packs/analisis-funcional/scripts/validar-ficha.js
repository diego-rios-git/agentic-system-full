#!/usr/bin/env node
/**
 * validar-ficha.js
 *
 * Revisa la ESTRUCTURA de una ficha de requisito: que estén las secciones, que
 * cada regla tenga su escenario, que un requisito de cálculo traiga la fórmula
 * con su tabla, que una versión nueva traiga la no regresión. No dice si la
 * ficha está bien: una ficha puede pasar sin errores y estar vacía de negocio.
 * Lo que pide cada sección está en
 * ai/core/references/requisitos/contenido-por-seccion.md.
 *
 *   node ai/packs/analisis-funcional/scripts/validar-ficha.js <ficha.md>...
 *   node ai/packs/analisis-funcional/scripts/validar-ficha.js --json <ficha.md>...
 *
 * Salida: 0 sin errores (puede haber avisos) · 1 hay errores · 2 NO SE PUDO
 * VERIFICAR: sin archivos, archivo ilegible, o un archivo que no es una ficha.
 *
 * No es un gate: corre cuando lo pide un procedimiento (metodo-analista,
 * ficha-desde-documento), no después de cada escritura. Una ficha en
 * `pendiente` es una idea anotada y solo se le pide *Qué pide*.
 *
 * Errores:
 *   FICHA-FM       Falta el encabezado, o le falta tipo, rf, titulo o estado.
 *   FICHA-SECCION  Falta una sección de las de siempre.
 *   FICHA-REGLA    No hay reglas `- **R1.** …`.
 *   FICHA-ESC      Un escenario sin `Verifica R…`, sin DADO/CUANDO/ENTONCES, o
 *                  que verifica una regla que no existe.
 *   FICHA-COBERTURA Una regla sin escenario.
 *   FICHA-PERFIL   `perfil: calculo|configuracion|senal` sin lo que ese perfil
 *                  exige.
 *   FICHA-HISTORIAL `version` mayor que 1 sin *Historial* o sin la matriz de
 *                  no regresión.
 *
 * Avisos:
 *   AVISO-VAGO      Una palabra que no pasa sin un número al lado (rápido,
 *                   varios, debería…) en Reglas o Escenarios.
 *   AVISO-TECNICO   Un término de implementación (endpoint, SQL, DTO…) en
 *                   Reglas, Flujos o Escenarios.
 *   AVISO-REFERENCIA "ver la tabla/matriz" sin una tabla cerca.
 *   AVISO-PENDIENTE Un `[a decidir: …]` sin quién decide.
 *   AVISO-ID        Un id de requisito sin su nombre al lado.
 *   AVISO-ESTADOS   *Estados* sin la tabla de transiciones.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SIEMPRE = [
  'Qué pide',
  'Reglas',
  'Escenarios de aceptación',
  'Errores y casos borde',
  'Fuera de alcance',
  'Datos y reglas que toca',
  'Decisiones abiertas',
];

const VAGAS = [
  'rápido', 'lento', 'fácil', 'simple', 'intuitivo', 'adecuado', 'apropiado',
  'razonable', 'suficiente', 'algunos', 'varios', 'pocos', 'muchos',
  'normalmente', 'generalmente', 'a tiempo', 'en lo posible', 'si corresponde',
  'según el caso', 'etc', 'y/o', 'entre otros', 'debería', 'podría',
  'eventualmente', 'mejorar', 'optimizar', 'soportar', 'manejar',
];

const TECNICAS = /\b(endpoint|sql|dto|rollback|worker|query|migraci[oó]n|timestamp|uuid|json)\b/i;
const NUMERO = /\d/;

function norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Encabezado YAML plano: escalares, como lo lee check-requirements. */
function frontMatter(text) {
  if (!/^---\r?\n/.test(text)) return null;
  const end = text.slice(3).search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end < 0) return null;
  const data = {};
  for (const line of text.slice(4, 3 + end + 1).split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return data;
}

/** Secciones `## Título` con su texto y la línea donde empiezan. */
function sections(lines) {
  const out = new Map();
  let current = null;
  lines.forEach((line, i) => {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = { title: h[1], line: i + 1, body: [] };
      out.set(norm(h[1]), current);
    } else if (current) {
      current.body.push({ text: line, line: i + 1 });
    }
  });
  return out;
}

function bodyText(sec) {
  return sec ? sec.body.map((l) => l.text).join('\n') : '';
}

/** Escenarios `#### Escenario: …` hasta el próximo encabezado. */
function scenarios(sec) {
  const out = [];
  if (!sec) return out;
  let cur = null;
  for (const l of sec.body) {
    const h = l.text.match(/^#{3,4}\s+Escenario:\s*(.+?)\s*$/);
    if (h) {
      cur = { name: h[1], line: l.line, text: [] };
      out.push(cur);
    } else if (/^#{2,4}\s/.test(l.text)) {
      cur = null;
    } else if (cur) {
      cur.text.push(l.text);
    }
  }
  return out;
}

function idRegex(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-workspace.json'), 'utf8'));
    const p = cfg.requirements && cfg.requirements.idPattern;
    if (p) return new RegExp(p.replace(/^\^/, '').replace(/\$$/, ''), 'g');
  } catch {
    // Sin configuración, el patrón por defecto del tablero.
  }
  return /RF-\d+\.\d+/g;
}

function validate(file, ids) {
  const errors = [];
  const warnings = [];
  const err = (rule, line, message) => errors.push({ rule, file, line, message });
  const warn = (rule, line, message) => warnings.push({ rule, file, line, message });

  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const fm = frontMatter(text);
  if (!fm || (fm.tipo !== 'requisito' && fm.rf === undefined)) {
    return { notFicha: true, errors, warnings };
  }
  for (const key of ['tipo', 'rf', 'titulo', 'estado']) {
    if (!fm[key]) err('FICHA-FM', 1, `falta \`${key}\` en el encabezado`);
  }

  const lines = text.split(/\r?\n/);
  const secs = sections(lines);
  const get = (title) => secs.get(norm(title));

  // Una idea anotada: alcanza con saber qué pide.
  if (fm.estado === 'pendiente') {
    if (!get('Qué pide')) err('FICHA-SECCION', 1, 'falta *Qué pide*');
    return { errors, warnings };
  }

  if (!/\*\*En una l[ií]nea:\*\*/.test(text)) err('FICHA-SECCION', 1, 'falta la línea `**En una línea:**`');
  for (const title of SIEMPRE) {
    if (!get(title)) err('FICHA-SECCION', 1, `falta la sección *${title}*`);
  }

  // Reglas y escenarios: cada regla con su escenario, cada escenario con su regla.
  const reglas = new Map();
  for (const l of get('Reglas') ? get('Reglas').body : []) {
    const m = l.text.match(/^\s*-\s+\*\*R(\d+)\.\*\*/);
    if (m) reglas.set(`R${m[1]}`, l.line);
  }
  if (get('Reglas') && reglas.size === 0) {
    err('FICHA-REGLA', get('Reglas').line, 'no hay reglas con la forma `- **R1.** …`');
  }

  const cubiertas = new Set();
  for (const esc of scenarios(get('Escenarios de aceptación'))) {
    const body = esc.text.join('\n');
    const verifica = body.match(/^\s*Verifica\s+(.+)$/im);
    if (!verifica) {
      err('FICHA-ESC', esc.line, `el escenario "${esc.name}" no dice qué regla verifica (\`Verifica R…\`)`);
    } else {
      for (const [r] of verifica[1].matchAll(/R\d+/g)) {
        if (!reglas.has(r)) err('FICHA-ESC', esc.line, `el escenario "${esc.name}" verifica ${r}, que no existe`);
        cubiertas.add(r);
      }
    }
    for (const k of ['DADO', 'CUANDO', 'ENTONCES']) {
      if (!new RegExp(`\\*\\*${k}\\*\\*`).test(body)) {
        err('FICHA-ESC', esc.line, `el escenario "${esc.name}" no tiene **${k}**`);
      }
    }
  }
  for (const [r, line] of reglas) {
    if (!cubiertas.has(r)) err('FICHA-COBERTURA', line, `${r} no tiene escenario; si no puede tenerlo, va a *Decisiones abiertas*`);
  }

  // Perfil: lo que un cálculo, una configuración o una señal tienen que traer.
  const perfil = norm(fm.perfil || '');
  if (perfil === 'calculo') {
    const reglasTxt = bodyText(get('Reglas'));
    if (!/```[^`]*=[^`]*```/s.test(reglasTxt)) err('FICHA-PERFIL', 1, 'perfil cálculo: falta la fórmula en un bloque ``` con `=` en *Reglas*');
    if (!/(>=|<=|≥|≤|>|<|mayor|menor|igual)/i.test(reglasTxt)) err('FICHA-PERFIL', 1, 'perfil cálculo: falta el operador de frontera');
    if (!/redonde|\[a decidir/i.test(text)) err('FICHA-PERFIL', 1, 'perfil cálculo: falta el redondeo, o la decisión pendiente sobre el redondeo');
    for (const caso of ['dentro', 'l[ií]mite', 'fuera']) {
      if (!new RegExp(`^\\|\\s*${caso}\\b`, 'im').test(reglasTxt)) {
        err('FICHA-PERFIL', 1, 'perfil cálculo: falta la tabla con un caso dentro, uno en el límite y uno fuera');
        break;
      }
    }
    if (!/l[ií]mite/i.test(bodyText(get('Escenarios de aceptación')))) {
      err('FICHA-PERFIL', 1, 'perfil cálculo: ningún escenario prueba el límite exacto');
    }
  } else if (perfil === 'configuracion') {
    const conf = get('Configuración');
    if (!conf) {
      err('FICHA-PERFIL', 1, 'perfil configuración: falta la sección *Configuración*');
    } else {
      const head = conf.body.map((l) => l.text).find((t) => /^\|/.test(t)) || '';
      for (const col of ['defecto', 'qui[eé]n', 'rige|vigencia', 'v[aá]lid|rango']) {
        if (!new RegExp(col, 'i').test(head)) {
          err('FICHA-PERFIL', conf.line, 'perfil configuración: la tabla no tiene valor por defecto, valores válidos, quién lo cambia y desde cuándo rige');
          break;
        }
      }
    }
  } else if (perfil === 'senal') {
    const zona = [bodyText(get('Reglas')), bodyText(get('Dependencias'))].join('\n');
    for (const [re, que] of [
      [/produc|emite|genera/i, 'quién la produce'],
      [/duplicad|idempot|una sola vez/i, 'cómo se evita el duplicado'],
      [/consum|act[uú]a despu[eé]s|due[nñ]o/i, 'quién actúa después'],
    ]) {
      if (!re.test(zona)) err('FICHA-PERFIL', 1, `perfil señal: no dice ${que}, en *Reglas* o *Dependencias*`);
    }
  } else if (fm.perfil) {
    err('FICHA-PERFIL', 1, `perfil "${fm.perfil}" desconocido: calculo, configuracion o senal`);
  }

  // Una versión nueva: historial y no regresión.
  const version = parseFloat(String(fm.version || '').replace(',', '.'));
  if (version > 1) {
    const hist = get('Historial');
    if (!hist) {
      err('FICHA-HISTORIAL', 1, `version ${fm.version} sin la sección *Historial*`);
    } else if (!/preservad|ampliad|corregid|retirad/i.test(bodyText(hist))) {
      err('FICHA-HISTORIAL', hist.line, 'el *Historial* no trae la matriz de no regresión (preservado / ampliado / corregido / retirado)');
    }
  }

  // Avisos.
  const vagas = new RegExp(`(^|[^\\p{L}])(${VAGAS.map((v) => v.replace('/', '\\/')).join('|')})(?=$|[^\\p{L}])`, 'iu');
  for (const title of ['Reglas', 'Escenarios de aceptación']) {
    for (const l of get(title) ? get(title).body : []) {
      const m = l.text.match(vagas);
      if (m && !NUMERO.test(l.text)) warn('AVISO-VAGO', l.line, `"${m[2]}" sin un número o una definición al lado`);
    }
  }
  for (const title of ['Reglas', 'Flujos', 'Escenarios de aceptación']) {
    for (const l of get(title) ? get(title).body : []) {
      const m = l.text.match(TECNICAS);
      if (m) warn('AVISO-TECNICO', l.line, `"${m[1]}" en *${title}*: la ficha dice qué, no cómo`);
    }
  }
  lines.forEach((t, i) => {
    if (/\b(ver|consultar)\s+(la\s+)?(tabla|matriz|cat[aá]logo)\b/i.test(t)) {
      const cerca = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
      if (!/^\|/m.test(cerca)) warn('AVISO-REFERENCIA', i + 1, 'cita una tabla que no está en la ficha: traela');
    }
    if (/\[a decidir/i.test(t) && !/decide/i.test(t)) warn('AVISO-PENDIENTE', i + 1, 'decisión abierta sin quién decide');
  });
  const propio = fm.rf;
  const finEncabezado = lines.indexOf('---', 1);
  lines.forEach((t, i) => {
    if (i <= finEncabezado || /^#\s/.test(t)) return;
    for (const m of t.matchAll(ids)) {
      if (m[0] === propio) continue;
      const despues = t.slice(m.index + m[0].length);
      if (!/^\s*(—|-|:)\s*\S/.test(despues)) warn('AVISO-ID', i + 1, `${m[0]} sin su nombre al lado`);
    }
  });
  const estados = get('Estados');
  if (estados && !/^\|\s*Desde/im.test(bodyText(estados))) {
    warn('AVISO-ESTADOS', estados.line, '*Estados* sin la tabla Desde / Evento / Hacia');
  }

  return { errors, warnings };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Uso: node ai/packs/analisis-funcional/scripts/validar-ficha.js [--json] <ficha.md>...');
    process.exit(2);
  }

  const ids = idRegex(process.cwd());
  const all = { errors: [], warnings: [] };
  for (const file of files) {
    let res;
    try {
      res = validate(file, ids);
    } catch (e) {
      console.error(`NO SE PUDO VERIFICAR ${file}: ${e.message}`);
      process.exit(2);
    }
    if (res.notFicha) {
      console.error(`NO SE PUDO VERIFICAR ${file}: no es una ficha (falta \`tipo: requisito\` o \`rf:\` en el encabezado)`);
      process.exit(2);
    }
    all.errors.push(...res.errors);
    all.warnings.push(...res.warnings);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  } else {
    for (const f of all.errors) console.log(`ERROR ${f.rule} ${f.file}:${f.line} ${f.message}`);
    for (const f of all.warnings) console.log(`AVISO ${f.rule} ${f.file}:${f.line} ${f.message}`);
    console.log(`${files.length} ficha(s): ${all.errors.length} error(es), ${all.warnings.length} aviso(s).`);
    if (all.errors.length === 0) console.log('Estructura en orden. No prueba que la ficha esté bien: eso lo dice la revisión.');
  }
  process.exit(all.errors.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { validate };
