# Agent Allowance — 5-minute live demo

Speak the lines. Do the clicks in order. The services are already up before you walk in. Each block maps to the judging rubric. If a step is slow, skip the optional line and keep going. The payment path does not depend on voice, fullscreen, or the preset you clicked.

| Time | Rubric | What the judge sees |
| --- | --- | --- |
| 0:00 | Demo and story (10%) | The card question, then the hero: budget, cap, expiry, merchants |
| 0:40 | Real-world utility (25%) | Travel, SaaS procurement, and supplies. Same rules. |
| 1:20 | Trust and control (25%) | Rogue agent: 3 attempts, 3 blocked, 0 RLUSD lost |
| 2:10 | Trust and control (25%) | Audit trail, Export JSON, Freeze agent |
| 2:50 | Technical execution (25%) | The 1 RLUSD brief, paid inside the rules |
| 3:30 | Trust and technical | The 8 RLUSD quote, approved once on a Ledger |
| 4:25 | Trust and control | The unlisted desk, decline only |
| 4:40 | Path to production (15%) | `docs/PATH_TO_PRODUCTION.md` and `npm run ship` |
| 4:50 | Demo and story | The close |

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

`npm run demo` prints three lines: one paid 1 RLUSD purchase, one 8 RLUSD quote blocked for the cap, and one 1 RLUSD quote blocked because the merchant is not on the allowlist. Leave the first three processes running.

5. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). You should see about 19 RLUSD left, one paid row, and two cards under **Needs you**. If Eve's chat covers the board, click **Minimize Eve**.

The merchant name on the paid row follows your rules file. The committed sample rules say **Market Desk**. `npm run setup:payments` labels your payout **Team merchant**. Either is fine. Say the name you see.

## 0:00 — Story (Demo and story)

> Would you give an AI your credit card?
>
> We wouldn't. An agent that can pay is useful. An agent with your card is not.
>
> Agent Allowance is a spending account for that agent. You fund 20 RLUSD. The agent may buy from merchants you listed, up to 5 RLUSD a purchase, until the allowance expires. Past any of those rules, it does not pay. It saves the quote and waits for a person.
>
> The payment itself is a Mastercard AP4M x402 voucher on XRPL EVM Testnet. Amazon Bedrock writes the plan. Jev reviews risk after the rules say yes. A Ledger signs the exceptions.

Gesture at the hero while you say the numbers: **RLUSD left**, **Per purchase 5.00 RLUSD**, **Expires**, **Merchants**.

## 0:40 — Three jobs, one allowance (Real-world utility)

> Same rules. Three jobs. A travel booker, a software buyer, a supplies clerk. The budget does not change when I change the job.

1. On **Home**, find **This allowance**, under the hero.
2. Click **Travel booking**, then **SaaS and API procurement**, then **Small-business supplies**. Read one line from the list each time.
3. Click **Research desk** before the next step. That is the job the live quotes use.
4. Say that the budget, the cap, and the merchant list did not change. The page says so under the list.

## 1:20 — Rogue agent (Trust and control)

This is the moment to show. The button runs three attacks through the real rules. It does not sign a voucher, it does not write the allowance file, and it does not add a second payable quote.

> Watch it try to break the allowance. Three attempts. The rules catch each one. No RLUSD moves.

1. On **Home**, find the **Rogue agent** card under the hero.
2. Click **Rogue agent**.
3. Read each card as it fills in: the attempt, the rule that caught it, then **Blocked**.
4. Stop on the summary: **3 attempts, 3 blocked, 0 RLUSD lost**.

The three cards, in order:

1. **Over the cap.** An 8 RLUSD buy from an allowed merchant. The per-purchase cap blocks it and routes it to Ledger approval. Nothing is signed.
2. **Off the allowlist.** 1 RLUSD to the unlisted desk. The allowlist blocks it, and the denylist hard-blocks it. A Ledger signature cannot pay that payout.
3. **Raise its own allowance.** The agent asks Eve to raise the cap. Eve refuses. A Ledger `SetAllowance` signature is required, and the allowance file stays as it was.

> It can ask. It cannot raise its own limit, and it cannot pay past the cap or the list.

The payment path under the hero lights Agent, then Rules, and stops. Ledger lights only when a signature could still pay. XRPL and the merchant stay dark, because nothing was signed.

Voice, Present, and the payment path are optional. **Voice on** speaks the block. **Voice off** mutes Eve and the tones. **Present** enlarges the type. If fullscreen is refused, the larger type still applies. Leave them on only if the room can hear and the projector is already up. **On XRPL** shows an explorer link only after a real transaction hash is recorded.

## 2:10 — Audit trail and freeze (Trust and control)

> Every decision is written down. Rule, reason, signer. And if I want it to stop, it stops.

1. Under the rogue cards, open **Audit trail**. The three blocks are there. Each row says **Blocked**, the rule, and **Nothing signed**.
2. Click **Export JSON**. A file named `allowance-audit.json` downloads. You do not need to open it unless a judge asks.
3. Click **Freeze agent**. The banner says new payments are refused. **Run agent** will not start a payment. Quotes under **Needs you** cannot be paid until you unfreeze.
4. Click **Unfreeze agent** before the Ledger step. The banner goes away.

Do this while nothing is mid-payment. Freeze refuses the next signature. It does not rewrite a transaction that has already been broadcast.

## 2:50 — Purchase 1, in rule, paid (Technical execution)

> First purchase. The morning market brief is 1 RLUSD, from a merchant on the allowlist, under the cap. The rules allow it. Jev does not flag it. The agent pays.

1. On **Home**, under **Latest activity**, find **Buy the morning market brief**, pill **Paid**, **1.00 RLUSD**.
2. Click that row.
3. Read the rule checks. Every line that was reached says **Pass**. Point at **Transaction** and **Receipt** when the live run filled them in. Those links open the XRPL EVM Testnet explorer and the AP4M settlement receipt.
4. Click **Close**.

> Nothing on that path asked a person. The agent stayed inside the allowance.

## 3:30 — Purchase 2, over the cap, approved on the Ledger (Trust and technical)

> Second purchase. Same merchant. Eight RLUSD of history. The cap is five, so the agent does not sign. A person can, on a Ledger. That signature redeems the 8 RLUSD resource. It still cannot pass an expired allowance or a blown budget.

1. Under **Needs you**, find the **8.00 RLUSD** card. The reason reads **This is over the per-purchase cap.**
2. Click **Approve with Ledger**.
3. Read the dark panel out loud. It shows the amount as `8 RLUSD`, the merchant label, and the expiry as a date. Say that the device itself may show raw fields or a blind-signing prompt. The sheet then moves through Signed, Broadcasting, Settling, and Paid. A second click does not start another payment.
4. Click **Connect Ledger**.
5. In the browser prompt, pick the Ledger. On the device, confirm only if those values match the panel.
6. Wait until the sheet says the quote was approved and paid once. Click **Close**.
7. Click the explorer link on that paid row.

> One signature, one redemption, and it cannot be replayed.

## 4:25 — Purchase 3, off the allowlist, decline only (Trust and control)

> Third purchase. One RLUSD, but the merchant is the unlisted desk. There is no Approve button. Decline is the only action. A Ledger signature cannot pay `0x0bad…`.

1. On the **1.00 RLUSD** card whose reason is **This merchant is not on the allowlist**, point at **Decline only**.
2. Do not look for **Approve with Ledger**. It is not there.
3. Click **Activity**. The history purchase is **Paid**. The outside desk is still **Blocked**.

> Eve can explain a block. Eve cannot approve one, and she cannot raise a limit without a Ledger signature. That stays on the device.

## 4:40 — Path to production

> This build is testnet. The ship path is the same control plane: Docker serves the dashboard and the API on one port, the agent key stays capped, the Ledger stays the approver, and the audit file is what finance exports. Mainnet is a chain id and a real payout, not a new product.

Point at [docs/PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md). If a judge asks how it deploys, say `npm run ship` after Docker is installed. Do not start that build during the five minutes.

## 4:50 — Close (Demo and story)

> So: would you give an AI your credit card? Give it an allowance. The rules spend. A person, on a Ledger, is the only way past the list or the cap. Freeze stops the agent. The budget and the expiry still hold. Thank you.

If a judge asks where the sponsors are: AP4M moves the RLUSD, XRPL EVM Testnet is the chain, Bedrock writes the words, Ledger signs the exception. The table is in the README.

## If the Ledger fails

Say this, then do not pretend the device signed:

> The hardware step didn't connect. The backup is the same three decisions, and the approval is labeled on screen as a simulated Ledger signature. It is not the device, and it does not broadcast a voucher.

Then either:

- Play [docs/demo-backup.mp4](demo-backup.mp4) (about 90 seconds), or
- Show it live, only as a labeled fallback:
  1. Stop the API. Start it again with `ALLOWANCE_DEV_SIGNER=1 npm run server`. Leave the merchant and the dashboard running. Refresh the page.
  2. A banner at the top says **simulated Ledger signature**.
  3. Click **Approve with Ledger** on the 8 RLUSD card. The sheet repeats **simulated Ledger signature**. There is no **Connect Ledger** button. The unlisted card has no approve button.
  4. Click **simulated Ledger signature**. The new paid row carries the same label.
  5. Say again that this key is throwaway and nothing was broadcast. Stop the API and start it without the flag before any real Ledger attempt.

Do not set `ALLOWANCE_DEV_SIGNER` for the judged live run. With the flag off, that route does not exist.

## What you click, and what you skip

| Click | When |
| --- | --- |
| **Travel booking**, **SaaS and API procurement**, **Small-business supplies**, then **Research desk** | Real-world utility. Return to Research desk before the purchases. |
| **Rogue agent**, then read the three cards and the summary | Trust. 3 attempts, 3 blocked, 0 RLUSD lost |
| **Export JSON**, then **Freeze agent**, then **Unfreeze agent** | Trust. Do this before the Ledger step. |
| The paid **morning market brief** row, then **Close** | Technical execution |
| **Approve with Ledger** on the **8.00 RLUSD** card, then **Connect Ledger**, then the explorer link | Purchase 2 is redeemed |
| Nothing except **Decline** on the unlisted card | Purchase 3 stays blocked |
| **Activity** | The paid history row beside the still-blocked desk, and the audit list |
| **Minimize Eve** | Only if her chat covers the board |
| **Run agent**, **Try an over-cap purchase** | Not in these five minutes. The over-cap button files an extra 6 RLUSD quote and muddies the story. |
| **Voice off**, **Present** | Optional. The demo stands without them. |
