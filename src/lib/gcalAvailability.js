const LS_KEY = 'gcal_free_busy_cache';
const LEGACY_LS_KEY = 'gcal_free_busy_cache';
const STALE_AFTER_MS = 60 * 60 * 1000;

function normalizeSnapshot(parsed) {
  if (!parsed) return null;
  if (parsed.data && typeof parsed.data === 'object') {
    return {
      data: parsed.data,
      fetchedAt: parsed.fetchedAt || null,
      source: parsed.source || 'google',
    };
  }
  if (typeof parsed === 'object') {
    return {
      data: parsed,
      fetchedAt: null,
      source: 'google',
    };
  }
  return null;
}

export function loadFreeBusySnapshot() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return null;
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadFreeBusy() {
  return loadFreeBusySnapshot()?.data || null;
}

export function saveFreeBusy(data, meta = {}) {
  try {
    const snapshot = {
      data,
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      source: meta.source || 'google',
    };
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
  } catch {}
}

export function clearFreeBusy() {
  localStorage.removeItem(LS_KEY);
}

export function getFreeBusyAgeMs(snapshot = loadFreeBusySnapshot()) {
  if (!snapshot?.fetchedAt) return Infinity;
  const t = new Date(snapshot.fetchedAt).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, Date.now() - t);
}

export function isFreeBusyStale(snapshot = loadFreeBusySnapshot()) {
  return getFreeBusyAgeMs(snapshot) > STALE_AFTER_MS;
}

export function getFreeBusyFetchedAt(snapshot = loadFreeBusySnapshot()) {
  return snapshot?.fetchedAt || null;
}
