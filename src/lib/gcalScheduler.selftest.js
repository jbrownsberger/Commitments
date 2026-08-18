import assert from 'node:assert/strict';
import { intervalLocalDates, subtractCommitmentsBlocks } from './gcalScheduler.js';

const split = subtractCommitmentsBlocks([
  { start: '2026-08-18T09:00:00.000Z', end: '2026-08-18T12:00:00.000Z' },
], [{ startMs: Date.parse('2026-08-18T10:00:00.000Z'), endMs: Date.parse('2026-08-18T11:00:00.000Z') }]);
assert.deepEqual(split, [
  { start: '2026-08-18T09:00:00.000Z', end: '2026-08-18T10:00:00.000Z' },
  { start: '2026-08-18T11:00:00.000Z', end: '2026-08-18T12:00:00.000Z' },
]);

const spanning = intervalLocalDates('2026-08-18T23:30:00.000Z', '2026-08-20T00:30:00.000Z');
assert.ok(spanning.length >= 2, 'an interval spanning midnight must be considered on each local day');
assert.equal(new Set(spanning).size, spanning.length);

console.log('gcalScheduler self-test passed');
