/**
 * Shell — top-level layout: nav tabs + page routing.
 * Quick Tasks panel is always visible in the right sidebar on every page.
 */
import React, { useState } from 'react';
import { signOut } from '../lib/db.js';
import Overview    from './Overview.jsx';
import Categories  from './Categories.jsx';
import Planner     from './Planner.jsx';
import QuickTasks  from './QuickTasks.jsx';
import '../styles/shell.css';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'categories',  label: 'Tasks' },
  { id: 'planner',     label: 'Planner' },
];

export default function Shell({ appData, userId, userEmail }) {
  const [tab, setTab] = useState('overview');
  const { quickTasks = [], saveQuickTask, removeQuickTask } = appData;

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Nav ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 16px', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-background)', position: 'sticky', top: 0, zIndex: 100,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 14px', fontSize: 13, border: 'none', background: 'none',
              cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              borderBottom: tab === t.id ? '2px solid var(--color-text-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {userEmail && (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginRight: 8 }}>{userEmail}</span>
        )}
        <button
          onClick={handleSignOut}
          style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px' }}
        >Sign out</button>
      </nav>

      {/* ── Body: main content + Quick Tasks sidebar ── */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '1fr 260px',
        gap: 0,
        alignItems: 'start',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}>
        {/* Main page */}
        <div style={{ minWidth: 0, paddingRight: 24 }}>
          {tab === 'overview'   && <Overview   appData={appData} userId={userId} />}
          {tab === 'categories' && <Categories appData={appData} userId={userId} />}
          {tab === 'planner'    && <Planner    appData={appData} userId={userId} />}
        </div>

        {/* Quick Tasks — sticky sidebar on all pages */}
        <div style={{ position: 'sticky', top: 56 }}>
          <QuickTasks
            quickTasks={quickTasks}
            onSave={saveQuickTask}
            onDelete={removeQuickTask}
          />
        </div>
      </div>
    </div>
  );
}
