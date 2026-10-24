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

Dashboard at [http://127.0.0.1:5173](http://127.0.0.1:5173). It polls the API every 3 seconds and shows only real rows. Until the agent records a purchase, Home says what to do next. Paid rows link to the [XRPL EVM Testnet explorer](https://explorer.testnet.xrplevm.org). Open a row for the rule checks, Jev's decision, the claim, the receipt, and the explorer link. Eve is the third tab, and the mic button opens her from anywhere.

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
| `JEV_API_KEY` | Optional. From thejevai.com, account settings, API Keys. Blank means the rules decide alone. |
| `JEV_API_URL` | Optional. `https://thejevai.com`, or a self-hosted Kev URL. |
| `JEV_MODEL` | Optional. Defaults to `typesafe/jev-1.13`. |
| `LLM_API_KEY` | Optional. Eve's model. Stays on the server. |
| `LLM_BASE_URL` | Optional. OpenAI-compatible base URL, such as `https://api.openai.com/v1`. |
| `LLM_MODEL` | Optional. Model name for that endpoint. |

The merchant listens on `MERCHANT_PORT` (4308). `PORT` (8787) is only the allowance API.

`MERCHANT_PAYOUT_ADDRESS` has to be in `agent/rules.json` or the 1 RLUSD sale is saved instead of paid, and the 8 RLUSD quote fails the allowlist instead of the cap. Use setup:payments to create the local merchant rules, or edit your configured ALLOWANCE_RULES file. Leave the committed sample rules unchanged.

The AP4M helpers in `agent/` come from the hackathon service. This project is ESM, so `agent/agent.js` loads the CommonJS helper with `createRequire`. Refresh the helpers if the kit changes:

```bash
curl -fsSL -o agent/ap4m-hackathon-sdk.cjs https://hackathon.ap4m.build/sdk/ap4m-hackathon-sdk.cjs
curl -fsSL -o agent/ap4m-x402.mjs https://hackathon.ap4m.build/sdk/ap4m-x402.mjs
npm install ethers@6.17.0 https://hackathon.ap4m.build/sdk/ap4m-sdk.tgz
```

## Combine the tested payments with the team app

The standalone payment reference was merged in PR #5 and subsequently removed by the team to avoid duplicate implementations. The integrated app uses the same AP4M service and merchant, and writes decisions and receipts into the dashboard API's local ledger.

After installing the root and dashboard dependencies, reuse the settings from the working payment-starter folder. This setup only writes local, gitignored configuration; it does not transfer funds:

```powershell
npm.cmd run setup:payments -- --from "C:\Users\amanp\Documents\Codex\2026-10-24\i-am-doing-xrp-hackothon-with-5\outputs\payment-starter" --use-agent-as-submitter
```

The explicit submitter flag preserves the existing local demo arrangement: the agent/funding wallet submits the merchant redemption and pays its gas; RLUSD still goes to the separate merchant wallet. A separate MERCHANT_SUBMITTER_KEY in the local settings takes precedence. The setup does not register a different agent or change AP4M's budget.

Setup writes the registered merchant ID and payout into .env and creates agent/rules.local.json with that payout allowed. The agent and API both use ALLOWANCE_RULES to load that local file. The committed sample rules stay available for tests and preview data. Existing custom rules are not overwritten.

Stop the standalone merchant on port 4308 before starting the integrated merchant. Then use four terminals, all from the repository root:

```powershell
npm.cmd run server
npm.cmd run merchant
npm.cmd run dashboard
npm.cmd run demo
```

The first three commands are long-running services; run one per terminal. The fourth performs one real 1 RLUSD purchase and saves two blocked quotes. Open http://127.0.0.1:5173 to watch the dashboard. A receipt distinguishes a recorded payout from redemption whose settlement is still processing.

The local dashboard budget counts integrated purchases recorded in its ledger, not every historical payment from the AP4M funding account. Earlier standalone transactions remain in the original local payment starter and PR #5 history; they are not silently added as newly purchased data.

### Recovery and contract-cap proof

If an x402 payment response is lost before purchase completion, the integrated payer reuses the retained channel, operation and price. It refuses a different wallet/resource/channel while that purchase is unresolved. Each redemption is recorded by transaction hash, so saving settlement evidence again cannot double-count local spend. Changing the task after a completed purchase starts a new purchase.

The 8 RLUSD demo quote demonstrates a local rule block. To separately test the on-chain channel cap:

```powershell
npm.cmd run test:channel-cap -- --open --close
```

This opens a 5 RLUSD test channel (uses test XRP gas), simulates an in-cap voucher and a 6 RLUSD cumulative voucher against the same block, and requires the second to return contract revert data. Neither payment is broadcast. It checks that redeemed state and merchant balance stay unchanged, writes a JSON result under agent/receipts/, and requests channel closure. A network failure, a closed channel, or a failed in-cap control does not count as a passing result. This command is prepared and tested with mocks; the team still needs to run it live on testnet.

Ledger hardware signing and AWS deployment remain separate team integrations. The dashboard approval endpoint currently records a placeholder decision and does not authorize an exceptional payment.

## How a purchase is decided

1. The agent reuses an open Channel, or opens one, then `GET`s `RESOURCE_URL` with the Channel id. It does not send a payment signature yet.
2. The merchant answers **402** with the price and payout.
3. `checkRules` looks at that quote. The first failure wins:
   - **expired** — the allowance date has passed
   - **merchant not allowed** — the payout is not in `agent/rules.json`
   - **over per-purchase cap** — the price is above 5 RLUSD
   - **over budget** — paying would take the running total above 20 RLUSD
4. **allow** — Jev reviews the quote. If Jev is unavailable, the rules still pay and the record says "Jev unavailable — rules only". If Jev's review score is 0.5 or higher, the purchase looks unnecessary (needed under 0.4), or the risk is 4/5 or 5/5, the quote is saved as **Jev flagged for review** and nothing is paid. Otherwise `buyResource` signs one x402 voucher and the merchant returns the market data. The agent reports the redemption, settles, and saves the tx hash, claim id, receipt URL, and explorer link. The Channel stays open for the next purchase.
5. **needs_approval** — the quote is written to the local ledger and nothing is paid. The rules always win: Jev cannot allow a quote the rules blocked.

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
| GET | `/api/pending` | Purchases waiting for approval, including the Jev record |
| POST | `/api/approve/:id` | Record a placeholder approval |
| POST | `/api/decline/:id` | Record a decline. Nothing is signed or paid |
| POST | `/api/eve` | Ask Eve. A change comes back as a confirmation, not an edit |
| POST | `/api/eve/confirm` | Apply a confirmation token Eve just issued |
| POST | `/api/run-agent` | Start one purchase against `RESOURCE_URL` |

The ledger file is `server/data/store.json`. It is created on first run and is not committed. Merchant state (`merchant/state/`) and agent purchase state (`agent/state/`) are not committed either.

## Tests

```bash
npm test
```

That checks the rules, that a 402 is read without a payment signature, that 1 RLUSD can be recorded, that 8 RLUSD and an unlisted merchant are saved without paying, that Jev cannot override a blocked rule, and that Eve asks before she approves or changes the cap.

## Jev and Eve

Jev looks at a purchase only after the rules allow it. Set `JEV_API_KEY` from [thejevai.com](https://thejevai.com) (account settings, then API Keys). `JEV_API_URL` defaults to `https://thejevai.com`. Point it at a self-hosted Kev server if you run one; the API is the same. With no key, a timeout, or an error, the agent pays on the rules and records "Jev unavailable — rules only". The dashboard card shows Needed, Risk (1–5), and Human review, plus whether the source was Jev, Kev, or the rules.

Eve is the assistant in the dashboard. She can say what was spent today and why the last quote was blocked. Approving, declining, or changing the cap or budget returns a confirmation card. Nothing changes until you press Confirm, or say "yes" or "confirm" while that card is on screen. Voice input uses the browser speech API in Chrome, Edge, and Safari. Firefox has no speech recognition, so Eve hides the mic and asks you to type. `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` are optional and stay on the server. Without them Eve uses a built-in parser.

## Safety

- The agent key, the merchant submitter key, `JEV_API_KEY`, and `LLM_API_KEY` stay in `.env`. They are not committed and they are not sent to the browser.
- The key is only used to sign. It is not sent to the AP4M service.
- This project targets XRPL EVM Testnet only. The agent stops if the service reports another chain id.
- Do not send RLUSD or XRP straight to the vault or ledger contracts. Channels and vouchers go through the AP4M kit.
If another merchant already uses port 4308, choose a free MERCHANT_PORT and update RESOURCE_URL to the same port. Set MERCHANT_STATE_DIRECTORY to a separate local folder such as merchant/state-4309 when changing the merchant resource URL; keep the original state for recovery. Restart the API after local environment changes.

If WebShield blocks the testnet RPC with URL:Blacklist, the live payment has not succeeded. Have the hackathon staff or security administrator review that classification before retrying. Keep the dashboard marked Sample until real decisions are recorded.
