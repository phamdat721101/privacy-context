/**
 * seed-translator-agent.ts — publishes the EN→VI translator lighthouse via
 * the existing `/v3/marketplace/seller/publish` route. Idempotent: re-runs
 * are safe because `sellerPublishService.publish()` keys on slug + creator.
 *
 * Usage:
 *   API_URL=http://localhost:3001 \
 *   PHAM_WALLET_ADDRESS=0x... \
 *     npx tsx scripts/seed-translator-agent.ts
 *
 * Or against the live testnet:
 *   API_URL=https://13-229-63-192.sslip.io PHAM_WALLET_ADDRESS=0x... \
 *     npx tsx scripts/seed-translator-agent.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const WALLET = process.env.PHAM_WALLET_ADDRESS;

if (!WALLET) {
  console.error('PHAM_WALLET_ADDRESS env required (the platform creator wallet)');
  process.exit(1);
}

const manifestYaml = readFileSync(
  resolve(__dirname, '..', 'examples', 'translator', 'manifest.yaml'),
  'utf8',
);

// Minimal field projection — sellerPublishService.publish() expects this
// shape (per packages/api/src/routes/v3-marketplace.ts).
const body = {
  title: 'Legal NDA Translator (English → Vietnamese)',
  slug: 'translator-en-vi',
  short_description:
    'Translates English NDAs into Vietnamese, preserving clause numbering and legal terminology.',
  domain: 'legal',
  persona_system_prompt: extractSystemPrompt(manifestYaml),
  pricing_amount_usdc: '1.50',
  pricing_rails: ['x402'],
  manifest_yaml: manifestYaml,
};

async function main() {
  const r = await fetch(`${API_URL}/v3/marketplace/seller/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wallet-address': WALLET!,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('publish failed', r.status, j);
    process.exit(1);
  }
  console.log('translator agent published');
  console.log(JSON.stringify(j, null, 2));
}

function extractSystemPrompt(yaml: string): string {
  const m = yaml.match(/system_prompt:\s*\|\n([\s\S]+)$/);
  return m ? m[1].trim() : 'You are a senior legal translator (EN ↔ VI).';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
