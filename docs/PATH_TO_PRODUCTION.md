# Path to production

This repository runs on XRPL EVM Testnet for the hackathon. Nothing here is pointed at mainnet. The pieces below are the plan for shipping the same control plane once a team is ready to fund real RLUSD.

## What already ships

`npm start` is the laptop path: Node.js 22, the API, and the dashboard. `npm run ship` is the one-click path. It needs Docker. It builds an image that serves the dashboard and the API together at [http://127.0.0.1:8787](http://127.0.0.1:8787). If a `.env` file is present, those keys are passed into the container and are not copied into the image. With no `.env`, the page still opens and the rules still block. Paying a merchant still needs the funded wallets.

## Mainnet plan

1. Keep the same gate. `checkRules` runs before any signature: allowlist, per-purchase cap, budget, expiry. Jev still cannot override a block. A Ledger signature still cannot pay a denylisted payout, an expired allowance, or a blown budget.
2. Point `AP4M_API_URL` and `AP4M_RPC_URL` at the production AP4M service and the XRPL EVM network it names. Refuse to start if the chain id is not the one that service publishes. The testnet guard that rejects anything other than chain `1449000` becomes a mainnet chain-id guard. Do not reuse the testnet faucet, the testnet channel, or the testnet merchant payout.
3. Replace the hackathon merchant with the team's real payout address. `npm run setup:payments` already writes that payout into `agent/rules.json` on testnet. The same step writes the mainnet payout, and the allowlist starts with that one address.
4. Register the ERC-7730 descriptor for `ApprovePurchase` and `SetAllowance` on the production chain if Ledger's registry accepts it. Until that certificate exists, the device may still show raw fields. The panel keeps showing the amount, the merchant, and the expiry, and the server still recovers the signature to `APPROVER_ADDRESS`.
5. Turn on the audit export and the freeze switch in the same deploy. They are already in this build. A production host keeps `server/data` on a volume so the trail survives a restart.

## Custody

The team holds three keys, and only those three.

| Key | Where it lives | What it can do |
| --- | --- | --- |
| Funding wallet | The person who tops up the budget | Funds the allowance. It does not sign purchases. |
| Agent wallet | A hosted secret (`AGENT_PRIVATE_KEY`) | Signs an x402 voucher only after the rules allow it, and only up to the open channel cap. |
| Approver | A Ledger at `APPROVER_ADDRESS` | Signs one out-of-rule purchase, or a `SetAllowance` raise. The server never sees this key. |

Operator, PSP, payout, release, and admin keys stay with the payment service. This project does not generate them. The agent key is a hot key with a hard ceiling: the channel cap is the budget, the rules cap each purchase, and **Freeze agent** stops new signatures without waiting for a deploy. A redemption that has already been broadcast is still recorded by its transaction hash. Unfreeze is a separate, logged action by a person.

## Multi-agent and team allowance

One company allowance, many agents.

- The budget, the expiry, and the merchant allowlist belong to the team. They are the file `agent/rules.json` today. In production that file becomes a row per team.
- Each agent gets its own wallet and its own per-purchase cap, drawn from the shared budget. Two agents cannot reserve the same remaining RLUSD. The reservation lock in this build is that check for one process. Production uses the same lock across the team's agents.
- One Ledger approver, or a short list of approvers, can pass a single quote or raise a cap. An agent cannot add itself to the approver list. Eve can prepare a raise. She cannot apply it.
- The audit trail is team-wide. Each row names the agent task, the rule, the reason, and the signer (`agent`, a person, or the approver address). Export JSON is the pack a finance lead downloads.

## Compliance

- No card numbers and no private keys are stored in the audit export. The export has the decision, the rule, the reason, the signer label or approver address, the amount, and the merchant label.
- The denylist is decline-only. A signature cannot pay it. That is the control for a merchant the team has rejected.
- Freeze is the incident switch. It refuses `Run agent`, a new voucher, and a Ledger pay that has not yet been claimed. The quote stays under **Needs you** until a person unfreezes.
- The dashboard origin and the localhost host check stay on for a single-team deploy. A hosted deploy replaces that allowlist with the team's HTTPS origin and keeps every state-changing request on that origin.
- Retention: keep the audit file with the ledger. Do not log `.env`.

## Business model

Agent Allowance is the control plane in front of an agent that needs to pay.

- A team pays for the allowance, not for a card. The price is a monthly fee per team, with a cap on how many agents share that budget.
- RLUSD settlement stays on the payment channel. The fee is for the rules, the Ledger step, the audit export, and the freeze switch. It is not a cut of the merchant's payout.
- The first three jobs are the ones on the dashboard: a travel booker, a SaaS and API buyer, and a small-business supplies agent. Each job uses the same budget, cap, allowlist, and approver. Selling a new job is a preset and a merchant list, not a new wallet product.
- A finance lead who wants the exception log uses Export JSON. A lead who wants the agent to stop uses Freeze. Those two actions are the ones a buyer can try in the first meeting.
