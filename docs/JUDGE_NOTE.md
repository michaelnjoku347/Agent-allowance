# Judge note

Scripted path for a funded XRPL EVM Testnet run. Do not invent transaction hashes. If this environment has no funded wallet, leave the TODO lines below.

## Quickstart

1. Fund the agent wallet and the merchant submitter with test XRP from the [XRPL EVM Testnet faucet](https://faucet.testevm.ripple.com). Fund the team budget in the [participant portal](https://hackathon.ap4m.build/participant).
2. Fill `.env` from `.env.example`. Put the Ledger Ethereum address (`m/44'/60'/0'/0/0`) in `APPROVER_ADDRESS`.
3. From the repo root:

```bash
npm install
npm install --prefix dashboard
npm run server
npm run merchant
npm run dashboard
npm run demo
```

4. Open [http://127.0.0.1:5173](http://127.0.0.1:5173).
5. Under **Needs you**, approve the **0.08 RLUSD** history row on a Ledger. The panel shows `0.08 RLUSD`, the merchant label, and the expiry as a date. The device may show raw fields or a blind-signing prompt, because chain 1449000 has no registered ERC-7730 descriptor.
6. Click the explorer link on that paid row. The row also keeps the claim id and the receipt URL.

`npm run demo` pays the 0.01 RLUSD brief, saves the 0.08 RLUSD history quote for that approval, and saves the unlisted `0x0bad…` desk as decline-only. That desk is a fixed fake payee, not a team merchant, so a Ledger signature cannot pay it. When Bedrock is configured, the demo asks Bedrock to choose instead of running those three steps. The activity row is labeled **Amazon Bedrock** or **Fallback (Bedrock not configured)**. A broadcast that fails returns the 0.08 RLUSD row to **Needs you** with a fresh challenge. Run `npm run preflight` first. It checks the channel cap against the 0.20 RLUSD budget, redeemed against local spent, and that both merchant ports answer.

## Live explorer links

TODO: paste links from a funded run. Do not fill these with sample or guessed hashes.

- 0.01 RLUSD morning brief redemption: TODO
- 0.08 RLUSD history redemption after Ledger approval: TODO
- Claim id: TODO
- Receipt URL: TODO
