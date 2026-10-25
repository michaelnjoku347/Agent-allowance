/**
 * Illustrations for the intro slides, drawn from the gauge disk: a pine disk,
 * a cut, and the lime band of what is left. Pure SVG and CSS; every motion
 * stops under prefers-reduced-motion and the drawing still reads.
 */

const PINE = 'var(--art-pine)';
const LIME = 'var(--accent)';
const CREAM = 'var(--art-cream)';

/** The disk with a lime band sweeping in, ringed by the three limits. */
export function ArtAllowance() {
  return (
    <svg className="art art-allowance" viewBox="0 0 320 240" role="img" aria-label="A gauge disk with the lime band of what is left, and the budget, the cap, and the end date around it">
      <circle className="art-halo" cx="160" cy="120" r="96" />
      <circle cx="160" cy="120" r="78" fill={PINE} />
      <circle className="art-sweep" cx="160" cy="120" r="58" fill="none" stroke={LIME} strokeWidth="18" strokeLinecap="round" pathLength="100" transform="rotate(-90 160 120)" />
      <circle cx="160" cy="120" r="34" fill={PINE} />
      <text x="160" y="116" textAnchor="middle" className="art-figure">0.125</text>
      <text x="160" y="134" textAnchor="middle" className="art-caption">RLUSD left</text>
      <g className="art-tag art-tag-1">
        <rect x="8" y="34" width="92" height="34" rx="17" />
        <text x="54" y="56" textAnchor="middle">Budget 0.20</text>
      </g>
      <g className="art-tag art-tag-2">
        <rect x="222" y="58" width="90" height="34" rx="17" />
        <text x="267" y="80" textAnchor="middle">Cap 0.05</text>
      </g>
      <g className="art-tag art-tag-3">
        <rect x="214" y="170" width="98" height="34" rx="17" />
        <text x="263" y="192" textAnchor="middle">Ends Dec 31</text>
      </g>
      <g className="art-tag art-tag-4">
        <rect x="8" y="160" width="104" height="34" rx="17" />
        <text x="60" y="182" textAnchor="middle">2 merchants</text>
      </g>
    </svg>
  );
}

const CHECKS = ['Real price', 'Listed merchant', 'Under the cap', 'Inside the budget', 'Before the end'];

/** A quote drops through the five checks and stops at the cap. */
export function ArtRules() {
  return (
    <svg className="art art-rules" viewBox="0 0 320 240" role="img" aria-label="A 0.08 RLUSD quote passes the first two checks and stops at the per-purchase cap">
      {CHECKS.map((label, index) => {
        const y = 22 + index * 42;
        const stop = index === 2;
        return (
          <g key={label} className={`art-check art-check-${index}${stop ? ' is-stop' : index < 2 ? ' is-pass' : ' is-skip'}`}>
            <rect x="64" y={y} width="236" height="32" rx="16" />
            <circle cx="88" cy={y + 16} r="9" />
            {stop
              ? <path d={`M${83} ${y + 11} l10 10 M${93} ${y + 11} l-10 10`} />
              : index < 2 ? <path d={`M${83} ${y + 16} l4 4 l7 -8`} /> : null}
            <text x="108" y={y + 21}>{label}</text>
          </g>
        );
      })}
      <g className="art-quote">
        <rect x="6" y="14" width="48" height="48" rx="14" />
        <text x="30" y="35" textAnchor="middle" className="art-quote-amount">0.08</text>
        <text x="30" y="50" textAnchor="middle" className="art-quote-unit">RLUSD</text>
      </g>
    </svg>
  );
}

/** A Ledger with the one message it signs. */
export function ArtLedger() {
  return (
    <svg className="art art-ledger" viewBox="0 0 320 240" role="img" aria-label="A Ledger showing Approve purchase, 0.08 RLUSD to Field Weather Co, with a confirm button">
      <rect className="art-device" x="34" y="58" width="252" height="124" rx="26" />
      <rect className="art-screen" x="60" y="80" width="200" height="80" rx="12" />
      <text x="160" y="106" textAnchor="middle" className="art-screen-title">Approve purchase</text>
      <text x="160" y="128" textAnchor="middle" className="art-screen-amount">0.08 RLUSD</text>
      <text x="160" y="146" textAnchor="middle" className="art-screen-meta">Field Weather Co</text>
      <circle className="art-button" cx="160" cy="202" r="16" />
      <circle className="art-press" cx="160" cy="202" r="16" />
      <path className="art-key" d="M152 202 l6 6 l11 -12" />
      <g className="art-sign">
        <rect x="214" y="18" width="92" height="30" rx="15" />
        <text x="260" y="38" textAnchor="middle">Signed once</text>
      </g>
    </svg>
  );
}

/** The lock that freezes signing, and Eve answering beside it. */
export function ArtControl() {
  return (
    <svg className="art art-control" viewBox="0 0 320 240" role="img" aria-label="A lock closing over the agent, and Eve explaining a payment">
      <g className="art-lock">
        <rect x="40" y="104" width="92" height="76" rx="16" />
        <path className="art-shackle" d="M60 104 v-22 a26 26 0 0 1 52 0 v22" />
        <path d="M86 128 a9 9 0 0 1 4.5 16.8 l2.5 13.2 h-14 l2.5 -13.2 A9 9 0 0 1 86 128 z" fill={CREAM} />
      </g>
      <g className="art-chat art-chat-1">
        <rect x="150" y="54" width="150" height="48" rx="16" />
        <text x="166" y="76">Why was it held?</text>
        <text x="166" y="92" className="art-chat-who">You</text>
      </g>
      <g className="art-chat art-chat-2">
        <rect x="150" y="112" width="160" height="66" rx="16" />
        <text x="166" y="134">0.08 is over your</text>
        <text x="166" y="151">0.05 cap. Approve it</text>
        <text x="166" y="168">on your Ledger.</text>
      </g>
    </svg>
  );
}

export const ART = {
  allowance: ArtAllowance,
  rules: ArtRules,
  ledger: ArtLedger,
  control: ArtControl,
};
