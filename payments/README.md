# Person 1: tested AP4M payment examples

These standalone scripts preserve Team AMD's successful direct-payment and x402 demos. Run them from this directory. The main application in ../agent, ../merchant and ../dashboard remains the team's integrated product.

## Verified live on XRPL EVM Testnet

- Chain ID: 1449000; PaymentLedger: 0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91.
- Registered agent/funding wallet: 0x35be304740fbfe2bf9d6e1890f488e0fa1d0653a.
- Merchant payout: 0x4dd838f5f158ec098918ff2b8c8cbb72d035e3bd.
- The direct-payment run redeemed 1 RLUSD, settled, and closed its 5 RLUSD channel.
- The x402 run received HTTP 402, signed a voucher, received the JSON resource, and reported the merchant payout. Its close response was lost (`fetch failed`); the recovery check confirmed status 2 (closed) and 1 RLUSD redeemed.
- These results are from the operator's live terminal output on October 24, 2026. No payment is sent by installation or syntax checks.

Transaction and receipt links are in [evidence.json](./evidence.json). These are public references, not private payment state.

## Install and configure

Use Node.js 24 LTS (minimum 22.13), with npm. In PowerShell from the repo root:

```powershell
cd payments
npm.cmd ci --ignore-scripts
Copy-Item .env.example .env
notepad .env
```

Enter AGENT_PRIVATE_KEY locally. The key must match the registered agent address above. Never put a key in source, chat, screenshots, or Git. For the current demo, the Funding account is also the registered agent; the separate MetaMask account named Agent is not registered here.

The package lock installs ethers 6.17.0 and the AP4M SDK from the official hackathon service. The helper SDK and example files were downloaded from https://hackathon.ap4m.build/sdk/. Do not use this hackathon kit on mainnet.

```powershell
node --env-file=.env preflight.cjs
```

The preflight checks network, ledger, token decimals, wallet identity and gas. It only reads public state and derives the wallet address locally.

## Direct 1 RLUSD payment

```powershell
node --env-file=.env ap4m-agent.cjs --pay
```

With CHANNEL_ID empty, this opens a 5 RLUSD channel, pays 1 RLUSD, reports redemption, settles, saves evidence in receipts/, and closes the channel. Each fresh successful run buys again. A channel cap is a cumulative limit, not a per-purchase allowance rule.

## x402 merchant and agent

Get the merchant ID using a wallet sign-in; no purchase is made:

```powershell
node --env-file=.env setup-x402.cjs
```

Terminal 1, from payments/:

```powershell
node --env-file=.env start-merchant.mjs
```

Terminal 2, also from payments/:

```powershell
node --env-file=.env start-x402-agent.mjs
```

The local merchant sells http://127.0.0.1:4308/resource for 1 RLUSD. The agent opens a 5 RLUSD channel, purchases the resource, reports redemption, requests settlement, and closes the channel.

For this local demo, the existing funded agent wallet also submits the merchant's redemption transactions and pays their XRP gas. RLUSD still goes to the separate merchant payout address. Set MERCHANT_SUBMITTER_KEY separately in the merchant's environment to use a different gas payer.

The x402 helper has one Windows compatibility adjustment: skip opening/fsyncing a directory on Windows, where opening directories fails. The actual retained payment file is still fsynced before sending.

## Recovery: do not repeat a purchase after a lost response

The agent keeps signed vouchers under agent-state/ and the merchant keeps its redemption state under merchant-state/. These directories stay local. Keep the merchant running when recovering an unresolved x402 purchase.

The starter wrapper refuses to open another channel if purchase.json already exists. Do not delete retained payment state or change operation/channel arguments to work around an unresolved purchase.

For the already-tested x402 channel (0xc6394141fb30d7b4c63fb995da62cffaee5465182a6c142366267107b5b4de9f):

```powershell
node --env-file=.env recover-channel.cjs
node --env-file=.env recover-channel.cjs --close
```

The first command checks only. The second closes only that existing channel if still open; it does not buy anything. For another channel, use the official SDK with the exact channel ID and verify the channel identities before closure.

A recorded redemption alone is not proof of merchant payout. Keep the redemption transaction, payout transaction, receipt, and channel ID. Verify settlement in AP4M and on the explorer before retrying.

## Scope and handoff

Working: direct AP4M payments; x402 purchase and resource delivery; RLUSD settlement; closure recovery; public on-chain receipt references.

Still to demonstrate for Person 1: a contract rejection for a voucher above a channel's cumulative cap, with redeemed state unchanged. A closed-channel error is not evidence of a cap rejection. Person 2 owns agent rules, Ledger approval and AWS; the demo's same-key gas submitter does not establish isolation between those roles.

The root application has its own rules and demo. This folder is a standalone payment reference and does not wire transactions into the dashboard or implement hardware approval.
