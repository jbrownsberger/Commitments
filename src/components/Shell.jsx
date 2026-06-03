/**
 * Top-level shell: toolbar, tabs, and tab routing.
 * This is the direct equivalent of the old <div class="app"> in index.html.
 * Individual tab contents will be ported into their own components.
 */
import React, { useState } from 'react';
import { signOut, downloadICS } from '../lib/db.js';
import '../styles/shell.css';

const TABS = [
  { id: 'overview', label: 'Overview & Queue' },
  { id: 'categories', label: 'Categories' },
  { id: 'planner', label: 'Planner' },
  { id: 'calendar', label: 'Calendar' },
];

export default function Shell({ userId, userEmail, appData }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { categories, tasks, preferences, undo, redo, canUndo, canRedo } = appData;

  const handleExportICS = () => downloadICS(tasks, categories);

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
      {/* Toolbar */}
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
        {/* Header */}
        <div className="header">
          <h1>Commitments</h1>
          <button
            className="btn btn-primary"
            onClick={() => {/* open add-task modal — to be wired up */}}
          >
            + Add task
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {TABS.map(t => (
            <div
              key={t.id}
              className={`tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Tab content — components to be ported in here */}
        <div className="tab-content">
          {activeTab === 'overview'   && <div className="placeholder">Overview &amp; Queue — coming soon</div>}
          {activeTab === 'categories' && <div className="placeholder">Categories — coming soon</div>}
          {activeTab === 'planner'    && <div className="placeholder">Planner — coming soon</div>}
          {activeTab === 'calendar'   && <div className="placeholder">Calendar — coming soon</div>}
        </div>
      </div>
    </div>
  );
}
