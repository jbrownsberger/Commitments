/**
 * GCalSync — Google Calendar integration tab
 *
 * Three panels:
 *  1. Connect  — OAuth sign-in via Google Identity Services
 *  2. Availability — pulls free/busy for the next N days and shows
 *     daily free-time alongside your planner's scheduled load
 *  3. Work Blocks — create GCal events for scheduled tasks
 *
 * Nothing in this file touches Planner.jsx or any planner state.
 * It reads appData (tasks, preferences) as read-only and writes
 * only to Google Calendar via the REST API.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/gcal.css';

// ── Config ────────────────────────────────────────────────────────────────────
// Paste your OAuth 2.0 Web Client ID from Google Cloud Console here.
// Scopes needed:
//   https://www.googleapis.com/auth/calendar.readonly   (free/busy)
//   https://www.googleapis.com/auth/calendar.events     (create blocks)
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPES    = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const CALENDAR_ID = 'primary'; // which calendar to write work blocks to
const LOOK_AHEAD_DAYS = 28;    // how many days of free/busy to fetch

// ── Helpers ───────────────────────────────────────────────────────────────────
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return toISO(d);
}
function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function minutesToHours(m) { return (m / 60).toFixed(1); }
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

// ── Google token management ───────────────────────────────────────────────────
let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry  = 0;

function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 30_000) return _accessToken;
  return new Promise(async (resolve, reject) => {
    await loadGsiScript();
    if (!_tokenClient) {
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          _accessToken = resp.access_token;
          _tokenExpiry  = Date.now() + (resp.expires_in ?? 3600) * 1000;
          resolve(_accessToken);
        },
      });
    }
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' });
  });
}

function revokeToken() {
  if (_accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(_accessToken);
  }
  _accessToken = null;
  _tokenExpiry  = 0;
  _tokenClient  = null;
}

async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Free/busy fetching ────────────────────────────────────────────────────────
async function fetchFreeBusy(calendarIds, timeMin, timeMax) {
  return gcalFetch('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      items: calendarIds.map(id => ({ id })),
    }),
  });
}

async function fetchCalendarList() {
  return gcalFetch('/users/me/calendarList?maxResults=50');
}

// Given an array of busy intervals on a single day, compute free minutes
// within working hours [workStart, workEnd] (e.g. 9, 17).
function freeMinutesOnDay(isoDate, busyIntervals, workStart = 8, workEnd = 20) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayStart = new Date(`${isoDate}T${String(workStart).padStart(2,'0')}:00:00`);
  const dayEnd   = new Date(`${isoDate}T${String(workEnd).padStart(2,'0')}:00:00`);
  const totalMins = (workEnd - workStart) * 60;

  // Clip each busy block to the working window and accumulate busy minutes
  let busyMins = 0;
  for (const { start, end } of busyIntervals) {
    const s = Math.max(new Date(start).getTime(), dayStart.getTime());
    const e = Math.min(new Date(end).getTime(),   dayEnd.getTime());
    if (e > s) busyMins += (e - s) / 60_000;
  }
  return Math.max(0, totalMins - busyMins);
}

// ── Create work block ────────────────────────────────────────────────────────
async function createWorkBlock(task, isoDate, durationHours, calendarId = CALENDAR_ID) {
  const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Default to 9 AM; you could make this smarter with free/busy data
  const start = new Date(`${isoDate}T09:00:00`);
  const end   = new Date(start.getTime() + durationHours * 3_600_000);
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: `Work on: ${task.name}`,
      description: task.description || '',
      start: { dateTime: start.toISOString(), timeZone: tz },
      end:   { dateTime: end.toISOString(),   timeZone: tz },
      colorId: '2', // sage green — identifiable as a Commitments block
      extendedProperties: {
        private: { commitments_task_id: String(task.id) },
      },
    }),
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GCalSync({ appData }) {
  const { tasks, preferences } = appData;
  const weeklyHours  = preferences?.weekly_hours  ?? 20;

  const [connected,    setConnected]    = useState(false);
  const [connecting,   setConnecting]   = useState(false);
  const [error,        setError]        = useState(null);
  const [clientIdOk,   setClientIdOk]   = useState(!!CLIENT_ID);

  // Free/busy state
  const [freeBusy,     setFreeBusy]     = useState(null);  // { [iso]: freeMinutes }
  const [loadingFB,    setLoadingFB]    = useState(false);
  const [calendars,    setCalendars]    = useState([]);     // user's calendar list
  const [selCals,      setSelCals]      = useState(null);   // Set of cal IDs to include
  const [workStart,    setWorkStart]    = useState(8);
  const [workEnd,      setWorkEnd]      = useState(20);

  // Work blocks state
  const [blockStatus,  setBlockStatus]  = useState({});    // { taskId-iso: 'pending'|'done'|'error' }
  const [activePanel,  setActivePanel]  = useState('availability'); // 'availability' | 'blocks'

  // ── Connect / disconnect ──────────────────────────────────────────────────
  const handleConnect = async () => {
    if (!CLIENT_ID) { setError('No Google Client ID configured. See setup instructions below.'); return; }
    setConnecting(true); setError(null);
    try {
      await getAccessToken();
      setConnected(true);
      // Immediately load the calendar list
      const list = await fetchCalendarList();
      const cals = (list.items || []).filter(c => !c.hidden);
      setCalendars(cals);
      setSelCals(new Set(cals.map(c => c.id)));
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    revokeToken();
    setConnected(false);
    setFreeBusy(null);
    setCalendars([]);
    setSelCals(null);
  };

  // ── Fetch free/busy ───────────────────────────────────────────────────────
  const handleFetchFreeBusy = useCallback(async () => {
    setLoadingFB(true); setError(null);
    try {
      const todayISO = toISO(new Date());
      const endISO   = addDays(todayISO, LOOK_AHEAD_DAYS);
      const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const timeMin  = new Date(todayISO + 'T00:00:00').toISOString();
      const timeMax  = new Date(endISO   + 'T23:59:59').toISOString();

      const calIds = selCals ? [...selCals] : calendars.map(c => c.id);
      if (!calIds.length) throw new Error('No calendars selected.');

      const resp = await fetchFreeBusy(calIds, timeMin, timeMax);

      // Merge busy intervals from all requested calendars
      const busyByDay = {};
      for (const calId of calIds) {
        const busy = resp.calendars?.[calId]?.busy || [];
        for (const interval of busy) {
          const day = interval.start.slice(0, 10);
          if (!busyByDay[day]) busyByDay[day] = [];
          busyByDay[day].push(interval);
        }
      }

      // Compute free minutes per day
      const result = {};
      for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
        const iso = addDays(todayISO, i);
        result[iso] = freeMinutesOnDay(iso, busyByDay[iso] || [], workStart, workEnd);
      }
      setFreeBusy(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFB(false);
    }
  }, [calendars, selCals, workStart, workEnd]);

  // ── Create a work block ───────────────────────────────────────────────────
  const handleCreateBlock = async (task, iso, hrs) => {
    const key = `${task.id}-${iso}`;
    setBlockStatus(s => ({ ...s, [key]: 'pending' }));
    try {
      await createWorkBlock(task, iso, hrs);
      setBlockStatus(s => ({ ...s, [key]: 'done' }));
    } catch (e) {
      setBlockStatus(s => ({ ...s, [key]: 'error' }));
      setError(e.message);
    }
  };

  // ── Derived: scheduled tasks with their days ──────────────────────────────
  const todayISO  = toISO(new Date());
  const scheduled = tasks
    .filter(t => t.status !== 'done' && t.scheduled_days?.some(d => d >= todayISO))
    .map(t => ({
      ...t,
      futureDays: (t.scheduled_days || []).filter(d => d >= todayISO),
    }))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="gcal-pane">
        <div className="gcal-hero">
          <div className="gcal-hero-icon">&#128197;</div>
          <h2>Google Calendar</h2>
          <p>Connect your Google Calendar to see real free time each day and push work blocks directly to your calendar.</p>

          <button
            className="btn btn-primary gcal-connect-btn"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : '🔗 Connect Google Calendar'}
          </button>

          {error && <div className="gcal-error">{error}</div>}
        </div>

        {/* Setup instructions */}
        <div className="gcal-setup">
          <h3>Setup (one-time)</h3>
          <ol>
            <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create or select a project.</li>
            <li>Enable the <strong>Google Calendar API</strong>.</li>
            <li>Under <em>Credentials</em>, create an <strong>OAuth 2.0 Web Client ID</strong>.</li>
            <li>Add your app's origin to <em>Authorized JavaScript origins</em> (e.g. <code>http://localhost:5173</code> and your deployed URL).</li>
            <li>Add <code>VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code> to your <code>.env</code> file and redeploy.</li>
          </ol>
          {!CLIENT_ID && (
            <div className="gcal-warning">
              ⚠️ <code>VITE_GOOGLE_CLIENT_ID</code> is not set. The connect button won't work until you add it.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="gcal-pane">
      {/* Header */}
      <div className="gcal-header">
        <div className="gcal-header-left">
          <span className="gcal-connected-badge">✓ Connected to Google Calendar</span>
        </div>
        <button className="btn btn-sm" onClick={handleDisconnect}>Disconnect</button>
      </div>

      {error && <div className="gcal-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Panel tabs */}
      <div className="gcal-panel-tabs">
        <button
          className={`gcal-panel-tab${activePanel === 'availability' ? ' active' : ''}`}
          onClick={() => setActivePanel('availability')}
        >📊 Availability</button>
        <button
          className={`gcal-panel-tab${activePanel === 'blocks' ? ' active' : ''}`}
          onClick={() => setActivePanel('blocks')}
        >📅 Work Blocks</button>
      </div>

      {/* ── Availability panel ── */}
      {activePanel === 'availability' && (
        <div className="gcal-availability">
          {/* Calendar selector */}
          {calendars.length > 0 && (
            <div className="gcal-cal-selector">
              <div className="gcal-section-label">Calendars to include</div>
              <div className="gcal-cal-list">
                {calendars.map(cal => (
                  <label key={cal.id} className="gcal-cal-item">
                    <input
                      type="checkbox"
                      checked={selCals?.has(cal.id) ?? true}
                      onChange={e => {
                        setSelCals(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(cal.id) : next.delete(cal.id);
                          return next;
                        });
                      }}
                    />
                    <span className="gcal-cal-dot" style={{ background: cal.backgroundColor || '#888' }} />
                    <span>{cal.summary}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Working hours */}
          <div className="gcal-working-hours">
            <div className="gcal-section-label">Working window</div>
            <div className="gcal-hours-row">
              <label>
                From
                <select value={workStart} onChange={e => setWorkStart(+e.target.value)}>
                  {Array.from({length: 24}, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i-12}pm`}</option>
                  ))}
                </select>
              </label>
              <label>
                To
                <select value={workEnd} onChange={e => setWorkEnd(+e.target.value)}>
                  {Array.from({length: 24}, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i-12}pm`}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary btn-sm" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                {loadingFB ? 'Loading…' : '↻ Refresh'}
              </button>
            </div>
          </div>

          {/* Results */}
          {!freeBusy ? (
            <div className="gcal-empty">
              <button className="btn btn-primary" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                {loadingFB ? 'Loading…' : '📊 Load my availability'}
              </button>
              <p>Fetches only busy/free status — no event details are read.</p>
            </div>
          ) : (
            <div className="gcal-fb-grid">
              {Object.entries(freeBusy).map(([iso, freeMin]) => {
                const freeH   = freeMin / 60;
                const capacity = workEnd - workStart;
                const pct     = Math.round((freeH / capacity) * 100);
                const isToday = iso === todayISO;
                const isPast  = iso < todayISO;
                // Planned hours from planner
                const planH   = tasks.reduce((sum, t) => {
                  const dayHrs = (t.scheduled_day_hours || {})[iso];
                  if (dayHrs !== undefined) return sum + dayHrs;
                  const rem        = remainingHours(t);
                  const futureDays = (t.scheduled_days || []).filter(d => d >= todayISO);
                  if (!futureDays.includes(iso)) return sum;
                  const expTotal   = futureDays.reduce((s, d) => s + ((t.scheduled_day_hours||{})[d]||0), 0);
                  const unw        = futureDays.filter(d => !(t.scheduled_day_hours||{})[d]);
                  return sum + (unw.length ? Math.max(rem - expTotal, 0) / unw.length : 0);
                }, 0);
                const overcommitted = planH > freeH + 0.1;

                return (
                  <div key={iso} className={`gcal-fb-row${isToday ? ' gcal-today' : ''}${isPast ? ' gcal-past' : ''}${overcommitted ? ' gcal-over' : ''}`}>
                    <div className="gcal-fb-date">{fmtShort(iso)}</div>
                    <div className="gcal-fb-bar-wrap">
                      <div className="gcal-fb-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
                      {planH > 0.05 && (
                        <div
                          className={`gcal-fb-plan-bar${overcommitted ? ' over' : ''}`}
                          style={{ width: `${Math.min((planH / capacity) * 100, 100)}%` }}
                          title={`${planH.toFixed(1)}h planned`}
                        />
                      )}
                    </div>
                    <div className="gcal-fb-label">
                      <span className="gcal-fb-free">{freeH.toFixed(1)}h free</span>
                      {planH > 0.05 && (
                        <span className={`gcal-fb-planned${overcommitted ? ' over' : ''}`}>
                          {planH.toFixed(1)}h planned
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Work Blocks panel ── */}
      {activePanel === 'blocks' && (
        <div className="gcal-blocks">
          <p className="gcal-blocks-intro">
            Push scheduled tasks to Google Calendar as work blocks.
            Each block is created at 9 AM on the scheduled day — you can drag it in GCal afterwards.
          </p>

          {scheduled.length === 0 ? (
            <div className="gcal-empty">No upcoming scheduled tasks. Schedule some in the Planner first.</div>
          ) : (
            scheduled.map(task => (
              <div key={task.id} className="gcal-task-block">
                <div className="gcal-task-name">{task.name}</div>
                {task.due_date && <div className="gcal-task-due">Due {fmtShort(task.due_date)}</div>}
                <div className="gcal-task-days">
                  {task.futureDays.slice(0, 14).map(iso => {
                    const key    = `${task.id}-${iso}`;
                    const status = blockStatus[key];
                    const hrs    = (() => {
                      const dayHrs = (task.scheduled_day_hours || {})[iso];
                      if (dayHrs !== undefined) return dayHrs;
                      const rem      = remainingHours(task);
                      const future   = task.futureDays;
                      const expTotal = future.reduce((s, d) => s + ((task.scheduled_day_hours||{})[d]||0), 0);
                      const unw      = future.filter(d => !(task.scheduled_day_hours||{})[d]);
                      return unw.length ? Math.max(rem - expTotal, 0) / unw.length : 0;
                    })();
                    return (
                      <div key={iso} className="gcal-day-row">
                        <span className="gcal-day-label">{fmtShort(iso)}</span>
                        <span className="gcal-day-hrs">{hrs.toFixed(1)}h</span>
                        <button
                          className={`gcal-push-btn${status === 'done' ? ' done' : status === 'error' ? ' error' : ''}`}
                          onClick={() => handleCreateBlock(task, iso, hrs)}
                          disabled={status === 'pending' || status === 'done'}
                        >
                          {status === 'pending' ? '…' :
                           status === 'done'    ? '✓ Added' :
                           status === 'error'   ? '✕ Retry' :
                           '+ Add to GCal'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
