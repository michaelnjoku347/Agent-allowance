import { money } from './format.js';
import { explainJev } from '../../shared/words.js';

function when(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function shortAddress(address) {
  const text = String(address ?? '');
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
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

function Empty({ title, body, action, actionLabel }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <button type="button" className="btn" onClick={action}>{actionLabel}</button> : null}
    </div>
  );
}

export function RulesView({ snapshot, view, onAsk, onSetup }) {
  const rules = snapshot?.rules;
  if (!rules) return <Empty title="Rules are still loading" body="The budget, cap, and expiry appear here as soon as the allowance answers." />;
  const rows = [
    ['Budget', `${money(view.budget)} RLUSD`],
    ['Per-purchase cap', `${money(rules.maxPerPurchase)} RLUSD`],
    ['Left to spend', `${money(view.left)} RLUSD`],
    ['Expires', when(rules.expiresAt)],
  ];
  return (
    <section className="card" aria-labelledby="rules-title">
      <div className="section-head">
        <h2 id="rules-title">Rules</h2>
        <p>The agent pays on its own only inside these limits. A raise needs the Ledger.</p>
      </div>
      <dl className="stat-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="how-actions">
        <button type="button" className="btn primary" onClick={onSetup}>Edit allowance</button>
        <button type="button" className="btn" onClick={() => onAsk('Set my cap to 3')}>Ask Eve to lower the cap</button>
      </div>
    </section>
  );
}

function merchantRows(allowed) {
  return (allowed ?? []).map((item) => (
    typeof item === 'string'
      ? { address: item, label: 'Allowed merchant' }
      : { address: item.address, label: item.label || 'Allowed merchant' }
  )).filter((item) => item.address);
}

export function MerchantsView({ snapshot }) {
  const allowed = merchantRows(snapshot?.rules?.allowedMerchants);
  return (
    <section className="card" aria-labelledby="merchants-title">
      <div className="section-head">
        <h2 id="merchants-title">Merchants</h2>
        <p>The agent can pay only the merchants on this list.</p>
      </div>
      {allowed.length === 0 ? (
        <Empty title="No merchants yet" body="Add a merchant from the allowance setup. Until then, every quote waits." />
      ) : (
        <ul className="people">
          {allowed.map((item) => (
            <li key={item.address} className="merchant-row">
              <span className="avatar" aria-hidden="true">{(item.label || 'M').trim().charAt(0).toUpperCase()}</span>
              <span className="merchant-copy">
                <strong>{item.label}</strong>
                <code className="meta address" title={item.address}>{shortAddress(item.address)}</code>
              </span>
              <span className="pill ok">Allowed</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AgentsView({ snapshot }) {
  const bedrock = snapshot?.bedrockConfigured;
  const mandate = snapshot?.mandate;
  return (
    <section className="card" aria-labelledby="agents-title">
      <div className="section-head">
        <h2 id="agents-title">Agents</h2>
        <p>One agent spends inside this allowance. The model chooses. It does not hold the keys.</p>
      </div>
      <dl className="stat-list">
        <div>
          <dt>Status</dt>
          <dd>{snapshot?.frozen ? 'Frozen' : snapshot?.agentConnected ? 'Connected' : 'Waiting for a payment'}</dd>
        </div>
        <div>
          <dt>Planner</dt>
          <dd>{bedrock ? 'Amazon Bedrock' : 'Built-in rules planner'}</dd>
        </div>
        <div>
          <dt>Mandate</dt>
          <dd>{mandate?.signed ? `Signed for ${mandate.agent}` : 'Not signed yet'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function SecurityView({ snapshot, onFreeze, busy, disabled }) {
  const audit = snapshot?.audit ?? [];
  return (
    <section className="card" aria-labelledby="security-title">
      <div className="section-head">
        <h2 id="security-title">Security</h2>
        <p>The Ledger approves exceptions. Freeze stops new signatures.</p>
      </div>
      <dl className="stat-list">
        <div>
          <dt>Ledger</dt>
          <dd>{snapshot?.simulatedLedger ? 'Demo signer is on' : 'A hardware Ledger signs exceptions'}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{snapshot?.frozen ? 'Frozen' : 'Can pay inside the rules'}</dd>
        </div>
      </dl>
      <div className="how-actions">
        <button type="button" className="btn danger" onClick={onFreeze} disabled={disabled || busy}>
          {snapshot?.frozen ? 'Unfreeze the agent' : 'Freeze the agent'}
        </button>
      </div>
      <h3 className="subhead">Audit log</h3>
      {audit.length === 0 ? (
        <Empty title="No decisions yet" body="Approvals, declines, and freezes show up here." />
      ) : (
        <ul className="people">
          {audit.slice(0, 12).map((item) => (
            <li key={item.id || `${item.at}-${item.outcome}`}>
              <strong>{item.outcome || item.kind || 'Decision'}</strong>
              <span className="meta">{[item.merchantLabel, item.reason || item.rule, when(item.at)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SettingsView({ theme, onTheme, voiceOn, onVoice }) {
  return (
    <section className="card" aria-labelledby="settings-title">
      <div className="section-head">
        <h2 id="settings-title">Settings</h2>
        <p>Appearance and spoken updates stay on this device.</p>
      </div>
      <div className="setting-list">
        <Switch label="Dark appearance" hint="Matches the theme menu in the header." on={theme === 'dark'} onToggle={onTheme} />
        <Switch label="Spoken updates" hint="Eve reads approvals and blocks aloud." on={Boolean(voiceOn)} onToggle={onVoice} />
      </div>
    </section>
  );
}

export function HelpView({ onAsk }) {
  return (
    <section className="card" aria-labelledby="help-title">
      <div className="section-head">
        <h2 id="help-title">Help</h2>
        <p>The agent decides what to buy. It cannot decide what it is allowed to spend.</p>
      </div>
      <ul className="people">
        <li>
          <strong>Rules first</strong>
          <span className="meta">Budget, cap, expiry, and the merchant list are checked before any signature.</span>
        </li>
        <li>
          <strong>Jev</strong>
          <span className="meta">{explainJev()}</span>
        </li>
        <li>
          <strong>Eve</strong>
          <span className="meta">Ask Eve about the allowance. She cannot approve a purchase or raise a limit.</span>
        </li>
      </ul>
      <div className="how-actions">
        <button type="button" className="btn" onClick={() => onAsk('What did my agent spend today?')}>Ask Eve</button>
      </div>
    </section>
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
