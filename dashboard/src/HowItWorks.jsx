import { useState } from 'react';
import { anchorDecisions, requestMandateChallenge, submitMandate } from './api.js';
import { prepareLedger, signOnLedger } from './ledger.js';
import { webHidSupported } from '../../shared/ledger-device.js';
import { AGENTIC_LINE, SPONSORS } from '../../shared/sponsors.js';

function txHref(hash) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash || '')
    ? `https://explorer.testnet.xrplevm.org/tx/${hash}`
    : null;
}

export default function HowItWorks({ snapshot, onChange }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const mandate = snapshot?.mandate;
  const anchor = snapshot?.anchor;
  const bedrock = snapshot?.bedrockConfigured
    ? 'Amazon Bedrock is configured. It chooses. It does not spend.'
    : 'Bedrock is not configured. The planner is labeled Fallback, not a live model.';
  const anchorHref = anchor?.anchored ? txHref(anchor.txHash) : null;

  async function signMandate() {
    setBusy('mandate');
    setNote('');
    try {
      prepareLedger();
      const challenge = await requestMandateChallenge();
      const signature = await signOnLedger(challenge.typedData, { expectedAddress: challenge.approver });
      await submitMandate({ signature, typedData: challenge.typedData });
      setNote('The Ledger signed the agent mandate. The merchant now requires it on /resource.');
      onChange?.();
    } catch (error) {
      setNote(error.message || 'The agent mandate was not signed.');
    } finally {
      setBusy('');
    }
  }

  async function anchorLatest() {
    setBusy('anchor');
    setNote('');
    try {
      const body = await anchorDecisions();
      setNote(body.reason || (body.anchored ? 'Anchored on XRPL EVM.' : 'Not anchored.'));
      onChange?.();
    } catch (error) {
      setNote(error.message || 'The decision was not anchored.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="card how" aria-labelledby="how-title">
      <div className="section-head">
        <h2 id="how-title">How it works</h2>
        <p>{AGENTIC_LINE} The agent decides what to buy. It cannot decide what it is allowed to spend.</p>
      </div>
      <ol className="sponsor-grid">
        {SPONSORS.map((sponsor) => (
          <li key={sponsor.id} className="sponsor-card">
            <p className="rogue-kicker">{sponsor.name}</p>
            <p>{sponsor.id === 'aws' ? `${sponsor.job} ${bedrock}` : sponsor.job}</p>
          </li>
        ))}
      </ol>
      <div className="how-actions">
        <p className="meta">
          {mandate?.signed
            ? `Agent mandate signed for ${mandate.agent}. Budget ${mandate.budget}. Cap ${mandate.cap}.`
            : 'No agent mandate is signed yet. Until one is, the merchant still serves /resource.'}
        </p>
        <button type="button" className="btn" onClick={signMandate} disabled={busy === 'mandate' || snapshot?.offlinePreview || !webHidSupported()}>
          {busy === 'mandate' ? 'Waiting for the Ledger…' : 'Sign the agent mandate'}
        </button>
        <button type="button" className="btn" onClick={anchorLatest} disabled={busy === 'anchor' || snapshot?.offlinePreview}>
          {busy === 'anchor' ? 'Anchoring…' : 'Anchor the latest decision'}
        </button>
        {anchor?.hash ? <p className="meta">Decision hash {anchor.hash}</p> : null}
        {anchorHref ? (
          <p className="meta"><a href={anchorHref} target="_blank" rel="noreferrer noopener">XRPL EVM anchor</a></p>
        ) : anchor?.reason ? <p className="meta">{anchor.reason}</p> : null}
        {note ? <p className="note" role="status">{note}</p> : null}
      </div>
    </section>
  );
}
