/**
 * GCalSync — Google Calendar integration tab
 *
 * Fixes in this version:
 *  - Token + connection state persisted to localStorage; survives tab switches
 *  - Silent re-auth on mount if a valid token is cached
 *  - Calc settings: working window, flat daily deduction, per-event buffer, efficiency %
 *  - All settings persisted to localStorage
 */
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/gcal.css';

// ── Config ────────────────────────────────────────────────────────────────────
const CLIENT_ID       = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPES          = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const CALENDAR_ID     = 'primary';
const LOOK_AHEAD_DAYS = 28;
const LS_TOKEN_KEY    = 'gcal_access_token';
const LS_EXPIRY_KEY   = 'gcal_token_expiry';
const LS_SETTINGS_KEY = 'gcal_calc_settings';
const LS_CALS_KEY     = 'gcal_selected_cals';

// ── Helpers ───────────────────────────────────────────────────────────────────
function toISO(d) { return d.toISOString().slice(0, 10); }
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

// ── Default calc settings ────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  workStart:    8,    // hour 0-23
  workEnd:      20,   // hour 0-23
  deductMins:   60,   // flat daily deduction (lunch + overhead), minutes
  bufferMins:   10,   // padding added before+after each calendar event, minutes
  efficiency:   85,   // % of remaining free time actually available for deep work
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) {
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(s));
}

// ── Token persistence ────────────────────────────────────────────────────────
// Module-level token mirrors localStorage so we don't re-parse on every call.
let _tokenClient = null;
let _accessToken = localStorage.getItem(LS_TOKEN_KEY) || null;
let _tokenExpiry  = parseInt(localStorage.getItem(LS_EXPIRY_KEY) || '0', 10);

function persistToken(token, expiresIn) {
  _accessToken = token;
  _tokenExpiry  = Date.now() + (expiresIn ?? 3600) * 1000;
  localStorage.setItem(LS_TOKEN_KEY,  token);
  localStorage.setItem(LS_EXPIRY_KEY, String(_tokenExpiry));
}
function clearToken() {
  _accessToken = null;
  _tokenExpiry  = 0;
  _tokenClient  = null;
  localStorage.removeItem(LS_TOKEN_KEY);
  localStorage.removeItem(LS_EXPIRY_KEY);
}
export function hasValidCachedToken() {
  return !!_accessToken && Date.now() < _tokenExpiry - 30_000;
}

function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src     = 'https://accounts.google.com/gsi/client';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// If prompt='' and a valid session exists on Google's side, this resolves
// silently (no popup). If not, it falls back to the popup.
async function getAccessToken(forceConsent = false) {
  if (!forceConsent && hasValidCachedToken()) return _accessToken;
  return new Promise(async (resolve, reject) => {
    await loadGsiScript();
    if (!_tokenClient) {
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          persistToken(resp.access_token, resp.expires_in);
          resolve(resp.access_token);
        },
      });
    }
    // prompt: '' = silent if Google still has a session; 'consent' = force UI
    _tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
  });
}

function revokeToken() {
  if (_accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(_accessToken);
  }
  clearToken();
}

async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: {
      Authorization:  `Bearer ${token}`,
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

// ── Free/busy ────────────────────────────────────────────────────────────────
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

/**
 * Compute effective free minutes on a day after applying all calc settings.
 *
 * Pipeline:
 *  1. Clip busy intervals to working window
 *  2. Expand each busy interval by bufferMins on each side (then merge overlaps)
 *  3. Sum buffered-busy minutes
 *  4. Subtract flat deduction (lunch/overhead)
 *  5. Multiply by efficiency %
 */
function effectiveFreeMinutes(isoDate, busyIntervals, settings) {
  const { workStart, workEnd, deductMins, bufferMins, efficiency } = settings;
  const winStart = new Date(`${isoDate}T${String(workStart).padStart(2,'0')}:00:00`).getTime();
  const winEnd   = new Date(`${isoDate}T${String(workEnd  ).padStart(2,'0')}:00:00`).getTime();
  const winMins  = (winEnd - winStart) / 60_000;

  // 1+2. Expand + clip each interval, then merge
  const bufMs = bufferMins * 60_000;
  const expanded = busyIntervals
    .map(({ start, end }) => ({
      s: Math.max(new Date(start).getTime() - bufMs, winStart),
      e: Math.min(new Date(end  ).getTime() + bufMs, winEnd),
    }))
    .filter(({ s, e }) => e > s)
    .sort((a, b) => a.s - b.s);

  // Merge overlapping intervals
  const merged = [];
  for (const iv of expanded) {
    if (merged.length && iv.s <= merged[merged.length - 1].e) {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
    } else {
      merged.push({ ...iv });
    }
  }

  // 3. Busy minutes after buffering
  const busyMins = merged.reduce((sum, { s, e }) => sum + (e - s) / 60_000, 0);

  // 4. Subtract deduction, floor at 0
  const afterDeduct = Math.max(0, winMins - busyMins - deductMins);

  // 5. Efficiency
  return afterDeduct * (efficiency / 100);
}

// ── Create work block ────────────────────────────────────────────────────────
async function createWorkBlock(task, isoDate, durationHours) {
  const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(`${isoDate}T09:00:00`);
  const end   = new Date(start.getTime() + durationHours * 3_600_000);
  return gcalFetch(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary:     `Work on: ${task.name}`,
      description: task.description || '',
      start: { dateTime: start.toISOString(), timeZone: tz },
      end:   { dateTime: end.toISOString(),   timeZone: tz },
      colorId: '2',
      extendedProperties: { private: { commitments_task_id: String(task.id) } },
    }),
  });
}

// ── Hour label ────────────────────────────────────────────────────────────────
function hrLabel(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GCalSync({ appData }) {
  const { tasks } = appData;
  const todayISO  = toISO(new Date());

  // ── Persistent connection state ───────────────────────────────────────────
  const [connected,  setConnected]  = useState(hasValidCachedToken);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState(null);

  // ── Calc settings (persisted) ─────────────────────────────────────────────
  const [settings,     setSettings]     = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  const updateSetting = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      saveSettings(next);
      return next;
    });
  };

  // ── Calendar list (persisted via localStorage for display; refetched on connect) ──
  const [calendars, setCalendars] = useState([]);
  const [selCals,   setSelCals]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_CALS_KEY) || 'null') || []); }
    catch { return new Set(); }
  });

  // ── Free/busy ────────────────────────────────────────────────────────────
  const [freeBusy,  setFreeBusy]  = useState(null);
  const [loadingFB, setLoadingFB] = useState(false);

  // ── Work blocks ──────────────────────────────────────────────────────────
  const [blockStatus, setBlockStatus] = useState({});
  const [activePanel, setActivePanel] = useState('availability');

  // ── On mount: if token is cached, quietly reload the calendar list ────────
  useEffect(() => {
    if (!connected || !CLIENT_ID) return;
    fetchCalendarList()
      .then(list => {
        const cals = (list.items || []).filter(c => !c.hidden);
        setCalendars(cals);
        // If we have no saved selection yet, select all
        setSelCals(prev => {
          if (prev.size > 0) return prev;
          const all = new Set(cals.map(c => c.id));
          localStorage.setItem(LS_CALS_KEY, JSON.stringify([...all]));
          return all;
        });
      })
      .catch(() => {}); // silently ignore if token expired mid-session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    if (!CLIENT_ID) { setError('No Google Client ID configured. See setup instructions below.'); return; }
    setConnecting(true); setError(null);
    try {
      await getAccessToken(true); // force consent so user explicitly approves
      setConnected(true);
      const list = await fetchCalendarList();
      const cals = (list.items || []).filter(c => !c.hidden);
      setCalendars(cals);
      const all = new Set(cals.map(c => c.id));
      setSelCals(all);
      localStorage.setItem(LS_CALS_KEY, JSON.stringify([...all]));
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    revokeToken();
    localStorage.removeItem(LS_CALS_KEY);
    setConnected(false);
    setCalendars([]);
    setSelCals(new Set());
    setFreeBusy(null);
  };

  // ── Fetch free/busy ───────────────────────────────────────────────────────
  const handleFetchFreeBusy = useCallback(async () => {
    setLoadingFB(true); setError(null);
    try {
      const endISO  = addDays(todayISO, LOOK_AHEAD_DAYS);
      const timeMin = new Date(todayISO + 'T00:00:00').toISOString();
      const timeMax = new Date(endISO   + 'T23:59:59').toISOString();
      const calIds  = selCals.size > 0 ? [...selCals] : calendars.map(c => c.id);
      if (!calIds.length) throw new Error('No calendars selected.');

      const resp = await fetchFreeBusy(calIds, timeMin, timeMax);

      // Merge busy intervals across all calendars, keyed by day
      const busyByDay = {};
      for (const calId of calIds) {
        for (const interval of (resp.calendars?.[calId]?.busy || [])) {
          const day = interval.start.slice(0, 10);
          (busyByDay[day] ??= []).push(interval);
        }
      }

      const result = {};
      for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
        const iso = addDays(todayISO, i);
        result[iso] = effectiveFreeMinutes(iso, busyByDay[iso] || [], settings);
      }
      setFreeBusy(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFB(false);
    }
  }, [calendars, selCals, settings, todayISO]);

  // ── Create work block ─────────────────────────────────────────────────────
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const scheduled = tasks
    .filter(t => t.status !== 'done' && t.scheduled_days?.some(d => d >= todayISO))
    .map(t => ({ ...t, futureDays: (t.scheduled_days || []).filter(d => d >= todayISO) }))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  // ── Disconnected screen ───────────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="gcal-pane">
        <div className="gcal-hero">
          <div className="gcal-hero-icon">&#128197;</div>
          <h2>Google Calendar</h2>
          <p>Connect your Google Calendar to see real free time each day and push work blocks directly to your calendar.</p>
          <button className="btn btn-primary gcal-connect-btn" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Connecting…' : '🔗 Connect Google Calendar'}
          </button>
          {error && <div className="gcal-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="gcal-setup">
          <h3>Setup (one-time)</h3>
          <ol>
            <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create or select a project.</li>
            <li>Enable the <strong>Google Calendar API</strong>.</li>
            <li>Under <em>Credentials</em>, create an <strong>OAuth 2.0 Web Client ID</strong>.</li>
            <li>Add your app origin to <em>Authorized JavaScript origins</em> (e.g. <code>http://localhost:5173</code> and your deployed URL).</li>
            <li>Add <code>VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code> to your <code>.env</code> file and redeploy.</li>
          </ol>
          {!CLIENT_ID && (
            <div className="gcal-warning">⚠️ <code>VITE_GOOGLE_CLIENT_ID</code> is not set.</div>
          )}
        </div>
      </div>
    );
  }

  // ── Connected screen ──────────────────────────────────────────────────────
  const { workStart, workEnd, deductMins, bufferMins, efficiency } = settings;
  const windowH = workEnd - workStart;

  return (
    <div className="gcal-pane">
      {/* Header */}
      <div className="gcal-header">
        <span className="gcal-connected-badge">✓ Connected to Google Calendar</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setShowSettings(s => !s)}>
            ⚙ Settings
          </button>
          <button className="btn btn-sm" onClick={handleDisconnect}>Disconnect</button>
        </div>
      </div>

      {error && <div className="gcal-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ── Calc settings panel ── */}
      {showSettings && (
        <div className="gcal-settings-panel">
          <div className="gcal-settings-grid">

            {/* Working window */}
            <div className="gcal-setting-group">
              <div className="gcal-section-label">Working window</div>
              <div className="gcal-hours-row">
                <label>From
                  <select value={workStart} onChange={e => updateSetting('workStart', +e.target.value)}>
                    {Array.from({length: 24}, (_, i) => <option key={i} value={i}>{hrLabel(i)}</option>)}
                  </select>
                </label>
                <label>To
                  <select value={workEnd} onChange={e => updateSetting('workEnd', +e.target.value)}>
                    {Array.from({length: 24}, (_, i) => <option key={i} value={i}>{hrLabel(i)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* Flat daily deduction */}
            <div className="gcal-setting-group">
              <div className="gcal-section-label">Daily deduction <span className="gcal-setting-hint">(lunch, overhead, life)</span></div>
              <div className="gcal-hours-row">
                <input
                  type="number" min={0} max={480} step={5}
                  value={deductMins}
                  onChange={e => updateSetting('deductMins', +e.target.value)}
                  style={{ width: 70 }}
                />
                <span className="gcal-setting-unit">minutes/day</span>
              </div>
              <div className="gcal-setting-preview">
                = {(deductMins / 60).toFixed(1)}h subtracted before anything else
              </div>
            </div>

            {/* Event buffer */}
            <div className="gcal-setting-group">
              <div className="gcal-section-label">Event buffer <span className="gcal-setting-hint">(context-switching time)</span></div>
              <div className="gcal-hours-row">
                <input
                  type="number" min={0} max={60} step={5}
                  value={bufferMins}
                  onChange={e => updateSetting('bufferMins', +e.target.value)}
                  style={{ width: 70 }}
                />
                <span className="gcal-setting-unit">min before &amp; after each event</span>
              </div>
            </div>

            {/* Efficiency */}
            <div className="gcal-setting-group">
              <div className="gcal-section-label">Efficiency <span className="gcal-setting-hint">(of remaining free time)</span></div>
              <div className="gcal-efficiency-row">
                <input
                  type="range" min={10} max={100} step={5}
                  value={efficiency}
                  onChange={e => updateSetting('efficiency', +e.target.value)}
                  className="gcal-slider"
                />
                <span className="gcal-efficiency-val">{efficiency}%</span>
              </div>
              <div className="gcal-setting-preview">
                e.g. a day with 6h free → {(6 * efficiency / 100).toFixed(1)}h usable
              </div>
            </div>

          </div>

          {/* Calendar selector */}
          {calendars.length > 0 && (
            <div className="gcal-setting-group" style={{ marginTop: 16 }}>
              <div className="gcal-section-label">Calendars to include</div>
              <div className="gcal-cal-list">
                {calendars.map(cal => (
                  <label key={cal.id} className="gcal-cal-item">
                    <input
                      type="checkbox"
                      checked={selCals.has(cal.id)}
                      onChange={e => {
                        setSelCals(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(cal.id) : next.delete(cal.id);
                          localStorage.setItem(LS_CALS_KEY, JSON.stringify([...next]));
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

          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 14 }}
            onClick={() => { setShowSettings(false); handleFetchFreeBusy(); }}
          >↻ Apply &amp; Refresh</button>
        </div>
      )}

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
          {/* Settings summary pill */}
          <div className="gcal-settings-summary">
            {hrLabel(workStart)}–{hrLabel(workEnd)} window
            {deductMins > 0 && ` · −${deductMins}m deduction`}
            {bufferMins > 0 && ` · ${bufferMins}m event buffer`}
            {efficiency < 100 && ` · ${efficiency}% efficiency`}
            <button className="gcal-settings-edit" onClick={() => setShowSettings(s => !s)}>edit</button>
          </div>

          {!freeBusy ? (
            <div className="gcal-empty">
              <button className="btn btn-primary" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                {loadingFB ? 'Loading…' : '📊 Load my availability'}
              </button>
              <p>Fetches only busy/free status — no event details are read.</p>
            </div>
          ) : (
            <>
              <div className="gcal-fb-refresh-row">
                <button className="btn btn-sm" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                  {loadingFB ? 'Loading…' : '↻ Refresh'}
                </button>
              </div>
              <div className="gcal-fb-grid">
                {Object.entries(freeBusy).map(([iso, freeMin]) => {
                  const freeH   = freeMin / 60;
                  const pct     = Math.round((freeH / windowH) * 100);
                  const isToday = iso === todayISO;
                  const isPast  = iso < todayISO;

                  const planH = tasks.reduce((sum, t) => {
                    const dayHrs = (t.scheduled_day_hours || {})[iso];
                    if (dayHrs !== undefined) return sum + dayHrs;
                    const rem        = remainingHours(t);
                    const futureDays = (t.scheduled_days || []).filter(d => d >= todayISO);
                    if (!futureDays.includes(iso)) return sum;
                    const expTotal   = futureDays.reduce((s, d) => s + ((t.scheduled_day_hours||{})[d]||0), 0);
                    const unw        = futureDays.filter(d => !(t.scheduled_day_hours||{})[d]);
                    return sum + (unw.length ? Math.max(rem - expTotal, 0) / unw.length : 0);
                  }, 0);
                  const overcommitted = planH > freeH + 0.05;

                  return (
                    <div key={iso} className={
                      `gcal-fb-row${isToday ? ' gcal-today' : ''}${isPast ? ' gcal-past' : ''}${overcommitted ? ' gcal-over' : ''}`
                    }>
                      <div className="gcal-fb-date">{fmtShort(iso)}</div>
                      <div className="gcal-fb-bar-wrap">
                        <div className="gcal-fb-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
                        {planH > 0.05 && (
                          <div
                            className={`gcal-fb-plan-bar${overcommitted ? ' over' : ''}`}
                            style={{ width: `${Math.min((planH / windowH) * 100, 100)}%` }}
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
            </>
          )}
        </div>
      )}

      {/* ── Work Blocks panel ── */}
      {activePanel === 'blocks' && (
        <div className="gcal-blocks">
          <p className="gcal-blocks-intro">
            Push scheduled tasks to Google Calendar as work blocks.
            Each block is created at 9 AM — drag it to the right time in GCal afterwards.
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
                    const hrs = (() => {
                      const dh = (task.scheduled_day_hours || {})[iso];
                      if (dh !== undefined) return dh;
                      const rem  = remainingHours(task);
                      const exp  = task.futureDays.reduce((s, d) => s + ((task.scheduled_day_hours||{})[d]||0), 0);
                      const unw  = task.futureDays.filter(d => !(task.scheduled_day_hours||{})[d]);
                      return unw.length ? Math.max(rem - exp, 0) / unw.length : 0;
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
