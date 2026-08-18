/**
 * Sync GCal UI settings (write calendar, selected calendars, calc settings)
 * between localStorage and user_preferences so they follow the signed-in user.
 */
import { supabase } from './supabase.js';

const LS_SETTINGS = 'gcal_calc_settings';
const LS_CALS = 'gcal_selected_cals';
const LS_WRITE = 'gcal_commitments_cal_id';
const LS_OWNER = 'gcal_preferences_owner_id';
const TRACKED = new Set([LS_SETTINGS, LS_CALS, LS_WRITE]);
export const GCAL_PREFS_CHANGED_EVENT = 'commitments:gcal-preferences-changed';

const nativeSetItem = localStorage.setItem.bind(localStorage);
const nativeRemoveItem = localStorage.removeItem.bind(localStorage);

let wrapped = false;
let persistTimer = null;
let initialSyncPromise = null;

function emitPrefsChanged() {
  queueMicrotask(() => window.dispatchEvent(new Event(GCAL_PREFS_CHANGED_EVENT)));
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistLocalToSupabase().catch((err) => console.warn('gcal prefs persist failed:', err));
  }, 250);
}

function wrapLocalStorage() {
  if (wrapped) return;
  wrapped = true;
  localStorage.setItem = (key, value) => {
    nativeSetItem(key, value);
    if (TRACKED.has(key)) {
      schedulePersist();
      emitPrefsChanged();
    }
  };
  localStorage.removeItem = (key) => {
    nativeRemoveItem(key);
    if (TRACKED.has(key)) {
      schedulePersist();
      emitPrefsChanged();
    }
  };
}

function clearLocalBundle() {
  nativeRemoveItem(LS_SETTINGS);
  nativeRemoveItem(LS_CALS);
  nativeRemoveItem(LS_WRITE);
  emitPrefsChanged();
}

function readLocalBundle() {
  let settings = null;
  let cals = [];
  try {
    const rawS = localStorage.getItem(LS_SETTINGS);
    if (rawS) settings = JSON.parse(rawS);
  } catch { /* ignore */ }
  try {
    const rawC = localStorage.getItem(LS_CALS);
    if (rawC) {
      const parsed = JSON.parse(rawC);
      cals = Array.isArray(parsed) ? parsed : [];
    }
  } catch { /* ignore */ }
  const write = localStorage.getItem(LS_WRITE) || 'primary';
  return { settings, cals, write };
}

async function persistLocalToSupabase(userId) {
  let id = userId;
  if (!id) {
    const { data: { user } } = await supabase.auth.getUser();
    id = user?.id;
  }
  if (!id) return;
  const { settings, cals, write } = readLocalBundle();
  const { error } = await supabase.from('user_preferences').upsert({
    user_id: id,
    gcal_write_cal_id: write,
    gcal_selected_cals: cals,
    gcal_calc_settings: settings,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  nativeSetItem(LS_OWNER, id);
}

function hydrateFromRemote(row) {
  if (!row) return;
  if (row.gcal_write_cal_id) nativeSetItem(LS_WRITE, row.gcal_write_cal_id);
  if (Array.isArray(row.gcal_selected_cals)) {
    nativeSetItem(LS_CALS, JSON.stringify(row.gcal_selected_cals));
  }
  if (row.gcal_calc_settings && typeof row.gcal_calc_settings === 'object') {
    nativeSetItem(LS_SETTINGS, JSON.stringify(row.gcal_calc_settings));
  }
  emitPrefsChanged();
}

async function pullOrPush(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('gcal_write_cal_id, gcal_selected_cals, gcal_calc_settings')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('gcal prefs load failed:', error);
    return;
  }
  const localOwner = localStorage.getItem(LS_OWNER);
  // Do not let one signed-in user inherit another user's browser-local choices.
  if (localOwner && localOwner !== userId) clearLocalBundle();

  const hasRemote = !!(data && (data.gcal_write_cal_id || data.gcal_calc_settings || (data.gcal_selected_cals && data.gcal_selected_cals.length)));
  if (hasRemote) {
    hydrateFromRemote(data);
    nativeSetItem(LS_OWNER, userId);
  } else {
    await persistLocalToSupabase(userId);
  }
}

export function waitForGcalPrefs() {
  return initialSyncPromise || Promise.resolve();
}

export function initGcalPrefs() {
  wrapLocalStorage();
  initialSyncPromise = supabase.auth.getSession().then(async ({ data }) => {
    if (data?.session?.user?.id) await pullOrPush(data.session.user.id);
  }).catch((error) => {
    console.warn('gcal prefs initial sync failed:', error);
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user?.id) {
      initialSyncPromise = pullOrPush(session.user.id).catch((error) => {
        console.warn('gcal prefs sync failed:', error);
      });
    }
  });
}
