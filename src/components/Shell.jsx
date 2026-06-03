/**
 * Shell — top-level layout: toolbar, header with global Add Task, tabs, page routing.
 * QuickTasks lives as a side panel inside Overview, not in the header.
 */
import React, { useState } from 'react';
import { signOut } from '../lib/db.js';
import Overview   from './Overview.jsx';
import Categories from './Categories.jsx';
import Planner    from './Planner.jsx';
import TaskModal  from './TaskModal.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'categories', label: 'Tasks'    },
  { id: 'planner',    label: 'Planner'  },
];

export default function Shell({ appData, userId, userEmail }) {
  const [tab,       setTab]       = useState('overview');
  const [addModal,  setAddModal]  = useState(false);   // global add-task modal

  const { categories, saveTask } = appData;

  const handleGlobalSave = async (payload) => {
    // payload already has category_id from TaskModal
    await saveTask(payload);
  };

  return (
    <div id="root">
      {/* ── Toolbar ── */}
      <div className="toolbar">
        {userEmail && (
          <span className="toolbar-label">{userEmail}</span>
        )}
        <button className="btn btn-sm" onClick={() => signOut()}>Sign out</button>
      </div>

      <div className="app">
        {/* ── Header ── */}
        <div className="header">
          <h1>Commitments</h1>
          <button
            className="btn btn-primary"
            onClick={() => setAddModal(true)}
            disabled={categories.length === 0}
            title={categories.length === 0 ? 'Add a category first' : 'Add a new task'}
          >
            Add task
          </button>
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
          {tab === 'overview'   && <Overview   appData={appData} userId={userId} onAddTask={() => setAddModal(true)} />}
          {tab === 'categories' && <Categories appData={appData} userId={userId} />}
          {tab === 'planner'    && <Planner    appData={appData} userId={userId} />}
        </div>
      </div>

      {/* ── Global add-task modal ── */}
      {addModal && categories.length > 0 && (
        <TaskModal
          task={null}
          categories={categories}
          onSave={handleGlobalSave}
          onClose={() => setAddModal(false)}
        />
      )}
    </div>
  );
}
