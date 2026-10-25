/**
 * Anchor one audit decision on XRPL EVM Testnet.
 * The transaction data is the keccak hash of that decision.
 * No wallet means the hash is returned and nothing is sent.
 */

import { ethers } from 'ethers';

export function decisionHash(row) {
  const payload = JSON.stringify({
    id: row?.id ?? null,
    at: row?.at ?? null,
    outcome: row?.outcome ?? null,
    rule: row?.rule ?? null,
    amount: row?.amount ?? null,
  });
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

/**
 * Send a 0-value transaction to the agent address. The data is the decision hash.
 * Pass `send` in tests. The default uses the agent wallet when one is configured.
 */
export async function anchorDecision({ row, env = process.env, send } = {}) {
  if (!row?.id) {
    return { anchored: false, hash: null, txHash: null, reason: 'No decision has been recorded yet.' };
  }
  const hash = decisionHash(row);
  const key = String(env.AGENT_PRIVATE_KEY ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return {
      anchored: false,
      hash,
      txHash: null,
      reason: 'No agent wallet is configured, so this hash was not anchored.',
    };
  }
  const rpc = env.AP4M_RPC_URL || 'https://rpc.testnet.xrplevm.org';
  const broadcast = send ?? (async () => {
    const wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(rpc));
    const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n, data: hash });
    const receipt = await tx.wait();
    return receipt?.hash ?? null;
  });
  try {
    const txHash = await Promise.race([
      broadcast({ hash, rpc }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Anchoring the decision timed out.')), 8000);
      }),
    ]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) {
      return { anchored: false, hash, txHash: null, reason: 'The anchor transaction did not return a hash.' };
    }
    return {
      anchored: true,
      hash,
      txHash,
      reason: 'The decision hash is in an XRPL EVM transaction.',
    };
  } catch (error) {
    const message = String(error?.message ?? 'The decision was not anchored.');
    const safe = message.includes(key) ? 'The decision was not anchored.' : message.slice(0, 240);
    return { anchored: false, hash, txHash: null, reason: safe };
  }
}
