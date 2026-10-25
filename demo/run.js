/**
 * Three purchases, one after another:
 *   1 RLUSD from the allowed merchant → paid
 *   8 RLUSD history resource          → blocked, over per-purchase cap
 *                                       (a Ledger approval redeems this one)
 *   1 RLUSD from an outside merchant  → blocked, decline only
 *
 * Start the API, the merchant, and the dashboard first.
 *   npm run server
 *   npm run merchant
 *   npm run dashboard
 *   npm run demo
 */

import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOnce } from '../agent/agent.js';
import { canonicalAddress, loadRules } from '../agent/rules.js';
import { historyResourceUrl } from '../shared/catalog.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

const port = Number(process.env.MERCHANT_PORT || 4308);
const origin = `http://127.0.0.1:${port}`;

const steps = [
  {
    task: 'Buy the morning market brief',
    resourceUrl: `${origin}/resource`,
    expect: 'allow',
    amount: '1',
  },
  {
    task: 'Buy the extended market history',
    resourceUrl: historyResourceUrl(),
    expect: 'needs_approval',
    reason: 'over per-purchase cap',
    amount: '8',
  },
  {
    task: 'Buy a quote from an outside desk',
    resourceUrl: `${origin}/demo/unlisted`,
    expect: 'needs_approval',
    reason: 'merchant not allowed',
  },
];

async function main() {
  const payout = process.env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '';
  if (!payout) throw new Error('Set MERCHANT_PAYOUT_ADDRESS in .env. The merchant pays out to that address.');
  const address = canonicalAddress(payout);
  const rules = loadRules();
  if (!rules.allowedMerchants.includes(address)) {
    throw new Error(
      `Add ${address} to allowedMerchants in agent/rules.json. `
      + 'The 1 RLUSD sale has to be allowed, and the 8 RLUSD quote has to fail the per-purchase cap.',
    );
  }

  let health;
  try {
    health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error('Merchant is not running. Start it with npm run merchant.');
  }
  if (!health.ok) throw new Error('Merchant is not running. Start it with npm run merchant.');
  const historyUrl = historyResourceUrl();
  try {
    const history = await fetch(historyUrl, { signal: AbortSignal.timeout(5_000) });
    if (history.status === 404) throw new Error('The 8 RLUSD history resource is not running.');
  } catch (error) {
    if (String(error.message ?? '').includes('history resource')) throw error;
    throw new Error('The 8 RLUSD history merchant is not running. Start it with npm run merchant.');
  }

  let failed = false;
  for (const step of steps) {
    try {
      const result = await runOnce({ task: step.task, resourceUrl: step.resourceUrl });
      console.log(`→ ${result.line}`);
      const wrongDecision = result.decision !== step.expect;
      const wrongReason = step.reason && result.reason !== step.reason;
      const wrongAmount = step.amount && result.amount !== step.amount;
      if (wrongDecision || wrongReason || wrongAmount) {
        const expected = step.reason ? `${step.expect} (${step.reason})` : step.expect;
        console.error(`Expected ${expected}.`);
        failed = true;
      }
    } catch (error) {
      console.log(`→ blocked — ${error.message ?? error}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
