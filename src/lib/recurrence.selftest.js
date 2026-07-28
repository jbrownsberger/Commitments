/**
 * Lightweight smoke tests for the pure recurrence engine.
 * Run: node src/lib/recurrence.selftest.js
 */
import {
  nextOccurrence,
  nextFutureOccurrence,
  firstOccurrenceOnOrAfter,
  enumerateOccurrences,
  cadenceLabel,
  previewOccurrences,
} from './recurrence.js';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

// Weekly
assert(nextOccurrence({ cadence: 'weekly', dow: 2 }, '2026-07-20') === '2026-07-21', 'weekly Tue after Mon');
assert(nextOccurrence({ cadence: 'weekly', dow: 2 }, '2026-07-21') === '2026-07-28', 'weekly Tue after Tue');

// Weekdays (Fri Jul 24 2026 → Mon Jul 27)
assert(nextOccurrence({ cadence: 'weekday' }, '2026-07-24') === '2026-07-27', 'weekday Fri→Mon');
assert(nextOccurrence({ cadence: 'weekday' }, '2026-07-27') === '2026-07-28', 'weekday Mon→Tue');

// Monthly day-of-month clamp
assert(nextOccurrence({ cadence: 'monthly', dom: 31 }, '2026-01-31') === '2026-02-28', 'Jan31→Feb28');
assert(nextOccurrence({ cadence: 'monthly', dom: 31 }, '2026-02-28') === '2026-03-31', 'Feb28→Mar31');

// Interval
assert(nextOccurrence({ cadence: 'every_3_weeks' }, '2026-07-01') === '2026-07-22', 'every 3 weeks');
assert(nextOccurrence({ cadence: 'every_2_days' }, '2026-07-01') === '2026-07-03', 'every 2 days');

// Late catch-up
assert(
  nextFutureOccurrence({ cadence: 'weekly', dow: 1 }, '2026-06-01', '2026-07-20') === '2026-07-27',
  'late weekly Mon catch-up',
);

// First occurrence on/after
assert(firstOccurrenceOnOrAfter({ cadence: 'weekly', dow: 5 }, '2026-07-22') === '2026-07-24', 'first Fri');
assert(firstOccurrenceOnOrAfter({ cadence: 'monthly', dom: 15 }, '2026-07-20') === '2026-08-15', 'first 15th');
assert(firstOccurrenceOnOrAfter({ cadence: 'weekday' }, '2026-07-25') === '2026-07-27', 'first weekday from Sat');

// Series enumerate
const fridays = enumerateOccurrences({ cadence: 'weekly', dow: 5 }, { start: '2026-07-24', count: 5 });
assert(
  fridays.length === 5 && fridays[0] === '2026-07-24' && fridays[4] === '2026-08-21',
  'series 5 Fridays',
);

const untilDates = enumerateOccurrences({ cadence: 'daily' }, { start: '2026-07-01', until: '2026-07-03' });
assert(untilDates.join(',') === '2026-07-01,2026-07-02,2026-07-03', 'until inclusive');

// Labels
assert(cadenceLabel({ recurring_cadence: 'monthly', recurring_dom: 31 }) === 'monthly on the 31st', 'label monthly');
assert(cadenceLabel({ recurring_cadence: 'weekly', recurring_dow: 2 }) === 'weekly on Tuesday', 'label weekly');
assert(cadenceLabel({ recurring_cadence: 'every_3_weeks' }) === 'every 3 weeks', 'label every 3 weeks');

// Preview non-empty
assert(previewOccurrences({ cadence: 'daily' }, '2026-07-01', 3).includes('Jul'), 'preview');

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
