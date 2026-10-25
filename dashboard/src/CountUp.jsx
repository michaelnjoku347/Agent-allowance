import { useEffect, useRef, useState } from 'react';
import { money } from './format.js';

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * The first paint is the real total. A later change can count from the
 * previous total. Starting at 0 made a reload show 0.056 or 0.0339 while the
 * caption already read "0.00 of 0.20 RLUSD spent". In-between frames use the
 * same 2 to 4 decimals as money(), so the number does not jump in width.
 */
export default function CountUp({ value, className }) {
  const target = Number(value);
  const finite = Number.isFinite(target);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(finite ? target : 0);
  const fromRef = useRef(finite ? target : 0);
  const settledOnce = useRef(false);

  useEffect(() => {
    if (!finite) return undefined;
    if (reduced || !settledOnce.current || fromRef.current === target) {
      settledOnce.current = true;
      fromRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 420;
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) {
        fromRef.current = target;
        setShown(target);
        return;
      }
      setShown(from + (target - from) * easeOut(t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = from;
    };
  }, [finite, reduced, target]);

  const settled = !finite || Math.abs(shown - target) < 1e-9;
  const text = !finite
    ? String(value ?? '')
    : (settled
      ? money(target)
      : shown.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: target % 0.01 === 0 ? 2 : 4 }));

  return <span className={className}>{text}</span>;
}
