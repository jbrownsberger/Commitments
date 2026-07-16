import { loadFreeBusySnapshot } from './gcalAvailability.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export const CALENDAR_ID = 'primary';
export const LS_SETTINGS_KEY  = 'gcal_calc_settings';
export const LS_CALS_KEY      = 'gcal_selected_cals';
export const LS_PUSH_REGISTRY = 'gcal_push_registry';
export const LS_WRITE_CAL_KEY       = 'gcal_commitments_cal_id';
export const LS_COMMITMENTS_CAL_KEY = LS_WRITE_CAL_KEY;
const LS_TOKEN_KEY = 'gcal_access_token';
const LS_TOKEN_EXPIRY_KEY = 'gcal_token_expiry';
const LS_TOKEN_SCOPE_KEY = 'gcal_token_scope';
const LS_ACCOUNT_HINT_KEY = 'gcal_account_hint';
const MIN_CHUNK_HOURS = 0.5;

export const DEFAULT_SETTINGS = {
  workWindows: [{ start: 8, end: 20 }],
  deductMins: 60,
  bufferMins: 10,
  efficiency: 85,
  nonWorkDays: [],
};

let gisLoaderPromise = null;
let tokenClient = null;
let pendingTokenRequest = null;

function getGoogleOauth() {
  return window.google?.accounts?.oauth2 || null;
}

function loadGisScript() {
  if (getGoogleOauth()) return Promise.resolve();
  if (gisLoaderPromise) return gisLoaderPromise;
  gisLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gis-client="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.gisClient = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoaderPromise;
}

function readCachedToken() {
  const accessToken = localStorage.getItem(LS_TOKEN_KEY);
  const expiryMs = parseInt(localStorage.getItem(LS_TOKEN_EXPIRY_KEY) || '0', 10);
  const scope = localStorage.getItem(LS_TOKEN_SCOPE_KEY) || '';
  const accountHint = localStorage.getItem(LS_ACCOUNT_HINT_KEY) || '';
  if (!accessToken || !expiryMs) return null;
  return { accessToken, expiryMs, scope, accountHint };
}

function cacheTokenResponse(tokenResponse) {
  if (!tokenResponse?.access_token) return null;
  const expiryMs = Date.now() + ((tokenResponse.expires_in || 3600) * 1000);
  localStorage.setItem(LS_TOKEN_KEY, tokenResponse.access_token);
  localStorage.setItem(LS_TOKEN_EXPIRY_KEY, String(expiryMs));
  localStorage.setItem(LS_TOKEN_SCOPE_KEY, tokenResponse.scope || SCOPES);
  if (tokenResponse.hint) localStorage.setItem(LS_ACCOUNT_HINT_KEY, tokenResponse.hint);
  return {
    accessToken: tokenResponse.access_token,
    expiryMs,
    scope: tokenResponse.scope || SCOPES,
    accountHint: tokenResponse.hint || localStorage.getItem(LS_ACCOUNT_HINT_KEY) || '',
  };
}

function clearCachedToken() {
  localStorage.removeItem(LS_TOKEN_KEY);
  localStorage.removeItem(LS_TOKEN_EXPIRY_KEY);
  localStorage.removeItem(LS_TOKEN_SCOPE_KEY);
}

function getAccountHint() {
  return localStorage.getItem(LS_ACCOUNT_HINT_KEY) || '';
}

export function setAccountHint(email) {
  if (email) localStorage.setItem(LS_ACCOUNT_HINT_KEY, email);
}

async function getTokenClient() {
  if (!CLIENT_ID) throw new Error('No Google Client ID configured');
  await loadGisScript();
  if (tokenClient) return tokenClient;
  const googleOauth = getGoogleOauth();
  if (!googleOauth) throw new Error('Google Identity Services unavailable');
  tokenClient = googleOauth.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    hint: getAccountHint() || undefined,
    callback: () => {},
    error_callback: (error) => {
      if (pendingTokenRequest) {
        pendingTokenRequest.reject(new Error(error?.type || 'Google authorization failed'));
        pendingTokenRequest = null;
      }
    },
  });
  return tokenClient;
}

function requestToken({ prompt = '', forcePrompt = false } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getTokenClient();
      pendingTokenRequest = { resolve, reject };
      client.callback = (resp) => {
        pendingTokenRequest = null;
        if (resp?.error) {
          reject(new Error(resp.error));
          return;
        }
        resolve(cacheTokenResponse(resp));
      };
      client.requestAccessToken({
        prompt: forcePrompt ? 'consent' : prompt,
      });
    } catch (err) {
      pendingTokenRequest = null;
      reject(err);
    }
  });
}

export function loadGcalSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
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

export function loadWriteCalId() {
  return localStorage.getItem(LS_WRITE_CAL_KEY) || 'primary';
}
export function saveWriteCalId(id) {
  if (id) localStorage.setItem(LS_WRITE_CAL_KEY, id);
  else localStorage.removeItem(LS_WRITE_CAL_KEY);
}
export function clearWriteCalId() {
  localStorage.removeItem(LS_WRITE_CAL_KEY);
}
export const loadCommitmentsCalId  = loadWriteCalId;
export const saveCommitmentsCalId  = saveWriteCalId;
export const clearCommitmentsCalId = clearWriteCalId;
export async function ensureCommitmentsCalendar() {
  return loadWriteCalId();
}

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
  for (const key of Object.keys(reg)) if (key.startsWith(prefix)) delete reg[key];
  _savePushRegistry(reg);
}
export function seedPushStatusFromRegistry(isoList) {
  const reg = getPushRegistry();
  const pushedDays = new Set(Object.keys(reg).map(k => k.split('|')[1]));
  const status = {};
  for (const iso of isoList) if (pushedDays.has(iso)) status[iso] = 'done';
  return status;
}

export async function connectGcal(forceConsent = false) {
  const token = await requestToken({ prompt: forceConsent ? 'consent' : 'select_account', forcePrompt: forceConsent });
  return !!token?.accessToken;
}

export function hasValidCachedToken() {
  const cached = readCachedToken();
  return !!cached && Date.now() < cached.expiryMs - 30_000;
}

export async function getAccessToken({ interactive = false } = {}) {
  const cached = readCachedToken();
  if (cached && Date.now() < cached.expiryMs - 30_000) return cached.accessToken;
  if (!interactive) return null;
  const token = await requestToken({ prompt: cached ? '' : 'select_account' });
  return token?.accessToken || null;
}

export async function isGcalConnected() {
  return hasValidCachedToken() || !!loadFreeBusySnapshot();
}

export async function disconnectGcal() {
  const token = localStorage.getItem(LS_TOKEN_KEY);
  const googleOauth = getGoogleOauth();
  if (token && googleOauth?.revoke) {
    await new Promise(resolve => {
      googleOauth.revoke(token, () => resolve());
      setTimeout(resolve, 1500);
    }).catch(() => {});
  }
  clearCachedToken();
  localStorage.removeItem(LS_ACCOUNT_HINT_KEY);
}

export function clearToken() {
  clearCachedToken();
}

export async function revokeToken() {
  await disconnectGcal();
}

export function startSilentTokenRefresh() {}
export function stopSilentTokenRefresh() {}

export async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken({ interactive: false });
  if (!token) throw new Error('Google Calendar sign-in required');
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    clearCachedToken();
    throw new Error('Google Calendar sign-in required');
  }
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
        endMs: new Date(ev.end.dateTime).getTime(),
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

export async function findFreeSlots(isoDate, notBeforeMs, settings, calIds) {
  const { workWindows, bufferMins } = settings;
  const windows = (workWindows || [{ start: settings.workStart ?? 8, end: settings.workEnd ?? 20 }])
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start)
    .map(w => ({
      s: new Date(`${isoDate}T${String(w.start).padStart(2,'0')}:00:00`).getTime(),
      e: new Date(`${isoDate}T${String(w.end).padStart(2,'0')}:00:00`).getTime(),
    }));
  if (windows.length === 0) return [];
  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();
  const writeCalId = loadWriteCalId();
  const fbCalIds = calIds.filter(id => id !== writeCalId);
  const fbResp = await fetchFreeBusy(fbCalIds, timeMin, timeMax).catch(() => ({ calendars: {} }));
  let busy = [];
  for (const id of fbCalIds) busy.push(...(fbResp.calendars?.[id]?.busy || []));
  const bufMs = bufferMins * 60_000;
  const minChunkMs = MIN_CHUNK_HOURS * 3_600_000;
  const gaps = [];
  for (const win of windows) {
    const earliest = notBeforeMs > 0 ? Math.max(notBeforeMs, win.s) : win.s;
    const blocked = busy
      .map(b => ({
        s: Math.max(new Date(b.start).getTime() - bufMs, win.s),
        e: Math.min(new Date(b.end).getTime() + bufMs, win.e),
      }))
      .filter(b => b.e > b.s)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const iv of blocked) {
      if (merged.length && iv.s <= merged[merged.length - 1].e) merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
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
  for (const gap of gaps) if (gap.endMs - gap.startMs >= neededMs) return new Date(gap.startMs);
  const windows = (settings.workWindows || [{ start: settings.workStart ?? 8, end: settings.workEnd ?? 20 }])
    .filter(w => w.end > w.start).sort((a, b) => a.start - b.start);
  const firstStart = windows.length
    ? new Date(`${isoDate}T${String(windows[0].start).padStart(2,'0')}:00:00`).getTime()
    : new Date(`${isoDate}T08:00:00`).getTime();
  const earliest = notBeforeMs > 0 ? Math.max(notBeforeMs, firstStart) : firstStart;
  return new Date(earliest);
}

export async function createChunkedWorkBlocks(task, isoDate, durationHours, notBeforeMs, settings, calIds) {
  const s = settings || loadGcalSettings();
  const ids = calIds || [...loadSelectedCals()];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calId = loadWriteCalId();
  const gaps = await findFreeSlots(isoDate, notBeforeMs, s, ids);
  let remainingMs = durationHours * 3_600_000;
  const events = [];
  for (const gap of gaps) {
    if (remainingMs <= 0) break;
    const availableMs = gap.endMs - gap.startMs;
    const chunkMs = Math.min(availableMs, remainingMs);
    const start = new Date(gap.startMs);
    const end = new Date(gap.startMs + chunkMs);
    const suffix = durationHours > (gap.endMs - gap.startMs) / 3_600_000 ? ` (part ${events.length + 1})` : '';
    const ev = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: `Work on: ${task.name}${suffix}`,
        description: task.description || '',
        start: { dateTime: start.toISOString(), timeZone: tz },
        end: { dateTime: end.toISOString(), timeZone: tz },
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
  const s = settings || loadGcalSettings();
  const ids = calIds || [...loadSelectedCals()];
  const { events, hoursPlaced } = await createChunkedWorkBlocks(task, isoDate, durationHours, 0, s, ids);
  if (events.length === 0) return null;
  const eventIds = events.map(e => e.id);
  setPushEntry(task.id, isoDate, eventIds[0], hoursPlaced, eventIds);
  return events[0];
}

export async function upsertWorkBlock(task, isoDate, durationHours, notBeforeMs, settings, calIds) {
  const s = settings || loadGcalSettings();
  const ids = calIds || [...loadSelectedCals()];
  const calId = loadWriteCalId();
  const existing = getPushEntry(task.id, isoDate);
  if (existing) {
    const hoursChanged = Math.abs((existing.hours || 0) - durationHours) > 0.01;
    if (!hoursChanged) {
      const estEndMs = (notBeforeMs > 0 ? notBeforeMs : 0) + durationHours * 3_600_000;
      return { events: [], hoursPlaced: existing.hours, created: false, endMs: estEndMs };
    }
    const idsToDelete = existing.eventIds || [existing.eventId].filter(Boolean);
    await Promise.allSettled(idsToDelete.map(id => gcalFetch(`/calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'DELETE' })));
    clearPushEntry(task.id, isoDate);
  }
  const { events, hoursPlaced } = await createChunkedWorkBlocks(task, isoDate, durationHours, notBeforeMs, s, ids);
  if (events.length === 0) return { events: [], hoursPlaced: 0, created: false, endMs: notBeforeMs };
  const eventIds = events.map(e => e.id);
  setPushEntry(task.id, isoDate, eventIds[0], hoursPlaced, eventIds);
  const lastEv = events[events.length - 1];
  const endMs = new Date(lastEv.end.dateTime).getTime();
  return { events, hoursPlaced, created: true, endMs };
}

export async function deleteWorkBlock(isoDate) {
  const calId = loadWriteCalId();
  const timeMin = new Date(`${isoDate}T00:00:00`).toISOString();
  const timeMax = new Date(`${isoDate}T23:59:59`).toISOString();
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '50' });
  params.append('privateExtendedProperty', 'commitments_task_id=true');
  const resp = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events?${params}`);
  const matches = (resp.items || []).filter(ev => ev.extendedProperties?.private?.commitments_task_id === 'true');
  await Promise.all(matches.map(ev => gcalFetch(`/calendars/${encodeURIComponent(calId)}/events/${ev.id}`, { method: 'DELETE' })));
  const reg = getPushRegistry();
  for (const key of Object.keys(reg)) if (key.endsWith(`|${isoDate}`)) delete reg[key];
  _savePushRegistry(reg);
  return matches.length;
}
