import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * Smooth count. RequestAnimationFrame only — no spring.
 * `text` is the exact figure to land on, from the shared formatter, so the
 * animated number never settles on a rounding of its own. Screen readers get
 * only the final text.
 */
export default function CountUp({ value, text, className }) {
  const reduced = useReducedMotion();
  const target = Number(value);
  const finite = Number.isFinite(target);
  const [shown, setShown] = useState(null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!finite || reduced) {
      fromRef.current = target;
      setShown(null);
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 520;
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * easeOut(t);
      fromRef.current = next;
      if (t < 1) {
        setShown(next);
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setShown(null);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finite, reduced, target]);

  const live = shown === null
    ? text
    : shown.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <span className={className}>
      <span aria-hidden="true">{live}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
