import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { PARTICIPANT_LEDGER_INTERFACE } from '@ap4m/sdk';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEMO_AMOUNTS } from '../shared/demo-amounts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A test channel the size of one per-purchase cap, and a voucher one cent past it.
const CAP_TEST_RLUSD = DEMO_AMOUNTS.cap;
const STEP_RLUSD = DEMO_AMOUNTS.step;
const require = createRequire(import.meta.url);
const { signIn, requestChannel, signVoucher, closeChannel } = require('../agent/ap4m-hackathon-sdk.cjs');

/** A revert is evidence only if the same channel accepts an in-cap voucher at the same block. */
export async function compareVouchers({ acceptedCall, rejectedCall }) {
  await acceptedCall();
  let rejection;
  try { await rejectedCall(); } catch (error) { rejection = error; }
  if (!rejection) throw new Error('FAIL: the over-cap voucher was accepted in simulation.');
  if (rejection.code !== 'CALL_EXCEPTION' || !/^0x[0-9a-f]{8,}$/i.test(rejection.data || '')) {
    throw new Error('Not a cap-test result: the request failed without contract revert data.');
  }
  return rejection.data;
}

async function main() {
  dotenv.config({ path: join(root, '.env') });
  const api = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
  if (api !== 'https://hackathon.ap4m.build') throw new Error('Expected the hackathon service.');
  const response = await fetch(api + '/public/config', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('AP4M config unavailable.');
  const config = await response.json();
  if (Number(config.network.chainId) !== 1449000) throw new Error('Expected XRPL EVM Testnet.');
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || config.network.rpcUrl);
  try {
    if ((await provider.getNetwork()).chainId !== 1449000n) throw new Error('RPC must be XRPL EVM Testnet.');
    let wallet;
    try { wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider); } catch { throw new Error('Configure a valid local agent key.'); }
    let channelId = process.env.CAP_TEST_CHANNEL_ID || '';
    if (channelId && !/^0x[0-9a-f]{64}$/i.test(channelId)) throw new Error('CAP_TEST_CHANNEL_ID is invalid.');
    let token;
    if (!channelId) {
      if (!process.argv.includes('--open')) throw new Error('Supply CAP_TEST_CHANNEL_ID, or add --open to create a 0.05 RLUSD test channel (uses test XRP gas).');
      if (!process.env.TEAM_NAME) throw new Error('Configure TEAM_NAME.');
      ({ token } = await signIn(api, process.env.TEAM_NAME, wallet));
      const channel = await requestChannel(api, token, wallet, { capRlusd: CAP_TEST_RLUSD, merchantId: process.env.MERCHANT_ID || undefined });
      channelId = channel.channel_id;
    }
    console.log('Cap-test channel:', channelId);
    console.log('Both vouchers will be simulated with eth_call; neither payment is broadcast.');
    const ledger = new ethers.Contract(config.contracts.paymentLedger, PARTICIPANT_LEDGER_INTERFACE, wallet);
    const block = await provider.getBlock('latest');
    const state = await ledger.channels(channelId, { blockTag: block.number });
    if (Number(state[11]) !== 1) throw new Error('Cap test needs an open channel. A closed-channel rejection does not count.');
    if (state[9].toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Channel is for another agent.');
    if (!process.env.MERCHANT_PAYOUT_ADDRESS || state[12].toLowerCase() !== process.env.MERCHANT_PAYOUT_ADDRESS.toLowerCase()) throw new Error('Channel payout does not match the configured merchant.');
    if (state[7] !== ethers.parseUnits(CAP_TEST_RLUSD, 18)) throw new Error(`This demo requires a ${CAP_TEST_RLUSD} RLUSD channel.`);
    const acceptedAmount = state[8] + ethers.parseUnits(STEP_RLUSD, 18);
    if (acceptedAmount > state[7]) throw new Error('No capacity for the positive control; use a fresh channel.');
    const rejectedAmount = state[7] + ethers.parseUnits(STEP_RLUSD, 18);
    const acceptedSignature = await signVoucher(wallet, config.contracts.paymentLedger, channelId, acceptedAmount);
    const rejectedSignature = await signVoucher(wallet, config.contracts.paymentLedger, channelId, rejectedAmount);
    const tokenContract = new ethers.Contract(config.contracts.rlusdToken, ['function balanceOf(address) view returns(uint256)'], provider);
    const merchantBefore = await tokenContract.balanceOf(state[12], { blockTag: block.number });
    const rejectionData = await compareVouchers({
      acceptedCall: () => ledger.redeemVoucher.staticCall({ channelId, cumulativeAmount: acceptedAmount }, acceptedSignature, { blockTag: block.number }),
      rejectedCall: () => ledger.redeemVoucher.staticCall({ channelId, cumulativeAmount: rejectedAmount }, rejectedSignature, { blockTag: block.number }),
    });
    const after = await ledger.channels(channelId);
    const merchantAfter = await tokenContract.balanceOf(state[12]);
    if (after[8] !== state[8] || merchantAfter !== merchantBefore) throw new Error('State changed during the check; inspect concurrent activity before claiming a clean result.');
    const evidence = { channelId, chainId: 1449000, blockNumber: block.number, blockHash: block.hash,
      method: 'eth_call (simulation, no payment broadcast)', capRlusd: CAP_TEST_RLUSD,
      acceptedCumulativeRlusd: ethers.formatUnits(acceptedAmount, 18), rejectedCumulativeRlusd: ethers.formatUnits(rejectedAmount, 18),
      rejectionData, redeemedBefore: state[8].toString(), redeemedAfter: after[8].toString(),
      merchantBalanceBefore: merchantBefore.toString(), merchantBalanceAfter: merchantAfter.toString() };
    const evidenceDir = join(root, 'agent/receipts');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, 'cap-test-' + channelId + '.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`PASS: in-cap voucher accepted; ${ethers.formatUnits(rejectedAmount, 18)} RLUSD voucher rejected against ${CAP_TEST_RLUSD} RLUSD cap at the same block.`);
    console.log('Redeemed amount and merchant balance unchanged. Evidence saved under agent/receipts/.');
    const openedHere = !process.env.CAP_TEST_CHANNEL_ID;
    if ((openedHere || process.argv.includes('--close')) && !process.argv.includes('--keep')) {
      if (!token) ({ token } = await signIn(api, process.env.TEAM_NAME, wallet));
      const closed = await closeChannel(api, token, wallet, channelId);
      console.log(`Closed the ${CAP_TEST_RLUSD} RLUSD test channel so the demo will not reuse it. TX:`, closed.tx_hash);
    } else console.log('Channel remains open. Pass --close to close it, or leave --keep when you passed CAP_TEST_CHANNEL_ID.');
  } finally { provider.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
}
