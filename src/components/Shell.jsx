import React, { useState, useEffect } from 'react';
import { signOut, downloadICS } from '../lib/db.js';
import Categories from './Categories.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'categories', label: 'Categories' },
  { id: 'overview',   label: 'Overview & Queue' },
  { id: 'planner',    label: 'Planner' },
  { id: 'calendar',   label: 'Calendar' },
];

export default function Shell({ userId, userEmail, appData }) {
  const [activeTab, setActiveTab] = useState('categories');
  const { categories, tasks, preferences, undo, redo, canUndo, canRedo } = appData;

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const handleExportICS  = () => downloadICS(tasks, categories);
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify({ categories, tasks, preferences }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'commitments-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div id="root">
      <div className="toolbar">
        <span className="toolbar-label">Export:</span>
        <button className="btn btn-sm" onClick={handleExportJSON}>JSON</button>
        <button className="btn btn-sm" onClick={handleExportICS}>📅 .ics</button>
        <button className="btn btn-sm" onClick={undo}  disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
        <button className="btn btn-sm" onClick={redo}  disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
        <span className="toolbar-label" style={{ marginLeft: 8 }}>{userEmail}</span>
        <button className="btn btn-sm btn-danger" onClick={signOut}>Sign out</button>
      </div>

      <div className="app">
        <div className="header">
          <h1>Commitments</h1>
        </div>

        <div className="tabs">
          {TABS.map(t => (
            <div key={t.id} className={`tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              {t.label}
            </div>
          ))}
        </div>

        <div className="tab-content">
          {activeTab === 'categories' && <Categories appData={appData} userId={userId} />}
          {activeTab === 'overview'   && <div className="placeholder">Overview & Queue — coming soon</div>}
          {activeTab === 'planner'    && <div className="placeholder">Planner — coming soon</div>}
          {activeTab === 'calendar'   && <div className="placeholder">Calendar — coming soon</div>}
        </div>
      </div>
    </div>
  );
}
