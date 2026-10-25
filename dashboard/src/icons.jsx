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

export function IconSliders({ size = 22 }) {
  return (
    <Stroke size={size}>
      <path {...pen} d="M4.5 8h10M18.5 8H20M4.5 16H8M12 16h8" />
      <circle {...pen} cx="16.5" cy="8" r="2" />
      <circle {...pen} cx="10" cy="16" r="2" />
    </Stroke>
  );
}

export function IconBadgeCheck() {
  return (
    <Stroke>
      <path {...pen} d="M12 3.5l2.1 1.5 2.6-.1.8 2.5 2.1 1.5-.8 2.5.8 2.5-2.1 1.5-.8 2.5-2.6-.1L12 20.5l-2.1-1.5-2.6.1-.8-2.5-2.1-1.5.8-2.5-.8-2.5 2.1-1.5.8-2.5 2.6.1z" />
      <path {...pen} d="M9 12.2l2.1 2.1 4-4.2" />
    </Stroke>
  );
}

export function IconStore() {
  return (
    <Stroke>
      <path {...pen} d="M4.5 9.5 6 4.5h12l1.5 5" />
      <path {...pen} d="M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
      <path {...pen} d="M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5" />
    </Stroke>
  );
}

export function IconBot() {
  return (
    <Stroke>
      <rect {...pen} x="4.5" y="8" width="15" height="11" rx="3" />
      <path {...pen} d="M12 8V4.5M2.5 12.5v2.5M21.5 12.5v2.5M10 15.5h4" />
      <path {...pen} d="M9.25 12h.01M14.75 12h.01" />
    </Stroke>
  );
}

export function IconShieldCheck() {
  return (
    <Stroke>
      <path {...pen} d="M12 3.5 19 6v5.5c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6l7-2.5z" />
      <path {...pen} d="M9 12l2.1 2.1 4-4.1" />
    </Stroke>
  );
}

export function IconGear() {
  return (
    <Stroke>
      <circle {...pen} cx="12" cy="12" r="2.75" />
      <path {...pen} d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.55 1.55M7.55 16.45 6 18M18 18l-1.55-1.55M7.55 7.55 6 6" />
      <circle {...pen} cx="12" cy="12" r="6.3" />
    </Stroke>
  );
}

export function IconHelp() {
  return (
    <Stroke>
      <circle {...pen} cx="12" cy="12" r="8.5" />
      <path {...pen} d="M9.6 9.5a2.5 2.5 0 0 1 4.85.85c0 1.65-2.45 2.15-2.45 3.65" />
      <path {...pen} d="M12 17h.01" />
    </Stroke>
  );
}

export function IconMore() {
  return (
    <Stroke>
      <path {...pen} d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.5" />
    </Stroke>
  );
}

export function IconContrast({ size = 22 }) {
  return (
    <Stroke size={size}>
      <circle {...pen} cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
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
      <path d="M11 9.2v13.6M11 9.2h10.2M11 16h7.2M11 22.8h10.2" fill="none" stroke="#F7F4EC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.4" cy="16" r="2.1" fill="#C6F36B" />
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

export function IconUnlock({ size = 16 }) {
  return (
    <Stroke size={size}>
      <rect {...pen} x="6" y="11" width="12" height="8" rx="1.5" />
      <path {...pen} d="M8.5 11V8.5a3.5 3.5 0 0 1 6.6-1.6" />
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

export function IconMoreVertical() {
  return (
    <Stroke>
      <path {...pen} d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth="2.5" />
    </Stroke>
  );
}
