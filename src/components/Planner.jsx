import React, { useState, useRef, useCallback, useEffect } from 'react';
import TaskPanel from './TaskPanel.jsx';
import { createWorkBlock } from '../lib/gcalScheduler.js';
import '../styles/planner.css';

const SHOW_WEEKS = 4;
const DAY_NAMES  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const LS_AUTOFILL_KEY = 'planner_autofill_settings';

function toISO(d) { return d.toISOString().slice(0, 10); }
function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtAgendaDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function taskProgress(task) {
  const substeps = task.substeps || [];
  if (!substeps.length) return task.manual_progress ?? task.manualProgress ?? 0;
  const totalWeight = substeps.reduce((s, sub) => s + (sub.weight ?? 1), 0);
  if (!totalWeight) return 0;
  const doneWeight = substeps.filter(s => s.done).reduce((s, sub) => s + (sub.weight ?? 1), 0);
  return Math.round((doneWeight / totalWeight) * 100);
}
function remainingHours(task) {
  const est = parseFloat(task.estimated_hours) || 1;
  return Math.max(0, est * (1 - taskProgress(task) / 100));
}
function buildISOs(weekOffset = 0) {
  const today  = new Date(); today.setHours(0,0,0,0);
  const anchor = new Date(today);
  const dow    = anchor.getDay();
  anchor.setDate(anchor.getDate() + (dow === 0 ? -6 : 1 - dow) + weekOffset * 7);
  return Array.from({ length: SHOW_WEEKS * 7 }, (_, i) => {
    const d = new Date(anchor); d.setDate(d.getDate() + i); return toISO(d);
  });
}
function hoursOnDay(task, iso, todayISO) {
  const rem        = remainingHours(task);
  const futureDays = (task.scheduled_days || []).filter(d => d >= todayISO);
  if (!futureDays.length) return 0;
  const dayHours      = task.scheduled_day_hours || {};
  const explicitTotal = futureDays.reduce((s, d) => s + (dayHours[d] || 0), 0);
  const unweighted    = futureDays.filter(d => !dayHours[d]);
  const perUnweighted = unweighted.length > 0
    ? Math.max(rem - explicitTotal, 0) / unweighted.length : 0;
  return dayHours[iso] !== undefined ? dayHours[iso] : perUnweighted;
}

// ── SVG icons ───────────────────────────────────────────────────────────────────
function IconCalendar({ size = 14, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <rect x="1" y="1.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="none"/>
      <path d="M1 5.5h12" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M4.5 0.5v2M9.5 0.5v2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <rect x="3.5" y="7" width="1.5" height="1.5" rx="0.3" fill="currentColor"/>
      <rect x="6.25" y="7" width="1.5" height="1.5" rx="0.3" fill="currentColor"/>
      <rect x="9" y="7" width="1.5" height="1.5" rx="0.3" fill="currentColor"/>
      <rect x="3.5" y="9.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/>
      <rect x="6.25" y="9.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/>
    </svg>
  );
}
function IconCalendarPush({ size = 11, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <rect x="1" y="1.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="none"/>
      <path d="M1 5.5h12" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M4.5 0.5v2M9.5 0.5v2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M7 12V7M5 9l2-2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevronUp({ size = 12, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevronDown({ size = 12, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style} aria-hidden="true">
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── AutoFill settings ─────────────────────────────────────────────────────────────
const DEFAULT_AUTOFILL = {
  mode:         'procrastinate',
  chunkHrs:     1,
  maxHrsPerDay: 0,
  skipWeekends: false,
  unallocated:  false,
};

function loadAutoFillSettings() {
  try {
    const raw = localStorage.getItem(LS_AUTOFILL_KEY);
    if (raw) return { ...DEFAULT_AUTOFILL, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_AUTOFILL };
}
function saveAutoFillSettings(s) {
  localStorage.setItem(LS_AUTOFILL_KEY, JSON.stringify(s));
}

function AutoFillModal({ settings, onChange, onApply, onClose }) {
  const set = (key, val) => onChange({ ...settings, [key]: val });
  const MODE_LABELS = {
    'procrastinate': 'Procrastinate (push toward deadline)',
    'spread':        'Spread evenly across available days',
    'front-load':    'Front-load (start ASAP)',
  };
  return (
    <div className="autofill-overlay" onClick={onClose}>
      <div className="autofill-modal" onClick={e => e.stopPropagation()}>
        <div className="autofill-modal-header">
          <span>Auto-fill settings</span>
          <button className="autofill-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="autofill-field">
          <label className="autofill-label">Distribution mode</label>
          <div className="autofill-radio-group">
            {Object.entries(MODE_LABELS).map(([val, label]) => (
              <label key={val} className="autofill-radio">
                <input type="radio" name="af-mode" value={val}
                  checked={settings.mode === val}
                  onChange={() => set('mode', val)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="autofill-field">
          <label className="autofill-label">Chunk size (hours per session)</label>
          <div className="autofill-row">
            <input type="number" min={0.25} max={12} step={0.25}
              value={settings.chunkHrs}
              onChange={e => set('chunkHrs', Math.max(0.25, parseFloat(e.target.value) || 1))}
              className="autofill-input" />
            <span className="autofill-unit">h per session</span>
          </div>
          <div className="autofill-hint">Tasks split into sessions of this size. Use a large value to place tasks whole.</div>
        </div>

        <div className="autofill-field">
          <label className="autofill-label">Max hours placed per day</label>
          <div className="autofill-row">
            <input type="number" min={0} max={24} step={0.5}
              value={settings.maxHrsPerDay}
              onChange={e => set('maxHrsPerDay', Math.max(0, parseFloat(e.target.value) || 0))}
              className="autofill-input" />
            <span className="autofill-unit">{settings.maxHrsPerDay === 0 ? '(unlimited)' : 'h/day cap'}</span>
          </div>
        </div>

        <div className="autofill-field">
          <label className="autofill-checkbox">
            <input type="checkbox"
              checked={settings.skipWeekends}
              onChange={e => set('skipWeekends', e.target.checked)} />
            Skip weekends
          </label>
          <label className="autofill-checkbox" style={{ marginTop: 6 }}>
            <input type="checkbox"
              checked={settings.unallocated}
              onChange={e => set('unallocated', e.target.checked)} />
            Place unallocated (assign days only, no per-day hour split)
          </label>
        </div>

        <div className="autofill-modal-footer">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}

/* ── Build a per-day availability map ───────────────────────────────────────────── */
function buildPerDayAvail(weeklyHours, gcalFreeBusy, skipWeekends, horizonDays = 16 * 7) {
  const fallback = weeklyHours / 7;
  const map      = {};
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < horizonDays; i++) {
    const iso = toISO(cur);
    const dow = cur.getDay();
    if (skipWeekends && (dow === 0 || dow === 6)) {
      map[iso] = 0;
    } else if (gcalFreeBusy && gcalFreeBusy[iso] !== undefined) {
      map[iso] = gcalFreeBusy[iso] / 60;
    } else {
      map[iso] = fallback;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return map;
}

/* ── autoFill ──────────────────────────────────────────────────────────────────── */
function autoFill(tasks, weeklyHours, afSettings, perDayAvail) {
  const { mode, chunkHrs, maxHrsPerDay, unallocated } = afSettings;
  const todayISO = toISO(new Date());
  const DAYS     = 16 * 7;
  const dayLoad  = {};

  // Seed dayLoad using hoursOnDay — the same calculation used for display —
  // so explicit per-day overrides are correctly accounted for.
  for (const t of tasks) {
    if (!t.scheduled_days) continue;
    const futureDays = t.scheduled_days.filter(d => d >= todayISO);
    for (const d of futureDays) {
      const hrs = hoursOnDay(t, d, todayISO);
      dayLoad[d] = (dayLoad[d] || 0) + hrs;
    }
  }

  const unscheduled = tasks
    .filter(t => t.status !== 'done' && !t.recurring &&
      (!t.scheduled_days || !t.scheduled_days.some(d => d >= todayISO)))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  const updated = tasks.map(t => ({
    ...t,
    scheduled_days:      t.scheduled_days      ? [...t.scheduled_days]      : [],
    scheduled_day_hours: t.scheduled_day_hours ? { ...t.scheduled_day_hours } : {},
  }));
  const byId  = Object.fromEntries(updated.map(t => [t.id, t]));
  const today = new Date(); today.setHours(0,0,0,0);

  for (const t of unscheduled) {
    const task = byId[t.id];
    if (!task) continue;
    const rem = remainingHours(task);
    if (rem <= 0) continue;

    const lastISO = task.due_date || (() => {
      const d = new Date(today); d.setDate(d.getDate() + DAYS); return toISO(d);
    })();

    const candidates = [];
    const cur = new Date(today);
    while (toISO(cur) <= lastISO) {
      const iso   = toISO(cur);
      const avail = perDayAvail[iso] ?? (weeklyHours / 7);
      const cap   = maxHrsPerDay > 0 ? Math.min(avail, maxHrsPerDay) : avail;
      const space = Math.max(cap - (dayLoad[iso] || 0), 0);
      if (space > 0.05) candidates.push(iso);
      cur.setDate(cur.getDate() + 1);
    }
    if (!candidates.length) continue;

    const sessionsNeeded = Math.ceil(rem / chunkHrs);
    let assignedDays;
    if (mode === 'procrastinate') {
      assignedDays = sessionsNeeded <= candidates.length
        ? candidates.slice(-sessionsNeeded) : candidates;
    } else if (mode === 'front-load') {
      assignedDays = sessionsNeeded <= candidates.length
        ? candidates.slice(0, sessionsNeeded) : candidates;
    } else {
      if (sessionsNeeded >= candidates.length) {
        assignedDays = candidates;
      } else {
        const step = candidates.length / sessionsNeeded;
        assignedDays = Array.from({ length: sessionsNeeded },
          (_, i) => candidates[Math.round(i * step)]);
      }
    }

    // Always update dayLoad after placing, regardless of unallocated mode,
    // so subsequent tasks see the correct remaining capacity on each day.
    const hrsPerDay = rem / assignedDays.length;
    for (const iso of assignedDays) {
      const avail  = perDayAvail[iso] ?? (weeklyHours / 7);
      const cap    = maxHrsPerDay > 0 ? Math.min(avail, maxHrsPerDay) : avail;
      const space  = Math.max(cap - (dayLoad[iso] || 0), 0);
      const actual = Math.min(hrsPerDay, space);
      dayLoad[iso] = (dayLoad[iso] || 0) + actual;
    }

    task.scheduled_days = assignedDays;
  }
  return updated;
}

// ── Day-picker modal ──────────────────────────────────────────────────────────────
function DayPickerModal({ task, allISOs, onPick, onClose }) {
  const weeks = [];
  for (let w = 0; w < SHOW_WEEKS; w++) weeks.push(allISOs.slice(w * 7, w * 7 + 7));
  const scheduled = new Set(task.scheduled_days || []);
  return (
    <div className="day-picker-overlay" onClick={onClose}>
      <div className="day-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="day-picker-header">
          <span>Schedule: <strong>{task.name}</strong></span>
          <button className="day-picker-close" onClick={onClose}>&times;</button>
        </div>
        {weeks.map((isos, w) => (
          <div key={w} className="day-picker-week">
            {isos.map((iso, i) => (
              <button
                key={iso}
                className={`day-picker-btn${scheduled.has(iso) ? ' picked' : ''}`}
                onClick={() => onPick(iso)}
              >
                <span className="dpb-name">{DAY_NAMES[i]}</span>
                <span className="dpb-date">{fmtShort(iso)}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="day-picker-hint">Tap a day to toggle it. Tap outside to close.</div>
      </div>
    </div>
  );
}

// ── Mobile Agenda View ──────────────────────────────────────────────────────────────
function AgendaView({
  allISOs, todayISO, weekOffset, setWeekOffset,
  scheduledOnDay, dueOnDay, dayLoad, dayAvail,
  catMap, hoursOnDayFn,
  trueUnscheduled, scheduledEarlier, scheduledLater,
  sortByDue,
  onOpenPanel, onSchedule, onRemoveDay,
  handleAutoFill, handleClearAll,
  gcalConnected, onPushDayToGCal, gcalPushStatus,
}) {
  const [unschOpen, setUnschOpen] = useState(true);
  const allUnscheduled = sortByDue([...trueUnscheduled, ...scheduledEarlier, ...scheduledLater]);

  const activeDays = allISOs.filter(iso =>
    iso === todayISO ||
    (scheduledOnDay[iso] && scheduledOnDay[iso].length > 0) ||
    (dueOnDay[iso] && dueOnDay[iso].length > 0)
  );

  const weekLabel = (() => {
    const start = new Date(allISOs[0] + 'T00:00:00');
    const end   = new Date(allISOs[allISOs.length - 1] + 'T00:00:00');
    return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' \u2013 ' + end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  return (
    <div className="agenda-view">
      <div className="agenda-nav">
        <div className="agenda-nav-btns">
          <button className="btn btn-sm" onClick={() => setWeekOffset(o => o - 1)}>&#8249;</button>
          <button className="btn btn-sm" onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}>Today</button>
          <button className="btn btn-sm" onClick={() => setWeekOffset(o => o + 1)}>&#8250;</button>
        </div>
        <span className="agenda-week-label">{weekLabel}</span>
        <div className="agenda-actions">
          <button className="btn btn-sm" onClick={handleAutoFill}>&#9889; Fill</button>
          <button className="btn btn-sm" onClick={handleClearAll}>Clear</button>
        </div>
      </div>

      {allUnscheduled.length > 0 && (
        <div className="agenda-unscheduled">
          <button
            className="agenda-section-toggle"
            onClick={() => setUnschOpen(o => !o)}
          >
            {unschOpen
              ? <IconChevronUp size={11} style={{ marginRight: 5 }} />
              : <IconChevronDown size={11} style={{ marginRight: 5 }} />}
            Unscheduled
            <span className="sidebar-count">{allUnscheduled.length}</span>
          </button>
          {unschOpen && allUnscheduled.map(task => {
            const cat = catMap[task.category_id];
            const color = cat?.color || '#888';
            const rem = remainingHours(task);
            return (
              <div key={task.id} className="agenda-unsch-row" style={{ borderLeftColor: color }}
                onClick={() => onOpenPanel(task)}>
                <div className="agenda-unsch-name">{task.name}</div>
                <div className="agenda-unsch-meta">
                  {rem.toFixed(1)}h remaining
                  {task.due_date ? ` \u00b7 due ${fmtShort(task.due_date)}` : ''}
                </div>
                <button className="agenda-schedule-btn"
                  onClick={e => { e.stopPropagation(); onSchedule(task); }}
                  aria-label="Pick days">
                  <IconCalendar size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {activeDays.length === 0 ? (
        <div className="agenda-empty">Nothing scheduled this window.</div>
      ) : activeDays.map(iso => {
        const isToday  = iso === todayISO;
        const isPast   = iso < todayISO;
        const load     = dayLoad[iso] || 0;
        const over     = load > dayAvail + 0.05;
        const dayTasks = scheduledOnDay[iso] || [];
        const dues     = dueOnDay[iso] || [];
        const pushSt   = gcalPushStatus[iso];
        const hasTasks = dayTasks.length > 0;
        return (
          <div key={iso} className={`agenda-day${isToday ? ' agenda-today' : ''}${isPast ? ' agenda-past' : ''}`}>
            <div className="agenda-day-header">
              <span className="agenda-day-label">{fmtAgendaDay(iso)}</span>
              {load > 0.05 && (
                <span className={`agenda-load-badge${over ? ' over' : ''}`}>{load.toFixed(1)}h</span>
              )}
              {gcalConnected && hasTasks && (
                <button
                  className={`day-gcal-btn${pushSt === 'done' ? ' done' : pushSt === 'error' ? ' error' : ''}`}
                  onClick={() => onPushDayToGCal(iso)}
                  disabled={pushSt === 'pushing'}
                  title={pushSt === 'done' ? 'Pushed to GCal' : 'Auto-schedule this day in Google Calendar'}
                >
                  {pushSt === 'pushing' ? '\u2026' : pushSt === 'done' ? '\u2713' : <IconCalendarPush size={13} />}
                </button>
              )}
            </div>
            {dues.map(t => (
              <div key={t.id} className="agenda-due-row"
                style={{ borderLeftColor: catMap[t.category_id]?.color || '#888' }}
                onClick={() => onOpenPanel(t)}>
                <span className="agenda-due-icon"><IconCalendar size={14} /></span>
                <span className="agenda-due-name">Due: {t.name}</span>
              </div>
            ))}
            {dayTasks.map(t => {
              const cat   = catMap[t.category_id];
              const color = cat?.color || '#888';
              const hrs   = hoursOnDayFn(t, iso, todayISO);
              return (
                <div key={t.id} className="agenda-task-row" style={{ borderLeftColor: color }}
                  onClick={() => onOpenPanel(t)}>
                  <div className="agenda-task-name">{t.name}</div>
                  <div className="agenda-task-meta">
                    <span className="agenda-task-hrs" style={{ background: color }}>{hrs.toFixed(1)}h</span>
                    {t.due_date && <span className="agenda-task-due">due {fmtShort(t.due_date)}</span>}
                  </div>
                  <button className="agenda-remove-btn"
                    onClick={e => { e.stopPropagation(); onRemoveDay(t, iso); }}
                    aria-label="Remove from this day">&times;</button>
                  <button className="agenda-schedule-btn-sm"
                    onClick={e => { e.stopPropagation(); onSchedule(t); }}
                    aria-label="Reschedule"><IconCalendar size={13} /></button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const DRAG_PX      = 10;
const DRAG_RATIO   = 1.2;

export default function Planner({ appData, userId, onEditTask }) {
  const {
    categories, tasks, preferences, saveTask, removeTask, setTaskSchedule,
    gcalFreeBusy, gcalConnected, gcalSettings, gcalSelCals,
  } = appData;
  const weeklyHours  = preferences?.weekly_hours  ?? 20;
  const dayAvail     = weeklyHours / 7;

  const [weekOffset,     setWeekOffset]     = useState(0);
  const [openPopover,    setOpenPopover]    = useState(null);
  const [hrsInput,       setHrsInput]       = useState('');
  const [panelTask,      setPanelTask]      = useState(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [dayPickerTask,  setDayPickerTask]  = useState(null);
  const [touchGhost,     setTouchGhost]     = useState(null);
  const [isMobile,       setIsMobile]       = useState(() => window.innerWidth <= 700);
  const [afSettings,     setAfSettings]     = useState(loadAutoFillSettings);
  const [showAfModal,    setShowAfModal]    = useState(false);
  const [gcalPushStatus, setGcalPushStatus] = useState({});

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 700);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const dragging       = useRef(null);
  const touchDragging  = useRef(null);
  const touchStartXY   = useRef(null);
  const touchMoved     = useRef(false);
  const touchAborted   = useRef(false);
  const touchOverCol   = useRef(null);

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayISO = toISO(today);
  const allISOs  = buildISOs(weekOffset);
  const windowStart = allISOs[0];
  const windowEnd   = allISOs[allISOs.length - 1];
  const catMap   = Object.fromEntries(categories.map(c => [c.id, c]));
  const allActive = tasks.filter(t => t.status !== 'done');

  const dayLoad        = {};
  const scheduledOnDay = {};
  const dueOnDay       = {};
  allISOs.forEach(iso => { dayLoad[iso] = 0; scheduledOnDay[iso] = []; dueOnDay[iso] = []; });
  for (const t of allActive) {
    if (t.due_date && dueOnDay[t.due_date] !== undefined) dueOnDay[t.due_date].push(t);
    if (!t.scheduled_days?.length) continue;
    const rem = remainingHours(t);
    if (rem <= 0) continue;
    const futureDays = t.scheduled_days.filter(d => d >= todayISO);
    for (const d of futureDays) {
      const hrs = hoursOnDay(t, d, todayISO);
      if (dayLoad[d]        !== undefined) dayLoad[d]        += hrs;
      if (scheduledOnDay[d] !== undefined) scheduledOnDay[d].push(t);
    }
  }

  const trueUnscheduled  = [];
  const scheduledEarlier = [];
  const scheduledLater   = [];
  for (const t of allActive) {
    if (t.recurring) continue;
    const days = t.scheduled_days || [];
    const inWindow = days.some(d => allISOs.includes(d));
    if (inWindow) continue;
    const hasBefore = days.some(d => d < windowStart);
    const hasAfter  = days.some(d => d > windowEnd);
    if (!days.length)                trueUnscheduled.push(t);
    else if (hasBefore && !hasAfter) scheduledEarlier.push(t);
    else if (hasAfter)               scheduledLater.push(t);
    else                             trueUnscheduled.push(t);
  }
  const sortByDue = arr => arr.slice().sort((a, b) =>
    (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  // ── Auto-fill ────────────────────────────────────────────────────────────────
  const runAutoFill = useCallback(async (settingsOverride) => {
    const s = settingsOverride || afSettings;
    const perDayAvail = buildPerDayAvail(weeklyHours, gcalFreeBusy || null, s.skipWeekends);
    const updated     = autoFill(allActive, weeklyHours, s, perDayAvail);
    for (const t of updated) {
      const orig = tasks.find(x => x.id === t.id);
      const schedChanged = JSON.stringify(orig?.scheduled_days?.slice().sort()) !==
                           JSON.stringify(t.scheduled_days?.slice().sort());
      if (schedChanged) {
        await setTaskSchedule(t.id, t.scheduled_days);
        if (!s.unallocated &&
            JSON.stringify(orig?.scheduled_day_hours) !== JSON.stringify(t.scheduled_day_hours))
          await saveTask({ ...orig, scheduled_day_hours: t.scheduled_day_hours });
      }
    }
  }, [allActive, weeklyHours, gcalFreeBusy, afSettings, setTaskSchedule, saveTask, tasks]);

  const handleAutoFill = useCallback(() => runAutoFill(), [runAutoFill]);

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('Remove all scheduled days from every task?')) return;
    for (const t of allActive)
      if (t.scheduled_days?.length) await setTaskSchedule(t.id, []);
  }, [allActive, setTaskSchedule]);

  // ── GCal per-day push ───────────────────────────────────────────────────────────
  const handlePushDayToGCal = useCallback(async (iso) => {
    const dayTasks = (scheduledOnDay[iso] || [])
      .slice()
      .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
    if (!dayTasks.length) return;

    setGcalPushStatus(s => ({ ...s, [iso]: 'pushing' }));
    try {
      for (const task of dayTasks) {
        const hrs = hoursOnDay(task, iso, todayISO);
        if (hrs < 0.1) continue;
        await createWorkBlock(task, iso, hrs, gcalSettings, gcalSelCals);
      }
      setGcalPushStatus(s => ({ ...s, [iso]: 'done' }));
    } catch (e) {
      setGcalPushStatus(s => ({ ...s, [iso]: 'error' }));
    }
  }, [scheduledOnDay, todayISO, gcalSettings, gcalSelCals]);

  // ── Mouse drag ─────────────────────────────────────────────────────────────────
  const onDragStart = (e, task) => { dragging.current = task; e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnd   = () => { dragging.current = null; };

  const onDropDay = useCallback(async (e, iso) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const t = dragging.current;
    if (!t) return;
    const days = t.scheduled_days || [];
    if (!days.includes(iso)) await setTaskSchedule(t.id, [...days, iso].sort());
    dragging.current = null;
  }, [setTaskSchedule]);

  const onDropSidebar = useCallback(async (e) => {
    e.preventDefault();
    const t = dragging.current;
    if (!t) return;
    await setTaskSchedule(t.id, []);
    dragging.current = null;
  }, [setTaskSchedule]);

  // ── Touch drag ─────────────────────────────────────────────────────────────────
  const colAtPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const col = el.closest('[data-iso]');
    return col ? col.dataset.iso : null;
  };

  const clearTouchOverCol = () => {
    if (touchOverCol.current) {
      const prev = document.querySelector(`[data-iso="${touchOverCol.current}"]`);
      prev?.classList.remove('drag-over');
      touchOverCol.current = null;
    }
  };

  const onTouchStartCard = useCallback((e, task) => {
    const touch = e.touches[0];
    touchStartXY.current  = { x: touch.clientX, y: touch.clientY };
    touchMoved.current    = false;
    touchAborted.current  = false;
    touchDragging.current = task;
  }, []);

  const onTouchMoveCard = useCallback((e) => {
    if (!touchDragging.current || touchAborted.current) return;
    const touch = e.touches[0];
    const dx    = touch.clientX - (touchStartXY.current?.x || 0);
    const dy    = touch.clientY - (touchStartXY.current?.y || 0);
    const dist  = Math.hypot(dx, dy);
    if (!touchMoved.current) {
      if (dist < DRAG_PX) return;
      const isHorizontal = Math.abs(dx) >= Math.abs(dy) * DRAG_RATIO;
      if (!isHorizontal) {
        touchDragging.current = null;
        touchAborted.current  = true;
        return;
      }
      touchMoved.current = true;
      document.body.classList.add('is-touch-dragging');
    }
    e.preventDefault();
    const task  = touchDragging.current;
    if (!task) return;
    const color = catMap[task.category_id]?.color || '#888';
    setTouchGhost({
      x: touch.clientX - 40,
      y: touch.clientY - 36,
      label: task.name,
      color,
    });
    const iso = colAtPoint(touch.clientX, touch.clientY);
    if (touchOverCol.current !== iso) {
      clearTouchOverCol();
      if (iso) {
        const next = document.querySelector(`[data-iso="${iso}"]`);
        next?.classList.add('drag-over');
        touchOverCol.current = iso;
      }
    }
  }, [catMap]);

  const onTouchEndCard = useCallback(async (e) => {
    const task = touchDragging.current;
    touchDragging.current = null;
    touchAborted.current  = false;
    document.body.classList.remove('is-touch-dragging');
    setTouchGhost(null);
    clearTouchOverCol();
    if (!task || !touchMoved.current) return;
    const touch = e.changedTouches[0];
    const sidebarEl = document.querySelector('.planner-sidebar');
    if (sidebarEl) {
      const r = sidebarEl.getBoundingClientRect();
      if (touch.clientX >= r.left && touch.clientX <= r.right &&
          touch.clientY >= r.top  && touch.clientY <= r.bottom) {
        await setTaskSchedule(task.id, []);
        return;
      }
    }
    const iso = colAtPoint(touch.clientX, touch.clientY);
    if (iso) {
      const days = task.scheduled_days || [];
      if (!days.includes(iso)) await setTaskSchedule(task.id, [...days, iso].sort());
    }
  }, [setTaskSchedule]);

  // ── Day-picker ─────────────────────────────────────────────────────────────────
  const onDayPickerPick = useCallback(async (iso) => {
    const task = dayPickerTask;
    if (!task) return;
    const days = task.scheduled_days || [];
    const newDays = days.includes(iso)
      ? days.filter(d => d !== iso)
      : [...days, iso].sort();
    await setTaskSchedule(task.id, newDays);
    task.scheduled_days = newDays;
  }, [dayPickerTask, setTaskSchedule]);

  // ── Edit helpers ────────────────────────────────────────────────────────────────
  const removeDay = useCallback(async (task, iso) => {
    const days   = (task.scheduled_days || []).filter(d => d !== iso);
    const dayHrs = { ...(task.scheduled_day_hours || {}) };
    delete dayHrs[iso];
    await setTaskSchedule(task.id, days);
    if (JSON.stringify(task.scheduled_day_hours) !== JSON.stringify(dayHrs))
      await saveTask({ ...task, scheduled_day_hours: dayHrs });
  }, [setTaskSchedule, saveTask]);

  const setDayHours = useCallback(async (task, iso, hrs) => {
    const dayHrs = { ...(task.scheduled_day_hours || {}), [iso]: Math.max(0, hrs) };
    await saveTask({ ...task, scheduled_days: task.scheduled_days || [], scheduled_day_hours: dayHrs });
    setOpenPopover(null);
  }, [saveTask]);

  const clearDayHours = useCallback(async (task, iso) => {
    const dayHrs = { ...(task.scheduled_day_hours || {}) };
    delete dayHrs[iso];
    await saveTask({ ...task, scheduled_days: task.scheduled_days || [], scheduled_day_hours: dayHrs });
    setOpenPopover(null);
  }, [saveTask]);

  const openPanel = (task) => setPanelTask({ task, cat: catMap[task.category_id] });

  const totalSidebarCount = trueUnscheduled.length + scheduledEarlier.length + scheduledLater.length;

  // ── Render ──────────────────────────────────────────────────────────────────────
  return (
    <div className="planner">
      {touchGhost && (
        <div className="touch-ghost" style={{
          left:       touchGhost.x,
          top:        touchGhost.y,
          background: touchGhost.color,
        }}>
          {touchGhost.label.slice(0, 20)}{touchGhost.label.length > 20 ? '\u2026' : ''}
        </div>
      )}

      {isMobile ? (
        <AgendaView
          allISOs={allISOs}
          todayISO={todayISO}
          weekOffset={weekOffset}
          setWeekOffset={setWeekOffset}
          scheduledOnDay={scheduledOnDay}
          dueOnDay={dueOnDay}
          dayLoad={dayLoad}
          dayAvail={dayAvail}
          catMap={catMap}
          hoursOnDayFn={hoursOnDay}
          trueUnscheduled={trueUnscheduled}
          scheduledEarlier={scheduledEarlier}
          scheduledLater={scheduledLater}
          sortByDue={sortByDue}
          onOpenPanel={openPanel}
          onSchedule={setDayPickerTask}
          onRemoveDay={removeDay}
          handleAutoFill={handleAutoFill}
          handleClearAll={handleClearAll}
          gcalConnected={gcalConnected}
          onPushDayToGCal={handlePushDayToGCal}
          gcalPushStatus={gcalPushStatus}
        />
      ) : (
        <>
          <div className="planner-controls">
            <div className="planner-nav">
              <button className="btn btn-sm" onClick={() => setWeekOffset(o => o - SHOW_WEEKS)}>&laquo;</button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(o => o - 1)}>&#8249;</button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(0)}
                disabled={weekOffset === 0} style={{ minWidth: 52 }}>Today</button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(o => o + 1)}>&#8250;</button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(o => o + SHOW_WEEKS)}>&raquo;</button>
            </div>
            <div className="planner-actions">
              <button className="btn btn-sm" onClick={() => setShowAfModal(true)}
                title="Auto-fill settings">&#9881; Autofill settings</button>
              <button className="btn btn-sm" onClick={handleClearAll}>Clear all</button>
            </div>
          </div>

          <div className="planner-layout">
            <div className="planner-sidebar-wrap">
              <button
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(o => !o)}
                aria-expanded={sidebarOpen}
              >
                {sidebarOpen
                  ? <IconChevronUp size={11} style={{ marginRight: 5 }} />
                  : <IconChevronDown size={11} style={{ marginRight: 5 }} />}
                Tasks
                {!sidebarOpen && totalSidebarCount > 0 &&
                  <span className="sidebar-count" style={{ marginLeft: 6 }}>{totalSidebarCount}</span>}
              </button>

              {sidebarOpen && (
                <div className="planner-sidebar"
                  onDragOver={e => e.preventDefault()}
                  onDrop={onDropSidebar}
                >
                  <div className="sidebar-title">
                    Unscheduled
                    <span className="sidebar-count">{trueUnscheduled.length}</span>
                  </div>
                  {trueUnscheduled.length === 0
                    ? <div className="sidebar-empty">None &#x2714;</div>
                    : sortByDue(trueUnscheduled).map(task => (
                        <SidebarCard
                          key={task.id}
                          task={task}
                          cat={catMap[task.category_id]}
                          allISOs={allISOs}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onTouchStart={onTouchStartCard}
                          onTouchMove={onTouchMoveCard}
                          onTouchEnd={onTouchEndCard}
                          onRemoveDay={removeDay}
                          onClick={() => openPanel(task)}
                          onSchedule={() => setDayPickerTask(task)}
                        />
                      ))
                  }

                  {scheduledEarlier.length > 0 && (
                    <>
                      <div className="sidebar-title" style={{ marginTop: '1rem' }}>
                        Scheduled earlier
                        <span className="sidebar-count">{scheduledEarlier.length}</span>
                      </div>
                      {sortByDue(scheduledEarlier).map(task => (
                        <SidebarCard key={task.id} task={task} cat={catMap[task.category_id]}
                          allISOs={allISOs} onDragStart={onDragStart} onDragEnd={onDragEnd}
                          onTouchStart={onTouchStartCard} onTouchMove={onTouchMoveCard} onTouchEnd={onTouchEndCard}
                          onRemoveDay={removeDay} onClick={() => openPanel(task)}
                          onSchedule={() => setDayPickerTask(task)} />
                      ))}
                    </>
                  )}

                  {scheduledLater.length > 0 && (
                    <>
                      <div className="sidebar-title" style={{ marginTop: '1rem' }}>
                        Scheduled later
                        <span className="sidebar-count">{scheduledLater.length}</span>
                      </div>
                      {sortByDue(scheduledLater).map(task => (
                        <SidebarCard key={task.id} task={task} cat={catMap[task.category_id]}
                          allISOs={allISOs} onDragStart={onDragStart} onDragEnd={onDragEnd}
                          onTouchStart={onTouchStartCard} onTouchMove={onTouchMoveCard} onTouchEnd={onTouchEndCard}
                          onRemoveDay={removeDay} onClick={() => openPanel(task)}
                          onSchedule={() => setDayPickerTask(task)} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="planner-weeks">
              {Array.from({ length: SHOW_WEEKS }, (_, w) => {
                const weekISOs = allISOs.slice(w * 7, w * 7 + 7);
                return (
                  <div key={w} className="planner-week">
                    <div className="planner-week-grid">
                      {weekISOs.map((iso, i) => {
                        const isToday  = iso === todayISO;
                        const isPast   = iso < todayISO;
                        const pushSt   = gcalPushStatus[iso];
                        const hasTasks = (scheduledOnDay[iso] || []).length > 0;
                        // Show the Auto-fill button inline in the first day-header cell of the first week only
                        const showAutoFill = w === 0 && i === 0;
                        return (
                          <div key={`hdr-${iso}`}
                            className={`planner-day-header${isToday ? ' today' : ''}${isPast ? ' past' : ''}`}>
                            <span className="planner-day-name-date">
                              {DAY_NAMES[i]}<br />
                              <span className="planner-day-date">{fmtShort(iso)}</span>
                            </span>
                            {showAutoFill && (
                              <button
                                className="btn btn-sm autofill-inline-btn"
                                onClick={handleAutoFill}
                                title="Auto-fill unscheduled tasks"
                              >&#9889; Auto-fill</button>
                            )}
                            {gcalConnected && hasTasks && (
                              <button
                                className={`day-gcal-btn${pushSt === 'done' ? ' done' : pushSt === 'error' ? ' error' : ''}`}
                                onClick={() => handlePushDayToGCal(iso)}
                                disabled={pushSt === 'pushing'}
                                title={pushSt === 'done' ? 'Pushed to GCal' : 'Auto-schedule this day in Google Calendar'}
                              >
                                {pushSt === 'pushing' ? '\u2026'
                                  : pushSt === 'done'  ? '\u2713'
                                  : <IconCalendarPush size={10} />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {weekISOs.map(iso => {
                        const load   = dayLoad[iso] || 0;
                        const over   = load > dayAvail + 0.05;
                        const isPast = iso < todayISO;
                        return (
                          <div
                            key={`col-${iso}`}
                            data-iso={iso}
                            className={`planner-col${over ? ' over' : ''}${isPast ? ' past' : ''}`}
                            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                            onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                            onDrop={e => onDropDay(e, iso)}
                          >
                            {load > 0.05 && (
                              <div className={`day-load-badge${over ? ' over' : ''}`}>{load.toFixed(1)}h</div>
                            )}
                            {dueOnDay[iso]?.map(t => (
                              <div key={t.id} className="due-chip"
                                style={{ background: catMap[t.category_id]?.color || '#888' }}
                                title={`Due: ${t.name}`}>
                                <IconCalendar size={9} style={{ marginRight: 3, verticalAlign: 'middle', opacity: 0.85 }} />
                                {t.name.slice(0, 12)}{t.name.length > 12 ? '\u2026' : ''}
                              </div>
                            ))}
                            {scheduledOnDay[iso]?.map(t => {
                              const cat      = catMap[t.category_id];
                              const hrs      = hoursOnDay(t, iso, todayISO);
                              const isCustom = (t.scheduled_day_hours || {})[iso] !== undefined;
                              const popKey   = `${t.id}-${iso}`;
                              return (
                                <PlannerTaskCard
                                  key={t.id}
                                  task={t} cat={cat} iso={iso} hrs={hrs} isCustom={isCustom}
                                  isPopoverOpen={openPopover === popKey}
                                  hrsInput={hrsInput}
                                  onDragStart={onDragStart} onDragEnd={onDragEnd}
                                  onTouchStart={onTouchStartCard}
                                  onTouchMove={onTouchMoveCard}
                                  onTouchEnd={onTouchEndCard}
                                  onRemove={() => removeDay(t, iso)}
                                  onOpen={() => openPanel(t)}
                                  onTogglePopover={() => {
                                    if (openPopover === popKey) setOpenPopover(null);
                                    else { setHrsInput(hrs.toFixed(1)); setOpenPopover(popKey); }
                                  }}
                                  onSetHours={() => setDayHours(t, iso, parseFloat(hrsInput))}
                                  onClearHours={() => clearDayHours(t, iso)}
                                  onHrsInputChange={setHrsInput}
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showAfModal && (
        <AutoFillModal
          settings={afSettings}
          onChange={next => { setAfSettings(next); saveAutoFillSettings(next); }}
          onApply={() => { setShowAfModal(false); runAutoFill(); }}
          onClose={() => setShowAfModal(false)}
        />
      )}

      {dayPickerTask && (
        <DayPickerModal
          task={dayPickerTask}
          allISOs={allISOs}
          onPick={onDayPickerPick}
          onClose={() => setDayPickerTask(null)}
        />
      )}

      {panelTask && (
        <TaskPanel
          task={panelTask.task}
          cat={panelTask.cat}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); setPanelTask({ ...panelTask, task: updated }); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => { setPanelTask(null); onEditTask(task); }}
        />
      )}
    </div>
  );
}

// ── PlannerTaskCard ────────────────────────────────────────────────────────────────
function PlannerTaskCard({
  task, cat, iso, hrs, isCustom,
  isPopoverOpen, hrsInput,
  onDragStart, onDragEnd,
  onTouchStart, onTouchMove, onTouchEnd,
  onRemove, onOpen,
  onTogglePopover, onSetHours, onClearHours, onHrsInputChange,
}) {
  const color = cat?.color || '#888';
  const due   = task.due_date ? <> &middot; due {fmtShort(task.due_date)}</> : null;
  return (
    <div
      className="planner-task-card"
      style={{ background: color }}
      draggable
      onDragStart={e => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onTouchStart={e => onTouchStart(e, task)}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="card-body" onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div className="card-name">{task.name.slice(0, 22)}{task.name.length > 22 ? '\u2026' : ''}</div>
        <div className="card-meta">
          <button
            className={`hrs-badge${isCustom ? ' hrs-custom' : ''}`}
            onClick={e => { e.stopPropagation(); onTogglePopover(); }}
            title="Click to adjust hours"
          >{hrs.toFixed(1)}h</button>
          {due && <span className="card-due">{due}</span>}
        </div>
        {isPopoverOpen && (
          <div className="hrs-popover" onClick={e => e.stopPropagation()}>
            <div className="hrs-popover-label">Hours on this day</div>
            <div className="hrs-popover-row">
              <input type="number" min="0" step="0.5"
                value={hrsInput}
                onChange={e => onHrsInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSetHours(); }}
                autoFocus />
              <button onClick={onSetHours}>Set</button>
              {isCustom && <button onClick={onClearHours} title="Reset to auto">&#8635;</button>}
            </div>
          </div>
        )}
      </div>
      <button className="card-remove" onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove from this day">&times;</button>
    </div>
  );
}

// ── SidebarCard ────────────────────────────────────────────────────────────────
function SidebarCard({ task, cat, allISOs, onDragStart, onDragEnd, onTouchStart, onTouchMove, onTouchEnd, onRemoveDay, onClick, onSchedule }) {
  const color   = cat?.color || '#888';
  const due     = task.due_date ? `due ${fmtShort(task.due_date)}` : 'no deadline';
  const rem     = remainingHours(task);
  const visible = (task.scheduled_days || []).filter(d => allISOs.includes(d));
  return (
    <div
      className="sidebar-card"
      style={{ borderLeftColor: color }}
      draggable
      onDragStart={e => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onTouchStart={e => onTouchStart(e, task)}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onClick}
      title="Tap to view \u00b7 Drag/touch-drag to schedule"
    >
      <div className="sidebar-card-name">{task.name}</div>
      <div className="sidebar-card-meta">{rem.toFixed(1)}h remaining &middot; {due}</div>
      {visible.length > 0 && (
        <div className="sidebar-days">
          {visible.map(d => (
            <span key={d} className="sidebar-day-chip">
              {fmtShort(d)}
              <button onClick={e => { e.stopPropagation(); onRemoveDay(task, d); }}>&times;</button>
            </span>
          ))}
        </div>
      )}
      <button
        className="sidebar-schedule-btn"
        onClick={e => { e.stopPropagation(); onSchedule(); }}
        title="Pick days"
        aria-label="Pick days to schedule"
      ><IconCalendar size={14} /></button>
    </div>
  );
}
