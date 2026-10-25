import { useId } from 'react';
import { MARK } from './brandMark.js';

/**
 * The gauge disk, drawn inline so the lime band can sweep into the cut.
 * Geometry comes from scripts/build-brand.py. On a dark page the disk sits on
 * the cream tile, with the same clear space as the app icon.
 */
export default function BrandMark({ size = 40, animate = true }) {
  const maskId = `mark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className={animate ? 'logo-mark is-animated' : 'logo-mark'}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="mark-tile" width="32" height="32" rx="8" fill={MARK.cream} />
      <g className="mark-art">
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <path
            className="mark-sweep"
            d={MARK.sweep}
            fill="none"
            stroke="#fff"
            strokeWidth={MARK.sweepWidth}
            pathLength="1"
          />
        </mask>
        <path fill={MARK.pine} d={MARK.disk} />
        <path fill={MARK.pine} d={MARK.segment} />
        <path fill={MARK.accent} d={MARK.lime} mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}
