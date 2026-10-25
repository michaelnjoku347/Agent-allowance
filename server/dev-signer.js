/**
 * DEV-ONLY software signer for automated tests.
 *
 * This is not a Ledger. It does not hold a key of its own: the test passes a
 * throwaway ethers wallet. The dashboard does not import this file, and the
 * API does not expose it. Never present its signature as a device signature.
 */

import { ethers } from 'ethers';
import { ethersApprovalTypes } from '../shared/approval.js';

function testsOnly() {
  // Isolated workers drop --test from argv and set NODE_TEST_CONTEXT instead.
  const fromRunner = process.argv.concat(process.execArgv).some((arg) => arg === '--test' || arg.startsWith('--test='));
  return fromRunner || Boolean(process.env.NODE_TEST_CONTEXT) || process.env.ALLOWANCE_DEV_SIGNER === '1';
}

/**
 * Sign the same EIP-712 payload the Ledger signs.
 * @returns {Promise<{ signature: string, address: string }>}
 */
export async function signApprovalForTest(typedData, privateKey) {
  if (!testsOnly()) {
    throw new Error('The dev signer is for automated tests only.');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? '')) {
    throw new Error('The dev signer needs a 32-byte test key.');
  }
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signTypedData(
    typedData.domain,
    ethersApprovalTypes(typedData.types),
    typedData.message,
  );
  return { signature, address: wallet.address.toLowerCase() };
}
