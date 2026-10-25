# Self score

Scored against the hackathon rubric and the four bounties this repo is aimed at. A 10 means a judge can see that piece work live, on device or on chain, during the five minutes. Anything short of that is named below.

The line for the room: **The AI decides what to buy, but it can never decide what it's allowed to spend.**

## Rubric

| Line | Weight | Score | Why |
| --- | --- | --- | --- |
| Real-world utility | 25% | 8.5 | One allowance covers a research desk, a travel booker, a SaaS buyer, and a supplies clerk. The rules, the cap, the hourly rate, and the merchant list are the product. No customer has run it outside the hackathon. |
| Trust and control | 25% | 9.0 | Rules run before any signature. The Heist shows a planner taking injected catalog text and still moving 0.00 RLUSD. Unlisted merchants cannot be Ledger-approved. Freeze stops signing and closes an open channel when a wallet exists. The agent mandate is a real EIP-712 check. Chain 1449000 still cannot clear-sign. |
| Technical execution | 25% | 8.5 | In-rule payments and the 8 RLUSD approval both go through AP4M x402. Receipts show the channel id and the claim id when the service returns them. Tests cover the mandate, the 403, the anchor’s refusal to invent a hash, and the Heist. This environment has not broadcast a new voucher. |
| Path to production | 15% | 8.0 | `docs/PATH_TO_PRODUCTION.md`, `Dockerfile`, `npm run ship`, and `apprunner.yaml` describe KMS or Secrets Manager, DynamoDB, IAM Bedrock, and App Runner. None of that is deployed. |
| Demo and story | 10% | 9.0 | `docs/DEMO_SCRIPT.md` is hook, live 1 RLUSD, Heist, Ledger on the 8 RLUSD quote, Eve refusing the raise, Freeze, close. **How it works** names each sponsor. Voice and Present are optional. |

Weighted total: about **8.6 / 10**. The gap to 10 is a funded live run: a real explorer link, a Ledger that signs the mandate and the 8 RLUSD quote in the room, Bedrock actually choosing, and an anchor transaction a judge can open.

## Bounties

| Bounty | What is in the product | Gap left |
| --- | --- | --- |
| Agentic Finance | The agent spends as an economic actor inside a programmable allowance. A Ledger is the hardware guard. The Heist shows the model can be talked into a 50 RLUSD pack and still cannot spend. | Sub-allowances for sub-agents are not built. |
| Ledger | `ApprovePurchase`, `SetAllowance`, and `AgentMandate` are EIP-712. The ERC-7730 descriptor lists all three. The dashboard recovers the signature to `APPROVER_ADDRESS`. After a mandate is stored, `/resource` is 403 without it. | Chain 1449000 has no Ledger registry certificate, so the device does not clear-sign. The panel tells the judge that. The history merchant on its own port does not check the mandate. |
| Mastercard AP4M | Quotes are HTTP 402. Allowed payments use `buyResource` on a channel. The receipt labels the AP4M channel and the AP4M claim. Sample rows are not presented as live receipts. | A claim id appears only after a funded redemption. This checkout has not produced a new one. |
| AWS | Bedrock plans purchases and can answer Eve. The row says Amazon Bedrock or Fallback. `apprunner.yaml` is the deploy shape, with the key kept out of the file. | Bedrock is off unless credentials are set. App Runner has not been deployed from here. |
| XRPL | Settlement is RLUSD on chain 1449000. **Anchor the latest decision** will send the audit hash as transaction data when the agent wallet has gas. | With no wallet the screen shows the hash and says it was not anchored. No memo transaction has been broadcast from this environment. |

## What would move each line

- Register the ERC-7730 descriptor, or move to a chain Ledger already clear-signs, and say so only after the device shows the words.
- Run `npm run demo` with a funded channel and paste the real explorer, channel, and claim ids into `docs/JUDGE_NOTE.md`.
- Sign the agent mandate on a Ledger before the judged payment, then show `/resource` returning 403 if the header is removed.
- Turn Bedrock on for the Heist so the card can say Amazon Bedrock, and leave the Fallback label in place when it is not.
- Anchor one audit row and open the XRPL EVM transaction.
- Deploy the App Runner service with an IAM role. Do not put the agent key in the image.
