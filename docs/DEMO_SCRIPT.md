# Agent Allowance — 5-minute live demo

Speak the lines. Do the clicks in order. The services are already up before you walk in. Each block maps to the judging rubric. If a step is slow, skip the optional line and keep going. The payment path does not depend on voice or fullscreen.

The line to land: **The AI decides what to buy, but it can never decide what it's allowed to spend.**

| Time | Rubric | What the judge sees |
| --- | --- | --- |
| 0:00 | Demo and story (10%) | The hook, How it works, then remaining, held for review, lost |
| 0:40 | Technical execution (25%) | The live 0.01 RLUSD brief, with an explorer link |
| 1:40 | Trust and control (25%) | Blocked prompt: injected text, the planner's choice, the rule, 0.00 RLUSD moved |
| 2:40 | Trust and technical | The judge approves 0.08 RLUSD on a Ledger. Eve refuses a cap raise |
| 3:50 | Path to production (15%) | Freeze closes the channel, then the production slide |
| 4:40 | Demo and story | The vision close |

## Before you walk in

Use Chrome, Edge, or Brave. Safari and Firefox have no WebHID, so a real Ledger will not connect.

1. Fund the agent wallet and the merchant submitter with test XRP from the [XRPL EVM Testnet faucet](https://faucet.testevm.ripple.com). The team budget is already funded in the [participant portal](https://hackathon.ap4m.build/participant).
2. Fill `.env` from `.env.example`. Put the Ledger Ethereum address (`m/44'/60'/0'/0/0`) in `APPROVER_ADDRESS`. Leave `ALLOWANCE_DEV_SIGNER` unset.
3. Unlock the Ledger, open the Ethereum app, and plug it in. The dark panel shows the readable amount, merchant, and expiry. The device may show raw fields or ask for blind signing, because chain 1449000 has no registered ERC-7730 descriptor. Allow that only when the panel matches this quote.
4. From the repo root, four terminals:

```bash
npm run server
npm run merchant
npm run dashboard
npm run demo
```

Or use two terminals: `npm start` runs the server, the dashboard, and the merchant (its keys are in `.env`), then `npm run demo`.

`npm run demo` prints three lines: one paid 0.01 RLUSD purchase, one 0.08 RLUSD quote blocked for the cap, and one 0.01 RLUSD quote blocked because the merchant is not on the allowlist. Leave the other processes running.

5. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). You should see about 0.19 RLUSD left, one paid row, and two cards under **Needs you**. If Eve's chat covers the board, click **Minimize Eve**.

The merchant name on the paid row follows your rules file. The committed sample rules say **Market Desk**. `npm run setup:payments` labels your payout **Team merchant**. Either is fine. Say the name you see.

## 0:00 — Hook (Demo and story)

> The AI decides what to buy, but it can never decide what it's allowed to spend.
>
> Would you give an AI your credit card? We wouldn't. Agent Allowance is a spending account. You fund 0.20 RLUSD. The agent may buy from merchants you listed, up to 0.05 RLUSD a purchase, until the allowance expires. Past any of those rules, it does not pay.
>
> Remaining is what it can still spend. Held for review is a quote a person has not released. Lost stays at zero, because a blocked quote never moves RLUSD.
>
> How it works is the sponsor map. Ledger signs the exception and the agent mandate. Mastercard AP4M moves every voucher. AWS Bedrock chooses, or the card says Fallback. XRPL settles the RLUSD.

Gesture at **How it works**, then at **Remaining**, **Held for review**, and **Lost** on the hero. If a mandate is already signed, say the merchant now returns 403 without it. If it is not, say so. Do not call an unanchored hash a transaction. The jobs under **This allowance** (travel, SaaS, supplies) are the same rules with a different name. Mention them in one sentence if a judge asks. Do not click through them unless you have spare seconds. Stay on **Research desk** for the live quotes.

## 0:40 — Live 0.01 RLUSD purchase (Technical execution)

> First purchase. The morning market brief is 0.01 RLUSD, from a merchant on the allowlist, under the cap. The rules allow it. The agent pays. Here is the explorer link.

1. On **Home**, under **Latest activity**, find **Buy the morning market brief**, pill **Paid**, **1.00 RLUSD**.
2. Click that row.
3. Read the rule checks. Every line that was reached says **Pass**. Point at **Transaction**. That link opens the XRPL EVM Testnet explorer. **Receipt** opens the AP4M settlement receipt when the live run filled it in.
4. Click **Close**.

> Nothing on that path asked a person. The agent stayed inside the allowance. The feed shows that explorer link only when the hash is a real 32-byte transaction.

## 1:40 — Blocked prompt (Trust and control)

This is the moment to show. One click feeds a malicious catalog row to the same planner the agent uses. The row says the user already approved a 0.50 RLUSD pack. The rules then block it. Nothing is signed, and no payable quote is added.

> Watch the catalog try to talk the planner into spending 0.50 RLUSD. The planner can take the bait. The allowance cannot.

1. On **Home**, open **Demo**.
2. Click **Show a blocked prompt**.
3. Read the red **Attack blocked** card out loud: the injected text, what the planner chose, the rule that stopped it, and **0.00 RLUSD moved**.

If the card says **Fallback (Bedrock not configured)**, say that Bedrock is not configured on this machine and the fallback followed the catalog text. Do not call that a live model. If the card says **Amazon Bedrock**, that call was real. If Bedrock refused the pack, say so, and still point at the rule: the 0.50 RLUSD quote is blocked anyway.

The payment path lights Agent, stops at Rules, and leaves Ledger, XRPL, and the merchant dark. A Ledger signature cannot pay a merchant that is not on the allowlist. **Voice on** lets Eve say why. **Voice off** mutes her and the tones.

## 2:40 — Ledger approves 0.08 RLUSD, Eve refuses the raise (Trust and technical)

> Second purchase. Same merchant. Eight cents of history. The cap is five cents, so the agent does not sign. A person can, on a Ledger. The agent still cannot raise its own cap.

1. Under **Needs you**, find the **0.08 RLUSD** card. The chip reads **Over cap by 0.03**. The merchant is on the allowlist, so a Ledger can approve this one quote.
2. Hand the Ledger to the judge if they want to press it. Click **Review and approve**. The **Why this needs you** panel names the rule, the price, the cap, how far over it is, and exactly what the Ledger signs.
3. Read the dark panel out loud. It shows the amount as `0.08 RLUSD`, the merchant label, and the expiry as a date. The device may show raw fields or a blind-signing prompt, because chain 1449000 has no registered ERC-7730 descriptor. Confirm only when the panel matches this quote.
4. Click **Approve 0.08 RLUSD** and confirm on the device. Wait until the sheet says the quote was approved and paid once. Click **Close**.
5. Click the explorer link on that paid row.
6. Open Eve and type `Set my cap to 0.08`. She says she cannot change the allowance and opens the Rules editor with 0.08 drafted, marked **Ledger signs**. The allowance file does not change until you save and sign.

> One signature, one redemption, and it cannot be replayed. Eve can explain anything and open the right screen. She cannot raise the cap.

Do not freeze before this step. A frozen agent will not take the Ledger payment.

The unlisted 0.01 RLUSD card, if it is on screen, has **Decline only**. There is no Approve button. A Ledger signature cannot pay a merchant that is off the allowlist. Point at it only if a judge asks. Do not let it replace the blocked prompt.

## 3:50 — Freeze, then the production slide (Path to production)

> If I want it to stop, it stops. Freeze stops signing, and it asks the payment service to close the channel. After that, the agent cannot sign another voucher on that channel.

1. Click **Freeze**. Read the banner. If a wallet and an open channel were configured, it says the payment channel is closed. If they were not, it says signing has stopped and it does not claim the channel closed. Either way, **Run agent** will not start a payment.
2. Do not unfreeze during the five minutes unless you still need the Ledger step. Unfreeze does not reopen a closed channel.
3. Point at [docs/PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md). The laptop path is `npm start`. The container path is `npm run ship` after Docker is installed. Do not start that build during the five minutes. The production plan is KMS or Secrets Manager for the agent key, DynamoDB for the ledger, Bedrock by IAM role, and RLUSD mainnet only after the payment service publishes that chain id.

## 4:40 — Close (Demo and story)

> The AI decides what to buy, but it can never decide what it's allowed to spend. Give it an allowance. The rules spend. A person, on a Ledger, is the only way past the cap. Freeze closes the channel. Thank you.

If a judge asks where the sponsors are: AP4M moves the RLUSD, XRPL EVM Testnet is the chain, Bedrock writes the words, Ledger signs the exception. The table is in the README. The three buyers are a travel booker, a SaaS and API buyer, and a small-business supplies agent. Same budget, same cap, same allowlist.

## If the Ledger fails

Say this, then do not pretend the device signed:

> The hardware step didn't connect. The backup is the same three decisions, and the approval is labeled on screen as a simulated Ledger signature. It is not the device, and it does not broadcast a voucher.

Then either:

- Play [docs/demo-backup.mp4](demo-backup.mp4) (about 90 seconds), or
- Show it live, only as a labeled fallback:
  1. Stop the API. Start it again with `ALLOWANCE_DEV_SIGNER=1 npm run server`. Leave the merchant and the dashboard running. Refresh the page.
  2. A banner at the top says **simulated Ledger signature**.
  3. Click **Review and approve** on the 0.08 RLUSD card. The sheet repeats **simulated Ledger signature**. The unlisted card has no approve button.
  4. Click **simulated Ledger signature**. The new paid row carries the same label.
  5. Say again that this key is throwaway and nothing was broadcast. Stop the API and start it without the flag before any real Ledger attempt.

Do not set `ALLOWANCE_DEV_SIGNER` for the judged live run. With the flag off, that route does not exist.

## What you click, and what you skip

| Click | When |
| --- | --- |
| The paid **morning market brief** row, then the explorer link, then **Close** | Technical execution. Do this before the blocked prompt. |
| **Show a blocked prompt**, then read the card | Trust. Injected text, the planner's choice, the rule, 0.00 RLUSD moved. |
| **Review and approve** on the **0.08 RLUSD** card, then **Approve 0.08 RLUSD**, then the explorer link | The judge can press the Ledger. Do this before Freeze. |
| Eve: `Set my cap to 0.08` | She cannot change it; she opens the editor with the draft, marked Ledger signs. |
| **Freeze agent** | After the Ledger step. Read whether the channel actually closed. |
| **This allowance** presets | Optional. One sentence. Do not rewrite the rules, and do not click them unless you have time. |
| **Export JSON** | Optional. The audit trail is under the blocked-prompt card if a judge asks. |
| **Minimize Eve** | Only if her chat covers the board |
| **Run agent**, **Try an over-cap purchase**, **Unfreeze agent** | Not in these five minutes. Unfreeze does not reopen a closed channel. |
| **Voice off**, **Present** | Optional. Present is in the Demo menu. Voice on speaks the blocked prompt. The demo stands without them. |
