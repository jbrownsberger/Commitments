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

export default function TaskJsonImport({ categories, onSave, onClose, onStatus }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const report = (next) => onStatus?.(next);

  const downloadTemplate = () => {
    downloadJson('task-triage-new-tasks-template.json', buildNewTasksTemplate());
    report({ ok: true, text: 'Template downloaded' });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy(true);
    report(null);
    try {
      const data = JSON.parse(await file.text());
      const { payloads, errors } = parseNewTasksJson(data, categories);
      if (payloads.length === 0) throw new Error(errors[0] || 'No valid tasks');
      for (const payload of payloads) await onSave(payload);
      const extra = errors.length ? ` (${errors.length} skipped)` : '';
      report({ ok: true, text: `Created ${payloads.length} task${payloads.length === 1 ? '' : 's'}${extra}` });
      onClose?.();
    } catch (err) {
      report({ ok: false, text: err.message || 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-json-actions">
      <button
        type="button"
        className="btn btn-sm"
        onClick={downloadTemplate}
        disabled={busy}
        title="Download a JSON template for multiple tasks"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px' }}
      >
        <DownloadIcon /> Template
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title="Create multiple new tasks from JSON"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px' }}
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
