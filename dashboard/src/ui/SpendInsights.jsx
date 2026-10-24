import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, money, toUnits, unitsToNumber } from '../format.js';
import { merchantName } from './bits.jsx';

const HEIGHT = 188;
const PAD = { top: 26, right: 16, bottom: 28, left: 40 };

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Paid purchases in time order, with the running total after each. */
function series(activity) {
  const paid = activity
    .filter((item) => item.status === 'paid' && Date.parse(item.createdAt))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let total = 0n;
  return paid.map((item) => {
    total += toUnits(item.amount) ?? 0n;
    return { item, t: Date.parse(item.createdAt), total, value: unitsToNumber(total) };
  });
}

function niceTimeTicks(t0, t1, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(t0 + ((t1 - t0) * i) / (count - 1));
  return out;
}

export default function SpendInsights({ ledger }) {
  const points = useMemo(() => series(ledger.activity), [ledger.activity]);
  const stopped = ledger.activity.filter((item) => item.status === 'pending' || item.status === 'declined');
  const stoppedUnits = stopped.reduce((sum, item) => sum + (toUnits(item.amount) ?? 0n), 0n);
  const average = ledger.paidCount ? ledger.spent / BigInt(ledger.paidCount) : 0n;

  const merchants = useMemo(() => {
    const map = new Map();
    for (const p of points) {
      const name = merchantName(p.item);
      map.set(name, (map.get(name) ?? 0n) + (toUnits(p.item.amount) ?? 0n));
    }
    return [...map.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  }, [points]);
  const topMerchant = merchants[0]?.[1] ?? 0n;

  return (
    <section className="panel insights" aria-labelledby="insights-title">
      <div className="panel-head">
        <h2 id="insights-title">Spending</h2>
        <p>Running total of paid purchases against the {money(ledger.budget)} RLUSD budget.</p>
      </div>

      <dl className="stat-row">
        <div className="stat">
          <dt>Spent</dt>
          <dd>{money(ledger.spent)}</dd>
        </div>
        <div className="stat">
          <dt>Average</dt>
          <dd>{money(average)}</dd>
        </div>
        <div className="stat stat-guard">
          <dt>On hold</dt>
          <dd>
            {money(stoppedUnits)}
            <span className="stat-note">{stopped.length} held</span>
          </dd>
        </div>
      </dl>

      {points.length ? <SpendChart points={points} budget={ledger.budget} /> : (
        <p className="empty-copy">No paid purchases yet. The chart fills in as the agent pays.</p>
      )}

      {merchants.length ? (
        <div className="by-merchant">
          <h3 className="mini-h">By merchant</h3>
          <ul>
            {merchants.map(([name, units]) => {
              const pct = topMerchant === 0n ? 0 : (unitsToNumber(units) / unitsToNumber(topMerchant)) * 100;
              return (
                <li key={name}>
                  <span className="bm-name">{name}</span>
                  <span className="bm-track" aria-hidden="true">
                    <span className="bm-bar" style={{ width: `${Math.max(4, pct)}%` }} />
                  </span>
                  <span className="bm-value">{money(units)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SpendChart({ points, budget }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const budgetValue = Math.max(unitsToNumber(budget), points[points.length - 1].value) || 1;
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const span = Math.max(last - first, 60 * 60 * 1000);
  const t0 = first - span * 0.12;
  const t1 = last + span * 0.12;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * innerW;
  const y = (v) => PAD.top + innerH - (v / budgetValue) * innerH;

  let line = `M${x(t0)},${y(0)}`;
  for (const p of points) line += ` H${x(p.t)} V${y(p.value)}`;
  line += ` H${x(t1)}`;
  const area = `${line} V${y(0)} H${x(t0)} Z`;
  const end = points[points.length - 1];
  const yTicks = [0, budgetValue / 2, budgetValue];
  const xTicks = niceTimeTicks(t0 + span * 0.12, t1 - span * 0.12, 3);
  const shown = active === null ? null : points[active];

  function onMove(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px);
      if (d < dist) { dist = d; best = i; }
    });
    setActive(best);
  }

  return (
    <figure className="chart" ref={ref}>
      <figcaption className="sr-only">
        Running total of paid purchases. {points.length} payments, ending at {money(end.total)} of a {money(budget)} RLUSD budget. Every payment is listed under Activity.
      </figcaption>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        role="presentation"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tick">{Math.round(v)}</text>
          </g>
        ))}
        <text x={width - PAD.right} y={y(budgetValue) - 8} textAnchor="end" className="budget-label">
          Budget {money(budget)}
        </text>
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 8} textAnchor="middle" className="tick">{clock(new Date(t).toISOString())}</text>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {shown ? <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={PAD.top + innerH} className="crosshair" /> : null}
        {points.map((p, i) => (
          <circle
            key={p.item.id}
            cx={x(p.t)}
            cy={y(p.value)}
            r={i === active ? 6 : 4.5}
            className="dot"
            tabIndex={0}
            role="img"
            aria-label={`${clock(p.item.createdAt)}: ${money(p.item.amount)} RLUSD to ${merchantName(p.item)}. Total ${money(p.total)}.`}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
        <text x={Math.min(x(end.t) + 10, width - PAD.right)} y={y(end.value) - 10} textAnchor={x(end.t) + 60 > width ? 'end' : 'start'} className="end-label">
          {money(end.total)}
        </text>
      </svg>
      {shown ? (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(x(shown.t), 90), width - 90),
            top: Math.max(y(shown.value) - 12, 0),
          }}
          aria-hidden="true"
        >
          <strong>{money(shown.total)} RLUSD</strong>
          <span>+{money(shown.item.amount)} · {merchantName(shown.item)}</span>
          <span className="tip-time">{clock(shown.item.createdAt)}</span>
        </div>
      ) : null}
    </figure>
  );
}
