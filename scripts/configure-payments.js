import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildConfiguration({ current = {}, source = {}, settings = {}, rules, useAgentAsSubmitter = false }) {
  const env = { ...source, ...current };
  for (const key of ['AGENT_PRIVATE_KEY', 'TEAM_NAME', 'MERCHANT_ID', 'MERCHANT_PAYOUT_ADDRESS', 'MERCHANT_SUBMITTER_KEY']) {
    env[key] = current[key]?.trim() || source[key]?.trim() || '';
  }
  env.MERCHANT_ID ||= settings.merchantId || '';
  env.MERCHANT_PAYOUT_ADDRESS ||= settings.payout || source.MERCHANT_PAYOUT || '';
  if (useAgentAsSubmitter) env.MERCHANT_SUBMITTER_KEY ||= env.AGENT_PRIVATE_KEY;
  for (const key of ['AGENT_PRIVATE_KEY', 'TEAM_NAME', 'MERCHANT_ID', 'MERCHANT_PAYOUT_ADDRESS', 'MERCHANT_SUBMITTER_KEY']) {
    if (!env[key]) throw new Error('Missing ' + key + '. Supply the tested starter folder; use --use-agent-as-submitter only for the existing same-wallet demo.');
  }
  try {
    env.AGENT_PRIVATE_KEY = new ethers.Wallet(env.AGENT_PRIVATE_KEY).privateKey;
    env.MERCHANT_SUBMITTER_KEY = new ethers.Wallet(env.MERCHANT_SUBMITTER_KEY).privateKey;
  }
  catch { throw new Error('A local wallet key is invalid. No key values are printed.'); }
  if (!/^0x[0-9a-f]{64}$/i.test(env.MERCHANT_ID)) throw new Error('MERCHANT_ID must be a 32-byte merchant ID.');
  if (!ethers.isAddress(env.MERCHANT_PAYOUT_ADDRESS)) throw new Error('MERCHANT_PAYOUT_ADDRESS is invalid.');
  const api = env.AP4M_API_URL || 'https://hackathon.ap4m.build';
  if (api !== 'https://hackathon.ap4m.build') throw new Error('Expected the hackathon AP4M service.');
  env.AP4M_API_URL = api;
  env.RESOURCE_URL ||= 'http://127.0.0.1:4308/resource';
  env.MERCHANT_PORT ||= '4308';
  env.PORT ||= '8787';
  env.CHANNEL_CAP ||= '5';
  if (env.CHANNEL_ID) throw new Error('Clear CHANNEL_ID locally before setup; the integrated agent selects an open channel.');
  const payout = env.MERCHANT_PAYOUT_ADDRESS.toLowerCase();
  const localRules = structuredClone(rules);
  // The configured seller is explicitly the merchant being integrated for this demo.
  localRules.allowedMerchants = [payout];
  localRules.merchantLabels = { [payout]: 'Team merchant' };
  return { env, rules: localRules };
}

export function main(argv = process.argv.slice(2), projectRoot = root) {
  const root = projectRoot;
  const sourceIndex = argv.indexOf('--from');
  const sourceDir = sourceIndex < 0 ? join(root, 'payments') : resolve(argv[sourceIndex + 1] || '');
  if (sourceIndex >= 0 && !argv[sourceIndex + 1]) throw new Error('--from requires the tested starter folder path.');
  const readEnv = file => existsSync(file) ? dotenv.parse(readFileSync(file)) : {};
  const settingsFile = join(sourceDir, 'x402-settings.json');
  const rulesFile = join(root, 'agent/rules.local.json');
  const current = readEnv(join(root, '.env'));
  if (current.ALLOWANCE_RULES && resolve(root, current.ALLOWANCE_RULES) !== rulesFile) throw new Error('An existing custom ALLOWANCE_RULES file is configured; keep its setup rather than replacing it.');
  if (existsSync(rulesFile)) throw new Error('agent/rules.local.json already exists. Keep your current rules and edit them locally if needed.');
  const configured = buildConfiguration({
    current,
    source: readEnv(join(sourceDir, '.env')),
    settings: existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {},
    rules: JSON.parse(readFileSync(join(root, 'agent/rules.json'), 'utf8')),
    useAgentAsSubmitter: argv.includes('--use-agent-as-submitter'),
  });
  configured.env.ALLOWANCE_RULES = rulesFile.replaceAll('\\', '/');
  // Write only local, gitignored files. Keys are never printed or sent to a service.
  writeFileSync(rulesFile, JSON.stringify(configured.rules, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const serialized = Object.entries(configured.env).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
  writeFileSync(join(root, '.env'), serialized, { mode: 0o600 });
  console.log('Configured local .env and agent/rules.local.json. No payment sent.');
  console.log('Next: npm run server; npm run merchant; npm run dashboard; npm run demo (one 1 RLUSD purchase).');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
