/**
 * ImportExport — JSON export, ICS export, JSON import.
 *
 * Props:
 *   appData   — standard appData bag
 *   menuMode  — if true, renders as .user-dropdown-item rows (for inside the user dropdown)
 *               if false/undefined, renders as the original compact toolbar strip
 *   onAction  — optional callback fired after any action (e.g. to close the dropdown)
 */
import React, { useRef, useState } from 'react';

/* ── ICS helpers ─────────────────────────────────────────────────────────── */
function toICSDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeProp(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function tasksToICS(tasks, categories) {
  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));
  const stamp  = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const vtodos = tasks
    .filter(t => !t.recurring && t.status !== 'done')
    .map(t => {
      const catName = catMap[t.category_id]?.name || '';
      const due = t.due_date ? `\nDUE;VALUE=DATE:${toICSDate(t.due_date)}` : '';
      const pct = t.manual_progress ?? 0;
      const status = t.status === 'in progress' ? 'IN-PROCESS'
        : t.status === 'done' ? 'COMPLETED' : 'NEEDS-ACTION';
      const notes = t.notes ? `\nDESCRIPTION:${escapeProp(t.notes)}` : '';
      const cat   = catName ? `\nCATEGORIES:${escapeProp(catName)}` : '';
      return [
        'BEGIN:VTODO',
        `UID:${uid()}@commitments`,
        `DTSTAMP:${stamp}`,
        `SUMMARY:${escapeProp(t.name)}`,
        `STATUS:${status}`,
        `PERCENT-COMPLETE:${pct}`,
        due.trimStart(),
        notes.trimStart(),
        cat.trimStart(),
        'END:VTODO',
      ].filter(Boolean).join('\r\n');
    });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Commitments//EN',
    'CALSCALE:GREGORIAN',
    ...vtodos,
    'END:VCALENDAR',
  ].join('\r\n');
}

/* ── Download helper ─────────────────────────────────────────────────────── */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
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

/* ── Component ───────────────────────────────────────────────────────────── */
export default function ImportExport({ appData, menuMode = false, onAction }) {
  const { categories, tasks, quickTasks, preferences, saveTask, saveCategory, saveQuickTask } = appData;
  const fileRef   = useRef();
  const [status, setStatus] = useState(null); // { ok: bool, text: string }

  const flash = (ok, text) => {
    setStatus({ ok, text });
    setTimeout(() => setStatus(null), 3500);
  };

  /* ── Export JSON ── */
  const exportJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      preferences,
      categories: categories.map(({ id, name, color }) => ({ id, name, color })),
      tasks: tasks.map(t => ({
        id:              t.id,
        category_id:     t.category_id,
        name:            t.name,
        status:          t.status,
        priority:        t.priority,
        due_date:        t.due_date,
        estimated_hours: t.estimated_hours,
        manual_progress: t.manual_progress,
        notes:           t.notes,
        recurring:       t.recurring,
        substeps:        (t.substeps || []).map(s => ({ text: s.text, done: s.done })),
        scheduled_days:  t.scheduled_days,
      })),
      quickTasks: (quickTasks || []).map(q => ({
        name: q.name, done: q.done, timeframeMinutes: q.timeframeMinutes, deadline: q.deadline,
      })),
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    download(`commitments-${dateStr}.json`, JSON.stringify(payload, null, 2), 'application/json');
    flash(true, 'JSON exported');
    onAction?.();
  };

  /* ── Export ICS ── */
  const exportICS = () => {
    const ics = tasksToICS(tasks, categories);
    const dateStr = new Date().toISOString().slice(0, 10);
    download(`commitments-${dateStr}.ics`, ics, 'text/calendar');
    flash(true, 'ICS exported');
    onAction?.();
  };

  /* ── Import JSON ── */
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.tasks || !Array.isArray(data.tasks)) throw new Error('Invalid format: missing tasks array');

      let imported = 0;

      const catIdMap = {};
      (categories || []).forEach(c => { catIdMap[c.id] = c.id; });

      if (data.categories) {
        for (const cat of data.categories) {
          const existing = (categories || []).find(
            c => c.name.toLowerCase() === cat.name.toLowerCase()
          );
          if (existing) {
            catIdMap[cat.id] = existing.id;
          } else {
            const saved = await saveCategory({ name: cat.name, color: cat.color });
            catIdMap[cat.id] = saved.id;
          }
        }
      }

      const existingKeys = new Set(
        (tasks || []).map(t => `${t.category_id}::${t.name.toLowerCase()}`)
      );
      for (const t of data.tasks) {
        const newCatId = catIdMap[t.category_id] ?? t.category_id;
        const key = `${newCatId}::${t.name.toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        await saveTask({
          category_id:     newCatId,
          name:            t.name,
          status:          t.status || 'not started',
          priority:        t.priority || 'med',
          due_date:        t.due_date || null,
          estimated_hours: t.estimated_hours || 1,
          manual_progress: t.manual_progress || 0,
          notes:           t.notes || '',
          substeps:        (t.substeps || []).map(s => ({ text: s.text, done: s.done ?? false })),
          scheduled_days:  t.scheduled_days || [],
        });
        imported++;
      }

      if (data.quickTasks && saveQuickTask) {
        const existingQNames = new Set((quickTasks || []).map(q => q.name.toLowerCase()));
        for (const q of data.quickTasks) {
          if (existingQNames.has(q.name.toLowerCase())) continue;
          await saveQuickTask({ name: q.name, done: false, timeframeMinutes: q.timeframeMinutes || 15, deadline: q.deadline || '' });
          imported++;
        }
      }

      flash(true, `Imported ${imported} item${imported !== 1 ? 's' : ''}`);
    } catch (err) {
      flash(false, `Import failed: ${err.message}`);
    }
  };

  const triggerImport = () => fileRef.current?.click();

  /* ── Menu mode (inside user dropdown) ── */
  if (menuMode) {
    return (
      <>
        <button className="user-dropdown-item" role="menuitem" onClick={exportJSON}
          title="Export all data as JSON">
          <DownloadIcon /> Export JSON
        </button>
        <button className="user-dropdown-item" role="menuitem" onClick={exportICS}
          title="Export tasks as ICS calendar file">
          <DownloadIcon /> Export ICS
        </button>
        <button className="user-dropdown-item" role="menuitem" onClick={triggerImport}
          title="Import from a previously exported JSON file">
          <UploadIcon /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        {status && (
          <span className={`import-export-flash${status.ok ? '' : ' error'}`}>{status.text}</span>
        )}
      </>
    );
  }

  /* ── Toolbar mode (legacy / standalone) ── */
  return (
    <div className="import-export-bar">
      <button className="btn btn-sm" onClick={exportJSON} title="Export all data as JSON">
        <DownloadIcon /> JSON
      </button>
      <button className="btn btn-sm" onClick={exportICS} title="Export tasks as ICS calendar file">
        <DownloadIcon /> ICS
      </button>
      <button className="btn btn-sm" onClick={triggerImport} title="Import from a previously exported JSON file">
        <UploadIcon /> Import JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {status && (
        <span className={`import-export-flash${status.ok ? '' : ' error'}`}>{status.text}</span>
      )}
    </div>
  );
}
