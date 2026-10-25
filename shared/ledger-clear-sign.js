/**
 * ERC-7730 clear-signing for the Ledger Ethereum app.
 *
 * The local descriptor is loaded so the signer context can see it. Ledger's
 * clear-signing filters also require a PKI signature and certificate. Chain
 * 1449000 is not in that registry, so this returns an honest refusal instead
 * of a fake success that would make signTypedData fail.
 */

import descriptor from './erc7730-approve-purchase.json' with { type: 'json' };

export function clearSignDescriptor() {
  return descriptor;
}

export function ledgerClearSign(chainId = 1449000) {
  const describedChain = Number(descriptor?.context?.eip712?.domain?.chainId);
  if (Number(chainId) === 1449000 || describedChain === 1449000) {
    return {
      available: false,
      reason: 'Chain 1449000 has no Ledger-registered ERC-7730 descriptor, so the device cannot clear-sign this message.',
    };
  }
  return {
    available: false,
    reason: 'Clear-signing needs a Ledger PKI signature for this descriptor.',
  };
}
