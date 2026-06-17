/**
 * gcalScheduler.js
 *
 * Shared Google Calendar scheduling logic used by GCalSync and Planner.
 *
 * AUTH MODEL (v2 — server-side OAuth code flow):
 *   The old GIS implicit token flow (initTokenClient) is replaced with a
 *   proper authorization code flow.  Tokens are stored server-side in
 *   Supabase (gcal_tokens table) by the gcal-auth edge function.
 *
 *   connectGcal()      — redirects user to Google OAuth consent screen
 *   getAccessToken()   — calls gcal-token edge function; returns a fresh
 *                        access token, transparently refreshing via the
 *                        stored refresh token when needed
 *   disconnectGcal()   — calls gcal-revoke edge function, deletes DB row
 *   isGcalConnected()  — async check against gcal-token; returns boolean
 *
 *   startSilentTokenRefresh / stopSilentTokenRefresh are removed entirely;
 *   the edge function handles token freshness on every call.
 *
 * SCOPE STRATEGY — sensitive tier only (no CASA security audit required):
 *   calendar.readonly  — read calendar list, events, free/busy
 *   calendar.events    — create / update / delete events this app created
 *
 * WRITE CALENDAR MODEL (two-tier):
 *   Preferred: user manually creates a dedicated calendar (e.g. "Commitments
 *   Work Blocks") in Google Calendar, then selects it here via the Phase 2
 *   UI.  The free/busy query omits that calendar entirely.
 *
 *   Fallback: user writes to primary (or any shared calendar).  App-written
 *   events are identified by the private extended property
 *   `commitments_task_id: "true"` and subtracted from busy intervals before
 *   availability is calculated.
 */

import { supabase } from './supabase.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

// Sensitive scopes only — no restricted `calendar` scope.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

// Redirect URI must match what is registered in Google Cloud Console and
// set as GCAL_REDIRECT_URI in Supabase edge function secrets.
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gcal-auth`;

export const CALENDAR_ID = 'primary';

export const LS_SETTINGS_KEY  = 'gcal_calc_settings';
export const LS_CALS_KEY      = 'gcal_selected_cals';
export const LS_PUSH_REGISTRY = 'gcal_push_registry';

/**
 * LS_WRITE_CAL_KEY — persists the calendar ID the user has chosen as the
 * write target for Commitments work-block events.
 *
 * We intentionally reuse the same localStorage key that was previously used
 * for LS_COMMITMENTS_CAL_KEY ('gcal_commitments_cal_id') so that existing
 * users who already had a dedicated calendar selected don't lose that
 * setting on upgrade.
 */
export const LS_WRITE_CAL_KEY       = 'gcal_commitments_cal_id';
export const LS_COMMITMENTS_CAL_KEY = LS_WRITE_CAL_KEY;

const MIN_CHUNK_HOURS = 0.5;

// ── Default settings ──────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  workWindows: [{ start: 8, end: 20 }],
  deductMins:  60,
  bufferMins:  10,
  efficiency:  85,
  nonWorkDays: [],
};

export function loadGcalSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate legacy single workStart/workEnd format
      if (!parsed.workWindows && (parsed.workStart !== undefined || parsed.workEnd !== undefined)) {
        parsed.workWindows = [{ start: parsed.workStart ?? 8, end: parsed.workEnd ?? 20 }];
        delete parsed.workStart;
        delete parsed.workEnd;
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveGcalSettings(s) {
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(s));
}

export function loadSelectedCals() {
  try {
    const raw = localStorage.getItem(LS_CALS_KEY);
    if (raw) return new Set(JSON.parse(raw) || []);
  } catch {}
  return new Set();
}

export function saveSelectedCals(set) {
  localStorage.setItem(LS_CALS_KEY, JSON.stringify([...set]));
}

// ── Write-calendar helpers ────────────────────────────────────────────────────
/** Returns the user-selected write calendar ID, or 'primary' as fallback. */
export function loadWriteCalId() {
  return localStorage.getItem(LS_WRITE_CAL_KEY) || 'primary';
}

/** Persists the user's chosen write calendar ID. */
export function saveWriteCalId(id) {
  if (id) localStorage.setItem(LS_WRITE_CAL_KEY, id);
  else    localStorage.removeItem(LS_WRITE_CAL_KEY);
}

/** Clears the write calendar selection (reverts to 'primary' fallback). */
export function clearWriteCalId() {
  localStorage.removeItem(LS_WRITE_CAL_KEY);
}

// Legacy shims
export const loadCommitmentsCalId  = loadWriteCalId;
export const saveCommitmentsCalId  = saveWriteCalId;
export const clearCommitmentsCalId = clearWriteCalId;

/**
 * ensureCommitmentsCalendar — kept as a no-op shim so any component that
 * imports and awaits it doesn't break.
 */
export async function ensureCommitmentsCalendar() {
  return loadWriteCalId();
}

// ── Push registry ─────────────────────────────────────────────────────────────
function _savePushRegistry(reg) {
  localStorage.setItem(LS_PUSH_REGISTRY, JSON.stringify(reg));
}
export function getPushRegistry() {
  try {
    const raw = localStorage.getItem(LS_PUSH_REGISTRY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
export function getPushEntry(taskId, isoDate) {
  return getPushRegistry()[`${taskId}|${isoDate}`] || null;
}
export function setPushEntry(taskId, isoDate, eventId, hours, eventIds) {
  const reg = getPushRegistry();
  reg[`${taskId}|${isoDate}`] = { eventId, eventIds: eventIds || [eventId], hours };
  _savePushRegistry(reg);
}
export function clearPushEntry(taskId, isoDate) {
  const reg = getPushRegistry();
  delete reg[`${taskId}|${isoDate}`];
  _savePushRegistry(reg);
}
export function clearPushEntriesForTask(taskId) {
  const reg = getPushRegistry();
  const prefix = `${taskId}|`;
  for (const key of Object.keys(reg)) {
    if (key.startsWith(prefix)) delete reg[key];
  }
  _savePushRegistry(reg);
}
export function seedPushStatusFromRegistry(isoList) {
  const reg = getPushRegistry();
  const pushedDays = new Set(Object.keys(reg).map(k => k.split('|')[1]));
  const status = {};
  for (const iso of isoList) {
    if (pushedDays.has(iso)) status[iso] = 'done';
  }
  return status;
}

// ── Auth — server-side OAuth code flow ───────────────────────────────────────

/**
 * Returns the current Supabase session access token (JWT), used to
 * authenticate calls to our own edge functions.
 */
async function _getSupabaseJwt() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * Redirects the user to Google's OAuth consent screen.
 * The gcal-auth edge function will handle the callback, store tokens,
 * and redirect back to the app.
 *
 * Call this when the user clicks "Connect Google Calendar".
 */
export function connectGcal() {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',   // always request refresh token
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Fetches a valid Google Calendar access token from the gcal-token edge
 * function.  The edge function transparently refreshes the token if it is
 * about to expire, so callers never need to think about expiry.
 *
 * Returns null if the user has not connected GCal (no row in gcal_tokens).
 * Throws on network or server errors.
 */
export async function getAccessToken() {
  const jwt = await _getSupabaseJwt();
  if (!jwt) throw new Error('Not authenticated with Supabase');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/gcal-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    },
  });

  if (res.status === 404) return null;  // no token row — user not connected
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `gcal-token error ${res.status}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

/**
 * Returns true if the user has a valid GCal connection (refresh token stored
 * server-side), false otherwise.  Async — replaces hasValidCachedToken().
 */
export async function isGcalConnected() {
  try {
    const token = await getAccessToken();
    return !!token;
  } catch {
    return false;
  }
}

/**
 * Synchronous best-effort check using the legacy localStorage token.
 * Used only for the *initial* render before the async check resolves,
 * so the UI doesn't flash "disconnected" on every page load.
 * Remove once all call-sites have been migrated to isGcalConnected().
 *
 * @deprecated — use isGcalConnected() instead
 */
export function hasValidCachedToken() {
  // Legacy keys kept for the transition period
  const token  = localStorage.getItem('gcal_access_token');
  const expiry  = parseInt(localStorage.getItem('gcal_token_expiry') || '0', 10);
  return !!token && Date.now() < expiry - 30_000;
}

/**
 * Revokes the stored GCal tokens (server-side) and disconnects the user.
 */
export async function disconnectGcal() {
  const jwt = await _getSupabaseJwt();
  if (!jwt) return;

  await fetch(`${SUPABASE_URL}/functions/v1/gcal-revoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    },
  }).catch(() => {});  // best-effort; clear local state regardless

  // Clean up any legacy localStorage token remnants
  localStorage.removeItem('gcal_access_token');
  localStorage.removeItem('gcal_token_expiry');
}

/**
 * clearToken — legacy shim.  New code should call disconnectGcal().
 * Kept so any component that calls clearToken() still compiles.
 */
export function clearToken() {
  localStorage.removeItem('gcal_access_token');
  localStorage.removeItem('gcal_token_expiry');
}

/**
 * revokeToken — legacy shim for components that call revokeToken().
 * Delegates to disconnectGcal().
 */
export async function revokeToken() {
  await disconnectGcal();
}

/**
 * startSilentTokenRefresh — no-op shim.  Token freshness is now handled
 * entirely by the gcal-token edge function on every getAccessToken() call.
 */
export function startSilentTokenRefresh(_onRefresh) {}

/**
 * stopSilentTokenRefresh — no-op shim.
 */
export function stopSilentTokenRefresh() {}

// ── Core API fetch ────────────────────────────────────────────────────────────
export async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Google Calendar not connected');

  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchCalendarList() {
  return gcalFetch('/users/me/calendarList?maxResults=50');
}
export async function fetchFreeBusy(calendarIds, timeMin, timeMax) {
  return gcalFetch('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin, timeMax,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      items: calendarIds.map(id => ({ id })),
    }),
  });
}

/**
 * Fetches intervals of work blocks previously written by this app,
 * identified by the `commitments_task_id` private extended property.
 */
export async function fetchCommitmentsBlockIntervals(timeMin, timeMax) {
  const calId = loadWriteCalId();
  const blocksByDay = {};
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', maxResults: '250',
      ...(pageToken ? { pageToken } : {}),
    });
    params.append('privateExtendedProperty', 'commitments_task_id=true');
    const resp = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events?${params}`);
    for (const ev of (resp.items || [])) {
      if (!ev.start?.dateTime) continue;
      const iso = new Date(ev.start.dateTime).toISOString().slice(0, 10);
      (blocksByDay[iso] ??= []).push({
        startMs: new Date(ev.start.dateTime).getTime(),
        endMs:   new Date(ev.end.dateTime).getTime(),
      });
    }
    pageToken = resp.nextPageToken || null;
  } while (pageToken);
  return blocksByDay;
}

export function subtractCommitmentsBlocks(busyIntervals, blockIntervals) {
  if (!blockIntervals || !blockIntervals.length) return busyIntervals;
  return busyIntervals.filter(b => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return !blockIntervals.some(bl => bl.startMs < be && bl.endMs > bs);
  });
}

// ── Free slot enumeration ─────────────────────────────────────────────────────
export async function findFreeSlots(isoDate, notBeforeMs, settings, calIds) {
  const { workWindows, bufferMins } = settings;
  const windows = (workWindows || [{ start: settings.workStart ?? 8, end: settings.workEnd ?? 20 }])
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start)
    .map(w => ({
      s: new Date(`${isoDate}T${String(w.start).padStart(2,'0')}:00:00`).getTime(),
      e: new Date(`${isoDate}T${String(w.end  ).padStart(2,'0')}:00:00`).getTime(),
    }));

  if (windows.length === 0) return [];

  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();

  const writeCalId = loadWriteCalId();
  const fbCalIds   = calIds.filter(id => id !== writeCalId);

  const fbResp = await fetchFreeBusy(fbCalIds, timeMin, timeMax).catch(() => ({ calendars: {} }));
  let busy = [];
  for (const id of fbCalIds) busy.push(...(fbResp.calendars?.[id]?.busy || []));

  const bufMs      = bufferMins * 60_000;
  const minChunkMs = MIN_CHUNK_HOURS * 3_600_000;
  const gaps       = [];

  for (const win of windows) {
    const earliest = notBeforeMs > 0 ? Math.max(notBeforeMs, win.s) : win.s;

    const blocked = busy
      .map(b => ({
        s: Math.max(new Date(b.start).getTime() - bufMs, win.s),
        e: Math.min(new Date(b.end  ).getTime() + bufMs, win.e),
      }))
      .filter(b => b.e > b.s)
      .sort((a, b) => a.s - b.s);

    const merged = [];
    for (const iv of blocked) {
      if (merged.length && iv.s <= merged[merged.length - 1].e)
        merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
      else merged.push({ ...iv });
    }

    let cursor = earliest;
    for (const block of [...merged, { s: win.e, e: win.e }]) {
      if (block.s <= cursor) { cursor = Math.max(cursor, block.e); continue; }
      const gapEnd = Math.min(block.s, win.e);
      if (gapEnd - cursor >= minChunkMs) gaps.push({ startMs: cursor, endMs: gapEnd });
      cursor = block.e;
    }
  }

  return gaps;
}

export async function findBestSlot(isoDate, durationHours, settings, calIds) {
  return findBestSlotAfter(isoDate, durationHours, 0, settings, calIds);
}
export async function findBestSlotAfter(isoDate, durationHours, notBeforeMs, settings, calIds) {
  const neededMs = durationHours * 3_600_000;
  const gaps = await findFreeSlots(isoDate, notBeforeMs, settings, calIds);
  for (const gap of gaps)
    if (gap.endMs - gap.startMs >= neededMs) return new Date(gap.startMs);
  const windows = (settings.workWindows || [{ start: settings.workStart ?? 8, end: settings.workEnd ?? 20 }])
    .filter(w => w.end > w.start).sort((a, b) => a.start - b.start);
  const firstStart = windows.length
    ? new Date(`${isoDate}T${String(windows[0].start).padStart(2,'0')}:00:00`).getTime()
    : new Date(`${isoDate}T08:00:00`).getTime();
  const earliest = notBeforeMs > 0 ? Math.max(notBeforeMs, firstStart) : firstStart;
  return new Date(earliest);
}

export async function createChunkedWorkBlocks(task, isoDate, durationHours, notBeforeMs, settings, calIds) {
  const s     = settings || loadGcalSettings();
  const ids   = calIds   || [...loadSelectedCals()];
  const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calId = loadWriteCalId();

  const gaps = await findFreeSlots(isoDate, notBeforeMs, s, ids);
  let remainingMs = durationHours * 3_600_000;
  const events = [];

  for (const gap of gaps) {
    if (remainingMs <= 0) break;
    const availableMs = gap.endMs - gap.startMs;
    const chunkMs     = Math.min(availableMs, remainingMs);
    const start       = new Date(gap.startMs);
    const end         = new Date(gap.startMs + chunkMs);
    const suffix = durationHours > (gap.endMs - gap.startMs) / 3_600_000
      ? ` (part ${events.length + 1})` : '';
    const ev = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary:     `Work on: ${task.name}${suffix}`,
        description: task.description || '',
        start: { dateTime: start.toISOString(), timeZone: tz },
        end:   { dateTime: end.toISOString(),   timeZone: tz },
        colorId: '2',
        extendedProperties: { private: { commitments_task_id: 'true' } },
      }),
    });
    events.push(ev);
    remainingMs -= chunkMs;
  }

  const hoursPlaced = (durationHours * 3_600_000 - remainingMs) / 3_600_000;
  return { events, hoursPlaced };
}

export async function createWorkBlock(task, isoDate, durationHours, settings, calIds) {
  const s   = settings || loadGcalSettings();
  const ids = calIds   || [...loadSelectedCals()];
  const { events, hoursPlaced } = await createChunkedWorkBlocks(task, isoDate, durationHours, 0, s, ids);
  if (events.length === 0) return null;
  const eventIds = events.map(e => e.id);
  setPushEntry(task.id, isoDate, eventIds[0], hoursPlaced, eventIds);
  return events[0];
}

export async function upsertWorkBlock(task, isoDate, durationHours, notBeforeMs, settings, calIds) {
  const s     = settings || loadGcalSettings();
  const ids   = calIds   || [...loadSelectedCals()];
  const calId = loadWriteCalId();

  const existing = getPushEntry(task.id, isoDate);
  if (existing) {
    const hoursChanged = Math.abs((existing.hours || 0) - durationHours) > 0.01;
    if (!hoursChanged) {
      const estEndMs = (notBeforeMs > 0 ? notBeforeMs : 0) + durationHours * 3_600_000;
      return { events: [], hoursPlaced: existing.hours, created: false, endMs: estEndMs };
    }
    const idsToDelete = existing.eventIds || [existing.eventId].filter(Boolean);
    await Promise.allSettled(
      idsToDelete.map(id =>
        gcalFetch(`/calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'DELETE' })
      )
    );
    clearPushEntry(task.id, isoDate);
  }

  const { events, hoursPlaced } = await createChunkedWorkBlocks(task, isoDate, durationHours, notBeforeMs, s, ids);
  if (events.length === 0)
    return { events: [], hoursPlaced: 0, created: false, endMs: notBeforeMs };

  const eventIds = events.map(e => e.id);
  setPushEntry(task.id, isoDate, eventIds[0], hoursPlaced, eventIds);
  const lastEv = events[events.length - 1];
  const endMs  = new Date(lastEv.end.dateTime).getTime();
  return { events, hoursPlaced, created: true, endMs };
}

export async function deleteWorkBlock(isoDate) {
  const calId   = loadWriteCalId();
  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();
  const params  = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '50' });
  params.append('privateExtendedProperty', 'commitments_task_id=true');
  const resp = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events?${params}`);
  const matches = (resp.items || []).filter(
    ev => ev.extendedProperties?.private?.commitments_task_id === 'true'
  );
  await Promise.all(
    matches.map(ev =>
      gcalFetch(`/calendars/${encodeURIComponent(calId)}/events/${ev.id}`, { method: 'DELETE' })
    )
  );
  const reg = getPushRegistry();
  for (const key of Object.keys(reg))
    if (key.endsWith(`|${isoDate}`)) delete reg[key];
  _savePushRegistry(reg);
  return matches.length;
}
