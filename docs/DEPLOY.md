# Deploy a public demo

A hosted public demo lets judges open one link and use the whole product
without installing anything or owning a Ledger. It serves the built dashboard
and the API from a single origin, and it needs no keys.

## What public demo mode does

Set `PUBLIC_DEMO=1` and the server changes four things:

| | Local (default) | Public demo |
| --- | --- | --- |
| Data | `server/data/store.json` and `agent/rules.json` | A private sandbox per visitor: a copy of the rules and a store seeded with the sample rows, chosen by an `HttpOnly` cookie. One judge's freeze, decline, or rule change never reaches another's screen. The page itself carries the cookie, so one visit is one sandbox. Idle sandboxes are removed after 6 hours, at most 500 are kept, and one network can start at most 120 new ones every 10 minutes. |
| Approvals and raises | A Ledger over WebHID | A **simulated Ledger signature** from a throwaway key held in memory. Every screen that uses it says so. The same EIP-712 challenge, signature check, and replay guard still run. |
| Run agent | Starts `agent/agent.js` with your keys | Records a simulated purchase that walks the demo story: a 0.01 RLUSD brief paid inside the rules, a 0.08 RLUSD history quote held for approval, and an unlisted desk that is decline-only. The real rules decide each one. Nothing is signed or broadcast. |
| Freeze | Stops signing and closes the payment channel | Stops signing in that visitor's sandbox. The shared channel is never closed, and another visitor's agent run is never stopped. |
| Eve | Proposes a freeze or a decline; you confirm | The same, and a proposal can be confirmed only from the visitor's own sandbox. |

**Reset my demo** in the banner starts a sandbox over from the sample rows.

The server also listens on `0.0.0.0`, trusts one proxy hop for the client
address (so rate limits are per visitor), answers on the host's public
hostname, and serves the dashboard with a strict Content-Security-Policy.

## Deploy on Render

1. Push the repository to GitHub.
2. In the Render dashboard choose **New → Blueprint**, pick the repository,
   and accept `render.yaml`. It creates one Docker web service,
   `agent-allowance-demo`, with `PUBLIC_DEMO=1` and a health check on
   `/api/health`.
3. Wait for the first deploy. The Docker build installs the AP4M SDK from
   `https://hackathon.ap4m.build/sdk/ap4m-sdk.tgz`, so the builder needs to
   reach that host.
4. Open `https://<service>.onrender.com`. The first-run intro plays, then the
   dashboard opens on the visitor's own sandbox.

Render sets `PORT` and `RENDER_EXTERNAL_HOSTNAME` itself; the server reads
both. For a custom domain, add it in Render and set `PUBLIC_HOSTNAME` to that
name (comma-separate several). API requests for any other `Host` are refused,
which also blocks DNS rebinding.

`render.yaml` uses the free plan, which sleeps when idle and wakes on the next
visit in about a minute. Pick a paid plan for a demo that must answer at once.

## Run the same image anywhere

```bash
docker build -t agent-allowance .

# Local, with the sample data, published on this computer only.
docker run --rm -p 127.0.0.1:8787:8787 agent-allowance

# Hosted public demo. Set PUBLIC_HOSTNAME to the name visitors will use.
docker run --rm -p 8787:8787 -e PUBLIC_DEMO=1 -e PUBLIC_HOSTNAME=demo.example.com agent-allowance
```

Put the container behind HTTPS. A dashboard opened from other machines must
be served over HTTPS, and the sandbox cookie is marked `Secure` whenever the
proxy says the request was HTTPS.

Without Docker:

```bash
npm ci && npm --prefix dashboard ci && npm --prefix dashboard run build
PUBLIC_DEMO=1 PORT=8787 node server/index.js
```

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_DEMO` | unset | `1` turns on public demo mode. |
| `PUBLIC_DEMO_PAYMENTS` | `simulated` | `testnet` hands Run agent to the real agent with the keys below. It needs all three. |
| `AGENT_PRIVATE_KEY`, `TEAM_NAME`, `RESOURCE_URL` | unset | Only for `PUBLIC_DEMO_PAYMENTS=testnet`. Store them in the host's secret settings, never in the repository. |
| `PUBLIC_HOSTNAME` | unset | Extra public hostnames, comma-separated. Render's and Fly's own hostnames are added automatically. |
| `HOST` | `0.0.0.0` in the image and in public demo mode, else `127.0.0.1` | Interface to listen on. |
| `PORT` | `8787` | Port to listen on. Hosts usually set it. |
| `SERVE_DASHBOARD` | `1` in the image | Serve `dashboard/dist` from the API. |
| `ALLOWANCE_RATE_LIMIT` | `1` | Scales the per-visitor rate limits. `0` turns them off for a load test. |

## Testnet payments in a hosted demo

`PUBLIC_DEMO_PAYMENTS=testnet` makes Run agent spend real testnet RLUSD from
the server-held agent wallet on XRPL EVM Testnet. Each visitor still has their
own sandbox for the rules and the ledger, but the AP4M payment channel is
shared by everyone, so use it only for a supervised session:

- Fund the agent only with what the demo should be able to spend.
- Keep the keys in the host's secret store. `render.yaml` declares them with
  `sync: false`, so they are never written to the repository.
- Approvals and raises still use the simulated signature in public demo mode.
  A hosted page cannot reach a judge's Ledger, and the server must never hold
  an approver key.

## Never commit secrets

`.env` and `.env.*` are in `.gitignore` and `.dockerignore`. The image never
contains a key. The simulated signer's key is generated in memory at start and
is gone when the process stops. Server logs strip anything shaped like a
private key and the values of the key variables above.
