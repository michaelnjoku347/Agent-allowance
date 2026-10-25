# Security

Agent Allowance lets an AI agent spend testnet RLUSD inside limits that a
person sets and a Ledger guards. This page says what it defends against,
where each defense lives, and what it does not try to cover. The short
version is in the README under [Security model](../README.md#security-model);
key custody is in [PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md#custody).

This kit runs on XRPL EVM Testnet only. Do not point it at a mainnet.

## Reporting a problem

Please report a vulnerability to the maintainers privately, for example
through GitHub's private vulnerability reporting if it is turned on for this
repository. Do not post exploit details in a public issue. Include the steps,
what you expected, and what happened. Never include a private key, even a
testnet one.

## What it defends against

| Threat | Defense | Where |
| --- | --- | --- |
| The agent, or a prompt injected into it, tries to overspend | `checkRules` runs before any signature: positive price, allowance not ended, merchant on the list, under the per-purchase cap, inside the budget. The first failure stops the purchase and nothing is signed. The channel cap is the budget. Freeze stops new signatures at once. | `agent/rules.js`, `agent/agent.js`, `server/freeze-channel.js` |
| A merchant quotes a different payee, an inflated price, or puts instructions in its description | The rules read the quote's own `payTo` and amount. The description is never trusted. The Heist demo is a test of this: a 0.50 RLUSD quote to an unlisted desk, with instructions to the agent written into its description, stays blocked and unsigned. | `merchant/quotes.js`, `server/heist.test.js` |
| Someone without the Ledger raises a limit | Lowering applies directly. Raising the cap, the budget, or the end date, or adding a merchant, needs a `SetAllowance` signature that recovers to the approver. The dashboard can name the approver once and never replace it. | `server/allowance.js`, `agent/rules.js` (`setApproverAddress`) |
| A Ledger approval is replayed or stretched | `ApprovePurchase` binds the purchase id, merchant, amount, and expiry. The server checks the signer, the quote, the expiry, and a used-signature list before paying once. A signature can pass the cap; it cannot pass an unlisted merchant, an ended allowance, or the budget. | `server/ledger.js`, `shared/approval.js` |
| Eve is talked into acting | Eve's answers come from a rules engine that only reads. She can propose two things, a freeze and a decline, and the server runs them only after the person confirms a single-use token that expires in two minutes and belongs to the session that asked. A model may reword a read answer; any action it suggests is dropped. Rule changes open the editor with a draft; saving stays with the person. | `server/eve.js` |
| Another website posts to the API (CSRF) | State-changing requests must come from the dashboard's origin and carry a JSON body (415 otherwise). | `server/index.js` (`fromDashboard`), `server/guardrails.js` |
| DNS rebinding | The API answers only `localhost`, `127.0.0.1`, or a configured public hostname. | `server/index.js` (`allowedHost`) |
| Script injection in the dashboard | React escapes text, and the served dashboard runs under `script-src 'self'` with no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri 'none'`. CSV exports quote cells that start with `=`, `+`, `-`, or `@`, so a spreadsheet does not run them as formulas. | `server/guardrails.js`, `dashboard/src/history.js` |
| Abuse and floods | Per-client rate limits for reads, writes, and Eve; a 16 KB body limit; ids, amounts (at most 18 decimals), dates, and text lengths shape-checked on every route; unknown allowance fields refused. | `server/guardrails.js` |
| Secrets in logs | Logs replace the values of the key variables and anything shaped like a private key. No route logs a request body. | `server/guardrails.js` (`redact`, `logError`) |
| A broken or missing rules file | Fails closed: the API answers `rules_unavailable` and nothing is paid. | `server/index.js` (`rulesOrRefuse`) |

## The hosted public demo

`PUBLIC_DEMO=1` adds visitors who do not trust each other. Each visitor gets
a private sandbox chosen by an `HttpOnly`, `SameSite=Lax` cookie (`Secure`
over HTTPS), carried by the page itself, so one visit is one sandbox. A
freeze, decline, or rule change stays in that sandbox. Eve's proposals can be
confirmed only from the sandbox that asked. A freeze never closes the shared
payment channel and never stops another visitor's agent run. Approvals and
raises use a labeled simulated Ledger signature from a throwaway key that
exists only in memory. One network can start at most 120 sandboxes every 10
minutes, and at most 500 are kept. See [DEPLOY.md](DEPLOY.md).

## Keys

The team holds three keys: the funding wallet, the agent wallet
(`AGENT_PRIVATE_KEY`), and the approver on a Ledger. `MERCHANT_SUBMITTER_KEY`
submits the merchant's redemptions. Keys live in `.env` (gitignored, never
copied into the Docker image) or the host's secret store. The agent signs
locally; no key is ever sent to the AP4M service or any other API. Operator,
PSP, payout, release, and admin keys belong to the service and are never
configured here.

## Not covered

- **A compromised computer running the API.** It holds the agent key. The
  rules and the channel cap bound what that key can spend, and Freeze stops
  it, but a machine an attacker controls can sign inside those bounds.
- **A compromised Ledger or a person approving without reading.** The device
  screen and the dashboard both show the amount, the merchant, and the
  expiry. Chain 1449000 has no registered clear-signing descriptor, so the
  device may show raw fields.
- **The AP4M service, the RPC, and the testnet itself.** They are trusted to
  report channels and redemptions honestly.
- **Local single-user mode has no login.** The API listens on `127.0.0.1` and
  trusts the person at this computer. Do not expose it to a network; use the
  public demo mode for anything other people can reach.
