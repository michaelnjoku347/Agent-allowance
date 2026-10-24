# Agent Allowance

A spending account for an AI agent. The agent can pay a merchant on its own when the purchase fits the allowance. If the quote is outside the rules, it does not pay — it saves the purchase for a person to approve.

Built for the Mastercard × XRPL hackathon on **XRPL EVM Testnet** (chain ID `1449000`), settling **RLUSD** with AP4M x402 vouchers.

```
agent/        rules, the 402 check, and the payer
server/       local API and the JSON ledger
dashboard/    budget, rules, payments, and approvals
```

## How a purchase is decided

1. The agent requests the merchant resource and reads the HTTP **402** challenge. It does not sign anything yet.
2. `checkRules` looks at the quote. The first failure wins:
   - **expired** — the allowance date has passed
   - **merchant not allowed** — the payout address is not in `agent/rules.json`
   - **over per-purchase cap** — the price is above 5 RLUSD
   - **over budget** — paying would take the running total above 20 RLUSD
3. **allow** — the AP4M SDK (`buyResource` in `ap4m-x402.mjs`) signs a voucher and retries the request.
4. **needs_approval** — the quote is written to the local ledger and nothing is paid.

Approving in the dashboard is a placeholder for a Ledger check. It records the decision only. It does not sign a voucher or move RLUSD.

The default allowance is in `agent/rules.json`: 20 RLUSD budget, 5 RLUSD per purchase, an allowlist of merchant payouts, and an expiry. Replace the sample addresses with your merchant payout before a live payment.

## Prerequisites

- Node.js 22.13 or newer
- A team onboarded at [hackathon.ap4m.build/participant](https://hackathon.ap4m.build/participant): Agent wallet added, budget funded
- Test XRP for gas from the [XRPL EVM Testnet faucet](https://faucet.testevm.ripple.com)
- A merchant resource URL that answers `GET /resource` with HTTP 402 (the AP4M example merchant, or a teammate's)

Team onboarding happens in the portal, not in this repo. The private key stays in `.env`.

## Setup

From the repo root:

```bash
npm install
npm install --prefix dashboard
cp .env.example .env
```

Fill in `.env`:

| Variable | What it is |
| --- | --- |
| `AGENT_PRIVATE_KEY` | Agent wallet key. Never commit it. |
| `AP4M_API_URL` | `https://hackathon.ap4m.build` |
| `TEAM_NAME` | Your registered team name |
| `CHANNEL_ID` | Optional. An open Channel. Leave blank to reuse one or open one. |
| `MERCHANT_PAYOUT_ADDRESS` | Payout that should also be listed in `agent/rules.json` |
| `RESOURCE_URL` | Merchant URL ending in `/resource` |

Put `MERCHANT_PAYOUT_ADDRESS` in `allowedMerchants` in `agent/rules.json`. If it is missing, a quote to that payout is saved for approval instead of paid.

The AP4M helpers in `agent/` come from the hackathon service. Refresh them if the kit changes:

```bash
curl -fsSL -o agent/ap4m-hackathon-sdk.cjs https://hackathon.ap4m.build/sdk/ap4m-hackathon-sdk.cjs
curl -fsSL -o agent/ap4m-x402.mjs https://hackathon.ap4m.build/sdk/ap4m-x402.mjs
npm install ethers@6.17.0 https://hackathon.ap4m.build/sdk/ap4m-sdk.tgz
```

`ap4m-hackathon-sdk.cjs` is the CommonJS helper. This project is ESM, which is the filename the kit uses for that case.

## Run

Use three terminals, from the repo root.

```bash
npm run server
```

API at [http://127.0.0.1:8787](http://127.0.0.1:8787). Until the agent records a real decision, the ledger is sample data (7.50 RLUSD spent of 20, plus two purchases waiting for approval).

```bash
npm run dashboard
```

Dashboard at [http://127.0.0.1:5173](http://127.0.0.1:5173). It polls `/api/status`, `/api/payments`, and `/api/pending` every 3 seconds. If the server is down, the page still shows the same sample data locally. Paid rows that come from the agent link to the [XRPL EVM Testnet explorer](https://explorer.testnet.xrplevm.org). Click a payment for the receipt. **Run Agent** plays the live feed and, when `.env` has a key, team name, and resource URL, starts `agent/agent.js`.

```bash
npm run agent -- "Buy the morning weather brief"
```

Watch the log. `allow` pays and the dashboard switches off the sample rows onto that payment. `needs_approval` does not pay; the quote shows under **Approval needed**.

To resume one unfinished payment instead of starting another, set `OPERATION` to the same name and run the agent again. The SDK keeps the signed voucher in `agent/state/` so a retry does not pay twice.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Budget, spent, remaining, rules |
| GET | `/api/payments` | Tx hash, merchant, amount, status |
| GET | `/api/pending` | Purchases waiting for approval |
| POST | `/api/approve/:id` | Record a placeholder approval |
| POST | `/api/run-agent` | Start the agent for the demo |

The ledger file is `server/data/store.json`. It is created on first run and is not committed.

## Tests

```bash
npm test
```

That checks the four rule outcomes, that a 402 header is read without a payment signature, and that approval does not create a transaction.

## Safety

- Do not commit `.env` or put a private key in source.
- The key is only used to sign. It is not sent to the AP4M service.
- This project targets XRPL EVM Testnet only. The agent stops if the service reports another chain id.
- Do not send RLUSD or XRP straight to the vault or ledger contracts. Channels and vouchers go through the AP4M kit.
