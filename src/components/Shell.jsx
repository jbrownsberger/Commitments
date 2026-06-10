/**
 * Shell — top-level layout. Manages the global add/edit task modal.
 */
import React, { useState } from 'react';
import { signOut } from '../lib/db.js';
import Overview     from './Overview.jsx';
import Categories   from './Categories.jsx';
import Planner      from './Planner.jsx';
import GCalSync     from './GCalSync.jsx';
import TaskModal    from './TaskModal.jsx';
import ImportExport from './ImportExport.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'overview',   label: 'Overview & Queue' },
  { id: 'categories', label: 'Categories'       },
  { id: 'planner',    label: 'Planner'           },
  { id: 'gcal',       label: 'Google Calendar'   },
];

// ── Inline SVG icons ────────────────────────────────────────────────────────
const IconUndo = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6" />
    <path d="M3 13C5.5 6.5 14 4 20 8s4 12-3 15" />
  </svg>
);

const IconRedo = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 7v6h-6" />
    <path d="M21 13C18.5 6.5 10 4 4 8S0 20 7 23" />
  </svg>
);

const IconSun = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2"  x2="12" y2="5"  />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2"  y1="12" x2="5"  y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
    <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"  />
    <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
    <line x1="4.22"  y1="19.78" x2="6.34"  y2="17.66" />
    <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"  />
  </svg>
);

const IconMoon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function Shell({ appData, userId, userEmail, darkMode, onToggleDarkMode }) {
  const [tab,       setTab]       = useState('overview');
  const [editModal, setEditModal] = useState(null);

  const { categories, saveTask, saveCategory, undo, redo, canUndo, canRedo } = appData;

  const openAdd = () => {
    if (categories.length === 0) return;
    setEditModal({ task: null, catId: categories[0]?.id ?? null });
  };

  const openEdit = (task) => {
    setEditModal({ task, catId: task.category_id });
  };

  const handleSave = async (payload) => {
    await saveTask(payload);
    setEditModal(null);
  };

  return (
    <div id="root">
      {/* ── Toolbar ── */}
      <div className="toolbar">
        {userEmail && <span className="toolbar-label">{userEmail}</span>}
        <ImportExport appData={{ ...appData, saveCategory }} />
        <button
          className="btn btn-sm btn-icon"
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
        ><IconUndo /> Undo</button>
        <button
          className="btn btn-sm btn-icon"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
        ><IconRedo /> Redo</button>
        <button
          className="btn-theme-toggle"
          onClick={onToggleDarkMode}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <IconSun /> : <IconMoon />}
        </button>
        <button className="btn btn-sm" onClick={() => signOut()}>Sign out</button>
      </div>

      <div className="app">
        {/* ── Header ── */}
        <div className="header">
          <h1>Commitments</h1>
          <button
            className="btn btn-primary"
            onClick={openAdd}
            disabled={categories.length === 0}
            title={categories.length === 0 ? 'Add a category first' : 'Add a new task'}
          >+ Add task</button>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {TABS.map(t => (
            <div
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</div>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="tab-content">
          {tab === 'overview'   && <Overview   appData={appData} userId={userId} onAddTask={openAdd} onEditTask={openEdit} />}
          {tab === 'categories' && <Categories appData={appData} userId={userId} onEditTask={openEdit} />}
          {tab === 'planner'    && <Planner    appData={appData} userId={userId} onEditTask={openEdit} />}
          {tab === 'gcal'       && <GCalSync   appData={appData} userId={userId} />}
        </div>
      </div>

      {/* ── Global add / edit task modal ── */}
      {editModal && categories.length > 0 && (
        <TaskModal
          task={editModal.task}
          catId={editModal.catId}
          categories={categories}
          onSave={handleSave}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}
