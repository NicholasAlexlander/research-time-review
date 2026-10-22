import test from 'node:test';
import assert from 'node:assert/strict';
import {daySchedule,monthDates} from './calendar.mjs';

test('2026 holiday and adjusted work weekend follow the published schedule',()=>{
  assert.deepEqual([daySchedule('2026-09-20').kind,daySchedule('2026-09-25').kind,daySchedule('2026-09-27').kind],['makeup','holiday','holiday']);
  assert.equal(daySchedule('2026-10-10').rest,false);
  assert.equal(daySchedule('2026-09-19').label,'周六');
});
test('2025 adjusted days and unpublished future years are labeled conservatively',()=>{
  assert.equal(daySchedule('2025-01-26').rest,false);
  assert.equal(daySchedule('2025-10-08').label,'国庆节·中秋节假期');
  assert.equal(daySchedule('2027-01-03').official,false);
  assert.equal(daySchedule('2027-01-03').label,'周日');
});
test('month grid starts on Monday',()=>{
  assert.equal(monthDates(2026,9).offset,1);
  assert.equal(monthDates(2026,9).dates.length,30);
});
