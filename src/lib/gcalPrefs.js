/**
 * Sync GCal UI settings (write calendar, selected calendars, calc settings)
 * between localStorage and user_preferences so they follow the signed-in user.
 */
import { supabase } from './supabase.js';

const LS_SETTINGS = 'gcal_calc_settings';
const LS_CALS = 'gcal_selected_cals';
const LS_WRITE = 'gcal_commitments_cal_id';
const TRACKED = new Set([LS_SETTINGS, LS_CALS, LS_WRITE]);

const nativeSetItem = localStorage.setItem.bind(localStorage);
const nativeRemoveItem = localStorage.removeItem.bind(localStorage);

let wrapped = false;
let persistTimer = null;

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
    if (TRACKED.has(key)) schedulePersist();
  };
  localStorage.removeItem = (key) => {
    nativeRemoveItem(key);
    if (TRACKED.has(key)) schedulePersist();
  };
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

async function persistLocalToSupabase() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { settings, cals, write } = readLocalBundle();
  const { error } = await supabase.from('user_preferences').upsert({
    user_id: user.id,
    gcal_write_cal_id: write,
    gcal_selected_cals: cals,
    gcal_calc_settings: settings,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
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
  const hasRemote = !!(data && (data.gcal_write_cal_id || data.gcal_calc_settings || (data.gcal_selected_cals && data.gcal_selected_cals.length)));
  if (hasRemote) hydrateFromRemote(data);
  else await persistLocalToSupabase();
}

export function initGcalPrefs() {
  wrapLocalStorage();
  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.user?.id) pullOrPush(data.session.user.id);
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user?.id) pullOrPush(session.user.id);
  });
}
