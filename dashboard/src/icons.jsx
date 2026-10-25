function Stroke({ children, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none">
      {children}
    </svg>
  );
}

const pen = {
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Same drawing as dashboard/public/brand/mark.svg. The dot is the allowance still left. */
export function LogoMark({ tone = 'pine', size = 36 }) {
  const pine = tone !== 'cream';
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill={pine ? '#1B4D3E' : '#F7F4EC'} />
      <path d="M 22.96 7.67 A 10.40 10.40 0 1 1 14.19 5.16 L 14.99 9.69 A 5.80 5.80 0 1 0 19.88 11.09 Z" fill={pine ? '#F7F4EC' : '#1B4D3E'} />
      <circle cx="17.88" cy="7.52" r="2.5" fill={pine ? '#C6F36B' : '#1A1814'} />
    </svg>
  );
}

export function IconHome() {
  return (
    <Stroke>
      <path {...pen} d="M4.5 10.8 12 4.5l7.5 6.3V19.5a1 1 0 0 1-1 1h-4.2v-5.2H9.7v5.2H5.5a1 1 0 0 1-1-1v-8.7z" />
    </Stroke>
  );
}

export function IconActivity() {
  return (
    <Stroke>
      <path {...pen} d="M5 7.5h9M5 12h14M5 16.5h7" />
      <path {...pen} d="M16.5 15.5 18.2 17.2 21.5 13.5" />
    </Stroke>
  );
}

export function IconEve() {
  return (
    <Stroke>
      <path {...pen} d="M6 8.5h12a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H10l-3.5 3v-3H6a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2z" />
      <path {...pen} d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </Stroke>
  );
}

export function IconMic({ size = 22 }) {
  return (
    <Stroke size={size}>
      <rect {...pen} x="9" y="3.5" width="6" height="10" rx="3" />
      <path {...pen} d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9 20h6" />
    </Stroke>
  );
}

export function IconSettings() {
  return (
    <Stroke>
      <path {...pen} d="M4.5 8h10M18.5 8H20M4.5 16H8M12 16h8" />
      <circle {...pen} cx="16.5" cy="8" r="2" />
      <circle {...pen} cx="10" cy="16" r="2" />
    </Stroke>
  );
}

export function IconCheck({ size = 18 }) {
  return (
    <Stroke size={size}>
      <path {...pen} d="M5 12.5 9.2 16.5 19 7.5" />
    </Stroke>
  );
}

export function IconReceipt() {
  return (
    <Stroke>
      <path {...pen} d="M7 3.5h10a1 1 0 0 1 1 1V20l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V4.5a1 1 0 0 1 1-1z" />
      <path {...pen} d="M9 8h6M9 12h6" />
    </Stroke>
  );
}

export function EveMark({ size = 28 }) {
  return (
    <svg className="eve-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#1B4D3E" />
      <path d="M10.5 10.5h11M10.5 16h7.5M10.5 21.5h11" stroke="#F4F0E6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevron({ size = 22 }) {
  return (
    <Stroke size={size}>
      <path {...pen} d="M6 14.5 12 8.5l6 6" />
    </Stroke>
  );
}

export function IconMinus({ size = 22 }) {
  return (
    <Stroke size={size}>
      <path {...pen} d="M6 12h12" />
    </Stroke>
  );
}

export function IconLock({ size = 16 }) {
  return (
    <Stroke size={size}>
      <rect {...pen} x="6" y="11" width="12" height="8" rx="1.5" />
      <path {...pen} d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />
    </Stroke>
  );
}

export function IconAlert({ size = 18 }) {
  return (
    <Stroke size={size}>
      <path {...pen} d="M12 4.5 20.5 19H3.5L12 4.5z" />
      <path {...pen} d="M12 10v4.2M12 16.8h.01" />
    </Stroke>
  );
}
