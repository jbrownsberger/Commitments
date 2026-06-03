import React, { useState, useEffect, useRef } from 'react';
import { signOut, downloadICS } from '../lib/db.js';
import Categories from './Categories.jsx';
import Overview from './Overview.jsx';
import Planner from './Planner.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'overview',   label: 'Overview & Queue' },
  { id: 'categories', label: 'Categories' },
  { id: 'planner',    label: 'Planner' },
];

export default function Shell({ userId, userEmail, appData }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { categories, tasks, preferences, undo, redo, canUndo, canRedo,
          saveCategory, saveTask } = appData;
  const importRef = useRef();

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
    const blob = new Blob(
      [JSON.stringify({ categories, tasks, preferences }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'commitments-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        // Import categories first, then tasks
        const cats  = json.categories || [];
        const tsks  = json.tasks      || [];
        for (const cat of cats)  await saveCategory(cat);
        for (const t   of tsks)  await saveTask(t);
        alert(`Imported ${cats.length} categories and ${tsks.length} tasks.`);
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
      // Reset input so same file can be re-imported if needed
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div id="root">
      <div className="toolbar">
        <span className="toolbar-label">Export:</span>
        <button className="btn btn-sm" onClick={handleExportJSON}>JSON</button>
        <button className="btn btn-sm" onClick={handleExportICS}>📅 .ics</button>
        <span className="toolbar-label" style={{ marginLeft: 4 }}>Import:</span>
        <button className="btn btn-sm" onClick={() => importRef.current.click()}>JSON</button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportJSON}
        />
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
          {activeTab === 'overview'   && <Overview   appData={appData} userId={userId} />}
          {activeTab === 'categories' && <Categories appData={appData} userId={userId} />}
          {activeTab === 'planner'    && <Planner    appData={appData} userId={userId} />}
        </div>
      </div>
    </div>
  );
}
