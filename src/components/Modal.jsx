import React, { useEffect } from 'react';
import '../styles/modal.css';

export default function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { maxWidth: 520 } : {}}
        onClick={e => e.stopPropagation()}
      >
        {title && <h2 style={{ fontSize:16, fontWeight:500, marginBottom:16 }}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
