import React, { useEffect, useRef } from 'react';
export default function Modal({ title, busy, onClose, children }) {
  const ref = useRef(null),
    close = useRef(onClose),
    working = useRef(busy);
  close.current = onClose;
  working.current = busy;
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const roots = [...document.querySelectorAll('.app > aside, .app > main')];
    roots.forEach((el) => (el.inert = true));
    const focusable = () =>
      [
        ...ref.current.querySelectorAll(
          'button,input,select,textarea,a[href],summary,[tabindex="0"]'
        ),
      ].filter((el) => !el.disabled && el.getClientRects().length);
    const frame = requestAnimationFrame(() => {
      const preferred = ref.current.querySelector('[autofocus],input:not([type="hidden"]),select');
      (preferred || focusable()[0] || ref.current).focus();
    });
    function keyboard(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!working.current) close.current();
      }
      if (e.key === 'Tab') {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first || !ref.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keyboard);
      document.body.style.overflow = overflow;
      roots.forEach((el) => (el.inert = false));
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
      >
        <div className="row modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" aria-label="Cerrar ventana" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
