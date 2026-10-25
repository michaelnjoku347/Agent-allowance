/**
 * Check the demo before a judge walks up.
 * Bedrock being unconfigured is reported, and it is not a failure.
 * A problem exits 1. This script does not pay anyone.
 */

import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOpenChannel, walletConfigured } from '../agent/chain-spend.js';
import { formatRlusd, loadRules, toUnits } from '../agent/rules.js';
import { devSignerEnabled } from '../server/backup-demo.js';
import { readBedrockSettings } from '../server/bedrock.js';
import { spentRlusd } from '../server/store.js';
import { historyResourceUrl, merchantOrigin } from '../shared/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function evaluatePreflight(facts = {}) {
  const problems = [];
  if (!facts.approverSet) {
    problems.push('Set APPROVER_ADDRESS to the Ledger account that may approve a purchase.');
  }
  if (facts.devSigner) {
    problems.push('ALLOWANCE_DEV_SIGNER is on. Turn it off before a real demo.');
  }
  if (!facts.walletConfigured) {
    problems.push('Set AGENT_PRIVATE_KEY and TEAM_NAME before checking the channel.');
  } else if (!facts.channelRead) {
    problems.push('The payment channel could not be read.');
  } else {
    try {
      if (facts.channelCap == null || toUnits(facts.channelCap) < toUnits(facts.budget)) {
        problems.push(`Channel cap ${facts.channelCap ?? 'missing'} RLUSD is below the budget of ${facts.budget} RLUSD.`);
      }
    } catch {
      problems.push('The channel cap could not be compared with the budget.');
    }
    if (facts.redeemed != null && facts.localSpent != null && facts.redeemed !== facts.localSpent) {
      problems.push(`On-chain redeemed ${facts.redeemed} RLUSD does not match local spent ${facts.localSpent} RLUSD.`);
    }
  }
  if (!facts.briefUp) problems.push(`The 1 RLUSD merchant is not answering at ${facts.briefUrl || 'the brief URL'}.`);
  if (!facts.historyUp) problems.push(`The 8 RLUSD history merchant is not answering at ${facts.historyUrl || 'the history URL'}.`);
  const mode = facts.bedrockConfigured ? 'Amazon Bedrock' : 'Fallback (Bedrock not configured)';
  return { ok: problems.length === 0, problems, mode };
}

async function probe(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

export async function gatherPreflight(env = process.env) {
  dotenv.config({ path: join(root, '.env') });
  const rules = loadRules();
  const briefUrl = `${merchantOrigin(env)}/resource`;
  const historyUrl = historyResourceUrl(env);
  let chain = null;
  let channelRead = false;
  if (walletConfigured(env)) {
    try {
      chain = await readOpenChannel(env, { fresh: true, timeoutMs: 3000 });
      channelRead = Boolean(chain);
    } catch {
      chain = null;
      channelRead = false;
    }
  }
  const localSpent = formatRlusd(toUnits(await spentRlusd()));
  return {
    approverSet: Boolean(String(env.APPROVER_ADDRESS ?? '').trim()),
    devSigner: devSignerEnabled(env),
    walletConfigured: walletConfigured(env),
    channelRead,
    channelCap: chain?.cap ?? null,
    redeemed: chain?.redeemed ?? null,
    budget: formatRlusd(rules.budget),
    localSpent,
    briefUp: await probe(briefUrl),
    historyUp: await probe(historyUrl),
    briefUrl,
    historyUrl,
    bedrockConfigured: readBedrockSettings(env).configured,
  };
}

async function main() {
  const facts = await gatherPreflight();
  const result = evaluatePreflight(facts);
  console.log(`Run-agent mode: ${result.mode}`);
  if (result.ok) {
    console.log('Preflight ok. Channel cap covers the budget, redeemed matches local spent, and both merchant routes answered.');
    return;
  }
  for (const problem of result.problems) console.error(problem);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
