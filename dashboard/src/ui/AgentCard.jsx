import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import CountUp from '../CountUp.jsx';
import Ring from '../Ring.jsx';
import { money, unitsToNumber } from '../format.js';
import { Logo, WavesIcon } from '../icons.jsx';
import { useMedia } from './bits.jsx';

function validThru(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--/--';
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${m}/${String(date.getUTCFullYear()).slice(-2)}`;
}

/**
 * The allowance drawn as a card the agent carries: balance, ring, expiry and
 * network. Tilts toward the pointer on desktop; still for touch and reduced motion.
 */
export default function AgentCard({ ledger, rules, network, state }) {
  const reduced = useReducedMotion();
  const fine = useMedia('(hover: hover) and (pointer: fine)');
  const tilt = fine && !reduced;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [5, -5]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-7, 7]), { stiffness: 180, damping: 18 });
  const sx = useTransform(px, (v) => `${v * 100}%`);
  const sy = useTransform(py, (v) => `${v * 100}%`);
  const shine = useMotionTemplate`radial-gradient(420px circle at ${sx} ${sy}, rgba(255,255,255,0.16), transparent 45%)`;

  const leftText = money(ledger.left);
  const budgetText = money(ledger.budget);

  return (
    <div className="card-stage">
      <motion.div
        className="agent-card"
        style={tilt ? { rotateX: rx, rotateY: ry, transformPerspective: 1000 } : undefined}
        onPointerMove={tilt ? (event) => {
          const box = event.currentTarget.getBoundingClientRect();
          px.set((event.clientX - box.left) / box.width);
          py.set((event.clientY - box.top) / box.height);
        } : undefined}
        onPointerLeave={tilt ? () => { px.set(0.5); py.set(0.5); } : undefined}
        initial={reduced ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 24, stiffness: 200 }}
      >
        {tilt ? <motion.span className="card-shine" style={{ background: shine }} aria-hidden="true" /> : null}
        <div className="card-row">
          <span className="card-brand">
            <Logo size={28} />
            <span>Agent Allowance</span>
          </span>
          <span className={`state state-${state.toLowerCase()}`}>
            <span className="state-dot" aria-hidden="true" />
            {state}
          </span>
        </div>

        <div className="card-main">
          <div className="card-figures">
            <h2 className="card-kicker" id="balance-title">Left to spend</h2>
            <p className="card-amount">
              <CountUp value={unitsToNumber(ledger.left)} text={leftText} />
              <span className="card-unit">RLUSD</span>
            </p>
            <p className="card-of"><span>of <strong>{budgetText}</strong> budget</span> · <span><strong>{money(ledger.spent)}</strong> spent</span></p>
          </div>
          <Ring ratio={ledger.ratioLeft} />
        </div>
        <p className="sr-only">{leftText} of {budgetText} RLUSD left. {money(ledger.spent)} RLUSD spent.</p>

        <div className="card-row card-foot" aria-hidden="true">
          <span className="emv">
            <svg viewBox="0 0 40 30" width="40" height="30">
              <rect x="0.5" y="0.5" width="39" height="29" rx="6" fill="url(#emv)" stroke="rgba(0,0,0,0.25)" />
              <path d="M0 10h13v10H0M40 10H27v10h13M13 0v30M27 0v30M13 15h14" fill="none" stroke="rgba(60,40,0,0.35)" />
              <defs>
                <linearGradient id="emv" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#F3E3A6" />
                  <stop offset="1" stopColor="#C9A957" />
                </linearGradient>
              </defs>
            </svg>
            <WavesIcon size={22} />
          </span>
          <span className="card-meta">
            <span className="card-label">Valid thru</span>
            <span>{validThru(rules?.expiresAt)}</span>
          </span>
          <span className="card-meta">
            <span className="card-label">Network</span>
            <span>{network?.name?.replace(' Testnet', '') || 'XRPL EVM'}</span>
          </span>
          <span className="card-net">Testnet</span>
        </div>
      </motion.div>
    </div>
  );
}
