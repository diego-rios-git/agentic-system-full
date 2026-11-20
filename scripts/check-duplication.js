#!/usr/bin/env node
/**
 * check-duplication.js
 *
 * Detecta código duplicado con `jscpd` — herramienta libre, determinista, sin
 * modelo de lenguaje de por medio.
 *
 * Corre vía `npx --yes jscpd`: no requiere instalación previa ni un
 * `package.json` en la raíz del workspace.
 *
 * Por qué excluye los tests por defecto: la repetición entre archivos de test
 * —preparación de datos, dobles de prueba— es normal y a menudo deseable, y
 * suele ser la mayoría de los clones detectados. Ahogaría la señal real, que
 * está en el código de producción. `--include-tests` los suma si alguien quiere
 * mirarlos a propósito.
 *
 * Códigos de salida: 0 sin duplicación nueva · 1 hay duplicación · 2 no se pudo
 * verificar (jscpd no disponible, configuración inválida).
 *
 * Uso:
 *   node scripts/check-duplication.js --repo mi-api
 *   node scripts/check-duplication.js --repo mi-api --json
 *   node scripts/check-duplication.js --repo mi-api --write-baseline
 *   node scripts/check-duplication.js --repo mi-api --baseline
 *   node scripts/check-duplication.js --repo mi-api --include-tests
 */

'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('./lib/workspace-config');
const baseline = require('./lib/baseline');
const languages = require('./lib/languages');

const ROOT = config.ROOT;
const BASELINE_NAME = 'duplication';

/** Umbrales: por debajo de esto, un "clon" es ruido — importes, andamiaje corto. */
const MIN_LINES = 10;
const MIN_TOKENS = 70;

/**
 * Qué es un test y qué es una ruta generada lo responde el perfil de lenguaje
 * de los packs activos, no una constante de este archivo. Con la constante
 * cableada a `.spec`/`.test`, en un repositorio .NET los `*Tests.cs` entraban al
 * análisis y la duplicación entre preparaciones de prueba —que es normal y a
 * menudo deseable— se llevaba puesta toda la señal real.
 */

/**
 * Rutas cuyo contenido se genera y no se refactoriza.
 *
 * Las migraciones de esquema son el caso típico: son un registro histórico que
 * solo crece, su repetitividad viene del generador, y una migración ya aplicada
 * no se toca — extraer código compartido de ellas rompería la reproducibilidad
 * del historial.
 *
 * Un proyecto puede ampliar la lista con `duplication.ignorePaths` en
 * `ai-workspace.json`.
 */
const DEFAULT_IGNORED = ['migrations', 'generated', '__generated__'];

function ignoredPattern(cfg) {
  const extra = (cfg.raw.duplication && cfg.raw.duplication.ignorePaths) || [];
  const names = [...DEFAULT_IGNORED, ...extra].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Insensible a mayúsculas: el generador de cada stack elige la capitalización
  // y no hay una sola convención. EF Core escribe `Migrations/`, TypeORM
  // `migrations/`. Un regex sensible a mayúsculas cubre uno y deja pasar el otro
  // sin decir nada.
  return new RegExp(`(^|[\\\\/])(${names.join('|')})[\\\\/]`, 'i');
}

// ---------------------------------------------------------------------------
// Ejecutar jscpd
// ---------------------------------------------------------------------------

/**
 * jscpd solo escribe su reporte a un archivo, así que se usa un directorio
 * temporal propio que se borra siempre, incluso si algo falla.
 *
 * Devuelve `null` si no se pudo ejecutar — sin red para `npx`, por ejemplo.
 */
function runJscpd(target) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-gate-'));
  try {
    // `shell: true` es obligatorio en Windows: desde Node 24, execFileSync
    // rechaza invocar un `.cmd` — como `npx.cmd` — directamente, con EINVAL.
    // Con shell, las rutas se citan a mano por si tienen espacios.
    const q = (s) => `"${s}"`;
    const cmd = [
      'npx', '--yes', 'jscpd', q(target),
      '--min-lines', String(MIN_LINES),
      '--min-tokens', String(MIN_TOKENS),
      '--reporters', 'json',
      '--output', q(outDir),
      '--silent',
    ].join(' ');

    execFileSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 180000, stdio: 'pipe', shell: true });

    const reportPath = path.join(outDir, 'jscpd-report.json');
    if (!fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* el temporal lo limpia el sistema operativo */
    }
  }
}

// ---------------------------------------------------------------------------
// Normalizar
// ---------------------------------------------------------------------------

function toPosix(p) {
  return String(p || '').split('\\').join('/');
}

/**
 * jscpd devuelve rutas relativas al directorio escaneado. Se les repone el
 * prefijo para que el hook de escritura pueda emparejar el archivo editado.
 */
function normalize(repoName, targetPrefix, report, includeTests, ignored, profile) {
  if (!report || !Array.isArray(report.duplicates)) return [];

  const findings = [];
  for (const d of report.duplicates) {
    const fileA = `${targetPrefix}/${toPosix(d.firstFile.name)}`;
    const fileB = `${targetPrefix}/${toPosix(d.secondFile.name)}`;

    if (!includeTests && (profile.isTest(fileA) || profile.isTest(fileB))) continue;
    if (profile.isIgnoredPath(fileA) || profile.isIgnoredPath(fileB)) continue;
    if (ignored.test(fileA) || ignored.test(fileB)) continue;

    // Hash del fragmento normalizado: el mismo bloque duplicado sigue siendo el
    // mismo hallazgo aunque se mueva de línea o cambie la indentación.
    const hash = crypto
      .createHash('sha1')
      .update(String(d.fragment || '').replace(/\s+/g, ' ').trim())
      .digest('hex')
      .slice(0, 12);

    findings.push({
      rule: 'DUP-1',
      repo: repoName,
      file: fileA,
      line: d.firstFile.start,
      otherFile: fileB,
      otherLine: d.secondFile.start,
      hash,
      message:
        `${d.lines} líneas duplicadas con ${fileB}:${d.secondFile.start}. ` +
        'Extraer a una función o módulo compartido en vez de repetir.',
    });
  }
  return findings;
}

/** Sin números de línea: mover el bloque no debe reintroducir el hallazgo. */
function fingerprint(f) {
  return `${[f.file, f.otherFile].sort().join('<->')}|${f.hash}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const useBaseline = argv.includes('--baseline');
  const writeBaseline = argv.includes('--write-baseline');
  const includeTests = argv.includes('--include-tests');

  let cfg;
  try {
    cfg = config.load();
  } catch (err) {
    return config.reportAndExit(err);
  }

  const repoIdx = argv.indexOf('--repo');
  const repoName = repoIdx >= 0 ? argv[repoIdx + 1] : null;
  if (!repoName) {
    process.stderr.write(
      `\nUso: node scripts/check-duplication.js --repo (${cfg.repos.map((r) => r.name).join('|')}) ` +
        '[--json] [--baseline] [--write-baseline] [--include-tests]\n\n',
    );
    process.exit(2);
  }

  let repo;
  try {
    repo = config.repo(cfg, repoName);
  } catch (err) {
    return config.reportAndExit(err);
  }

  // Un repositorio sin clonar no es un repositorio sin duplicación. Sale con 2
  // y sin escribir en stdout: en `--json` quien consume esto es un script, que
  // lee el código de salida, y `[]` con código 0 sería "revisé y está limpio".
  if (!fs.existsSync(repo.absPath)) {
    process.stderr.write(
      `\n  ${repo.name}: el repositorio no existe en ${repo.path}. ¿Falta clonarlo?\n` +
        '  Tratarlo como NO VERIFICADO, no como "sin duplicación".\n\n',
    );
    process.exit(2);
  }

  // Preferir `src/` cuando existe: la raíz del repositorio trae configuración y
  // andamiaje cuya repetición no dice nada.
  const withSrc = path.join(repo.path, 'src');
  const targetPrefix = fs.existsSync(path.join(ROOT, withSrc)) ? toPosix(withSrc) : toPosix(repo.path);

  if (!fs.existsSync(path.join(ROOT, targetPrefix))) {
    if (asJson) process.stdout.write('[]\n');
    else console.log(`  ${repo.name}: no existe ${targetPrefix} — nada que analizar.`);
    process.exit(0);
  }

  const profile = languages.forRepo(cfg, repo);
  for (const p of profile.problems) process.stderr.write(`  aviso: ${p}
`);

  const report = runJscpd(targetPrefix);
  if (report === null) {
    // jscpd no disponible. Sale con 2 —"no pude correr"— y NO con 0 y una
    // lista vacía: en --json quien consume esto es un script, que lee el
    // código de salida y no el aviso, y una lista vacía es indistinguible de
    // "no encontré nada". Un gate roto que se lee como limpio es peor que no
    // tenerlo.
    process.stderr.write('  jscpd no disponible — gate omitido. Tratarlo como no verificado.\n');
    process.exit(2);
  }

  let findings = normalize(repo.name, targetPrefix, report, includeTests, ignoredPattern(cfg), profile);

  if (writeBaseline) {
    const res = baseline.write(BASELINE_NAME, repo.name, findings.map(fingerprint));
    console.log(`\n  Baseline de "${repo.name}": ${res.written} duplicados congelados`);
    console.log(`  Total en el archivo: ${res.total} (scopes: ${res.scopes.join(', ')})\n`);
    process.exit(0);
  }

  if (useBaseline) {
    findings = baseline.filter(findings, BASELINE_NAME, repo.name, fingerprint);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(findings) + '\n');
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log(`  ${repo.name}: sin duplicación nueva.`);
    process.exit(0);
  }

  console.log(`\n  ${findings.length} bloque(s) duplicado(s) — ${repo.name}\n`);
  for (const f of findings) {
    console.log(`  [${f.rule}] ${f.file}:${f.line}`);
    console.log(`    ${f.message}\n`);
  }
  process.exit(1);
}

main();
