/**
 * GCalSync — Google Calendar integration tab
 *
 * Auth, API helpers, and block CRUD now live in src/lib/gcalScheduler.js.
 * This component owns UI state only.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  connectGcal,
  hasValidCachedToken,
  isGcalConnected,
  revokeToken,
  fetchCalendarList,
  fetchFreeBusy,
  fetchTaskTriageBlockIntervals,
  subtractTaskTriageBlocks,
  upsertWorkBlock,
  deleteTaskWorkBlock,
  deleteWorkBlock,
  getPushEntry,
  getPushRegistry,
  loadGcalSettings,
  saveGcalSettings,
  loadSelectedCals,
  saveSelectedCals,
  DEFAULT_SETTINGS,
  loadWriteCalId,
  saveWriteCalId,
  intervalLocalDates,
  localDayBounds,
  toLocalISODate,
} from '../lib/gcalScheduler.js';
import { GCAL_PREFS_CHANGED_EVENT, waitForGcalPrefs } from '../lib/gcalPrefs.js';
import '../styles/gcal.css';

const CLIENT_ID       = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const STALE_LABEL_MS  = 60 * 60 * 1000;
const LOOK_AHEAD_DAYS = 28;
const DAY_NAMES       = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ───────────────────────────────────────────────────────────────────────────
function toISO(d) { return toLocalISODate(d); }
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
function remainingHours(task) {
  const substeps = task.substeps || [];
  const prog = substeps.length
    ? (() => {
        const tw = substeps.reduce((s, x) => s + (x.weight ?? 1), 0);
        if (!tw) return 0;
        const dw = substeps.filter(x => x.done).reduce((s, x) => s + (x.weight ?? 1), 0);
        return Math.round((dw / tw) * 100);
      })()
    : (task.manual_progress ?? task.manualProgress ?? 0);
  return Math.max(0, (parseFloat(task.estimated_hours) || 1) * (1 - prog / 100));
}

// Keep the Google Calendar tab's block length identical to the Planner's
// per-day allocation, including any manual per-day hour overrides.
function hoursOnDay(task, iso, todayISO) {
  const rem = remainingHours(task);
  const futureDays = (task.scheduled_days || []).filter(day => day >= todayISO);
  if (!futureDays.length) return 0;
  const dayHours = task.scheduled_day_hours || {};
  const explicitTotal = futureDays.reduce((sum, day) => sum + (dayHours[day] || 0), 0);
  const unweighted = futureDays.filter(day => dayHours[day] === undefined);
  const perUnweighted = unweighted.length
    ? Math.max(rem - explicitTotal, 0) / unweighted.length
    : 0;
  return dayHours[iso] !== undefined ? dayHours[iso] : perUnweighted;
}

function effectiveFreeMinutes(isoDate, busyIntervals, settings) {
  const { workWindows, deductMins, bufferMins, efficiency, nonWorkDays } = settings;
  const dowIndex = new Date(isoDate + 'T00:00:00').getDay();
  if ((nonWorkDays || []).includes(dowIndex)) return 0;

  const windows = (workWindows || [{ start: 8, end: 20 }])
    .filter(w => w.end > w.start)
    .map(w => ({
      s: new Date(`${isoDate}T${String(w.start).padStart(2,'0')}:00:00`).getTime(),
      e: new Date(`${isoDate}T${String(w.end  ).padStart(2,'0')}:00:00`).getTime(),
    }));

  if (!windows.length) return 0;

  const bufMs = bufferMins * 60_000;
  let totalFreeMs = 0;

  for (const win of windows) {
    const winMs = win.e - win.s;
    const expanded = busyIntervals
      .map(({ start, end }) => ({
        s: Math.max(new Date(start).getTime() - bufMs, win.s),
        e: Math.min(new Date(end  ).getTime() + bufMs, win.e),
      }))
      .filter(({ s, e }) => e > s)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const iv of expanded) {
      if (merged.length && iv.s <= merged[merged.length - 1].e)
        merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
      else merged.push({ ...iv });
    }
    const busyMs = merged.reduce((sum, { s, e }) => sum + (e - s), 0);
    totalFreeMs += Math.max(0, winMs - busyMs);
  }

  const afterDeduct = Math.max(0, totalFreeMs / 60_000 - deductMins);
  return afterDeduct * (efficiency / 100);
}

function totalWindowHours(settings) {
  const windows = settings.workWindows || [{ start: 8, end: 20 }];
  return windows.filter(w => w.end > w.start).reduce((s, w) => s + (w.end - w.start), 0);
}

function hrLabel(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function windowSummary(workWindows) {
  return (workWindows || [{ start: 8, end: 20 }])
    .filter(w => w.end > w.start)
    .map(w => `${hrLabel(w.start)}–${hrLabel(w.end)}`)
    .join(', ');
}

// ── Seed blockStatus from the push registry ───────────────────────────────────────────
// Returns { 'taskId-iso': 'done', … } for every registry entry whose date is
// covered by the given scheduled task list.
function seedBlockStatusFromRegistry(scheduledTasks) {
  const reg = getPushRegistry();
  const status = {};
  for (const [key] of Object.entries(reg)) {
    // registry keys are  "taskId|isoDate"
    const [taskId, iso] = key.split('|');
    if (!taskId || !iso) continue;
    const task = scheduledTasks.find(t => String(t.id) === String(taskId));
    if (!task) continue;
    status[`${taskId}-${iso}`] = 'done';
  }
  return status;
}

// ── SVG icons ─────────────────────────────────────────────────────────────────────────
function IconCalendar({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
      <path d="M1 6h14" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <rect x="4" y="8" width="2" height="2" rx="0.5" fill="currentColor"/>
      <rect x="7" y="8" width="2" height="2" rx="0.5" fill="currentColor"/>
      <rect x="10" y="8" width="2" height="2" rx="0.5" fill="currentColor"/>
      <rect x="4" y="11" width="2" height="2" rx="0.5" fill="currentColor"/>
      <rect x="7" y="11" width="2" height="2" rx="0.5" fill="currentColor"/>
    </svg>
  );
}
function IconBarChart({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <rect x="1" y="9" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.7"/>
      <rect x="6" y="5" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.85"/>
      <rect x="11" y="2" width="3" height="12" rx="0.5" fill="currentColor"/>
      <path d="M0 14.5h16" stroke="currentColor" strokeWidth="1" opacity="0.4"/>
    </svg>
  );
}
function IconLink({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.77-1.77a3.5 3.5 0 0 0-4.95-4.95L7.1 3.95"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L2.78 8.27a3.5 3.5 0 0 0 4.95 4.95l1.17-1.17"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function IconGear({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.27 1.27M11.33 11.33l1.27 1.27M12.6 3.4l-1.27 1.27M4.67 11.33l-1.27 1.27"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
function IconCheck({ size = 14, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconWarning({ size = 14, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M7 1.5L13 12.5H1L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="10" r="0.6" fill="currentColor"/>
    </svg>
  );
}
function IconRefresh({ size = 14, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M12 7A5 5 0 1 1 7 2a5 5 0 0 1 3.54 1.46L12 2v4H8"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconTrash({ size = 13, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M2 3.5h9M5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M10.5 3.5l-.6 7a.5.5 0 0 1-.5.5H3.6a.5.5 0 0 1-.5-.5l-.6-7"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconPlus({ size = 12, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

// ── WorkWindowsEditor ─────────────────────────────────────────────────────────────────
function WorkWindowsEditor({ windows, onChange }) {
  const hourOptions = Array.from({ length: 25 }, (_, i) => i);

  const updateWindow = (idx, key, val) => {
    const next = windows.map((w, i) => i === idx ? { ...w, [key]: val } : w);
    onChange(next);
  };

  const addWindow = () => {
    const last  = windows[windows.length - 1];
    const start = last ? Math.min(last.end + 1, 23) : 13;
    const end   = Math.min(start + 4, 24);
    onChange([...windows, { start, end }]);
  };

  const removeWindow = (idx) => {
    if (windows.length <= 1) return;
    onChange(windows.filter((_, i) => i !== idx));
  };

  return (
    <div className="gcal-work-windows">
      {windows.map((w, idx) => (
        <div key={idx} className="gcal-work-window-row">
          <label className="gcal-ww-label">
            From
            <select value={w.start} onChange={e => updateWindow(idx, 'start', +e.target.value)}>
              {hourOptions.slice(0, 24).map(h => (
                <option key={h} value={h}>{hrLabel(h)}</option>
              ))}
            </select>
          </label>
          <label className="gcal-ww-label">
            To
            <select value={w.end} onChange={e => updateWindow(idx, 'end', +e.target.value)}>
              {hourOptions.slice(1).map(h => (
                <option key={h} value={h}>{hrLabel(h)}</option>
              ))}
            </select>
          </label>
          {w.end <= w.start && (
            <span className="gcal-ww-warn">End must be after start</span>
          )}
          {windows.length > 1 && (
            <button className="gcal-ww-remove" onClick={() => removeWindow(idx)} title="Remove this window">&times;</button>
          )}
        </div>
      ))}
      <button className="gcal-ww-add btn btn-sm" onClick={addWindow}>
        <IconPlus size={11} style={{ marginRight: 5, verticalAlign: 'middle' }} />
        Add window
      </button>
      <div className="gcal-setting-preview">
        Total: {windows.filter(w => w.end > w.start).reduce((s, w) => s + (w.end - w.start), 0)}h/day
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────────────
export default function GCalSync({ appData }) {
  const { tasks, onFreeBusyUpdate, onFreeBusyClear, onConnectionChange, gcalFreeBusySnapshot } = appData;
  const todayISO = toISO(new Date());

  // ── Connection state ──────────────────────────────────────────────────────────────
  const [connStatus, setConnStatus] = useState('checking');
  const connected  = connStatus === 'connected';
  const checking   = connStatus === 'checking';

  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    isGcalConnected()
      .then(ok => setConnStatus(ok ? 'connected' : 'disconnected'))
      .catch(() => setConnStatus('disconnected'));
  }, []);

  useEffect(() => {
    if (checking) return;
    onConnectionChange?.(connected);
  }, [connStatus, onConnectionChange]);

  // ── Settings ──────────────────────────────────────────────────────────────────────
  const [settings,     setSettings]     = useState(loadGcalSettings);
  const [showSettings, setShowSettings] = useState(false);

  const updateSetting = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      saveGcalSettings(next);
      return next;
    });
  };

  // ── Calendar list & selections ────────────────────────────────────────────────────
  const [calendars,  setCalendars]  = useState([]);
  const [selCals,    setSelCals]    = useState(loadSelectedCals);
  const [writeCalId, setWriteCalId] = useState(loadWriteCalId);
  const [prefsReady, setPrefsReady] = useState(false);
  const [calendarListStatus, setCalendarListStatus] = useState('idle');

  // ── Free/busy data ────────────────────────────────────────────────────────────────
  const [freeBusy,          setFreeBusy]          = useState(() => gcalFreeBusySnapshot?.data || null);
  const [loadingFB,         setLoadingFB]         = useState(false);
  const [subtractingBlocks, setSubtractingBlocks] = useState(false);

  // ── Work blocks panel ─────────────────────────────────────────────────────────────
  const [blockStatus, setBlockStatus] = useState({});
  const [activePanel, setActivePanel] = useState('availability');
  const [blockSort,   setBlockSort]   = useState('task');

  // ── Snapshot metadata ─────────────────────────────────────────────────────────────
  const snapshotFetchedAt = gcalFreeBusySnapshot?.fetchedAt || null;
  const snapshotAgeMs     = snapshotFetchedAt ? (Date.now() - new Date(snapshotFetchedAt).getTime()) : Infinity;
  const hasSnapshot       = !!gcalFreeBusySnapshot?.data;
  const snapshotIsStale   = snapshotAgeMs > STALE_LABEL_MS;
  const snapshotLabel     = snapshotFetchedAt
    ? new Date(snapshotFetchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  // Supabase hydration is asynchronous. Reflect it in this mounted component
  // before applying browser-local defaults or loading calendar choices.
  useEffect(() => {
    let active = true;
    const syncFromLocal = () => {
      if (!active) return;
      setSettings(loadGcalSettings());
      setSelCals(loadSelectedCals());
      setWriteCalId(loadWriteCalId());
    };
    window.addEventListener(GCAL_PREFS_CHANGED_EVENT, syncFromLocal);
    waitForGcalPrefs().finally(() => {
      syncFromLocal();
      if (active) setPrefsReady(true);
    });
    return () => {
      active = false;
      window.removeEventListener(GCAL_PREFS_CHANGED_EVENT, syncFromLocal);
    };
  }, []);

  const loadCalendarList = useCallback(async () => {
    if (!connected || !CLIENT_ID || !prefsReady) return;
    setCalendarListStatus('loading');
    try {
      const list = await fetchCalendarList();
      const cals = (list.items || []).filter(c => !c.hidden);
      setCalendars(cals);
      setSelCals(prev => {
        if (prev.size > 0) return prev;
        const all = new Set(cals.map(c => c.id));
        saveSelectedCals(all);
        return all;
      });
      setWriteCalId(prev => {
        const ids = cals.map(c => c.id);
        if (prev !== 'primary' && !ids.includes(prev)) {
          saveWriteCalId('primary');
          return 'primary';
        }
        return prev;
      });
      setCalendarListStatus('loaded');
    } catch (err) {
      setCalendarListStatus('error');
      setError(`Could not load your calendar choices: ${err.message || 'please reconnect and try again.'}`);
    }
  }, [connected, prefsReady]);

  // ── Load calendar list when connected ─────────────────────────────────────────────
  useEffect(() => {
    loadCalendarList();
  }, [loadCalendarList]);

  // ── Seed blockStatus from the push registry on mount / task change ────────────────
  // This ensures that tasks already pushed via the Planner show as 'done' here
  // without requiring a round-trip to the GCal API.
  useEffect(() => {
    setBlockStatus(prev => ({ ...seedBlockStatusFromRegistry(scheduled), ...prev }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // ── When switching to the Blocks panel, reconcile registry + live API ────────────
  useEffect(() => {
    if (activePanel !== 'blocks' || !connected) return;

    // Immediately seed from local registry (fast, no flash).
    setBlockStatus(prev => ({ ...seedBlockStatusFromRegistry(scheduled), ...prev }));

    // Then do a live fetch to catch blocks pushed from other sessions/devices.
    const endISO  = addDays(todayISO, 28);
    const { start } = localDayBounds(todayISO);
    const { end } = localDayBounds(endISO);
    const timeMin = start.toISOString();
    const timeMax = end.toISOString();
    fetchTaskTriageBlockIntervals(timeMin, timeMax)
      .then(blocksByDay => {
        setBlockStatus(prev => {
          const next = { ...prev };
          for (const [iso, blocks] of Object.entries(blocksByDay)) {
            for (const block of blocks) {
              if (!block.taskId || block.taskId === 'true') continue; // Legacy blocks cannot be safely attributed.
              const task = scheduled.find(candidate => String(candidate.id) === String(block.taskId));
              if (task) next[`${task.id}-${iso}`] = 'done';
            }
          }
          return next;
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel, connected]);

  // ── Availability fetch ────────────────────────────────────────────────────────────
  const handleFetchFreeBusy = useCallback(async () => {
    setLoadingFB(true); setError(null); setSubtractingBlocks(false);
    try {
      const endISO  = addDays(todayISO, LOOK_AHEAD_DAYS);
      const { start } = localDayBounds(todayISO);
      const { end } = localDayBounds(endISO);
      const timeMin = start.toISOString();
      const timeMax = end.toISOString();

      const currentWriteCalId = loadWriteCalId();
      const currentSelCals    = selCals.size > 0 ? selCals : loadSelectedCals();
      const allCalIds = currentSelCals.size > 0
        ? [...currentSelCals]
        : (calendars.length > 0 ? calendars.map(c => c.id) : []);
      const calIds = allCalIds.filter(id => id !== currentWriteCalId);
      if (!calIds.length) throw new Error('No calendars selected.');

      const isFallback = currentWriteCalId === 'primary';

      const [fbResp, blocksByDay] = await Promise.all([
        fetchFreeBusy(calIds, timeMin, timeMax),
        isFallback
          ? (setSubtractingBlocks(true),
             fetchTaskTriageBlockIntervals(timeMin, timeMax))
          : Promise.resolve({}),
      ]);
      setSubtractingBlocks(false);

      const busyByDay = {};
      for (const calId of calIds) {
        for (const interval of (fbResp.calendars?.[calId]?.busy || [])) {
          for (const iso of intervalLocalDates(interval.start, interval.end)) {
            (busyByDay[iso] ??= []).push(interval);
          }
        }
      }

      const result = {};
      for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
        const iso     = addDays(todayISO, i);
        let   rawBusy = busyByDay[iso] || [];
        if (isFallback && blocksByDay[iso]?.length)
          rawBusy = subtractTaskTriageBlocks(rawBusy, blocksByDay[iso]);
        result[iso] = effectiveFreeMinutes(iso, rawBusy, settings);
      }

      setFreeBusy(result);
      onFreeBusyUpdate?.(result, { fetchedAt: new Date().toISOString(), source: 'google' });
      setConnStatus('connected');
    } catch (e) {
      const msg = e.message || '';
      if (/401|unauthorized|invalid.*(token|credentials)|token.*expired/i.test(msg)) {
        revokeToken();
        setConnStatus('disconnected');
        setFreeBusy(null);
        setError('Your Google session expired. Please reconnect.');
      } else {
        setError(msg);
      }
      setSubtractingBlocks(false);
    } finally {
      setLoadingFB(false);
    }
  }, [calendars, selCals, writeCalId, settings, todayISO, onFreeBusyUpdate, onFreeBusyClear]);

  // ── Connect ───────────────────────────────────────────────────────────────────────
  const handleConnect = useCallback(async (forceConsent = false) => {
    if (!CLIENT_ID) { setError('No Google Client ID configured. See setup instructions below.'); return; }
    setConnecting(true); setError(null);
    try {
      await connectGcal(forceConsent);
      setConnStatus('connected');
      await handleFetchFreeBusy();
    } catch (e) { setError(e.message || 'Unable to connect to Google Calendar.'); }
    finally { setConnecting(false); }
  }, [handleFetchFreeBusy]);

  // ── Disconnect ────────────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    await revokeToken().catch(() => {});
    // Connection credentials are browser-local, but scheduling preferences are
    // user-scoped in Supabase and should survive reconnecting on any device.
    setConnStatus('disconnected');
    setCalendars([]);
    setCalendarListStatus('idle');
    setFreeBusy(null);
    setBlockStatus({});
    setSubtractingBlocks(false);
    onFreeBusyClear?.();
  }, [onFreeBusyClear]);

  // Auto-load availability on mount when connected and no data yet.
  useEffect(() => {
    if (!connected || freeBusy !== null || loadingFB) return;
    handleFetchFreeBusy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Block CRUD ────────────────────────────────────────────────────────────────────

  // Uses the same placement path as Planner. The scheduler includes existing
  // TaskTriage blocks as busy time and serializes same-day writes, so each
  // individually added block follows the previous one with the configured buffer.
  const handleCreateBlock = useCallback(async (task, iso, hrs) => {
    const key = `${task.id}-${iso}`;
    setBlockStatus(s => ({ ...s, [key]: 'pending' }));
    try {
      await upsertWorkBlock(task, iso, hrs, 0, settings, [...selCals]);
      setBlockStatus(s => ({ ...s, [key]: 'done' }));
    } catch (e) {
      setBlockStatus(s => ({ ...s, [key]: 'error' }));
      setError(e.message);
    }
  }, [settings, selCals]);

  // Deletes only the specific task's event(s) for this day (via push registry),
  // leaving other tasks' blocks on the same day untouched.
  const handleDeleteBlock = useCallback(async (task, iso) => {
    const key = `${task.id}-${iso}`;
    setBlockStatus(s => ({ ...s, [key]: 'deleting' }));
    try {
      await deleteTaskWorkBlock(task.id, iso);
      setBlockStatus(s => ({ ...s, [key]: null }));
    } catch (e) {
      setBlockStatus(s => ({ ...s, [key]: 'error' }));
      setError(e.message);
    }
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────────────
  const scheduled = tasks
    .filter(t => t.status !== 'done' && t.scheduled_days?.some(d => d >= todayISO))
    .map(t => ({ ...t, futureDays: (t.scheduled_days || []).filter(d => d >= todayISO) }))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  const scheduledByDate = React.useMemo(() => {
    const rows = [];
    for (const task of scheduled) {
      for (const iso of task.futureDays) {
        rows.push({ iso, task });
      }
    }
    rows.sort((a, b) => a.iso.localeCompare(b.iso));
    return rows;
  }, [scheduled]);

  const plannedHoursByDay = React.useMemo(() => {
    const map = {};
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const hrs = remainingHours(task);
      const days = (task.scheduled_days || []).filter(d => d >= todayISO);
      if (!days.length) continue;
      const hrsPerDay = hrs / days.length;
      for (const iso of days) {
        map[iso] = (map[iso] || 0) + hrsPerDay;
      }
    }
    return map;
  }, [tasks, todayISO]);

  const { workWindows, deductMins, bufferMins, efficiency, nonWorkDays } = settings;
  const windowH = totalWindowHours(settings);

  const toggleNonWorkDay = (dowIndex) => {
    const current = nonWorkDays || [];
    const next = current.includes(dowIndex)
      ? current.filter(d => d !== dowIndex)
      : [...current, dowIndex];
    updateSetting('nonWorkDays', next);
  };

  const usingPrimaryFallback = writeCalId === 'primary';

  const scheduledByDateGrouped = React.useMemo(() => {
    const map = {};
    for (const { iso, task } of scheduledByDate) {
      (map[iso] ??= []).push(task);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [scheduledByDate]);

  // ── Row renderers ─────────────────────────────────────────────────────────────────
  const renderDayRow = (task, iso) => {
    const key             = `${task.id}-${iso}`;
    const status          = blockStatus[key];
    const hrs             = hoursOnDay(task, iso, todayISO);
    return (
      <div key={`${task.id}-${iso}`} className="gcal-day-row">
        <span className="gcal-day-label">{fmtShort(iso)}</span>
        <span className="gcal-day-hrs">{hrs.toFixed(1)}h</span>
        {status === 'done' ? (
          <button className="gcal-delete-btn" onClick={() => handleDeleteBlock(task, iso)}>
            <IconTrash size={12} />
            Remove
          </button>
        ) : status === 'pending' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Adding…</span>
        ) : status === 'deleting' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Removing…</span>
        ) : status === 'error' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>Error</span>
        ) : (
          <button className="gcal-push-btn" onClick={() => handleCreateBlock(task, iso, hrs)}>
            Add {hrs.toFixed(1)}h block
          </button>
        )}
      </div>
    );
  };

  const renderTaskRowForDate = (task, iso) => {
    const key             = `${task.id}-${iso}`;
    const status          = blockStatus[key];
    const hrs             = hoursOnDay(task, iso, todayISO);
    return (
      <div key={`${task.id}-${iso}`} className="gcal-day-row">
        <span className="gcal-task-name-inline">{task.name}</span>
        <span className="gcal-day-hrs">{hrs.toFixed(1)}h</span>
        {status === 'done' ? (
          <button className="gcal-delete-btn" onClick={() => handleDeleteBlock(task, iso)}>
            <IconTrash size={12} />
            Remove
          </button>
        ) : status === 'pending' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Adding…</span>
        ) : status === 'deleting' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Removing…</span>
        ) : status === 'error' ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>Error</span>
        ) : (
          <button className="gcal-push-btn" onClick={() => handleCreateBlock(task, iso, hrs)}>
            Add {hrs.toFixed(1)}h block
          </button>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────────
  return (
    <div className="gcal-pane">

      {/* ── Checking / initialising ── */}
      {checking && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Checking Google Calendar connection…
        </div>
      )}

      {/* ── Disconnected hero (never connected, no saved snapshot) ── */}
      {!checking && !connected && !hasSnapshot && (
        <>
          <div className="gcal-hero">
            <div className="gcal-hero-icon"><IconCalendar size={48} /></div>
            <h2>Google Calendar</h2>
            <p>Connect your Google Calendar to see real free time each day and push work blocks directly to your calendar.</p>
            <button className="btn btn-primary gcal-connect-btn" onClick={() => handleConnect(true)} disabled={connecting}>
              <IconLink size={15} style={{ marginRight: 7, verticalAlign: 'middle' }} />
              {connecting ? 'Connecting…' : 'Connect Google Calendar'}
            </button>
            {error && <div className="gcal-error" style={{ marginTop: 12 }}>{error}</div>}
          </div>
          <div className="gcal-setup">
            <h3>How to connect</h3>
            <ol>
              <li>Click the <strong>Connect Google Calendar</strong> button above.</li>
              <li>Sign in with your Google account.</li>
              <li>Grant TaskTriage permission to view and edit your calendar.</li>
              <li>Your availability will automatically sync, and you can schedule work blocks directly to your calendar!</li>
            </ol>
          </div>
        </>
      )}

      {/* ── Connected / snapshot UI ── */}
      {!checking && (connected || hasSnapshot) && (
        <>
          <div className="gcal-header">
            <span className="gcal-connected-badge">
              {connected
                ? <><IconCheck size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Connected to Google Calendar</>
                : <><IconWarning size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Showing saved Google data</>}
            </span>
            <div className="gcal-header-actions">
              <button className="btn btn-sm" onClick={() => setShowSettings(s => !s)}>
                <IconGear size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                Settings
              </button>
              {connected ? (
                <button className="btn btn-sm" onClick={handleDisconnect}>Disconnect</button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => handleConnect(false)} disabled={connecting}>Reconnect Google</button>
              )}
            </div>
          </div>

          {error && <div className="gcal-error" style={{ marginBottom: 12 }}>{error}</div>}

          {hasSnapshot && (
            <div className={snapshotIsStale || !connected ? 'gcal-warning' : 'gcal-info'} style={{ marginBottom: 12 }}>
              {snapshotLabel ? `Availability last refreshed ${snapshotLabel}.` : 'Availability shown from your last Google sync.'}
              {(snapshotIsStale || !connected) && (
                <> {' '}This data may be out of date. <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => handleConnect(false)} disabled={connecting}>{connecting ? 'Connecting…' : 'Refresh from Google'}</button></>
              )}
            </div>
          )}

          {showSettings && (
            <div className="gcal-settings-panel">
              <div className="gcal-settings-grid">

                <div className="gcal-setting-group">
                  <div className="gcal-section-label">Working windows</div>
                  <WorkWindowsEditor
                    windows={workWindows || [{ start: 8, end: 20 }]}
                    onChange={next => updateSetting('workWindows', next)}
                  />
                </div>

                <div className="gcal-setting-group">
                  <div className="gcal-section-label">
                    Non-work days <span className="gcal-setting-hint">(automatically 0 availability)</span>
                  </div>
                  <div className="gcal-dow-row">
                    {DAY_NAMES.map((name, idx) => {
                      const isOff = (nonWorkDays || []).includes(idx);
                      return (
                        <button key={idx} type="button"
                          className={`gcal-dow-btn${isOff ? ' gcal-dow-off' : ''}`}
                          onClick={() => toggleNonWorkDay(idx)}
                          title={isOff ? `${name}: non-work day` : `${name}: work day`}
                        >{name}</button>
                      );
                    })}
                  </div>
                  {(nonWorkDays || []).length > 0 && (
                    <div className="gcal-setting-preview">
                      {DAY_NAMES.filter((_, i) => (nonWorkDays || []).includes(i)).join(', ')} will show 0h available
                    </div>
                  )}
                </div>

                <div className="gcal-setting-group">
                  <div className="gcal-section-label">Daily deduction <span className="gcal-setting-hint">(lunch, overhead, life)</span></div>
                  <div className="gcal-hours-row">
                    <input type="number" min={0} max={480} step={5}
                      value={deductMins}
                      onChange={e => updateSetting('deductMins', +e.target.value)}
                      style={{ width: 70 }} />
                    <span className="gcal-setting-unit">minutes/day</span>
                  </div>
                  <div className="gcal-setting-preview">= {(deductMins / 60).toFixed(1)}h subtracted before anything else</div>
                </div>

                <div className="gcal-setting-group">
                  <div className="gcal-section-label">Event buffer <span className="gcal-setting-hint">(context-switching time)</span></div>
                  <div className="gcal-hours-row">
                    <input type="number" min={0} max={60} step={5}
                      value={bufferMins}
                      onChange={e => updateSetting('bufferMins', +e.target.value)}
                      style={{ width: 70 }} />
                    <span className="gcal-setting-unit">min before &amp; after each event</span>
                  </div>
                </div>

                <div className="gcal-setting-group">
                  <div className="gcal-section-label">Efficiency <span className="gcal-setting-hint">(of remaining free time)</span></div>
                  <div className="gcal-efficiency-row">
                    <input type="range" min={10} max={100} step={5}
                      value={efficiency}
                      onChange={e => updateSetting('efficiency', +e.target.value)}
                      className="gcal-slider" />
                    <span className="gcal-efficiency-val">{efficiency}%</span>
                  </div>
                  <div className="gcal-setting-preview">e.g. a day with 6h free → {(6 * efficiency / 100).toFixed(1)}h usable</div>
                </div>

              </div>

              <div className="gcal-write-cal-section">
                <div className="gcal-section-label">
                  Work blocks calendar
                  <span className="gcal-setting-hint"> (where scheduled work blocks are written)</span>
                </div>

                {!connected ? (
                  <div className="gcal-write-cal-notice gcal-write-cal-notice--warn">
                    <IconWarning size={13} />
                    <span>Reconnect Google Calendar to load and change this choice.</span>
                  </div>
                ) : calendarListStatus === 'loading' || !prefsReady ? (
                  <div className="gcal-info">Loading your calendar choices…</div>
                ) : calendarListStatus === 'error' ? (
                  <div className="gcal-write-cal-notice gcal-write-cal-notice--warn">
                    <IconWarning size={13} />
                    <span>Calendar choices could not be loaded.</span>
                    <button className="btn btn-sm" onClick={loadCalendarList}>Try again</button>
                  </div>
                ) : (
                  <>
                  <div className="gcal-write-cal-tip">
                    <span className="gcal-write-cal-tip-icon">💡</span>
                    <span>
                      For the cleanest availability numbers, create a dedicated calendar
                      in Google Calendar — e.g. <em>TaskTriage Work Blocks</em> — then
                      select it below.{' '}
                      <a href="https://calendar.google.com/calendar/r/settings/createcalendar"
                        target="_blank" rel="noopener noreferrer">Create one now ↗</a>
                      <span className="gcal-write-cal-refresh-hint">
                        After creating, use the refresh button below so the new calendar appears in the list.
                      </span>
                    </span>
                  </div>

                  <select
                    className="gcal-write-cal-select"
                    value={writeCalId}
                    onChange={e => { const id = e.target.value; saveWriteCalId(id); setWriteCalId(id); }}
                  >
                    <option value="primary">Primary calendar (fallback)</option>
                    {calendars
                      .filter(cal => cal.accessRole === 'owner' || cal.accessRole === 'writer')
                      .map(cal => <option key={cal.id} value={cal.id}>{cal.summary}</option>)
                    }
                  </select>

                  <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={loadCalendarList}>
                    <IconRefresh size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                    Refresh calendar choices
                  </button>

                  {usingPrimaryFallback ? (
                    <div className="gcal-write-cal-notice gcal-write-cal-notice--warn">
                      <IconWarning size={13} />
                      <span>Writing to your primary calendar. App-written blocks are identified by tag and subtracted automatically — but a dedicated calendar is cleaner.</span>
                    </div>
                  ) : (
                    <div className="gcal-write-cal-notice gcal-write-cal-notice--ok">
                      <IconCheck size={13} />
                      <span>Work blocks go to this calendar only, and it's excluded from your availability calculation automatically.</span>
                    </div>
                  )}
                  </>
                )}
              </div>

              {calendarListStatus === 'loaded' && calendars.length > 0 && (
                <div className="gcal-setting-group" style={{ marginTop: 16 }}>
                  <div className="gcal-section-label">Calendars to include
                    <span className="gcal-setting-hint"> (read for availability)</span>
                  </div>
                  <div className="gcal-cal-list">
                    {calendars
                      .filter(cal => cal.id !== writeCalId)
                      .map(cal => (
                        <label key={cal.id} className="gcal-cal-item">
                          <input type="checkbox"
                            checked={selCals.has(cal.id)}
                            onChange={e => {
                              setSelCals(prev => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(cal.id) : next.delete(cal.id);
                                saveSelectedCals(next);
                                return next;
                              });
                            }} />
                          <span className="gcal-cal-dot" style={{ background: cal.backgroundColor || '#888' }} />
                          <span>{cal.summary}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }}
                onClick={() => { setShowSettings(false); handleFetchFreeBusy(); }}>
                <IconRefresh size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Apply &amp; Refresh
              </button>
            </div>
          )}

          <div className="gcal-panel-tabs">
            <button className={`gcal-panel-tab${activePanel === 'availability' ? ' active' : ''}`}
              onClick={() => setActivePanel('availability')}>
              <IconBarChart size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Availability
            </button>
            <button className={`gcal-panel-tab${activePanel === 'blocks' ? ' active' : ''}`}
              onClick={() => setActivePanel('blocks')}>
              <IconCalendar size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Work Blocks
            </button>
          </div>

          {activePanel === 'availability' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn btn-sm" onClick={handleFetchFreeBusy} disabled={loadingFB || !connected}>
                  <IconRefresh size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                  {loadingFB ? 'Loading…' : connected ? 'Refresh' : 'Reconnect to refresh'}
                </button>
              </div>

              {subtractingBlocks && (
                <div className="gcal-info" style={{ marginBottom: 8 }}>
                  Subtracting your TaskTriage work blocks from busy time…
                </div>
              )}

              {freeBusy ? (
                <div className="gcal-fb-grid">
                  {Object.entries(freeBusy).map(([iso, mins]) => {
                    const freeHrs = mins / 60;
                    const planHrs = plannedHoursByDay[iso] || 0;
                    const isToday = iso === todayISO;
                    const isPast  = iso < todayISO;
                    const isOff   = (nonWorkDays || []).includes(new Date(iso + 'T00:00:00').getDay());
                    const isOver  = planHrs > freeHrs && freeHrs > 0;
                    const freePct = windowH > 0 ? Math.min(100, (freeHrs / windowH) * 100) : 0;
                    const planPct = windowH > 0 ? Math.min(100, (planHrs / windowH) * 100) : 0;

                    let rowClass = 'gcal-fb-row';
                    if (isToday) rowClass += ' gcal-today';
                    if (isPast)  rowClass += ' gcal-past';
                    if (isOver)  rowClass += ' gcal-over';
                    if (isOff)   rowClass += ' gcal-day-off';

                    return (
                      <div key={iso} className={rowClass}>
                        <div className="gcal-fb-date">
                          {fmtShort(iso)}
                          {isOff && <span className="gcal-off-badge">off</span>}
                        </div>
                        <div className="gcal-fb-bar-wrap">
                          <div className="gcal-fb-bar" style={{ width: `${freePct}%` }} />
                          {planHrs > 0 && (
                            <div className={`gcal-fb-plan-bar${isOver ? ' over' : ''}`}
                              style={{ width: `${planPct}%` }} />
                          )}
                        </div>
                        <div className="gcal-fb-label">
                          <span className="gcal-fb-free">{freeHrs.toFixed(1)}h free</span>
                          {planHrs > 0 && (
                            <span className={`gcal-fb-planned${isOver ? ' over' : ''}`}>
                              {planHrs.toFixed(1)}h planned
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                !loadingFB && (
                  <div className="gcal-empty">
                    <p>No availability data yet.</p>
                    <button className="btn btn-primary btn-sm" onClick={handleFetchFreeBusy}>Load availability</button>
                  </div>
                )
              )}
            </div>
          )}

          {activePanel === 'blocks' && (
            <div className="gcal-blocks-panel">
              {scheduled.length === 0 ? (
                <div className="gcal-empty">
                  <p>No tasks have been scheduled yet. Use the Planner tab to assign tasks to days.</p>
                </div>
              ) : (
                <>
                  <div className="gcal-blocks-toolbar">
                    <span className="gcal-blocks-sort-label">Sort by:</span>
                    <div className="gcal-sort-toggle" role="group" aria-label="Sort work blocks by">
                      <button
                        className={`gcal-sort-btn${blockSort === 'task' ? ' active' : ''}`}
                        onClick={() => setBlockSort('task')}
                        aria-pressed={blockSort === 'task'}
                      >Task</button>
                      <button
                        className={`gcal-sort-btn${blockSort === 'date' ? ' active' : ''}`}
                        onClick={() => setBlockSort('date')}
                        aria-pressed={blockSort === 'date'}
                      >Date</button>
                    </div>
                  </div>
                  <div className="gcal-blocks-list">
                    {blockSort === 'task' ? (
                      scheduled.map(task => (
                        <div key={task.id} className="gcal-task-block">
                          <div className="gcal-task-name">{task.name}</div>
                          <div className="gcal-task-days">
                            {task.futureDays.map(iso => renderDayRow(task, iso))}
                          </div>
                        </div>
                      ))
                    ) : (
                      scheduledByDateGrouped.map(([iso, tasksOnDay]) => (
                        <div key={iso} className="gcal-date-block">
                          <div className="gcal-date-heading">{fmtShort(iso)}</div>
                          <div className="gcal-task-days">
                            {tasksOnDay.map(task => renderTaskRowForDate(task, iso))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
}
