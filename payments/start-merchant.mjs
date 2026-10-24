import fs from 'node:fs';
const settings = JSON.parse(fs.readFileSync(new URL('./x402-settings.json', import.meta.url), 'utf8'));
process.env.AP4M_API_URL = 'https://hackathon.ap4m.build';
process.env.MERCHANT_ID = settings.merchantId;
process.env.MERCHANT_PAYOUT = settings.payout;
// Local hackathon demo: use the existing funded test wallet to submit redemptions.
// Merchant payout remains the separate merchant wallet. A separate gas payer can be set later.
process.env.MERCHANT_SUBMITTER_KEY ||= process.env.AGENT_PRIVATE_KEY;
process.env.STATE_DIRECTORY = './merchant-state';
await import('./example-x402-merchant.mjs');
