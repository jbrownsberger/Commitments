/**
 * QuickTasks — standing weekly commitments panel.
 * Lives in the header. Tasks persist to DB via onSave/onDelete props.
 * NOTE: Do NOT pass a client-generated id for new tasks — let the DB generate it.
 */
import React, { useState, useRef } from 'react';

export default function QuickTasks({ quickTasks = [], onSave, onDelete }) {
  const [inputVal, setInputVal] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editMins, setEditMins] = useState(15);
  const inputRef = useRef();

  const totalMins = quickTasks
    .filter(t => !t.done)
    .reduce((s, t) => s + (t.timeframeMinutes || 15), 0);

  const addTask = () => {
    const name = inputVal.trim();
    if (!name) return;
    // No id — DB will generate one
    onSave({ name, done: false, deadline: '', timeframeMinutes: 15 });
    setInputVal('');
    inputRef.current?.focus();
  };

  const toggle = (t) => onSave({ ...t, done: !t.done });

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditMins(t.timeframeMinutes || 15);
  };
  const saveEdit = (t) => {
    onSave({ ...t, name: editName.trim() || t.name, timeframeMinutes: parseInt(editMins) || 15 });
    setEditingId(null);
  };

  const active = quickTasks.filter(t => !t.done);
  const done   = quickTasks.filter(t =>  t.done);

  return (
    <div className="quick-panel">
      <div className="quick-panel-title">
        <span>Standing commitments</span>
        <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>
          {(totalMins / 60).toFixed(1)}h/wk
        </span>
      </div>

      <div className="quick-add-row">
        <input
          ref={inputRef}
          className="quick-add-input"
          placeholder="Add commitment, press Enter"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
        />
      </div>

      {quickTasks.length === 0 && (
        <div style={{ fontSize:12, color:'var(--color-text-tertiary)', padding:'6px 0' }}>
          e.g. email, meetings, admin…
        </div>
      )}

      {[...active, ...done].map(t => (
        <div key={t.id} className="quick-task-item">
          {editingId === t.id ? (
            <>
              <input
                className="quick-add-input"
                style={{ flex:1, marginRight:4 }}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(t); if (e.key === 'Escape') setEditingId(null); }}
                autoFocus
              />
              <input
                type="number" min={1} max={600}
                style={{ width:44, fontSize:11, padding:'2px 4px', border:'0.5px solid var(--color-border-secondary)', borderRadius:3, marginRight:4 }}
                value={editMins}
                onChange={e => setEditMins(e.target.value)}
                title="Minutes/week"
              />
              <span style={{ fontSize:10, color:'var(--color-text-tertiary)', marginRight:4 }}>m/wk</span>
              <span className="quick-task-del" onClick={() => saveEdit(t)} title="Save">✓</span>
              <span className="quick-task-del" onClick={() => setEditingId(null)} title="Cancel">×</span>
            </>
          ) : (
            <>
              <span
                className={`quick-task-check${t.done ? ' done' : ''}`}
                onClick={() => toggle(t)}
              >{t.done ? '✓' : ''}</span>
              <span
                className={`quick-task-name${t.done ? ' done' : ''}`}
                onClick={() => startEdit(t)}
                title="Click to edit"
              >{t.name}</span>
              {(t.timeframeMinutes && t.timeframeMinutes !== 15) && (
                <span style={{ fontSize:10, color:'var(--color-text-tertiary)' }}>{t.timeframeMinutes}m</span>
              )}
              {t.deadline && (
                <span style={{ fontSize:10, color:'var(--color-text-tertiary)' }}>{t.deadline}</span>
              )}
              <span
                className="quick-task-del"
                onClick={() => onDelete(t.id)}
                title="Remove"
              >×</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
