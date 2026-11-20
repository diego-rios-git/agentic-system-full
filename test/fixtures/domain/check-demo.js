#!/usr/bin/env node
/**
 * check-demo.js — un gate de dominio de juguete, armado con `lib/domain-gate.js`
 * exactamente como lo armaría un proyecto. Dominio inventado: "importes".
 *
 * Es el fixture de `test/domain-gate.test.js`; no es una regla de la base.
 * `DEMO_BAD_FIXTURES=1` agrega un fixture equivocado para probar `--validate-fixtures`.
 */

'use strict';

const domain = require('../../../scripts/lib/domain-gate');

const badFixture = process.env.DEMO_BAD_FIXTURES === '1';

domain.run({
  name: 'demo',
  policy: 'ai/local/rules/importes.md',
  vocabulary: {
    domain: ['amount', 'price', 'balance'],
    ambiguous: ['limit', 'cap'],
    qualifiers: ['daily', 'max', 'min'],
    disqualifiers: ['count', 'percent', 'id', 'repetitions'],
  },
  // El módulo que ES el punto de conversión.
  allowlist: ['src/lib/importes/'],
  // Exención POR LÍNEA: formatear en el acto no es aritmética.
  exemptLine: (line) => /\bIntl\.NumberFormat\b/.test(line),
  rules: [
    {
      id: 'DEMO-1',
      title: 'Conversión a punto flotante sobre un importe',
      allowlistable: true,
      match: ({ line, isDomainName, nameOf }) => {
        const out = [];
        for (const m of line.matchAll(/\b(?:parseFloat|Number)\s*\(\s*([^)]{0,80})/g)) {
          if (isDomainName(m[1])) out.push({ field: nameOf(m[1]) });
        }
        return out;
      },
      fixtures: {
        bad: ['const x = parseFloat(order.amount);', 'Number(daily_limit) > 3'],
        good: ['const x = parseFloat(page_limit);', 'Number(item_count)', "new Intl.NumberFormat('es').format(Number(amount))"],
      },
    },
    {
      id: 'DEMO-2',
      title: 'Campo de importe tipado number',
      match: ({ line, isDomainName }) => {
        const m = /^\s*(?:readonly\s+)?([A-Za-z_]\w*)\s*[!?]?\s*:\s*number\s*;/.exec(line);
        return m && isDomainName(m[1]) ? [{ field: m[1] }] : [];
      },
      fixtures: { bad: ['  amount: number;'], good: ['  amount: string;', '  amount_repetitions: number;'] },
    },
  ],
  fixtures: {
    names: {
      domain: ['amount', 'totalAmount', 'daily_limit', 'maxCap', 'order.price', "row['balance']"],
      notDomain: ['limit', 'page_limit', 'amount_repetitions', 'cap', 'percentAmount', 'user_id', ...(badFixture ? ['price'] : [])],
    },
  },
});
