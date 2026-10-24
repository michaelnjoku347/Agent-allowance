/** Inline icons. Decorative by default; pass a label to name one for screen readers. */
function Svg({ label, size = 24, children, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The mark: an allowance ring with a gap, and the agent's dot riding on it. */
export function Logo({ size = 32 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="var(--logo-bg)" />
      <path d="M16 7.5a8.5 8.5 0 1 1-8.1 5.9" fill="none" stroke="var(--logo-ring)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="9.6" cy="10" r="2.6" fill="var(--logo-dot)" />
      <path d="M12.6 19.4 16 11.8l3.4 7.6M13.8 16.9h4.4" fill="none" stroke="var(--logo-ring)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const HomeIcon = (p) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const ListIcon = (p) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </Svg>
);

export const SparkIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
    <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />
  </Svg>
);

export const MicIcon = (p) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Svg>
);

export const SendIcon = (p) => (
  <Svg {...p}>
    <path d="M4 12 20 4l-6 16-2.5-6.5z" />
    <path d="M11.5 13.5 20 4" />
  </Svg>
);

export const PlayIcon = (p) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p) => (
  <Svg {...p}>
    <path d="M9 5.5v13M15 5.5v13" strokeWidth="2.6" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const XIcon = (p) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const ClockIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const BlockIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Svg>
);

export const CapIcon = (p) => (
  <Svg {...p}>
    <path d="M4 17h16M7 17V9.5M12 17V6M17 17v-4.5" />
  </Svg>
);

export const CalendarIcon = (p) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);

export const StoreIcon = (p) => (
  <Svg {...p}>
    <path d="M4.5 9.5 6 4.5h12l1.5 5M4.5 9.5h15M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
    <path d="M5.5 12v7.5h13V12M10 19.5v-4h4v4" />
  </Svg>
);

export const ShieldIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" />
    <path d="M12 8.5v4M12 15.5v.01" />
  </Svg>
);

export const ChevronIcon = (p) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const ExternalIcon = (p) => (
  <Svg {...p}>
    <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" />
  </Svg>
);

export const SunIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (p) => (
  <Svg {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </Svg>
);

export const AutoIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
  </Svg>
);

export const SpeakerIcon = (p) => (
  <Svg {...p}>
    <path d="M4.5 9.5h3l5-4v13l-5-4h-3z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const CopyIcon = (p) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Svg>
);

export const BoltIcon = (p) => (
  <Svg {...p}>
    <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z" />
  </Svg>
);

export const ChainIcon = (p) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const SearchIcon = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Svg>
);

export const TagIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" />
    <circle cx="8" cy="8" r="1.5" />
  </Svg>
);

export const EditIcon = (p) => (
  <Svg {...p}>
    <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

export const ArrowIcon = (p) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

/** Contactless waves, drawn for the agent card. */
export const WavesIcon = (p) => (
  <Svg {...p}>
    <path d="M8 8.5a5 5 0 0 1 0 7M11.5 6a8.5 8.5 0 0 1 0 12M15 3.5a12 12 0 0 1 0 17" />
  </Svg>
);

export const WalletIcon = (p) => (
  <Svg {...p}>
    <path d="M4.5 7.5A2 2 0 0 1 6.5 5.5h11v3" />
    <rect x="4.5" y="8.5" width="15" height="10" rx="2" />
    <path d="M15.5 13.5h1.5" />
  </Svg>
);
