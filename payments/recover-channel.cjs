'use strict';
const { ethers } = require('ethers');
const { signIn, closeChannel } = require('./ap4m-hackathon-sdk.cjs');
const API = 'https://hackathon.ap4m.build';
const RPC = 'https://rpc.testnet.xrplevm.org';
const LEDGER = '0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91';
const CHANNEL = '0xc6394141fb30d7b4c63fb995da62cffaee5465182a6c142366267107b5b4de9f';
const AGENT = '0x35be304740fbfe2bf9d6e1890f488e0fa1d0653a';
const MERCHANT = '0x4dd838f5f158ec098918ff2b8c8cbb72d035e3bd';
const ABI = ['function channels(bytes32) view returns (bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,uint256,address,uint64,uint8,address,uint64,address,uint64,uint64,uint64)'];
async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || RPC);
  try {
    if ((await provider.getNetwork()).chainId !== 1449000n) throw new Error('Expected XRPL EVM Testnet.');
    const ledger = new ethers.Contract(LEDGER, ABI, provider);
    let state = await ledger.channels(CHANNEL);
    if (state[9].toLowerCase() !== AGENT || state[12].toLowerCase() !== MERCHANT) throw new Error('Channel identities do not match your team.');
    console.log('Existing channel:', CHANNEL);
    console.log('Redeemed:', ethers.formatUnits(state[8], 18), 'RLUSD');
    console.log('On-chain status:', Number(state[11]));
    if (Number(state[11]) === 2) { console.log('Already closed. No action needed.'); return; }
    if (Number(state[11]) !== 1) throw new Error('Unexpected channel status. Check the AP4M portal before taking action.');
    if (!process.argv.includes('--close')) { console.log('Channel is open. To close only this existing channel, add --close to this command.'); return; }
    if (!process.env.AGENT_PRIVATE_KEY) throw new Error('Missing local AGENT_PRIVATE_KEY.');
    let wallet;
    try { wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider); } catch { throw new Error('Invalid local wallet key.'); }
    if (wallet.address.toLowerCase() !== AGENT) throw new Error('Local key does not match registered agent.');
    console.log('Signing in to close the existing channel. No purchase will be made.');
    const { token } = await signIn(API, 'AMD', wallet);
    try {
      const closed = await closeChannel(API, token, wallet, CHANNEL);
      console.log('Close request TX:', closed.tx_hash);
    } catch (error) {
      console.log('Close request did not return successfully:', error.shortMessage || error.message);
      if (error.cause?.code) console.log('Network error code:', error.cause.code);
      console.log('Checking whether closure nevertheless reached the chain...');
      state = await ledger.channels(CHANNEL);
      if (Number(state[11]) === 2) { console.log('Channel is closed on-chain.'); return; }
      throw new Error('Closure is not confirmed. Run this recovery command again later; do not rerun the purchase.');
    }
    state = await ledger.channels(CHANNEL);
    console.log(Number(state[11]) === 2 ? 'Confirmed: channel closed on-chain.' : 'Closure not yet confirmed on-chain. Run this command again later to check.');
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(error => {
  console.error(error.shortMessage || error.message);
  if (error.cause?.code) console.error('Network error code:', error.cause.code);
  process.exitCode = 1;
});
