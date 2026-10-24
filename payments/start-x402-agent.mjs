import fs from 'node:fs';
import preflightModule from './preflight.cjs';
if (fs.existsSync('./agent-state/purchase.json')) {
  throw new Error('A previous x402 purchase is retained. Recover/verify it before starting another purchase; do not open a new channel on retry. See payments/README.md.');
}
await preflightModule.preflight(true);
const settings = JSON.parse(fs.readFileSync(new URL('./x402-settings.json', import.meta.url), 'utf8'));
process.env.AP4M_API_URL = 'https://hackathon.ap4m.build';
process.env.MERCHANT_ID = settings.merchantId;
process.env.CHANNEL_ID = '';
process.env.STATE_DIRECTORY = './agent-state';
await import('./example-x402-agent.mjs');
