import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime, logTimeToIso, timeInputValue } from '../src/lib/dates.js'

test('logTimeToIso: a time on a logged day, with times before the day start on the next morning', () => {
  const local = (iso) => {
    const d = new Date(iso)
    return [d.getDate(), d.getHours(), d.getMinutes()]
  }
  assert.deepEqual(local(logTimeToIso('2026-11-12', '07:05')), [12, 7, 5])
  assert.deepEqual(local(logTimeToIso('2026-11-12', '02:30', 4)), [13, 2, 30])
  assert.deepEqual(local(logTimeToIso('2026-11-12', '04:00', 4)), [12, 4, 0])
  assert.equal(logTimeToIso('2026-11-12', ''), null)
  assert.equal(logTimeToIso('2026-11-12', '25:00'), null)
})

test('timeInputValue and formatTime round-trip a local time', () => {
  const iso = logTimeToIso('2026-11-12', '18:45')
  assert.equal(timeInputValue(iso), '18:45')
  assert.equal(formatTime(iso), '6:45 pm')
  assert.equal(formatTime(null), '')
})
