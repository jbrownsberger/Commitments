/**
 * QuickTasks — standing commitments sidebar panel.
 * Mirrors the original app's renderQuickPanel() functionality.
 */
import React, { useState, useRef } from 'react';

export default function QuickTasks({ quickTasks = [], onSave, onDelete }) {
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef();

  const totalMins = quickTasks
    .filter(t => !t.done)
    .reduce((s, t) => s + (t.timeframeMinutes || 15), 0);

  const addTask = () => {
    const name = inputVal.trim();
    if (!name) return;
    onSave({ id: crypto.randomUUID(), name, done: false, deadline: '', timeframeMinutes: 15 });
    setInputVal('');
    inputRef.current?.focus();
  };

  const toggle = (t) => onSave({ ...t, done: !t.done });

  const editTask = (t) => {
    const name = window.prompt('Task name:', t.name);
    if (name === null) return;
    const mins = window.prompt('Time commitment (minutes/week):', t.timeframeMinutes || 15);
    onSave({ ...t, name: name.trim() || t.name, timeframeMinutes: parseInt(mins) || 15 });
  };

  const active = quickTasks.filter(t => !t.done);
  const done   = quickTasks.filter(t =>  t.done);

  return (
    <div className="quick-panel">
      <div className="quick-panel-title">
        <span>Quick tasks</span>
        <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>
          {(totalMins / 60).toFixed(1)}h/wk
        </span>
      </div>

      <div className="quick-add-row">
        <input
          ref={inputRef}
          className="quick-add-input"
          placeholder="Task name, press Enter"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
        />
      </div>

      {quickTasks.length === 0 && (
        <div style={{ fontSize:12, color:'var(--color-text-tertiary)', textAlign:'center', padding:'8px 0' }}>
          No quick tasks yet
        </div>
      )}

      {[...active, ...done].map(t => (
        <div key={t.id} className="quick-task-item">
          <span
            className={`quick-task-check${t.done ? ' done' : ''}`}
            onClick={() => toggle(t)}
          >{t.done ? '✓' : ''}</span>
          <span
            className={`quick-task-name${t.done ? ' done' : ''}`}
            onClick={() => editTask(t)}
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
        </div>
      ))}
    </div>
  );
}
