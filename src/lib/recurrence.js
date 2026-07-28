/**
 * Pure recurrence engine — date math only, no Supabase / React.
 *
 * Rule shape (derived from a task or form state):
 *   {
 *     cadence: 'daily' | 'weekday' | 'weekly' | 'monthly' |
 *              'every_N_days' | 'every_N_weeks' | 'every_N_months',
 *     dow: 0–6 | null,   // Sun=0 … Sat=6  (weekly / optional every_N_weeks)
 *     dom: 1–31 | null,  // day of month (monthly)
 *   }
 *
 * All date strings are 'YYYY-MM-DD' in local time.
 * Never pass bare ISO date strings to `new Date()` — use parseLocalDate.
 */

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Parse a 'YYYY-MM-DD' string into a LOCAL midnight Date. */
export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Format a Date as 'YYYY-MM-DD' in local time. */
export function formatLocalDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's local date string. */
export function todayStr() {
  return formatLocalDate(new Date());
}

/** Last calendar day of the month containing `dt` (local). */
export function lastDayOfMonth(dt) {
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
}

/**
 * Build a local date for year/month (0-based) / desired day-of-month,
 * clamping to the last day of that month (e.g. 31 → Feb 28/29).
 */
export function clampedDate(year, monthIndex, dayOfMonth) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(1, dayOfMonth), last);
  const dt = new Date(year, monthIndex, day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// ── Rule helpers ──────────────────────────────────────────────────────────────

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Build a rule object from a task (or task-like payload).
 */
export function ruleFromTask(task) {
  if (!task) return null;
  return {
    cadence: task.recurring_cadence || 'daily',
    dow: task.recurring_dow ?? null,
    dom: task.recurring_dom ?? null,
  };
}

export function isRollingTask(task) {
  return !!(task?.recurring && task.recurring_type === 'reset' && !task.is_recurring_template);
}

export function isSeriesTemplate(task) {
  return !!(task?.is_recurring_template === true ||
    (task?.recurring && task.recurring_type === 'expand' && task.is_recurring_template));
}

/** True when the row is real work (not a series meta-template). */
export function isWorkTask(task) {
  return !task?.is_recurring_template;
}

export function isSeriesInstance(task) {
  return !!(task?.recurring_template_id && !task?.is_recurring_template);
}

// ── Core schedule math ────────────────────────────────────────────────────────

/**
 * Next (or same-day) occurrence of `dow` on or after `fromDate`.
 */
export function nextOccurrenceOfDow(dow, fromDate) {
  const base = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  const diff = (dow - base.getDay() + 7) % 7;
  const result = new Date(base);
  result.setDate(result.getDate() + diff);
  return formatLocalDate(result);
}

/**
 * Strictly future occurrence of `dow` after `fromDate` (always advances ≥1 day).
 */
export function nextFutureOccurrenceOfDow(dow, fromDate) {
  const base = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + 1);
  return nextOccurrenceOfDow(dow, base);
}

/**
 * Advance `fromDate` by exactly one cadence period.
 * Returns the new LOCAL date string.
 *
 * Semantics: the result is the *next* scheduled date *after* fromDate
 * (strictly later for weekly/monthly/weekday/daily/interval).
 */
export function nextOccurrence(rule, fromDate) {
  const cadence = rule?.cadence || 'daily';
  const d = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  d.setHours(0, 0, 0, 0);

  if (cadence === 'daily') {
    d.setDate(d.getDate() + 1);
    return formatLocalDate(d);
  }

  if (cadence === 'weekday') {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return formatLocalDate(d);
  }

  if (cadence === 'weekly') {
    const dow = rule.dow;
    if (dow !== undefined && dow !== null) {
      return nextFutureOccurrenceOfDow(dow, d);
    }
    d.setDate(d.getDate() + 7);
    return formatLocalDate(d);
  }

  if (cadence === 'monthly') {
    const dom = rule.dom ?? d.getDate();
    // Move to the same day next month (or further if we somehow land same/earlier).
    let year = d.getFullYear();
    let month = d.getMonth() + 1;
    let candidate = clampedDate(year, month, dom);
    // If still not strictly after fromDate (edge cases), keep advancing months.
    while (formatLocalDate(candidate) <= formatLocalDate(d)) {
      month += 1;
      if (month > 11) { month = 0; year += 1; }
      candidate = clampedDate(year, month, dom);
    }
    return formatLocalDate(candidate);
  }

  // custom: every_N_days | every_N_weeks | every_N_months
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (m[2] === 'day') {
      d.setDate(d.getDate() + n);
      return formatLocalDate(d);
    }
    if (m[2] === 'week') {
      if (rule.dow !== undefined && rule.dow !== null) {
        // Advance N weeks from fromDate, then snap to that DOW on/after.
        d.setDate(d.getDate() + n * 7);
        return nextOccurrenceOfDow(rule.dow, d);
      }
      d.setDate(d.getDate() + n * 7);
      return formatLocalDate(d);
    }
    if (m[2] === 'month') {
      const dom = rule.dom ?? d.getDate();
      let year = d.getFullYear();
      let month = d.getMonth() + n;
      year += Math.floor(month / 12);
      month = ((month % 12) + 12) % 12;
      let candidate = clampedDate(year, month, dom);
      // Ensure strictly after fromDate.
      while (formatLocalDate(candidate) <= formatLocalDate(d)) {
        month += n;
        year += Math.floor(month / 12);
        month = ((month % 12) + 12) % 12;
        candidate = clampedDate(year, month, dom);
      }
      return formatLocalDate(candidate);
    }
  }

  // fallback
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
}

/**
 * Keep advancing until the result is strictly after `today` (default: real today).
 * Used for late-completion catch-up on rolling tasks.
 *
 * Starts by taking one step from `fromDate` (the previous due), then continues
 * if needed so the schedule never drifts from the original anchor grid.
 */
export function nextFutureOccurrence(rule, fromDate, today = todayStr()) {
  let cur = typeof fromDate === 'string' ? fromDate : formatLocalDate(fromDate);
  let guard = 0;
  do {
    cur = nextOccurrence(rule, cur);
    guard += 1;
    if (guard > 1000) break; // safety
  } while (cur <= today);
  return cur;
}

/**
 * First occurrence of the rule on or after `fromDate` (inclusive).
 * Used when picking the initial due date for a new rolling/series task.
 */
export function firstOccurrenceOnOrAfter(rule, fromDate) {
  const cadence = rule?.cadence || 'daily';
  const base = typeof fromDate === 'string' ? fromDate : formatLocalDate(fromDate);
  const d = parseLocalDate(base);
  d.setHours(0, 0, 0, 0);

  if (cadence === 'daily') {
    return base;
  }

  if (cadence === 'weekday') {
    if (d.getDay() >= 1 && d.getDay() <= 5) return base;
    return nextOccurrence(rule, base);
  }

  if (cadence === 'weekly') {
    const dow = rule.dow;
    if (dow === undefined || dow === null) return base;
    return nextOccurrenceOfDow(dow, base);
  }

  if (cadence === 'monthly') {
    const dom = rule.dom ?? d.getDate();
    const candidate = clampedDate(d.getFullYear(), d.getMonth(), dom);
    const candStr = formatLocalDate(candidate);
    if (candStr >= base) return candStr;
    return nextOccurrence(rule, base);
  }

  // Intervals: if fromDate is already on the grid we accept it as first.
  // For every_N_weeks with DOW, snap to that DOW on/after fromDate.
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m && m[2] === 'week' && rule.dow !== undefined && rule.dow !== null) {
    return nextOccurrenceOfDow(rule.dow, base);
  }
  if (m && m[2] === 'month') {
    const dom = rule.dom ?? d.getDate();
    const candidate = clampedDate(d.getFullYear(), d.getMonth(), dom);
    const candStr = formatLocalDate(candidate);
    if (candStr >= base) return candStr;
    return nextOccurrence(rule, base);
  }

  return base;
}

/**
 * Enumerate occurrence dates for a series.
 *
 * @param {object} rule
 * @param {{ start: string, until?: string|null, count?: number|null, max?: number }} opts
 *   - start: first candidate date (inclusive); will be snapped via firstOccurrenceOnOrAfter
 *   - until: inclusive end date (optional)
 *   - count: max number of occurrences (optional; default 10 if neither until nor count)
 *   - max: hard cap (default 365)
 * @returns {string[]} YYYY-MM-DD dates
 */
export function enumerateOccurrences(rule, opts = {}) {
  const {
    start,
    until = null,
    count = null,
    max = 365,
  } = opts;

  if (!start) return [];

  const untilStr = until || null;
  // count wins as a hard limit; if only until is set, generate until that date
  // (capped by max). If neither, default to 10 occurrences.
  const maxCount = (count != null && count > 0)
    ? count
    : (untilStr ? max : 10);

  const dates = [];
  let cursor = firstOccurrenceOnOrAfter(rule, start);

  while (dates.length < maxCount && dates.length < max) {
    if (untilStr && cursor > untilStr) break;
    dates.push(cursor);
    const next = nextOccurrence(rule, cursor);
    if (next <= cursor) break; // safety against non-advancing rules
    cursor = next;
  }

  return dates;
}

// ── Labels ────────────────────────────────────────────────────────────────────

/**
 * Human-readable cadence for UI badges / meta.
 * Accepts a task or a rule-like object.
 */
export function cadenceLabel(taskOrRule) {
  if (!taskOrRule) return '';
  const cadence = taskOrRule.recurring_cadence || taskOrRule.cadence;
  if (!cadence) return '';

  const dow = taskOrRule.recurring_dow ?? taskOrRule.dow ?? null;
  const dom = taskOrRule.recurring_dom ?? taskOrRule.dom ?? null;

  if (cadence === 'daily') return 'daily';
  if (cadence === 'weekday') return 'weekdays';

  if (cadence === 'weekly') {
    let resolvedDow = dow;
    if ((resolvedDow === null || resolvedDow === undefined) && taskOrRule.due_date) {
      resolvedDow = parseLocalDate(taskOrRule.due_date).getDay();
    }
    const dayName = (resolvedDow !== null && resolvedDow !== undefined)
      ? DOW_NAMES[resolvedDow]
      : null;
    return dayName ? `weekly on ${dayName}` : 'weekly';
  }

  if (cadence === 'monthly') {
    let resolvedDom = dom;
    if ((resolvedDom === null || resolvedDom === undefined) && taskOrRule.due_date) {
      resolvedDom = parseLocalDate(taskOrRule.due_date).getDate();
    }
    if (resolvedDom != null) {
      return `monthly on the ${ordinal(resolvedDom)}`;
    }
    return 'monthly';
  }

  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    let base = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
    if (unit === 'week' && dow !== null && dow !== undefined) {
      base += ` on ${DOW_NAMES[dow]}`;
    }
    if (unit === 'month' && dom != null) {
      base += ` on the ${ordinal(dom)}`;
    }
    return base;
  }

  return cadence;
}

export function modeLabel(task) {
  if (!task?.recurring) return '';
  if (task.recurring_type === 'expand' || task.is_recurring_template) return 'Series';
  return 'Rolling';
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Short preview of upcoming dates for the form, e.g.
 * "Fri Jul 24 · Fri Jul 31 · Fri Aug 7"
 */
export function previewOccurrences(rule, start, n = 3) {
  const dates = enumerateOccurrences(rule, { start, count: n, max: n });
  return dates.map(formatPreviewDate).join(' · ');
}

function formatPreviewDate(dateStr) {
  const d = parseLocalDate(dateStr);
  const dow = DOW_SHORT[d.getDay()];
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${dow} ${mon} ${d.getDate()}`;
}

// ── Cadence serialisation (form ↔ string) ─────────────────────────────────────

export function parseCadenceString(cadence) {
  if (!cadence) {
    return { isCustom: false, preset: 'daily', customN: 2, customUnit: 'days' };
  }
  if (cadence === 'daily' || cadence === 'weekday' || cadence === 'weekly' || cadence === 'monthly') {
    return { isCustom: false, preset: cadence, customN: 2, customUnit: 'days' };
  }
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) {
    return {
      isCustom: true,
      preset: 'daily',
      customN: parseInt(m[1], 10),
      customUnit: m[2] + 's',
    };
  }
  return { isCustom: false, preset: 'daily', customN: 2, customUnit: 'days' };
}

export function serialiseCadence(isCustom, preset, customN, customUnit) {
  if (!isCustom) return preset;
  const unit = (customUnit || 'days').replace(/s$/, '');
  return `every_${customN || 1}_${unit}s`;
}

// Back-compat aliases used by older call sites during migration
export const nextScheduledDate = (cadence, fromDate, dow) =>
  nextOccurrence({ cadence, dow: dow ?? null, dom: null }, fromDate);

export const nextFutureScheduledDate = (cadence, fromDate, dow) =>
  nextFutureOccurrence({ cadence, dow: dow ?? null, dom: null }, fromDate);
