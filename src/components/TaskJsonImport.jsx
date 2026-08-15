import React, { useRef, useState } from 'react';
import {
  buildNewTasksTemplate,
  downloadJson,
  parseNewTasksJson,
} from '../lib/taskBulkJson.js';

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
    <div className="tm-json-bar">
      <button type="button" className="btn btn-sm" onClick={downloadTemplate} disabled={busy}
        title="Download a JSON template for multiple tasks">
        Download template
      </button>
      <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}
        title="Create multiple new tasks from JSON">
        {busy ? 'Importing…' : 'Upload JSON'}
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFile} />
      {status && (
        <span className={`import-export-flash${status.ok ? '' : ' error'}`}>{status.text}</span>
      )}
    </div>
  );
}
