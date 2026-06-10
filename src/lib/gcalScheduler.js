/**
 * gcalScheduler.js
 *
 * Shared Google Calendar scheduling logic used by GCalSync and Planner.
 *
 * Exports:
 *   Auth / token
 *     hasValidCachedToken()
 *     getAccessToken(forceConsent?)
 *     revokeToken()
 *
 *   Core API
 *     gcalFetch(path, opts?)
 *     fetchFreeBusy(calendarIds, timeMin, timeMax)
 *     fetchCalendarList()
 *
 *   Block management
 *     fetchCommitmentsBlockIntervals(timeMin, timeMax)
 *     subtractCommitmentsBlocks(busyIntervals, blockIntervals)
 *     findBestSlot(isoDate, durationHours, settings, calIds)
 *     findBestSlotAfter(isoDate, durationHours, notBeforeMs, settings, calIds)
 *     createWorkBlock(task, isoDate, durationHours, settings, calIds)
 *     upsertWorkBlock(task, isoDate, durationHours, notBeforeMs, settings, calIds)
 *     deleteWorkBlock(taskId, isoDate)
 *
 *   Push registry (localStorage dedup)
 *     getPushRegistry()
 *     getPushEntry(taskId, isoDate)
 *     setPushEntry(taskId, isoDate, eventId, hours)
 *     clearPushEntry(taskId, isoDate)
 *     clearPushEntriesForTask(taskId)
 *     seedPushStatusFromRegistry(isoList)
 *
 *   Settings helpers
 *     loadGcalSettings()
 *     saveGcalSettings(s)
 *     loadSelectedCals()
 *     saveSelectedCals(set)
 *     DEFAULT_SETTINGS
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID       = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPES          = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
export const CALENDAR_ID = 'primary';

const LS_TOKEN_KEY    = 'gcal_access_token';
const LS_EXPIRY_KEY   = 'gcal_token_expiry';
export const LS_SETTINGS_KEY  = 'gcal_calc_settings';
export const LS_CALS_KEY      = 'gcal_selected_cals';
export const LS_PUSH_REGISTRY = 'gcal_push_registry';

// ── Default settings ──────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  workStart:   8,
  workEnd:     20,
  deductMins:  60,
  bufferMins:  10,
  efficiency:  85,
  nonWorkDays: [],
};

export function loadGcalSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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

// ── Push registry ─────────────────────────────────────────────────────────────
// Shape: { ["taskId|isoDate"]: { eventId: string, hours: number } }

export function getPushRegistry() {
  try {
    const raw = localStorage.getItem(LS_PUSH_REGISTRY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function savePushRegistry(reg) {
  localStorage.setItem(LS_PUSH_REGISTRY, JSON.stringify(reg));
}

export function getPushEntry(taskId, isoDate) {
  return getPushRegistry()[`${taskId}|${isoDate}`] || null;
}

export function setPushEntry(taskId, isoDate, eventId, hours) {
  const reg = getPushRegistry();
  reg[`${taskId}|${isoDate}`] = { eventId, hours };
  savePushRegistry(reg);
}

export function clearPushEntry(taskId, isoDate) {
  const reg = getPushRegistry();
  delete reg[`${taskId}|${isoDate}`];
  savePushRegistry(reg);
}

export function clearPushEntriesForTask(taskId) {
  const reg = getPushRegistry();
  const prefix = `${taskId}|`;
  for (const key of Object.keys(reg)) {
    if (key.startsWith(prefix)) delete reg[key];
  }
  savePushRegistry(reg);
}

/**
 * Given a list of ISO dates, return a gcalPushStatus map pre-seeded with
 * 'done' for any (task, day) pairs that have a registry entry on that day.
 * Used to restore push-status UI after component remount.
 *
 * @param {string[]} isoList  — list of ISO dates in the current planner window
 * @returns {{ [iso: string]: 'done' }}
 */
export function seedPushStatusFromRegistry(isoList) {
  const reg    = getPushRegistry();
  const status = {};
  // An iso date is "done" if at least one task has been pushed for it
  const pushedDays = new Set(
    Object.keys(reg).map(k => k.split('|')[1])
  );
  for (const iso of isoList) {
    if (pushedDays.has(iso)) status[iso] = 'done';
  }
  return status;
}

// ── Token management ──────────────────────────────────────────────────────────
let _tokenClient = null;
let _accessToken = localStorage.getItem(LS_TOKEN_KEY) || null;
let _tokenExpiry  = parseInt(localStorage.getItem(LS_EXPIRY_KEY) || '0', 10);

function persistToken(token, expiresIn) {
  _accessToken = token;
  _tokenExpiry  = Date.now() + (expiresIn ?? 3600) * 1000;
  localStorage.setItem(LS_TOKEN_KEY,  token);
  localStorage.setItem(LS_EXPIRY_KEY, String(_tokenExpiry));
}

export function clearToken() {
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
  if (_accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(_accessToken);
  }
  clearToken();
}

// ── Core API fetch ─────────────────────────────────────────────────────────────
/**
 * Authenticated fetch against the Google Calendar v3 API.
 * Handles both JSON responses and 204 No Content (e.g. DELETE).
 */
export async function gcalFetch(path, opts = {}) {
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
  if (res.status === 204) return null;
  return res.json();
}

// ── Calendar list ──────────────────────────────────────────────────────────────
export async function fetchCalendarList() {
  return gcalFetch('/users/me/calendarList?maxResults=50');
}

// ── Free / busy ────────────────────────────────────────────────────────────────
export async function fetchFreeBusy(calendarIds, timeMin, timeMax) {
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

// ── Commitments block intervals ────────────────────────────────────────────────
/**
 * Fetch all events tagged with commitments_task_id within a time range.
 * Returns { [isoDate]: [{ startMs, endMs }] }.
 */
export async function fetchCommitmentsBlockIntervals(timeMin, timeMax) {
  const blocksByDay = {};
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      maxResults: '250',
      ...(pageToken ? { pageToken } : {}),
    });
    params.append('privateExtendedProperty', 'commitments_task_id=true');
    const resp = await gcalFetch(
      `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`
    );
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

/**
 * Remove Commitments-owned busy intervals from a free/busy list.
 * A busy interval is dropped if fully covered by any of our own blocks.
 */
export function subtractCommitmentsBlocks(busyIntervals, blockIntervals) {
  if (!blockIntervals || !blockIntervals.length) return busyIntervals;
  return busyIntervals.filter(b => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return !blockIntervals.some(bl => bl.startMs <= bs && bl.endMs >= be);
  });
}

// ── Slot finder ────────────────────────────────────────────────────────────────
/**
 * Find the earliest contiguous free slot on isoDate that fits durationHours.
 * Respects workStart/workEnd window and bufferMins padding around events.
 * Falls back to workStart if nothing fits.
 *
 * @param {string}   isoDate        — 'YYYY-MM-DD'
 * @param {number}   durationHours  — length of the desired block in hours
 * @param {object}   settings       — gcal settings (workStart, workEnd, bufferMins, …)
 * @param {string[]} calIds         — calendar IDs to check for conflicts
 * @returns {Promise<Date>}         — the best start time as a Date object
 */
export async function findBestSlot(isoDate, durationHours, settings, calIds) {
  return findBestSlotAfter(isoDate, durationHours, 0, settings, calIds);
}

/**
 * Like findBestSlot but also respects a notBeforeMs floor (Unix ms).
 * Used when scheduling multiple tasks sequentially on the same day so each
 * one starts after the previous one ends.
 *
 * @param {string}   isoDate
 * @param {number}   durationHours
 * @param {number}   notBeforeMs    — earliest allowed start in Unix ms (0 = no constraint)
 * @param {object}   settings
 * @param {string[]} calIds
 * @returns {Promise<Date>}
 */
export async function findBestSlotAfter(isoDate, durationHours, notBeforeMs, settings, calIds) {
  const { workStart, workEnd, bufferMins } = settings;
  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();

  const [fbResp, ownBlocksByDay] = await Promise.all([
    fetchFreeBusy(calIds, timeMin, timeMax).catch(() => ({ calendars: {} })),
    fetchCommitmentsBlockIntervals(timeMin, timeMax).catch(() => ({})),
  ]);

  let busy = [];
  for (const id of calIds)
    busy.push(...(fbResp.calendars?.[id]?.busy || []));

  busy = subtractCommitmentsBlocks(busy, ownBlocksByDay[isoDate] || []);

  const bufMs    = bufferMins * 60_000;
  const neededMs = durationHours * 3_600_000;
  const winStart = new Date(`${isoDate}T${String(workStart).padStart(2, '0')}:00:00`).getTime();
  const winEnd   = new Date(`${isoDate}T${String(workEnd  ).padStart(2, '0')}:00:00`).getTime();

  // Apply notBeforeMs floor (clamp to working window)
  const earliest = notBeforeMs > 0 ? Math.max(notBeforeMs, winStart) : winStart;

  const blocked = busy
    .map(b => ({
      s: Math.max(new Date(b.start).getTime() - bufMs, winStart),
      e: Math.min(new Date(b.end  ).getTime() + bufMs, winEnd),
    }))
    .filter(b => b.e > b.s)
    .sort((a, b) => a.s - b.s);

  const merged = [];
  for (const iv of blocked) {
    if (merged.length && iv.s <= merged[merged.length - 1].e)
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
    else merged.push({ ...iv });
  }

  // Walk gaps starting from `earliest`, return first gap that fits
  let cursor = earliest;
  for (const block of [...merged, { s: winEnd, e: winEnd }]) {
    if (block.s <= cursor) {
      cursor = Math.max(cursor, block.e);
      continue;
    }
    if (block.s - cursor >= neededMs)
      return new Date(cursor);
    cursor = block.e;
  }

  // Fallback: earliest allowed start
  return new Date(earliest);
}

// ── Block creation ─────────────────────────────────────────────────────────────
/**
 * Create a work block on Google Calendar for a task on a given day.
 * Uses findBestSlot to pick the start time intelligently.
 * NOTE: prefer upsertWorkBlock for push-from-Planner flows.
 *
 * @param {object}   task
 * @param {string}   isoDate
 * @param {number}   durationHours
 * @param {object}   settings
 * @param {string[]} calIds
 * @returns {Promise<object>}  the created GCal event object
 */
export async function createWorkBlock(task, isoDate, durationHours, settings, calIds) {
  const s   = settings || loadGcalSettings();
  const ids = calIds   || [...loadSelectedCals()];
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const start = await findBestSlot(isoDate, durationHours, s, ids);
  const end   = new Date(start.getTime() + durationHours * 3_600_000);

  return gcalFetch(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary:     `Work on: ${task.name}`,
      description: task.description || '',
      start: { dateTime: start.toISOString(), timeZone: tz },
      end:   { dateTime: end.toISOString(),   timeZone: tz },
      colorId: '2',
      extendedProperties: { private: { commitments_task_id: 'true' } },
    }),
  });
}

// ── Upsert block ───────────────────────────────────────────────────────────────
/**
 * Create or update a work block for a task/day, using the push registry to
 * deduplicate and avoid re-creating events that already exist.
 *
 * Behaviour:
 *   - No registry entry → create new event at best slot (respecting notBeforeMs),
 *     save to registry. Returns { event, endMs, created: true }.
 *   - Registry entry, hours unchanged → skip. Returns { event: null, endMs, created: false }.
 *   - Registry entry, hours changed   → PATCH the existing event's end time,
 *     update registry. Returns { event, endMs, created: false }.
 *   - Registry entry, but PATCH returns 404 (event deleted externally) → fall
 *     through and create a new event. Returns { event, endMs, created: true }.
 *
 * @param {object}   task
 * @param {string}   isoDate
 * @param {number}   durationHours
 * @param {number}   notBeforeMs    — floor for slot search (Unix ms, 0 = no constraint)
 * @param {object}   settings
 * @param {string[]} calIds
 * @returns {Promise<{ event: object|null, endMs: number, created: boolean }>}
 */
export async function upsertWorkBlock(task, isoDate, durationHours, notBeforeMs, settings, calIds) {
  const s   = settings || loadGcalSettings();
  const ids = calIds   || [...loadSelectedCals()];
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const existing = getPushEntry(task.id, isoDate);

  // ── Case: existing event, try update or skip ──────────────────────────────
  if (existing) {
    const hoursChanged = Math.abs((existing.hours || 0) - durationHours) > 0.01;

    if (!hoursChanged) {
      // Nothing to do — compute endMs from stored start so caller can chain
      // We don't store startMs, so we re-derive it from notBeforeMs as a best
      // approximation; the actual start is already on GCal.
      // For chaining purposes, return a reasonable endMs estimate.
      const estStart = Math.max(notBeforeMs, 0);
      const endMs    = estStart + durationHours * 3_600_000;
      return { event: null, endMs, created: false };
    }

    // Hours changed — PATCH the existing event
    try {
      // Fetch the existing event to get its actual start time
      const existingEvent = await gcalFetch(
        `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${existing.eventId}`
      );
      const startMs = new Date(existingEvent.start.dateTime).getTime();
      const newEnd  = new Date(startMs + durationHours * 3_600_000);
      const patched = await gcalFetch(
        `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${existing.eventId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            summary: `Work on: ${task.name}`,
            end: { dateTime: newEnd.toISOString(), timeZone: tz },
          }),
        }
      );
      setPushEntry(task.id, isoDate, existing.eventId, durationHours);
      return { event: patched, endMs: newEnd.getTime(), created: false };
    } catch (err) {
      // If the event no longer exists (404), fall through to create
      if (!err.message?.includes('404')) throw err;
      clearPushEntry(task.id, isoDate);
    }
  }

  // ── Case: no entry (or cleared after 404) — create new ───────────────────
  const start = await findBestSlotAfter(isoDate, durationHours, notBeforeMs, s, ids);
  const end   = new Date(start.getTime() + durationHours * 3_600_000);

  const event = await gcalFetch(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary:     `Work on: ${task.name}`,
      description: task.description || '',
      start: { dateTime: start.toISOString(), timeZone: tz },
      end:   { dateTime: end.toISOString(),   timeZone: tz },
      colorId: '2',
      extendedProperties: { private: { commitments_task_id: 'true' } },
    }),
  });

  setPushEntry(task.id, isoDate, event.id, durationHours);
  return { event, endMs: end.getTime(), created: true };
}

// ── Block deletion ─────────────────────────────────────────────────────────────
/**
 * Find and delete the Commitments-owned work block for a given day.
 * Also clears any push registry entries for tasks on that day.
 * If multiple matching blocks exist (edge case), deletes all of them.
 *
 * @param {string} isoDate — 'YYYY-MM-DD'
 * @returns {Promise<number>} — count of events deleted
 */
export async function deleteWorkBlock(isoDate) {
  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    maxResults: '50',
  });
  params.append('privateExtendedProperty', 'commitments_task_id=true');

  const resp = await gcalFetch(
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`
  );

  const matches = (resp.items || []).filter(
    ev => ev.extendedProperties?.private?.commitments_task_id === 'true'
  );

  await Promise.all(
    matches.map(ev =>
      gcalFetch(
        `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${ev.id}`,
        { method: 'DELETE' }
      )
    )
  );

  // Clear registry entries for this day
  const reg = getPushRegistry();
  for (const key of Object.keys(reg)) {
    if (key.endsWith(`|${isoDate}`)) delete reg[key];
  }
  savePushRegistry(reg);

  return matches.length;
}

// keep savePushRegistry accessible within module only — exported via helpers above
function savePushRegistry(reg) {
  localStorage.setItem(LS_PUSH_REGISTRY, JSON.stringify(reg));
}
