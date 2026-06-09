/**
 * GCalSync — Google Calendar integration tab
 *
 * Changes in this version:
 *  - All emoji replaced with inline SVG icons
 *  - Mobile-responsive layout fixes
 *  - Calls appData.onFreeBusyUpdate(result) after each successful free/busy fetch
 *  - Calls appData.onFreeBusyClear() on disconnect
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── SVG icons ─────────────────────────────────────────────────────────────────
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
  workStart:   8,
  workEnd:     20,
  deductMins:  60,
  bufferMins:  10,
  efficiency:  85,
  nonWorkDays: [],
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

function effectiveFreeMinutes(isoDate, busyIntervals, settings) {
  const { workStart, workEnd, deductMins, bufferMins, efficiency, nonWorkDays } = settings;
  const dowIndex = new Date(isoDate + 'T00:00:00').getDay();
  if ((nonWorkDays || []).includes(dowIndex)) return 0;
  const winStart = new Date(`${isoDate}T${String(workStart).padStart(2,'0')}:00:00`).getTime();
  const winEnd   = new Date(`${isoDate}T${String(workEnd  ).padStart(2,'0')}:00:00`).getTime();
  const winMins  = (winEnd - winStart) / 60_000;
  const bufMs = bufferMins * 60_000;
  const expanded = busyIntervals
    .map(({ start, end }) => ({
      s: Math.max(new Date(start).getTime() - bufMs, winStart),
      e: Math.min(new Date(end  ).getTime() + bufMs, winEnd),
    }))
    .filter(({ s, e }) => e > s)
    .sort((a, b) => a.s - b.s);
  const merged = [];
  for (const iv of expanded) {
    if (merged.length && iv.s <= merged[merged.length - 1].e)
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
    else merged.push({ ...iv });
  }
  const busyMins    = merged.reduce((sum, { s, e }) => sum + (e - s) / 60_000, 0);
  const afterDeduct = Math.max(0, winMins - busyMins - deductMins);
  return afterDeduct * (efficiency / 100);
}

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

function hrLabel(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GCalSync({ appData }) {
  const { tasks, onFreeBusyUpdate, onFreeBusyClear } = appData;
  const todayISO = toISO(new Date());

  const [connected,  setConnected]  = useState(hasValidCachedToken);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState(null);

  const [settings,     setSettings]     = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  const updateSetting = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      saveSettings(next);
      return next;
    });
  };

  const [calendars, setCalendars] = useState([]);
  const [selCals,   setSelCals]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_CALS_KEY) || 'null') || []); }
    catch { return new Set(); }
  });

  const [freeBusy,    setFreeBusy]    = useState(null);
  const [loadingFB,   setLoadingFB]   = useState(false);
  const [blockStatus, setBlockStatus] = useState({});
  const [activePanel, setActivePanel] = useState('availability');

  useEffect(() => {
    if (!connected || !CLIENT_ID) return;
    fetchCalendarList()
      .then(list => {
        const cals = (list.items || []).filter(c => !c.hidden);
        setCalendars(cals);
        setSelCals(prev => {
          if (prev.size > 0) return prev;
          const all = new Set(cals.map(c => c.id));
          localStorage.setItem(LS_CALS_KEY, JSON.stringify([...all]));
          return all;
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const handleConnect = async () => {
    if (!CLIENT_ID) { setError('No Google Client ID configured. See setup instructions below.'); return; }
    setConnecting(true); setError(null);
    try {
      await getAccessToken(true);
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
    onFreeBusyClear?.();
  };

  const handleFetchFreeBusy = useCallback(async () => {
    setLoadingFB(true); setError(null);
    try {
      const endISO  = addDays(todayISO, LOOK_AHEAD_DAYS);
      const timeMin = new Date(todayISO + 'T00:00:00').toISOString();
      const timeMax = new Date(endISO   + 'T23:59:59').toISOString();
      const calIds  = selCals.size > 0 ? [...selCals] : calendars.map(c => c.id);
      if (!calIds.length) throw new Error('No calendars selected.');
      const resp = await fetchFreeBusy(calIds, timeMin, timeMax);
      const busyByDay = {};
      for (const calId of calIds)
        for (const interval of (resp.calendars?.[calId]?.busy || []))
          (busyByDay[interval.start.slice(0, 10)] ??= []).push(interval);
      const result = {};
      for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
        const iso = addDays(todayISO, i);
        result[iso] = effectiveFreeMinutes(iso, busyByDay[iso] || [], settings);
      }
      setFreeBusy(result);
      onFreeBusyUpdate?.(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFB(false);
    }
  }, [calendars, selCals, settings, todayISO, onFreeBusyUpdate]);

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

  const scheduled = tasks
    .filter(t => t.status !== 'done' && t.scheduled_days?.some(d => d >= todayISO))
    .map(t => ({ ...t, futureDays: (t.scheduled_days || []).filter(d => d >= todayISO) }))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  // ── Disconnected screen ───────────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="gcal-pane">
        <div className="gcal-hero">
          <div className="gcal-hero-icon">
            <IconCalendar size={48} />
          </div>
          <h2>Google Calendar</h2>
          <p>Connect your Google Calendar to see real free time each day and push work blocks directly to your calendar.</p>
          <button className="btn btn-primary gcal-connect-btn" onClick={handleConnect} disabled={connecting}>
            <IconLink size={15} style={{ marginRight: 7, verticalAlign: 'middle' }} />
            {connecting ? 'Connecting…' : 'Connect Google Calendar'}
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
            <div className="gcal-warning">
              <IconWarning size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              <code>VITE_GOOGLE_CLIENT_ID</code> is not set.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Connected screen ──────────────────────────────────────────────────────
  const { workStart, workEnd, deductMins, bufferMins, efficiency, nonWorkDays } = settings;
  const windowH = workEnd - workStart;

  const toggleNonWorkDay = (dowIndex) => {
    const current = nonWorkDays || [];
    const next = current.includes(dowIndex)
      ? current.filter(d => d !== dowIndex)
      : [...current, dowIndex];
    updateSetting('nonWorkDays', next);
  };

  return (
    <div className="gcal-pane">
      <div className="gcal-header">
        <span className="gcal-connected-badge">
          <IconCheck size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Connected to Google Calendar
        </span>
        <div className="gcal-header-actions">
          <button className="btn btn-sm" onClick={() => setShowSettings(s => !s)}>
            <IconGear size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Settings
          </button>
          <button className="btn btn-sm" onClick={handleDisconnect}>Disconnect</button>
        </div>
      </div>

      {error && <div className="gcal-error" style={{ marginBottom: 12 }}>{error}</div>}

      {showSettings && (
        <div className="gcal-settings-panel">
          <div className="gcal-settings-grid">

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

          {calendars.length > 0 && (
            <div className="gcal-setting-group" style={{ marginTop: 16 }}>
              <div className="gcal-section-label">Calendars to include</div>
              <div className="gcal-cal-list">
                {calendars.map(cal => (
                  <label key={cal.id} className="gcal-cal-item">
                    <input type="checkbox"
                      checked={selCals.has(cal.id)}
                      onChange={e => {
                        setSelCals(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(cal.id) : next.delete(cal.id);
                          localStorage.setItem(LS_CALS_KEY, JSON.stringify([...next]));
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
        <div className="gcal-availability">
          <div className="gcal-settings-summary">
            {hrLabel(workStart)}–{hrLabel(workEnd)} window
            {(nonWorkDays || []).length > 0 && ` · ${DAY_NAMES.filter((_, i) => nonWorkDays.includes(i)).join('/')} off`}
            {deductMins > 0 && ` · −${deductMins}m deduction`}
            {bufferMins > 0 && ` · ${bufferMins}m event buffer`}
            {efficiency < 100 && ` · ${efficiency}% efficiency`}
            <button className="gcal-settings-edit" onClick={() => setShowSettings(s => !s)}>edit</button>
          </div>

          {!freeBusy ? (
            <div className="gcal-empty">
              <button className="btn btn-primary" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                <IconBarChart size={14} style={{ marginRight: 7, verticalAlign: 'middle' }} />
                {loadingFB ? 'Loading…' : 'Load my availability'}
              </button>
              <p>Fetches only busy/free status — no event details are read.</p>
            </div>
          ) : (
            <>
              <div className="gcal-fb-refresh-row">
                <button className="btn btn-sm" onClick={handleFetchFreeBusy} disabled={loadingFB}>
                  <IconRefresh size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                  {loadingFB ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              <div className="gcal-fb-grid">
                {Object.entries(freeBusy).map(([iso, freeMin]) => {
                  const freeH   = freeMin / 60;
                  const pct     = Math.round((freeH / windowH) * 100);
                  const isToday = iso === todayISO;
                  const isPast  = iso < todayISO;
                  const isOff   = (nonWorkDays || []).includes(new Date(iso + 'T00:00:00').getDay());
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
                      `gcal-fb-row${isToday ? ' gcal-today' : ''}${isPast ? ' gcal-past' : ''}${overcommitted ? ' gcal-over' : ''}${isOff ? ' gcal-day-off' : ''}`
                    }>
                      <div className="gcal-fb-date">
                        {fmtShort(iso)}
                        {isOff && <span className="gcal-off-badge">off</span>}
                      </div>
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
                      const rem = remainingHours(task);
                      const exp = task.futureDays.reduce((s, d) => s + ((task.scheduled_day_hours||{})[d]||0), 0);
                      const unw = task.futureDays.filter(d => !(task.scheduled_day_hours||{})[d]);
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
                           status === 'done'    ? 'Added' :
                           status === 'error'   ? 'Retry' :
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
