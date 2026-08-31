import React, { useEffect } from 'react';
import '../styles/modal.css';

export default function Modal({ title, children, onClose, wide, headerActions, className = '' }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className={`modal${className ? ` ${className}` : ''}`}
        style={wide ? { maxWidth: 520 } : {}}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="modal-header">
            <h2 className="modal-title">{title}</h2>
            {headerActions && <div className="modal-header-actions">{headerActions}</div>}
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
