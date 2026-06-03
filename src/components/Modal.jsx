import React, { useEffect, useRef } from 'react';
import '../styles/modal.css';

export default function Modal({ title, onClose, children }) {
  const ref = useRef();

  // Close on Escape; trap focus inside modal
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
