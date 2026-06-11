/**
 * gcalScheduler.js
 *
 * Shared Google Calendar scheduling logic used by GCalSync and Planner.
 *
 * SCOPE STRATEGY — sensitive tier only (no CASA security audit required):
 *   calendar.readonly  — read calendar list, events, free/busy
 *   calendar.events    — create / update / delete events this app created
 *
 * WRITE CALENDAR MODEL (two-tier):
 *   Preferred: user manually creates a dedicated calendar (e.g. "Commitments
 *   Work Blocks") in Google Calendar, then selects it here via the Phase 2
 *   UI.  The free/busy query omits that calendar entirely — no tag-matching
 *   needed because nothing else writes to it.
 *
 *   Fallback: user writes to primary (or any shared calendar).  App-written
 *   events are identified by the private extended property
 *   `commitments_task_id: "true"` and subtracted from busy intervals before
 *   availability is calculated.
 *
 *   Phase 2 will add the picker UI.  Until then the write calendar defaults
 *   to whatever was previously stored under LS_COMMITMENTS_CAL_KEY, or
 *   'primary' if nothing is stored.
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Sensitive scopes only — no restricted `calendar` scope.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export const CALENDAR_ID = 'primary';

const LS_TOKEN_KEY   = 'gcal_access_token';
const LS_EXPIRY_KEY  = 'gcal_token_expiry';
export const LS_SETTINGS_KEY = 'gcal_calc_settings';
export const LS_CALS_KEY     = 'gcal_selected_cals';
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
// Keep old export name alive for any code that imports it directly.
export const LS_COMMITMENTS_CAL_KEY = LS_WRITE_CAL_KEY;

const MIN_CHUNK_HOURS   = 0.5;
const REFRESH_BEFORE_MS = 5 * 60_000;

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
// These replace the auto-creation model (ensureCommitmentsCalendar) with a
// user-selected write target.  The localStorage key is unchanged so existing
// selections survive the upgrade.

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

// Legacy shims — all existing component code that calls these continues to
// work without modification.
export const loadCommitmentsCalId  = loadWriteCalId;
export const saveCommitmentsCalId  = saveWriteCalId;
export const clearCommitmentsCalId = clearWriteCalId;

/**
 * ensureCommitmentsCalendar — kept as a no-op shim so any component that
 * imports and awaits it doesn't break.  Calendar creation now happens
 * manually by the user; Phase 2 will remove this call from components.
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

// ── Token management ──────────────────────────────────────────────────────────
let _tokenClient = null;
let _accessToken = localStorage.getItem(LS_TOKEN_KEY) || null;
let _tokenExpiry = parseInt(localStorage.getItem(LS_EXPIRY_KEY) || '0', 10);
let _refreshTimer = null;

function persistToken(token, expiresIn) {
  _accessToken = token;
  _tokenExpiry = Date.now() + (expiresIn ?? 3600) * 1000;
  localStorage.setItem(LS_TOKEN_KEY, token);
  localStorage.setItem(LS_EXPIRY_KEY, String(_tokenExpiry));
}
export function clearToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  _tokenClient = null;
  stopSilentTokenRefresh();
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
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
export async function getAccessToken(forceConsent = false) {
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
export function revokeToken() {
  if (_accessToken && window.google?.accounts?.oauth2)
    window.google.accounts.oauth2.revoke(_accessToken);
  clearToken();
}
export function startSilentTokenRefresh(onRefresh) {
  stopSilentTokenRefresh();
  if (!hasValidCachedToken()) return;
  const msUntilExpiry  = _tokenExpiry - Date.now();
  const msUntilRefresh = Math.max(msUntilExpiry - REFRESH_BEFORE_MS, 0);
  _refreshTimer = setTimeout(async () => {
    try {
      await loadGsiScript();
      if (!_tokenClient) {
        await new Promise((resolve, reject) => {
          _tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID, scope: SCOPES,
            callback: (resp) => {
              if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
              persistToken(resp.access_token, resp.expires_in); resolve();
            },
          });
          _tokenClient.requestAccessToken({ prompt: '' });
        });
      } else {
        await new Promise((resolve, reject) => {
          const prev = _tokenClient.callback;
          _tokenClient.callback = (resp) => {
            _tokenClient.callback = prev;
            if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
            persistToken(resp.access_token, resp.expires_in); resolve();
          };
          _tokenClient.requestAccessToken({ prompt: '' });
        });
      }
      onRefresh?.(true);
      startSilentTokenRefresh(onRefresh);
    } catch { onRefresh?.(false); }
  }, msUntilRefresh);
}
export function stopSilentTokenRefresh() {
  if (_refreshTimer !== null) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

// ── Core API fetch ────────────────────────────────────────────────────────────
export async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken();
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
 *
 * These are used by subtractCommitmentsBlocks to prevent app-written events
 * from being double-counted as "busy" when the write calendar is the same
 * calendar being queried for availability (i.e. the fallback path).
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
/**
 * Returns all free gap intervals across all configured work windows for isoDate.
 *
 * KEY FIX (Phase 1): the write calendar is always excluded from the free/busy
 * query.  On the preferred path (dedicated calendar) this is sufficient on its
 * own — nothing else writes there so no subtraction is needed.  On the
 * fallback path (primary or shared calendar) the app-written blocks are
 * identified by commitments_task_id and subtracted by the caller via
 * fetchCommitmentsBlockIntervals / subtractCommitmentsBlocks.
 */
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

  // Always exclude the write calendar from the free/busy query.
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
  // Fallback: start of first window
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
