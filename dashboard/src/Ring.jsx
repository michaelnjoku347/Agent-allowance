/** Progress ring for the share of the budget that is left. Decorative: the figure beside it carries the meaning. */
export default function Ring({ ratio, size = 132, stroke = 12 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio));
  return (
    <svg className="ring" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="ring-fill"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - filled)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dy="0.1em" textAnchor="middle" dominantBaseline="middle" className="ring-label">
        {Math.round(filled * 100)}%
      </text>
      <text x="50%" y="50%" dy="1.9em" textAnchor="middle" dominantBaseline="middle" className="ring-sub">
        left
      </text>
    </svg>
  );
}
