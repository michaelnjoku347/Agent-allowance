import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { BlockIcon, CheckIcon, ClockIcon, SparkIcon, XIcon } from '../icons.jsx';

const ICONS = { ok: CheckIcon, warn: ClockIcon, danger: BlockIcon, info: SparkIcon };

/** Short notices for live events. The page's own live region reads them out; these are the visual. */
export default function Toasts({ toasts, onDismiss, onOpen }) {
  return (
    <div className="toasts" aria-hidden="true">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} onOpen={onOpen} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ toast, onDismiss, onOpen }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(toast.id), 5200);
    return () => window.clearTimeout(t);
  }, [toast.id, onDismiss]);
  const Icon = ICONS[toast.tone] ?? SparkIcon;
  return (
    <motion.div
      layout
      className={`toast ${toast.tone}`}
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', damping: 26, stiffness: 380 }}
    >
      <span className="toast-icon"><Icon size={18} /></span>
      <button type="button" className="toast-body" tabIndex={-1} onClick={() => { if (toast.item) onOpen(toast.item); onDismiss(toast.id); }}>
        <strong>{toast.title}</strong>
        {toast.text ? <span>{toast.text}</span> : null}
      </button>
      <button type="button" className="toast-x" tabIndex={-1} onClick={() => onDismiss(toast.id)}>
        <XIcon size={16} />
      </button>
    </motion.div>
  );
}
