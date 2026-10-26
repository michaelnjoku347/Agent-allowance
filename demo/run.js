/**
 * Three purchases, one after another, unless Bedrock is configured.
 * When Bedrock is configured, the demo asks it to choose among the live resources.
 * Otherwise:
 *   0.01 RLUSD from the allowed merchant → paid
 *   0.08 RLUSD history resource          → blocked, over per-purchase cap
 *                                       (a Ledger approval redeems this one)
 *   0.01 RLUSD from an outside merchant  → blocked, decline only
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
import { canonicalAddress, loadRules, toUnits } from '../agent/rules.js';
import { DEMO_AMOUNTS } from '../shared/demo-amounts.js';
import { readBedrockSettings } from '../server/bedrock.js';
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
    amount: process.env.PRICE_RLUSD?.trim() || DEMO_AMOUNTS.brief,
  },
  {
    task: 'Buy the extended market history',
    resourceUrl: historyResourceUrl(),
    expect: 'needs_approval',
    reason: 'over per-purchase cap',
    amount: DEMO_AMOUNTS.history,
  },
  {
    task: 'Buy a quote from an outside desk',
    resourceUrl: `${origin}/demo/unlisted`,
    expect: 'needs_approval',
    reason: 'merchant not allowed',
  },
];

function sameAmount(left, right) {
  try {
    return toUnits(left) === toUnits(right);
  } catch {
    return false;
  }
}

function explainAllowlist(address) {
  const shown = address || 'your merchant payout';
  console.error(`The payout ${shown} is not in allowedMerchants in agent/rules.json.`);
  console.error('The demo will not pay until that address is on the allowlist.');
  console.error('Write the real payout into agent/rules.json with:');
  console.error('  npm run setup:payments -- --from <starter> --use-agent-as-submitter');
  console.error('That command keeps the budget, cap, expiry, and denylist, and replaces allowedMerchants with the payout.');
  console.error('Or add the address under allowedMerchants in agent/rules.json yourself.');
}

function labelFor(result) {
  if (result?.plan?.source === 'bedrock') return 'Amazon Bedrock';
  return 'Fallback (Bedrock not configured)';
}

async function main() {
  const payout = process.env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '';
  if (!payout) {
    explainAllowlist('');
    process.exitCode = 1;
    return;
  }
  let address;
  try {
    address = canonicalAddress(payout);
  } catch {
    explainAllowlist(payout);
    process.exitCode = 1;
    return;
  }
  const rules = loadRules();
  if (!rules.allowedMerchants.includes(address)) {
    explainAllowlist(address);
    process.exitCode = 1;
    return;
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
    if (history.status === 404) throw new Error(`The ${DEMO_AMOUNTS.history} RLUSD history resource is not running.`);
  } catch (error) {
    if (String(error.message ?? '').includes('history resource')) throw error;
    throw new Error(`The ${DEMO_AMOUNTS.history} RLUSD history merchant is not running. Start it with npm run merchant.`);
  }

  if (readBedrockSettings().configured) {
    console.log('Amazon Bedrock is configured. The demo asks Bedrock to choose one live resource.');
    const result = await runOnce({ task: 'Buy the morning market brief' });
    console.log(`→ ${result.line}`);
    console.log(labelFor(result));
    return;
  }

  console.log('Fallback (Bedrock not configured)');
  let failed = false;
  for (const step of steps) {
    try {
      const result = await runOnce({ task: step.task, resourceUrl: step.resourceUrl });
      console.log(`→ ${result.line}`);
      console.log(labelFor(result));
      const wrongDecision = result.decision !== step.expect;
      const wrongReason = step.reason && result.reason !== step.reason;
      const wrongAmount = step.amount && !sameAmount(result.amount, step.amount);
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
