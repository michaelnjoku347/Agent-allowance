'use strict';
const fs = require('node:fs');
const { ethers } = require('ethers');
const { signIn } = require('./ap4m-hackathon-sdk.cjs');
async function main() {
  if (!process.env.AGENT_PRIVATE_KEY) throw new Error('Your local .env needs AGENT_PRIVATE_KEY.');
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
  if (wallet.address.toLowerCase() !== '0x35be304740fbfe2bf9d6e1890f488e0fa1d0653a') throw new Error('Wallet does not match registered agent.');
  const api = 'https://hackathon.ap4m.build';
  const session = await signIn(api, 'AMD', wallet);
  const response = await fetch(api + '/public/participant/me', {
    headers: { Authorization: 'Bearer ' + session.token },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Merchant lookup returned HTTP ' + response.status);
  const me = await response.json();
  const ids = new Set();
  function visit(value, path = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path + '.' + key;
      if (typeof child === 'string' && (/^merchant_?id$/i.test(key) || (key === 'id' && /merchants?/i.test(path))) && /^0x[0-9a-f]{64}$/i.test(child)) ids.add(child);
      if (child && typeof child === 'object') visit(child, nextPath);
    }
  }
  visit(me);
  if (ids.size !== 1) {
    console.log('Merchant IDs found:', [...ids]);
    console.log('Could not select one merchant automatically. Find Merchant ID in AP4M > My Setup > Your registered identities.');
    return;
  }
  const merchantId = [...ids][0];
  fs.writeFileSync('x402-settings.json', JSON.stringify({ merchantId, payout: '0x4dd838f5f158ec098918ff2b8c8cbb72d035e3bd' }, null, 2));
  console.log('Merchant ID:', merchantId);
  console.log('Saved x402-settings.json. No payment sent.');
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
