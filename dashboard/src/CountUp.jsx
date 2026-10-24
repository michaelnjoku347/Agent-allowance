import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

/** Smooth count. RequestAnimationFrame only — no spring. */
export default function CountUp({ value, className }) {
  const reduced = useReducedMotion();
  const target = Number(value);
  const finite = Number.isFinite(target);
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!finite) return undefined;
    if (reduced) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 380;
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * easeOut(t);
      fromRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finite, reduced, target]);

  const text = finite
    ? shown.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value ?? '');

  return <span className={className}>{text}</span>;
}
