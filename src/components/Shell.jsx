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
  { id: 'gcal',       label: '📅 Google Calendar' },
];

export default function Shell({ appData, userId, userEmail }) {
  const [tab,       setTab]       = useState('overview');
  const [editModal, setEditModal] = useState(null);

  const { categories, saveTask, saveCategory } = appData;

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
          {tab === 'planner'    && <Planner    appData={appData} userId={userId} />}
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
