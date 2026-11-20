#!/usr/bin/env node
/**
 * check-encoding.js
 *
 * Mojibake: texto UTF-8 que se leyó (o se guardó) con otra codificación y quedó
 * con secuencias raras de dos caracteres donde iba una `ó` (la A con tilde seguida de un
 * superíndice, o la raíz cuadrada seguida de un signo matemático).
 *
 *   ENC-1.1
 *
 * Por qué existe: ni el formateador ni el linter lo ven —es texto válido— y el
 * daño no es estético. Un test pasó en VERDE porque el matcher que buscaba un
 * texto en pantalla tenía la tilde rota: nunca podía coincidir, la consulta
 * devolvía vacío y la aserción negativa ("no está en el documento") se cumplía
 * siempre. Un test en verde sobre un escenario que no se probaba. Volvió a
 * pasar al editar comentarios con acentos desde una herramienta que no respetó
 * la codificación.
 *
 * Mira TODO archivo de texto versionado (markdown, python, c#, json, ts…), no
 * solo el código de un lenguaje: el mojibake aparece donde hay español, y el
 * español está en los comentarios, en los textos de la interfaz, en la
 * documentación. Un comentario sí cuenta.
 *
 * Qué marca (las familias que producen casi todos los accidentes):
 *   1. UTF-8 leído como latin-1: `Ã` o `Â` seguidos de un carácter U+0080–U+00BF
 *      (la `ó` queda como U+00C3 U+00B3, el `¿` como U+00C2 U+00BF, el `°` como U+00C2 U+00B0),
 *      y las comillas tipográficas rotas: U+00E2 U+20AC seguido de U+2122, U+201C o U+201D.
 *   2. UTF-8 leído como MacRoman: U+221A (la raíz) seguido de U+2260, U+00B0, U+2265, U+00B1,
 *      U+00A9 o U+222B (la `ó` queda como U+221A U+2265).
 *
 * Qué NO marca: `√` sola (es la raíz cuadrada), `Ã` o `Â` seguidas de una letra
 * ASCII (`ÃB`: una sigla), ni el texto legítimo en cualquier otro idioma
 * (japonés, emoji, acentos bien codificados).
 *
 * Con baseline (la huella no lleva número de línea).
 *
 * Uso:
 *   node scripts/check-encoding.js --repo mi-api [--baseline] [--json]
 *   node scripts/check-encoding.js --repo mi-api --target src/x.ts
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cli = require('./lib/gate-cli');
const config = require('./lib/workspace-config');

// Los caracteres se construyen desde su código: este archivo no puede contener,
// él mismo, el defecto que busca (se marcaría a sí mismo, y un editor que
// "arregle" la codificación al guardarlo cambiaría lo que el gate detecta).
const ch = (...codes) => String.fromCharCode(...codes);

const PATTERNS = [
  // U+00C3 o U+00C2 (A con tilde / con circunflejo) + U+0080–U+00BF
  new RegExp(`[${ch(0xc3, 0xc2)}][${ch(0x80)}-${ch(0xbf)}]`),
  // U+00E2 + U+20AC (a-circunflejo + euro) + comilla o marca registrada rota (U+2122, U+201C, U+201D)
  new RegExp(`${ch(0xe2, 0x20ac)}[${ch(0x2122, 0x201c, 0x201d)}]`),
  // U+221A (raíz) + símbolo matemático (U+2260, U+00B0, U+2265, U+00B1, U+00A9, U+222B)
  new RegExp(`${ch(0x221a)}[${ch(0x2260, 0xb0, 0x2265, 0xb1, 0xa9, 0x222b)}]`),
];

/** ¿La línea tiene mojibake? */
function hasMojibake(line) {
  return PATTERNS.some((re) => re.test(line));
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Extensiones que nunca son texto: ni se abren. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.gz', '.tgz',
  '.7z', '.rar', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.wasm',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.bin', '.sqlite', '.db',
]);

function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Los archivos versionados: los de git (seguidos y nuevos sin ignorar), para que
 * un archivo todavía sin commitear también se revise. `null` si no se pudo
 * listar: sin lista no se puede afirmar nada.
 */
function versionedFiles(dir) {
  try {
    const out = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
    );
    return [...new Set(out.split('\0').filter(Boolean))];
  } catch {
    return null;
  }
}

function scanFile(abs, rel) {
  const ext = path.extname(rel).toLowerCase();
  if (BINARY_EXT.has(ext)) return [];

  let buf;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_BYTES) return [];
    buf = fs.readFileSync(abs);
  } catch {
    return [];
  }
  if (isBinary(buf)) return [];

  const findings = [];
  const lines = buf.toString('utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!hasMojibake(lines[i])) continue;
    findings.push({
      rule: 'ENC-1.1',
      file: rel,
      line: i + 1,
      code: lines[i].trim().slice(0, 120),
      message:
        'Mojibake: texto UTF-8 leído con otra codificación (la `ó` quedó como dos caracteres raros). ' +
        'Releer el archivo como UTF-8 y reescribir el texto afectado: un matcher o un texto con la ' +
        'tilde rota nunca coincide.',
    });
  }
  return findings;
}

cli.run({
  name: 'encoding',
  script: 'scripts/check-encoding.js',
  usage: '[--target <archivo>]',

  // Sin número de línea: mover código no debe reintroducir un hallazgo congelado.
  fingerprint: (f) => `${f.rule}|${f.file}|${f.code}`,

  scan(ctx) {
    const target = ctx.arg('--target');
    let rels;

    if (target) {
      // El hook pasa la ruta relativa a la raíz del workspace; a mano suele
      // darse relativa al repositorio. Vale cualquiera de las dos.
      const fromRepo = path.join(ctx.dir, target);
      const abs = fs.existsSync(fromRepo) ? fromRepo : path.join(config.ROOT, target);
      if (!fs.existsSync(abs)) {
        return cli.unverified(`${ctx.repo.name}: --target ${target} no existe`);
      }
      rels = [path.relative(ctx.dir, abs).split(path.sep).join('/')];
    } else {
      rels = versionedFiles(ctx.dir);
      if (rels === null) {
        return cli.unverified(
          `${ctx.repo.name}: no se pudo listar los archivos versionados (¿${ctx.dir} no es un repositorio de git?)`,
        );
      }
    }

    const findings = [];
    for (const rel of rels) findings.push(...scanFile(path.join(ctx.dir, rel), rel));

    return cli.findings(findings, { emptyMessage: `sin mojibake (${rels.length} archivos de texto revisados)` });
  },
});
