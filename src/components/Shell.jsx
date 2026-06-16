/**
 * Shell — top-level layout. Manages the global add/edit task modal.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signOut } from '../lib/db.js';
import Overview     from './Overview.jsx';
import Categories   from './Categories.jsx';
import Planner      from './Planner.jsx';
import GCalSync     from './GCalSync.jsx';
import TaskModal    from './TaskModal.jsx';
import ImportExport from './ImportExport.jsx';
import '../styles/shell.css';

// ── Tab definitions with inline SVG icons ────────────────────────────────────
const TabIconOverview = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1" y="1" width="6" height="6" rx="1.5"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <rect x="9" y="1" width="6" height="6" rx="1.5"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <rect x="1" y="9" width="6" height="6" rx="1.5"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <rect x="9" y="9" width="6" height="6" rx="1.5"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
  </svg>
);

const TabIconCategories = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="3" cy="4.5" r="1.2" fill="currentColor"/>
    <path d="M6.5 4.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="3" cy="8" r="1.2" fill="currentColor"/>
    <path d="M6.5 8h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="3" cy="11.5" r="1.2" fill="currentColor"/>
    <path d="M6.5 11.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const TabIconPlanner = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M4.5 9h3M4.5 11.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const TabIconGCal = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 4.5V8l2.5 1.5" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TABS = [
  { id: 'overview',   label: 'Overview',        Icon: TabIconOverview    },
  { id: 'categories', label: 'Categories',       Icon: TabIconCategories  },
  { id: 'planner',    label: 'Planner',          Icon: TabIconPlanner     },
  { id: 'gcal',       label: 'Google Calendar',  Icon: TabIconGCal        },
];

// ── Toolbar icon set ──────────────────────────────────────────────────────
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

const IconUser = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconChevronDown = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconDownload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconUpload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

// ── User dropdown ──────────────────────────────────────────────────────────────────
function UserDropdown({ userEmail, darkMode, onToggleDarkMode, canUndo, canRedo, onUndo, onRedo, appData }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="user-dropdown" ref={ref}>
      <button
        className="user-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={userEmail}
      >
        <span className="user-dropdown-avatar"><IconUser /></span>
        <IconChevronDown />
      </button>

      {open && (
        <div className="user-dropdown-menu" role="menu">
          <div className="user-dropdown-email">{userEmail}</div>
          <div className="user-dropdown-divider" />

          <button
            className="user-dropdown-item"
            role="menuitem"
            onClick={() => { onToggleDarkMode(); }}
          >
            {darkMode ? <IconSun /> : <IconMoon />}
            {darkMode ? 'Light mode' : 'Dark mode'}
          </button>

          <button
            className="user-dropdown-item"
            role="menuitem"
            onClick={() => { onUndo(); }}
            disabled={!canUndo}
          >
            <IconUndo /> Undo
          </button>

          <button
            className="user-dropdown-item"
            role="menuitem"
            onClick={() => { onRedo(); }}
            disabled={!canRedo}
          >
            <IconRedo /> Redo
          </button>

          <div className="user-dropdown-divider" />

          {/* Import / Export — rendered inline inside the menu */}
          <ImportExport
            appData={{ ...appData, saveCategory: appData.saveCategory }}
            menuMode
            onAction={() => setOpen(false)}
          />

          <div className="user-dropdown-divider" />

          <button
            className="user-dropdown-item user-dropdown-item--danger"
            role="menuitem"
            onClick={() => signOut()}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────────
export default function Shell({ appData, userId, userEmail, darkMode, onToggleDarkMode }) {
  const [tab,       setTab]       = useState('overview');
  const [editModal, setEditModal] = useState(null);
  const tabsRef    = useRef(null);
  const wrapperRef = useRef(null);

  const { categories, saveTask, saveCategory, undo, redo, canUndo, canRedo } = appData;

  // ── Scroll-fade logic ────────────────────────────────────────────────────
  const updateFade = useCallback(() => {
    const el = tabsRef.current;
    const wrapper = wrapperRef.current;
    if (!el || !wrapper) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    wrapper.classList.toggle('scrolled-end', atEnd);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    updateFade();
    el.addEventListener('scroll', updateFade, { passive: true });
    window.addEventListener('resize', updateFade, { passive: true });
    return () => {
      el.removeEventListener('scroll', updateFade);
      window.removeEventListener('resize', updateFade);
    };
  }, [updateFade]);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const activeBtn = el.querySelector('.tab.active');
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    updateFade();
  }, [tab, updateFade]);

  const openAdd = (catId) => {
    if (categories.length === 0) return;
    setEditModal({ task: null, catId: catId ?? categories[0]?.id ?? null });
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
      <div className="app">
        {/* ── Single compact header row ── */}
        <div className="header">
          <h1>Commitments</h1>
          <div className="header-actions">
            <button
              className="btn btn-primary"
              onClick={() => openAdd()}
              disabled={categories.length === 0}
              title={categories.length === 0 ? 'Add a category first' : 'Add a new task'}
            >+ New task</button>
            <UserDropdown
              userEmail={userEmail}
              darkMode={darkMode}
              onToggleDarkMode={onToggleDarkMode}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              appData={{ ...appData, saveCategory }}
            />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs-wrapper" ref={wrapperRef}>
          <div className="tabs" role="tablist" ref={tabsRef}>
            {TABS.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <t.Icon />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ── */}
        <div className="tab-content">
          {tab === 'overview'   && <Overview   appData={appData} userId={userId} onAddTask={openAdd} onEditTask={openEdit} />}
          {tab === 'categories' && <Categories appData={appData} userId={userId} onAddTask={openAdd} onEditTask={openEdit} />}
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
