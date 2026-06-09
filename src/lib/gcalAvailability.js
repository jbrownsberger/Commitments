/**
 * gcalAvailability.js
 *
 * Thin persistence layer for the GCal free/busy cache.
 * Shape: { [isoDate: string]: number }  — values are free minutes.
 *
 * Consumers read `appData.gcalFreeBusy` (may be null if never fetched).
 * GCalSync writes via `appData.onFreeBusyUpdate(data)`.
 */

const LS_KEY = 'gcal_free_busy_cache';

/** Returns the cached map, or null if nothing stored yet. */
export function loadFreeBusy() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/** Persists a fresh map received from GCalSync. */
export function saveFreeBusy(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

/** Wipes the cache (e.g. on GCal disconnect). */
export function clearFreeBusy() {
  localStorage.removeItem(LS_KEY);
}
