import React, { useRef, useState } from 'react';
import {
  buildNewTasksTemplate,
  downloadJson,
  parseNewTasksJson,
} from '../lib/taskBulkJson.js';

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export default function TaskJsonImport({ categories, onSave, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const downloadTemplate = () => {
    downloadJson('commitments-new-tasks-template.json', buildNewTasksTemplate());
    setStatus({ ok: true, text: 'Template downloaded' });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy(true);
    setStatus(null);
    try {
      const data = JSON.parse(await file.text());
      const { payloads, errors } = parseNewTasksJson(data, categories);
      if (payloads.length === 0) throw new Error(errors[0] || 'No valid tasks');
      for (const payload of payloads) await onSave(payload);
      const extra = errors.length ? ` (${errors.length} skipped)` : '';
      setStatus({ ok: true, text: `Created ${payloads.length} task${payloads.length === 1 ? '' : 's'}${extra}` });
      onClose?.();
    } catch (err) {
      setStatus({ ok: false, text: err.message || 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
      margin: '-4px 0 12px',
    }}>
      {status && (
        <span className={`import-export-flash${status.ok ? '' : ' error'}`} style={{ marginRight: 'auto' }}>
          {status.text}
        </span>
      )}
      <button
        type="button"
        className="btn btn-sm"
        onClick={downloadTemplate}
        disabled={busy}
        title="Download a JSON template for multiple tasks"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px' }}
      >
        <DownloadIcon /> Template
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title="Create multiple new tasks from JSON"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px' }}
      >
        <UploadIcon /> {busy ? 'Importing…' : 'JSON'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  );
}
