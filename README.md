# Agent Allowance

A spending account for an AI agent. The agent can buy market data on its own when the purchase fits the allowance. If the quote is outside the rules, it does not pay — it saves the purchase for a person to approve.

Built for the Mastercard × XRPL hackathon on **XRPL EVM Testnet** (chain ID `1449000`), settling **RLUSD** through an AP4M x402 voucher.

```
agent/        rules and the x402 payer
merchant/     sells market data at GET /resource
server/       local API and the JSON ledger
dashboard/    budget, rules, payments, and approvals
demo/         three purchases: one paid, two blocked
```

## Run

Use four terminals, from the repo root, after the setup below.

```bash
npm run server
```

Allowance API at [http://127.0.0.1:8787](http://127.0.0.1:8787). Until the agent records a real decision, the ledger is sample data. The first real payment or blocked quote replaces those rows.

```bash
npm run merchant
```

Sells market data at [http://127.0.0.1:4308/resource](http://127.0.0.1:4308/resource) for 1 RLUSD. A request with no voucher gets HTTP 402 and the payment requirements. A signed voucher is redeemed on XRPL EVM Testnet and the response is the market data. Payout is `MERCHANT_PAYOUT_ADDRESS`.

```bash
npm run dashboard
```

Dashboard at [http://127.0.0.1:5173](http://127.0.0.1:5173). It polls the API every 3 seconds. Paid rows link to the [XRPL EVM Testnet explorer](https://explorer.testnet.xrplevm.org). Click a payment for the receipt (channel, claim, payout, receipt URL, explorer). While the ledger is still the sample set, the page says Sample. After `npm run demo` it says Live and shows only the real rows.

```bash
npm run demo
```

Runs three purchases, in order, and prints one line each:

1. **1 RLUSD** from the allowed merchant (`GET /resource`) → paid. The line includes the tx hash, claim id, receipt URL, and explorer link.
2. **8 RLUSD** from that same merchant → `blocked over per-purchase cap — saved for approval`. Nothing is signed.
3. **1 RLUSD** from a merchant that is not on the allowlist → `blocked merchant not allowed — saved for approval`. Nothing is signed.

The blocked quotes are saved under **Approval needed**. Approving there records the decision only. It does not sign a voucher or move RLUSD.

## Setup

- Node.js 22.13 or newer
- A team onboarded at [hackathon.ap4m.build/participant](https://hackathon.ap4m.build/participant): Agent wallet and Merchant added, budget funded
- Test XRP for gas from the [XRPL EVM Testnet faucet](https://faucet.testevm.ripple.com), on both the agent wallet and the merchant submitter

```bash
npm install
npm install --prefix dashboard
cp .env.example .env
```

Fill in `.env` (it is gitignored — do not commit it):

| Variable | What it is |
| --- | --- |
| `AGENT_PRIVATE_KEY` | Agent wallet. Signs vouchers. Never commit it. |
| `AP4M_API_URL` | `https://hackathon.ap4m.build` |
| `TEAM_NAME` | Your registered team name |
| `CHANNEL_ID` | Optional. Leave blank to reuse an open Channel, or to open one. |
| `MERCHANT_PAYOUT_ADDRESS` | Where the merchant is paid. Also add this address to `allowedMerchants` in `agent/rules.json`. |
| `RESOURCE_URL` | `http://127.0.0.1:4308/resource` |
| `MERCHANT_ID` | Your Merchant id from the participant portal |
| `MERCHANT_SUBMITTER_KEY` | Wallet that submits redemptions. Needs test XRP. Never commit it. |

The merchant listens on `MERCHANT_PORT` (4308). `PORT` (8787) is only the allowance API.

`MERCHANT_PAYOUT_ADDRESS` has to be in `agent/rules.json` or the 1 RLUSD sale is saved instead of paid, and the 8 RLUSD quote fails the allowlist instead of the cap. Add the address locally. Leave the sample addresses in the committed file.

The AP4M helpers in `agent/` come from the hackathon service. This project is ESM, so `agent/agent.js` loads the CommonJS helper with `createRequire`. Refresh the helpers if the kit changes:

```bash
curl -fsSL -o agent/ap4m-hackathon-sdk.cjs https://hackathon.ap4m.build/sdk/ap4m-hackathon-sdk.cjs
curl -fsSL -o agent/ap4m-x402.mjs https://hackathon.ap4m.build/sdk/ap4m-x402.mjs
npm install ethers@6.17.0 https://hackathon.ap4m.build/sdk/ap4m-sdk.tgz
```

## How a purchase is decided

1. The agent reuses an open Channel, or opens one, then `GET`s `RESOURCE_URL` with the Channel id. It does not send a payment signature yet.
2. The merchant answers **402** with the price and payout.
3. `checkRules` looks at that quote. The first failure wins:
   - **expired** — the allowance date has passed
   - **merchant not allowed** — the payout is not in `agent/rules.json`
   - **over per-purchase cap** — the price is above 5 RLUSD
   - **over budget** — paying would take the running total above 20 RLUSD
4. **allow** — `buyResource` signs one x402 voucher and the merchant returns the market data. The agent reports the redemption, settles, and saves the tx hash, claim id, receipt URL, and explorer link. The Channel stays open for the next purchase.
5. **needs_approval** — the quote is written to the local ledger and nothing is paid.

A single purchase that is inside the rules:

```bash
npm run agent -- "Buy the morning market brief"
```

A dropped connection (`fetch failed`) is retried up to 3 times. An HTTP error is not retried, so a payment is not sent twice.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Budget, spent, remaining, rules |
| GET | `/api/payments` | Tx hash, merchant, amount, status |
| GET | `/api/pending` | Purchases waiting for approval |
| POST | `/api/approve/:id` | Record a placeholder approval |
| POST | `/api/run-agent` | Start one purchase against `RESOURCE_URL` |

The ledger file is `server/data/store.json`. It is created on first run and is not committed. Merchant state (`merchant/state/`) and agent purchase state (`agent/state/`) are not committed either.

## Tests

```bash
npm test
```

That checks the rules, that a 402 is read without a payment signature, that 1 RLUSD can be recorded, and that 8 RLUSD and an unlisted merchant are saved without paying.

## Safety

- Do not commit `.env` or put a private key in source.
- The key is only used to sign. It is not sent to the AP4M service.
- This project targets XRPL EVM Testnet only. The agent stops if the service reports another chain id.
- Do not send RLUSD or XRP straight to the vault or ledger contracts. Channels and vouchers go through the AP4M kit.
