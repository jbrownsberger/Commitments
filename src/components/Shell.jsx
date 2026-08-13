/**
 * Shell — top-level layout.
 * Manages the global add/edit task modal, task-view panel, and search overlay.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signOut } from '../lib/db.js';
import {
  getPushStatus,
  subscribePush,
  unsubscribePush,
  sendTestPush,
  detectTimezone,
  isPushSupported,
} from '../lib/push.js';
import Overview     from './Overview.jsx';
import Categories   from './Categories.jsx';
import Planner      from './Planner.jsx';
import GCalSync     from './GCalSync.jsx';
import TaskModal    from './TaskModal.jsx';
import TaskPanel    from './TaskPanel.jsx';
import ImportExport from './ImportExport.jsx';
import Search       from './Search.jsx';
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

const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);

const IconBell = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const LEAD_DAY_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: '1 day' },
  { value: 2, label: '2 days' },
  { value: 3, label: '3 days' },
];

const DIGEST_HOUR_OPTIONS = [6, 7, 8, 9, 10, 11, 12].map(h => ({
  value: h,
  label: h === 12 ? '12 PM' : `${h} AM`,
}));

// ── User dropdown ──────────────────────────────────────────────────────────────────
function UserDropdown({
  userId, userEmail, darkMode, onToggleDarkMode,
  canUndo, canRedo, onUndo, onRedo, appData,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const [pushStatus, setPushStatus] = useState({
    supported: isPushSupported(),
    permission: 'default',
    subscribed: false,
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState(null); // { ok, text }

  const prefs = appData?.preferences || {};
  const savePreferences = appData?.savePreferences;

  const refreshPushStatus = useCallback(async () => {
    try {
      const s = await getPushStatus();
      setPushStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      refreshPushStatus();
      setPushMsg(null);
    }
  }, [open, refreshPushStatus]);

  // Keep the digest timezone in sync with this device once subscribed.
  useEffect(() => {
    if (!pushStatus.subscribed || !savePreferences || !userId) return;
    const tz = detectTimezone();
    if (!tz || prefs.timezone === tz) return;
    savePreferences({ ...prefs, user_id: userId, timezone: tz }).catch(() => {});
  }, [pushStatus.subscribed, prefs.timezone, savePreferences, userId, prefs]);

  const flash = (ok, text) => {
    setPushMsg({ ok, text });
    setTimeout(() => setPushMsg(null), 4000);
  };

  const handleEnablePush = async () => {
    if (!userId || pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    try {
      await subscribePush(userId);
      if (savePreferences) {
        await savePreferences({
          ...prefs,
          user_id: userId,
          notify_digest: prefs.notify_digest ?? true,
          notify_overdue: prefs.notify_overdue ?? true,
          notify_due_today: prefs.notify_due_today ?? true,
          notify_lead_days: prefs.notify_lead_days ?? 1,
          notify_digest_hour: prefs.notify_digest_hour ?? 9,
          timezone: detectTimezone(),
        });
      }
      await refreshPushStatus();
      flash(true, 'Notifications enabled');
    } catch (err) {
      flash(false, err.message || 'Could not enable notifications');
      await refreshPushStatus();
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    try {
      await unsubscribePush(userId);
      await refreshPushStatus();
      flash(true, 'Notifications disabled');
    } catch (err) {
      flash(false, err.message || 'Could not disable notifications');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    try {
      await sendTestPush();
      flash(true, 'Test notification sent');
    } catch (err) {
      flash(false, err.message || 'Test failed');
    } finally {
      setPushBusy(false);
    }
  };

  const updateNotifyPref = async (patch) => {
    if (!savePreferences || !userId) return;
    try {
      await savePreferences({
        ...prefs,
        user_id: userId,
        timezone: prefs.timezone || detectTimezone(),
        ...patch,
      });
    } catch (err) {
      flash(false, err.message || 'Could not save preference');
    }
  };

  const digestOn = prefs.notify_digest !== false;
  const leadDays = prefs.notify_lead_days ?? 1;
  const digestHour = prefs.notify_digest_hour ?? 9;

  let pushHint = null;
  if (!pushStatus.supported) {
    pushHint = 'Not supported in this browser';
  } else if (pushStatus.permission === 'denied') {
    pushHint = 'Permission denied — enable in System Settings';
  }

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
        <div className="user-dropdown-menu user-dropdown-menu--wide" role="menu">
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

          {/* ── Notifications ── */}
          <div className="user-dropdown-section-label">
            <IconBell /> Notifications
          </div>

          {pushHint && (
            <div className="user-dropdown-hint">{pushHint}</div>
          )}

          {!pushHint && !pushStatus.subscribed && (
            <button
              className="user-dropdown-item"
              role="menuitem"
              onClick={handleEnablePush}
              disabled={pushBusy || !pushStatus.supported}
            >
              <IconBell />
              {pushBusy ? 'Enabling…' : 'Enable notifications'}
            </button>
          )}

          {!pushHint && pushStatus.subscribed && (
            <>
              <button
                className="user-dropdown-item"
                role="menuitem"
                onClick={handleTestPush}
                disabled={pushBusy}
              >
                Send test notification
              </button>
              <button
                className="user-dropdown-item"
                role="menuitem"
                onClick={handleDisablePush}
                disabled={pushBusy}
              >
                Disable notifications
              </button>

              <label className="user-dropdown-pref">
                <span>Daily digest</span>
                <input
                  type="checkbox"
                  checked={digestOn}
                  onChange={(e) => updateNotifyPref({ notify_digest: e.target.checked })}
                />
              </label>

              <label className="user-dropdown-pref">
                <span>Lead time</span>
                <select
                  value={leadDays}
                  onChange={(e) => updateNotifyPref({ notify_lead_days: Number(e.target.value) })}
                  disabled={!digestOn}
                >
                  {LEAD_DAY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="user-dropdown-pref">
                <span>Digest hour</span>
                <select
                  value={digestHour}
                  onChange={(e) => updateNotifyPref({
                    notify_digest_hour: Number(e.target.value),
                    timezone: detectTimezone(),
                  })}
                  disabled={!digestOn}
                >
                  {DIGEST_HOUR_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {pushMsg && (
            <span className={`import-export-flash${pushMsg.ok ? '' : ' error'}`}>
              {pushMsg.text}
            </span>
          )}

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
  const [tab,        setTab]        = useState('overview');
  const [editModal,  setEditModal]  = useState(null);   // { task, catId }
  const [panelTask,  setPanelTask]  = useState(null);   // task shown in TaskPanel
  const [searchOpen, setSearchOpen] = useState(false);
  const tabsRef    = useRef(null);
  const wrapperRef = useRef(null);

  const { categories, tasks, saveTask, removeTask, saveCategory, undo, redo, canUndo, canRedo } = appData;

  // ── ⌘K / Ctrl+K shortcut ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // ── Task open / edit helpers ────────────────────────────────────────────────
  const openAdd = (catId) => {
    if (categories.length === 0) return;
    setEditModal({ task: null, catId: catId ?? categories[0]?.id ?? null });
  };

  const openEdit = (task) => {
    setEditModal({ task, catId: task.category_id });
  };

  // Opens the read/interact pane (TaskPanel) — used by search results.
  const openPanel = (task) => {
    const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));
    const cat    = catMap[task.category_id];
    setPanelTask({ ...task, _cat: cat });
  };

  const handleSave = async (payload) => {
    await saveTask(payload);
    setEditModal(null);
  };

  // TaskPanel save: update in-place and keep the panel open with fresh data.
  const handlePanelSave = async (updated) => {
    const saved = await saveTask(updated);
    const next  = saved || updated;
    setPanelTask(prev => prev ? { ...next, _cat: prev._cat } : null);
    return saved;
  };

  return (
    <div id="root">
      <div className="app">
        {/* ── Header ── */}
        <div className="header">
          <h1>Commitments</h1>
          <div className="header-actions">
            <button
              className="btn btn-icon"
              onClick={() => setSearchOpen(true)}
              title="Search tasks (⌘K)"
              aria-label="Search tasks"
            >
              <IconSearch />
              <span style={{ fontSize: 12 }}>Search</span>
            </button>

            <button
              className="btn btn-primary"
              onClick={() => openAdd()}
              disabled={categories.length === 0}
              title={categories.length === 0 ? 'Add a category first' : 'Add a new task'}
            >+ New task</button>

            <UserDropdown
              userId={userId}
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

      {/* ── Global task-view panel (opened from search results) ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={panelTask._cat ?? {}}
          onClose={() => setPanelTask(null)}
          onSave={handlePanelSave}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => { setPanelTask(null); openEdit(task); }}
        />
      )}

      {/* ── Global search overlay ── */}
      {searchOpen && (
        <Search
          tasks={tasks}
          categories={categories}
          onSelectTask={(task) => { openPanel(task); }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
