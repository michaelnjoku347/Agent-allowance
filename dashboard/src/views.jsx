import { useMemo, useState } from 'react';
import AllowanceEditor from './AllowanceEditor.jsx';
import ApproverSetup from './ApproverSetup.jsx';
import { money, relativeTime, when as whenFull } from './format.js';
import { daysLabel, daysLeft, spendByMerchant } from './insights.js';
import { IconCheck, IconLock, IconUnlock } from './icons.jsx';
import { EmptyState, planLabel } from './rows.jsx';
import { explainJev } from '../../shared/words.js';

function day(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function shortAddress(address) {
  const text = String(address ?? '');
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function Tile({ label, value, unit = '', hint = '', tone = '' }) {
  return (
    <li className={tone ? `stat-tile is-${tone}` : 'stat-tile'}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}{unit ? <span className="stat-unit"> {unit}</span> : null}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </li>
  );
}

function Switch({ label, hint, on, onToggle }) {
  return (
    <div className="setting-row">
      <div>
        <p className="setting-label">{label}</p>
        {hint ? <p className="meta">{hint}</p> : null}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle-switch" onClick={onToggle}>
        <span className="toggle-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

function CopyAddress({ address }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="copy-address">
      <code title={address}>{shortAddress(address)}</code>
      <button type="button" className="btn text copy-btn" onClick={copy} aria-label={`Copy address ${address}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

const CHECKS = [
  ['The price is above zero', 'A zero or negative quote is refused.', false],
  ['The allowance has not expired', 'After the last day, nothing is paid. Extend it with your Ledger.', false],
  ['The merchant is on your list', 'Anyone else is decline-only. No signature can pay them.', false],
  ['The price is within the per-purchase cap', 'Over the cap, the agent stops and asks you. Your Ledger can approve that one purchase.', true],
  ['The total stays within the budget', 'A purchase that would go over the budget is refused, even with a signature.', false],
];

export function RulesView({ snapshot, view, onLoad, onNotice, editorSeed }) {
  const rules = snapshot?.rules;
  if (!rules) {
    return <section className="card"><EmptyState icon={<IconLock />} title="Rules are still loading">The budget, cap, and expiry appear here as soon as the allowance answers.</EmptyState></section>;
  }
  return (
    <div className="page-grid rules-page">
      <ul className="stat-tiles page-tiles" aria-label="Current limits">
        <Tile label="Budget" value={money(view.budget)} unit="RLUSD" hint={`${money(view.spent)} spent`} />
        <Tile label="Per-purchase cap" value={money(rules.maxPerPurchase)} unit="RLUSD" hint="Above this needs you" />
        <Tile label="Left to spend" value={money(view.left)} unit="RLUSD" hint={`${Math.round((1 - view.ratio) * 100)}% of the budget`} />
        <Tile label="Expires" value={day(rules.expiresAt)} hint={daysLabel(daysLeft(rules.expiresAt))} />
      </ul>
      <section className="card editor-card" aria-labelledby="editor-title">
        <div className="card-head">
          <h2 id="editor-title">Edit the allowance</h2>
          <p className="meta">Lowering applies now. Raising needs your Ledger.</p>
        </div>
        <AllowanceEditor snapshot={snapshot} onSaved={onLoad} onNotice={onNotice} seed={editorSeed} />
      </section>
      <section className="card checks-card" aria-labelledby="checks-title">
        <div className="card-head">
          <h2 id="checks-title">How every purchase is checked</h2>
        </div>
        <p className="meta checks-lede">In this order, before anything is signed. The first rule that fails decides.</p>
        <ol className="rule-steps">
          {CHECKS.map(([title, body, approvable], index) => (
            <li key={title}>
              <span className="rule-step-n" aria-hidden="true">{index + 1}</span>
              <div>
                <p className="rule-step-title">{title}</p>
                <p className="meta">{body}</p>
                <span className={approvable ? 'rule-tag is-soft' : 'rule-tag'}>
                  {approvable ? <><IconUnlock size={14} /> Your Ledger can approve past it</> : <><IconLock size={14} /> Nobody can override it</>}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function merchantRows(allowed) {
  return (allowed ?? []).map((item) => (
    typeof item === 'string'
      ? { address: item, label: 'Allowed merchant' }
      : { address: item.address, label: item.label || 'Allowed merchant' }
  )).filter((item) => item.address);
}

export function MerchantsView({ snapshot, view, onGo }) {
  const allowed = merchantRows(snapshot?.rules?.allowedMerchants);
  const denied = snapshot?.rules?.deniedMerchants ?? [];
  const stats = useMemo(() => {
    const byAddress = new Map();
    for (const item of view?.activity ?? []) {
      const key = String(item.merchant ?? '').toLowerCase();
      const row = byAddress.get(key) ?? { paid: 0, count: 0, last: null };
      if (item.status === 'paid') {
        row.paid += Number(item.amount) || 0;
        row.count += 1;
        if (!row.last || Date.parse(item.createdAt) > Date.parse(row.last)) row.last = item.createdAt;
      }
      byAddress.set(key, row);
    }
    return byAddress;
  }, [view?.activity]);
  const share = spendByMerchant(view?.payments ?? []);
  return (
    <div className="page-grid merchants-page">
      <ul className="stat-tiles page-tiles" aria-label="Merchant summary">
        <Tile label="Allowed" value={String(allowed.length)} hint="The agent may pay these" />
        <Tile label="Decline-only" value={String(denied.length)} hint="Never payable" tone={denied.length ? 'warn' : ''} />
        <Tile label="Top merchant" value={share[0]?.label ?? 'None yet'} hint={share[0] ? `${money(share[0].amount)} RLUSD paid` : 'Nothing paid yet'} />
      </ul>
      <section className="card table-card" aria-labelledby="page-title">
        <div className="card-head">
          <h2>Allowlist</h2>
          <button type="button" className="btn" onClick={() => onGo?.('rules')}>Add or remove</button>
        </div>
        {allowed.length === 0 ? (
          <EmptyState icon={<IconLock />} title="No merchants yet">Add a merchant from the allowance editor. Until then, every quote waits.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Merchant</th>
                  <th scope="col">Payout address</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col" className="num">Payments</th>
                  <th scope="col">Last paid</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {allowed.map((item) => {
                  const row = stats.get(item.address.toLowerCase()) ?? { paid: 0, count: 0, last: null };
                  return (
                    <tr key={item.address}>
                      <th scope="row">
                        <span className="cell-merchant">
                          <span className="avatar" aria-hidden="true">{(item.label || 'M').trim().charAt(0).toUpperCase()}</span>
                          {item.label}
                        </span>
                      </th>
                      <td><CopyAddress address={item.address} /></td>
                      <td className="num">{money(row.paid)} RLUSD</td>
                      <td className="num">{row.count}</td>
                      <td>{row.last ? <span title={whenFull(row.last)}>{relativeTime(row.last)}</span> : <span className="meta">Never</span>}</td>
                      <td><span className="pill ok"><IconCheck size={14} /> Allowed</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {denied.length ? (
        <section className="card table-card" aria-labelledby="denied-title">
          <div className="card-head">
            <h2 id="denied-title">Decline-only</h2>
            <p className="meta">Quotes from these are recorded and refused. A Ledger signature cannot pay them.</p>
          </div>
          <ul className="denied-list">
            {denied.map((item) => (
              <li key={item.address}>
                <span className="avatar is-danger" aria-hidden="true"><IconLock size={16} /></span>
                <div>
                  <p className="denied-name">{item.label || 'Unlisted merchant'}</p>
                  <p className="meta">{item.reason}</p>
                </div>
                <CopyAddress address={item.address} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function AgentsView({ snapshot, view, onOpen, agentPanels = null }) {
  const bedrock = snapshot?.bedrockConfigured;
  const mandate = snapshot?.mandate;
  const decisions = (view?.activity ?? []).filter((item) => item.plan?.source || item.task).slice(0, 8);
  const paidCount = (view?.payments ?? []).filter((item) => item.status === 'paid').length;
  return (
    <div className="page-grid agents-page">
      <ul className="stat-tiles page-tiles" aria-label="Agent summary">
        <Tile label="Agent" value={snapshot?.profile?.agentName || 'Unnamed'} hint={snapshot?.frozen ? 'Frozen. Nothing can be signed' : snapshot?.agentConnected ? 'Connected, pays inside the rules' : 'Waiting for its first payment'} tone={snapshot?.frozen ? 'warn' : ''} />
        <Tile label="Planner" value={bedrock ? 'Bedrock' : 'Built-in'} hint={bedrock ? 'Amazon Bedrock chooses' : 'Rules planner, no model'} />
        <Tile label="Mandate" value={mandate?.signed ? 'Signed' : 'Not signed'} hint={mandate?.signed ? `For ${shortAddress(mandate.agent)}` : 'Optional Ledger-signed scope'} />
        <Tile label="Payments made" value={String(paidCount)} hint={`${money(view?.spent ?? 0)} RLUSD in total`} />
      </ul>
      <section className="card" aria-labelledby="page-title">
        <div className="card-head">
          <h2>Recent decisions</h2>
          <p className="meta">What the agent chose to buy, and who chose it.</p>
        </div>
        {decisions.length === 0 ? (
          <EmptyState icon={<IconCheck />} title="No decisions yet">Run the agent. Each purchase it plans shows up here with the planner that chose it.</EmptyState>
        ) : (
          <ul className="decision-list">
            {decisions.map((item) => (
              <li key={item.id}>
                <button type="button" className="decision" onClick={() => onOpen?.(item)}>
                  <span className="decision-task">{item.task || 'Purchase'}</span>
                  <span className="meta">{item.merchantLabel || 'Merchant'} · {money(item.amount)} RLUSD · {relativeTime(item.createdAt)}</span>
                  <span className="decision-source">{planLabel(item.plan) || 'Rules planner'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="meta agent-note">The model only chooses what to buy. It never holds a key, and it cannot change what it is allowed to spend.</p>
      </section>
      {agentPanels ? <div className="agent-panels">{agentPanels}</div> : null}
    </div>
  );
}

function auditTone(row) {
  if (row.rule === 'freeze') return ['Frozen', 'danger'];
  if (row.rule === 'unfreeze') return ['Unfrozen', 'ok'];
  if (row.outcome === 'ledger-approved') return ['Ledger approved', 'warn'];
  if (row.outcome === 'allowed') return ['Allowed', 'ok'];
  return ['Blocked', 'danger'];
}

export function SecurityView({ snapshot, onFreeze, busy, disabled, onExportAudit, onLoad, onNotice }) {
  const audit = snapshot?.audit ?? [];
  const frozen = Boolean(snapshot?.frozen);
  const approver = snapshot?.rules?.approverAddress;
  return (
    <div className="page-grid security-page">
      <section className={frozen ? 'card kill-card is-frozen' : 'card kill-card'} aria-labelledby="kill-title">
        <div className="card-head">
          <h2 id="kill-title">Kill switch</h2>
          <span className={frozen ? 'pill danger' : 'pill ok'}>{frozen ? 'Frozen' : 'Live'}</span>
        </div>
        <p className="kill-copy">
          {frozen
            ? 'Signing is stopped and the payment channel was closed. Unfreeze lets the agent pay inside the rules again. Its next run opens a new channel.'
            : 'Freeze stops every new signature at once, then closes the payment channel. Use it if anything looks wrong. You can unfreeze at any time.'}
        </p>
        <button type="button" className={frozen ? 'btn primary kill-btn' : 'btn danger kill-btn'} onClick={onFreeze} disabled={disabled || busy} aria-busy={busy}>
          {frozen ? <IconUnlock size={18} /> : <IconLock size={18} />}
          <span>{busy ? (frozen ? 'Unfreezing…' : 'Freezing…') : frozen ? 'Unfreeze the agent' : 'Freeze the agent'}</span>
        </button>
      </section>
      <section className="card approver-card" aria-labelledby="approver-title">
        <div className="card-head">
          <h2 id="approver-title">Approver</h2>
          <span className={snapshot?.simulatedLedger || !approver ? 'pill warn' : 'pill ok'}>
            {snapshot?.simulatedLedger ? 'Demo signer' : approver ? 'Hardware Ledger' : 'Not set'}
          </span>
        </div>
        {approver
          ? <CopyAddress address={approver} />
          : <ApproverSetup disabled={Boolean(snapshot?.offlinePreview)} onSaved={onLoad} onNotice={onNotice} />}
        <ul className="approver-can">
          <li><IconCheck size={16} /> Approves one over-cap purchase at a time</li>
          <li><IconCheck size={16} /> Signs raises to the budget, cap, expiry, or merchant list</li>
          <li><IconLock size={16} /> Cannot pay a merchant off the list or go over the budget</li>
        </ul>
        {snapshot?.simulatedLedger ? <p className="sim-label">Backup demo: a simulated Ledger signature, not a hardware device.</p> : null}
      </section>
      <section className="card table-card audit-card" aria-labelledby="audit-log-title">
        <div className="card-head">
          <h2 id="audit-log-title">Audit log</h2>
          <button type="button" className="btn" onClick={onExportAudit} disabled={!audit.length}>Export JSON</button>
        </div>
        {audit.length === 0 ? (
          <EmptyState icon={<IconCheck />} title="No decisions yet">Approvals, blocks, and freezes are kept here with the rule, the reason, and the signer.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Why</th>
                  <th scope="col">Merchant</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Signer</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((row) => {
                  const [label, tone] = auditTone(row);
                  return (
                    <tr key={row.id || `${row.at}-${row.rule}`}>
                      <td><span title={whenFull(row.at)}>{relativeTime(row.at) || '—'}</span></td>
                      <td><span className={`pill ${tone}`}>{label}</span></td>
                      <td>{row.reason}</td>
                      <td>{row.merchantLabel || <span className="meta">—</span>}</td>
                      <td className="num">{row.amount ? `${money(row.amount)} RLUSD` : <span className="meta">—</span>}</td>
                      <td>{row.signer ? (row.signer.startsWith('0x') ? <code>{shortAddress(row.signer)}</code> : row.signer) : <span className="meta">Nothing signed</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsView({ theme, setTheme, voiceOn, onVoice, onReplayIntro }) {
  return (
    <div className="page-grid settings-page">
      <section className="card" aria-labelledby="appearance-title">
        <div className="card-head"><h2 id="appearance-title">Appearance</h2></div>
        <div className="theme-choices" role="radiogroup" aria-labelledby="appearance-title">
          {[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my device']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? 'theme-choice is-on' : 'theme-choice'} onClick={() => setTheme(id)}>
              <span className={`theme-swatch is-${id}`} aria-hidden="true" />
              <span>{label}</span>
              {theme === id ? <IconCheck size={16} /> : null}
            </button>
          ))}
        </div>
        <p className="meta">Motion follows your device. Turn on Reduce motion there and the app stops animating.</p>
      </section>
      <section className="card" aria-labelledby="updates-title">
        <div className="card-head"><h2 id="updates-title">Updates</h2></div>
        <div className="setting-list">
          <Switch label="Spoken updates" hint="Eve reads approvals and blocks aloud." on={Boolean(voiceOn)} onToggle={onVoice} />
        </div>
      </section>
      <section className="card" aria-labelledby="intro-title">
        <div className="card-head"><h2 id="intro-title">Introduction</h2></div>
        <p className="meta">See the tour of allowances, rules, and Ledger approvals again, or rerun the guided setup.</p>
        <div className="how-actions">
          <button type="button" className="btn" onClick={onReplayIntro}>Show the intro</button>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('setup:open'))}>Run setup</button>
        </div>
      </section>
    </div>
  );
}

const FAQ = [
  ['What is an allowance?', 'A budget your AI agent can spend on its own, with a per-purchase cap, a last day, and a list of merchants. Like pocket money with rules.'],
  ['What can the agent do without me?', 'Pay a listed merchant, under the cap, inside the budget, before the last day. Nothing else.'],
  ['When does it ask me?', 'When a price is over the cap, or Jev flags a purchase for review. You approve that one purchase on your Ledger, or decline it.'],
  ['What can no one override?', 'An unlisted merchant, an expired allowance, and going over the budget. Not the agent, not Eve, not a signature.'],
  ['What does Freeze do?', 'Stops every new signature at once and closes the payment channel. Unfreeze lets the agent pay again; its next run opens a new channel.'],
  ['What can Eve do?', 'Eve reads everything and explains it with real numbers. She can open pages, filter history, and export a CSV. She never signs, spends, changes rules, or unfreezes.'],
  ['Jev', explainJev()],
  ['Where is my data?', 'In server/data/store.json on the machine running the API. Payments settle on XRPL EVM Testnet through AP4M.'],
];

export function HelpView({ onAsk, onReplayIntro }) {
  return (
    <div className="page-grid help-page">
      <ul className="faq-grid">
        {FAQ.map(([q, a]) => (
          <li key={q} className="card faq">
            <h2 className="faq-q">{q}</h2>
            <p>{a}</p>
          </li>
        ))}
      </ul>
      <div className="how-actions">
        <button type="button" className="btn primary" onClick={() => onAsk('What did my agent spend today?')}>Ask Eve</button>
        <button type="button" className="btn" onClick={onReplayIntro}>Show the intro</button>
      </div>
    </div>
  );
}

export default function Desk(props) {
  if (props.route === 'rules') return <RulesView {...props} />;
  if (props.route === 'merchants') return <MerchantsView {...props} />;
  if (props.route === 'agents') return <AgentsView {...props} />;
  if (props.route === 'security') return <SecurityView {...props} />;
  if (props.route === 'settings') return <SettingsView {...props} />;
  return <HelpView {...props} />;
}
