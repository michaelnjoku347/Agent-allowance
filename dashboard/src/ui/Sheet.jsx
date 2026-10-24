import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, useId, useRef } from 'react';
import { XIcon } from '../icons.jsx';
import { useMedia } from './bits.jsx';

/**
 * Dialog that is a bottom sheet on phones (drag the grip down to close) and a
 * right-hand drawer on desktop. Focus is trapped while open and returns to the
 * button that opened it.
 */
export default function Sheet({ open, title, subtitle, onClose, children, wide }) {
  return (
    <AnimatePresence>
      {open ? (
        <Panel key="sheet" title={title} subtitle={subtitle} onClose={onClose} wide={wide}>
          {children}
        </Panel>
      ) : null}
    </AnimatePresence>
  );
}

function Panel({ title, subtitle, onClose, children, wide }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const desktop = useMedia('(min-width: 960px)');
  const drag = useDragControls();
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement;
    const focusable = () => [...root.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.disabled);
    (root.querySelector('[data-autofocus]') ?? focusable()[0])?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const hidden = desktop ? { x: 48, opacity: 0 } : { y: '100%' };
  const shown = desktop ? { x: 0, opacity: 1 } : { y: 0 };

  return (
    <motion.div
      className="sheet-back"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.div
        className={wide ? 'sheet wide' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        initial={hidden}
        animate={shown}
        exit={hidden}
        transition={{ type: 'spring', damping: 32, stiffness: 340 }}
        drag={desktop ? false : 'y'}
        dragListener={false}
        dragControls={drag}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
      >
        <div className="sheet-grip" aria-hidden="true" onPointerDown={(event) => drag.start(event)}>
          <span />
        </div>
        <div className="sheet-top" onPointerDown={(event) => { if (!desktop && event.target === event.currentTarget) drag.start(event); }}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="meta">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
