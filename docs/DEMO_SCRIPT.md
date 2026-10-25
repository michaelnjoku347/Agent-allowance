# Agent Allowance — 3-minute pitch and live demo

Speak the lines. Do the clicks in order. The whole thing fits in three minutes if the services are already up.

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

## 0:00 — Story (about 35 seconds)

> Would you give an AI your credit card?
>
> We wouldn't. An agent that can pay is useful. An agent with your card is not.
>
> Agent Allowance is a spending account for that agent. You fund 20 RLUSD. The agent may buy from merchants you listed, up to 5 RLUSD a purchase, until the allowance expires. Past any of those rules, it does not pay. It saves the quote and waits for a person.
>
> The payment itself is a Mastercard AP4M x402 voucher on XRPL EVM Testnet. Amazon Bedrock writes the plan. Jev reviews risk after the rules say yes. A Ledger signs the exceptions.

Gesture at the hero while you say the numbers: **RLUSD left**, **Per purchase 5.00 RLUSD**, **Expires**, **Merchants**.

## Headline — Rogue agent (about 40 seconds)

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

**Voice on** is the header default. Eve says “Waiting for Ledger” or “Blocked” as each card lands. Click **Voice off** to mute her and the soft tones. **Present** enlarges the type for a projector. If the browser refuses fullscreen, the larger type still applies. **On XRPL** shows an explorer link only after a real transaction hash is recorded.

## 0:35 — Purchase 1, in rule, paid (about 40 seconds)

> First purchase. The morning market brief is 1 RLUSD, from a merchant on the allowlist, under the cap. The rules allow it. Jev does not flag it. The agent pays.

1. On **Home**, under **Latest activity**, find **Buy the morning market brief**, pill **Paid**, **1.00 RLUSD**.
2. Click that row.
3. Read the rule checks. Every line that was reached says **Pass**. Point at **Transaction** and **Receipt** when the live run filled them in. Those links open the XRPL EVM Testnet explorer and the AP4M settlement receipt.
4. Click **Close**.

> Nothing on that path asked a person. The agent stayed inside the allowance.

## 1:15 — Purchase 2, over the cap, approved on the Ledger (about 50 seconds)

> Second purchase. Same merchant. Eight RLUSD of history. The cap is five, so the agent does not sign. A person can, on a Ledger. That signature redeems the 8 RLUSD resource. It still cannot pass an expired allowance or a blown budget.

1. Under **Needs you**, find the **8.00 RLUSD** card. The reason reads **This is over the per-purchase cap.**
2. Click **Approve with Ledger**.
3. Read the dark panel out loud. It shows the amount as `8 RLUSD`, the merchant label, and the expiry as a date. Say that the device itself may show raw fields or a blind-signing prompt. The sheet then moves through Signed, Broadcasting, Settling, and Paid. A second click does not start another payment.
4. Click **Connect Ledger**.
5. In the browser prompt, pick the Ledger. On the device, confirm only if those values match the panel.
6. Wait until the sheet says the quote was approved and paid once. Click **Close**.
7. Click the explorer link on that paid row.

> One signature, one redemption, and it cannot be replayed.

## 1:55 — Purchase 3, off the allowlist, decline only (about 25 seconds)

> Third purchase. One RLUSD, but the merchant is the unlisted desk. There is no Approve button. Decline is the only action. A Ledger signature cannot pay `0x0bad…`.

1. On the **1.00 RLUSD** card whose reason is **This merchant is not on the allowlist**, point at **Decline only**.
2. Do not look for **Approve with Ledger**. It is not there.
3. Click **Activity**. The history purchase is **Paid**. The outside desk is still **Blocked**.

> Eve can explain a block. Eve cannot approve one, and she cannot raise a limit without a Ledger signature. That stays on the device.

## 2:45 — Close (about 15 seconds)

> So: would you give an AI your credit card? Give it an allowance. The rules spend. A person, on a Ledger, is the only way past the list or the cap. The budget and the expiry still hold. Thank you.

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
| **Rogue agent**, then read the three cards and the summary | Headline. 3 attempts, 3 blocked, 0 RLUSD lost |
| The paid **morning market brief** row, then **Close** | Purchase 1 |
| **Approve with Ledger** on the **8.00 RLUSD** card, then **Connect Ledger**, then the explorer link | Purchase 2 is redeemed |
| Nothing except **Decline** on the unlisted card | Purchase 3 stays blocked |
| **Activity** | Show the paid history row beside the still-blocked desk |
| **Minimize Eve** | Only if her chat covers the board |
| **Run agent**, **Try an over-cap purchase**, **Decline** | Not in this three minutes. The over-cap button files an extra 6 RLUSD quote and muddies the story. |
