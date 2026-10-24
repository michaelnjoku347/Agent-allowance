'use strict';
const { ethers } = require('ethers');
const AGENT = '0x35be304740fbfe2bf9d6e1890f488e0fa1d0653a';
const MERCHANT = '0x4dd838f5f158ec098918ff2b8c8cbb72d035e3bd';
const LEDGER = '0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91';
const API = 'https://hackathon.ap4m.build';
async function preflight(requireKey = false) {
  if (process.env.AP4M_API_URL && process.env.AP4M_API_URL !== API) throw new Error('Unexpected AP4M API URL.');
  if (process.env.PAYMENT_LEDGER && process.env.PAYMENT_LEDGER.toLowerCase() !== LEDGER.toLowerCase()) throw new Error('Unexpected PaymentLedger override.');
  if (process.env.TEAM_NAME && process.env.TEAM_NAME !== 'AMD') throw new Error('Expected team AMD.');
  const key = process.env.AGENT_PRIVATE_KEY;
  if (requireKey && !key) throw new Error('Add the registered test wallet private key to .env locally first.');
  if (key) {
    let wallet;
    try { wallet = new ethers.Wallet(key); } catch { throw new Error('AGENT_PRIVATE_KEY is invalid.'); }
    if (wallet.address.toLowerCase() !== AGENT) throw new Error('The .env key does not match the registered AP4M wallet.');
    console.log('Local key matches registered agent.');
  } else console.log('No key configured; checking public addresses only.');
  const response = await fetch(API + '/public/config', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('AP4M config returned HTTP ' + response.status);
  const config = await response.json();
  if (Number(config.network.chainId) !== 1449000) throw new Error('AP4M network is not XRPL EVM Testnet.');
  if (config.contracts.paymentLedger.toLowerCase() !== LEDGER.toLowerCase()) throw new Error('AP4M PaymentLedger changed; review a new starter kit.');
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || config.network.rpcUrl);
  try {
    if ((await provider.getNetwork()).chainId !== 1449000n) throw new Error('RPC is on the wrong network.');
    if (await provider.getCode(LEDGER) === '0x') throw new Error('PaymentLedger contract missing.');
    const token = new ethers.Contract(config.contracts.rlusdToken, [
      'function decimals() view returns (uint8)',
      'function balanceOf(address) view returns (uint256)',
    ], provider);
    const decimals = Number(await token.decimals());
    if (decimals !== 18) throw new Error('Token decimals differ from the bundled SDK.');
    const balance = await provider.getBalance(AGENT);
    const merchantBalance = await token.balanceOf(MERCHANT);
    console.log('Network: XRPL EVM Testnet (1449000)');
    console.log('Registered agent:', AGENT);
    console.log('Agent gas balance:', ethers.formatEther(balance), 'test XRP');
    console.log('Merchant:', MERCHANT);
    console.log('Merchant balance:', ethers.formatUnits(merchantBalance, decimals), 'test RLUSD');
    console.log('PaymentLedger matches the downloaded starter.');
    if (balance === 0n) throw new Error('Agent needs test XRP for gas. Faucet: ' + config.network.faucetUrl);
    const cap = ethers.parseUnits(process.env.CHANNEL_CAP || '5', 18);
    if (cap < ethers.parseUnits('1', 18) || cap > ethers.parseUnits('5', 18)) throw new Error('This runner requires a channel cap between 1 and 5 RLUSD.');
    console.log('Planned purchase: 1 test RLUSD; channel cap:', ethers.formatUnits(cap, 18), 'RLUSD.');
    return { config, agent: AGENT, merchant: MERCHANT };
  } finally { provider.destroy(); }
}
module.exports = { preflight, AGENT, MERCHANT };
if (require.main === module) preflight().catch(error => {
  console.error('Check failed:', error.shortMessage || error.message);
  process.exitCode = 1;
});
