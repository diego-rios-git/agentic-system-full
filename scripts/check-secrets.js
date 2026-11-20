#!/usr/bin/env node
/**
 * check-secrets.js
 *
 * Detecta secretos en un bloque de texto: API keys, tokens JWT, claves
 * privadas, credenciales embebidas en connection strings, y asignaciones de
 * password/secret/token a un literal (no a una variable de entorno).
 *
 * Aplica la regla de ai/core/rules/datos-sensibles.md: "si no lo pegarías en un
 * ticket que puede leer cualquiera, no lo pegues en un prompt".
 *
 * No barre el repo: recibe el texto por stdin. Lo usa el hook
 * scripts/hooks/pre-write-secrets.js para revisar el contenido de un
 * Write/Edit ANTES de que se escriba, y también se puede correr a mano:
 *
 *   node scripts/check-secrets.js < archivo.txt
 *   echo "$texto" | node scripts/check-secrets.js --json
 *
 * Reglas verificadas:
 *   SEC-1  Bloque de clave privada (BEGIN ... PRIVATE KEY)
 *   SEC-2  Access key de AWS (AKIA...)
 *   SEC-3  Token con forma de JWT (tres segmentos base64url)
 *   SEC-4  Credenciales embebidas en una URL (user:pass@host)
 *   SEC-5  api_key / secret / token / password asignado a un literal largo
 *
 * No hay baseline: cada llamada evalúa contenido nuevo que todavía no
 * existe en ningún archivo, no el repo completo. No hay deuda que congelar.
 *
 * SEC-5 solo marca LITERALES. Una asignación cuyo valor se lee de otro lado
 * (`token = body.access_token`, `secret = process.env.X`) no es un secreto pegado
 * en el código: es el camino correcto. Cuando ese mismo valor aparece entre
 * comillas pero es una ruta de propiedades (`"body.access_token"`: el nombre de
 * dónde leerlo), tampoco se marca. Límite conocido: un valor que es el NOMBRE de
 * un campo en snake_case (`password: "password_field_name"`) sí se marca, porque
 * no se distingue de una clave débil; se arregla con un placeholder reconocible.
 * Los casos están fijados en test/check-secrets-sec5.test.js.
 *
 * Heurística, no un parser de credenciales: los falsos negativos son
 * posibles (un secreto con nombre de variable no reconocido pasa). Los
 * falsos positivos se mitigan con una lista de placeholders conocidos
 * (`changeme`, `xxx`, `<tu-api-key>`, etc.) y excluyendo referencias a
 * variables de entorno (`process.env.X`, `configService.get(...)`).
 */

'use strict';

// ---------------------------------------------------------------------------
// Placeholders conocidos: si el valor capturado matchea esto, no es un
// secreto real, es un ejemplo o una plantilla.
// ---------------------------------------------------------------------------

const PLACEHOLDER_VALUE = new RegExp(
  [
    '^(change[-_]?me|your[-_]?|xxx+|\\*+|example|ejemplo|dummy|fake|placeholder',
    '|redacted|test|sample|<.*>|\\$\\{.*\\}|null|undefined|todo|tbd|foo|bar)',
  ].join(''),
  'i',
);

const ENV_REFERENCE_LINE = /process\.env|configService\.get|getOrThrow|import\.meta\.env/;

/** `body.access_token`, `res.data.token`: una ruta de propiedades, no un secreto. */
const PROPERTY_PATH = /^[A-Za-z_$][\w$]*(?:\?\.|\.)[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*$/;

function isPlaceholder(value) {
  const v = value.replace(/^['"]|['"]$/g, '');
  if (!v || v.length < 8) return true;
  if (PLACEHOLDER_VALUE.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true; // "xxxxxxxx", "00000000"
  return false;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

const RULES = [
  {
    rule: 'SEC-1',
    title: 'Bloque de clave privada',
    pattern: /-----BEGIN\s+(RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    message: () => 'Bloque de clave privada (BEGIN ... PRIVATE KEY). Nunca se pega una clave privada real.',
  },
  {
    rule: 'SEC-2',
    title: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    message: (m) => `Access key de AWS con forma real (${m[0].slice(0, 8)}...). Rotala si es real.`,
  },
  {
    rule: 'SEC-3',
    title: 'Token JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    message: () => 'Token con forma de JWT. Si es un token real de un usuario, no se comparte — describí el caso, no pegues el token.',
  },
  {
    rule: 'SEC-4',
    title: 'Credenciales en URL',
    pattern: /\b[a-z][a-z0-9+.-]{1,15}:\/\/([^\s'"<>@/]+):([^\s'"<>@]+)@[^\s'"<>]+/gi,
    message: () => 'Connection string con usuario y password embebidos.',
    // Placeholder típico: postgres://usuario:password@host
    skip: (m) => isPlaceholder(m[1]) && isPlaceholder(m[2]),
  },
  {
    rule: 'SEC-5',
    title: 'Secreto asignado a un literal',
    // Identificador genérico (soporta camelCase/snake_case: dbPassword,
    // STRIPE_API_KEY, client_secret) seguido de un literal entre comillas.
    pattern: /\b([A-Za-z_$][\w$]*)\s*[:=]\s*['"]([^'"\n]{8,})['"]/g,
    message: (m) => `"${m[1]}" asignado a un valor literal, no a una variable de entorno.`,
    skip: (m, line) => {
      if (ENV_REFERENCE_LINE.test(line)) return true;
      if (isPlaceholder(m[2])) return true;
      // Solo en SEC-5: en una URL (SEC-4) `usuario:clave.x@host` sí es una credencial.
      if (PROPERTY_PATH.test(m[2])) return true;
      return !isSecretLikeIdentifier(m[1]);
    },
  },
];

/** Normaliza un identificador (camelCase/snake_case) y busca una keyword de secreto como substring. */
function isSecretLikeIdentifier(name) {
  const normalized = name.toLowerCase().replace(/[_$-]/g, '');
  return SECRET_KEYWORDS.some((k) => normalized.includes(k));
}

const SECRET_KEYWORDS = [
  'apikey', 'secret', 'password', 'passwd', 'pwd',
  'privatekey', 'accesstoken', 'refreshtoken', 'clientsecret', 'authtoken',
];

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

function scan(text) {
  const lines = text.split('\n');
  const findings = [];

  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(line))) {
        if (rule.skip && rule.skip(m, line)) continue;
        findings.push({
          rule: rule.rule,
          title: rule.title,
          line: i + 1,
          message: rule.message(m),
        });
      }
    }
  });

  return findings;
}

function readStdin() {
  try {
    return require('fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');

  const text = readStdin();
  if (!text.trim()) process.exit(0);

  const findings = scan(text);

  if (json) {
    console.log(JSON.stringify(findings));
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log('  Sin secretos detectados.');
    process.exit(0);
  }

  console.log(`\n  ${findings.length} hallazgo(s) — ai/core/rules/datos-sensibles.md\n`);
  for (const f of findings) {
    console.log(`  [${f.rule}] línea ${f.line}: ${f.message}`);
  }
  console.log('');
  process.exit(1);
}

main();
