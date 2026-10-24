import { ChainIcon, ShieldIcon, TagIcon } from '../icons.jsx';

const STEPS = [
  {
    Icon: TagIcon,
    title: 'The agent gets a price',
    text: 'The merchant answers with an x402 quote in RLUSD. Nothing is paid yet.',
  },
  {
    Icon: ShieldIcon,
    title: 'Rules and Jev check it',
    text: 'Budget, per-purchase cap, approved merchants and expiry, then Jev scores the risk.',
  },
  {
    Icon: ChainIcon,
    title: 'Paid on XRPL, or held for you',
    text: 'If it fits, a signed AP4M voucher settles on XRPL EVM. If not, it waits for you here.',
  },
];

export default function HowItWorks() {
  return (
    <section className="panel how" aria-labelledby="how-title">
      <div className="panel-head">
        <h2 id="how-title">How every purchase is checked</h2>
      </div>
      <ol className="steps">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title}>
            <span className="step-icon"><Icon size={20} /></span>
            <span className="step-n" aria-hidden="true">{i + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
