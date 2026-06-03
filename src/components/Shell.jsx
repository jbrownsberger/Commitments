/**
 * Shell — top-level layout: toolbar, tabs, page routing.
 * Matches the .toolbar / .tabs / .app CSS classes in shell.css.
 */
import React, { useState } from 'react';
import { signOut } from '../lib/db.js';
import Overview   from './Overview.jsx';
import Categories from './Categories.jsx';
import Planner    from './Planner.jsx';
import QuickTasks from './QuickTasks.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'overview',   label: 'Overview'  },
  { id: 'categories', label: 'Tasks'     },
  { id: 'planner',    label: 'Planner'   },
];

export default function Shell({ appData, userId, userEmail }) {
  const [tab, setTab] = useState('overview');
  const { quickTasks = [], saveQuickTask, removeQuickTask } = appData;

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
        <div className="header">
          <h1>Commitments</h1>
          <QuickTasks
            quickTasks={quickTasks}
            onSave={saveQuickTask}
            onDelete={removeQuickTask}
          />
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
          {tab === 'overview'   && <Overview   appData={appData} userId={userId} />}
          {tab === 'categories' && <Categories appData={appData} userId={userId} />}
          {tab === 'planner'    && <Planner    appData={appData} userId={userId} />}
        </div>
      </div>
    </div>
  );
}
