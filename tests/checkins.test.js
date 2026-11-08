import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PER_DAY, buildCheckinContext, checkinDue, checkinFingerprint } from '../src/lib/checkins.js'
import { isKeyboardOpen, keyboardInset } from '../src/lib/viewport.js'

const H = 3600e3
const T0 = Date.parse('2026-11-08T12:00:00Z')
const last = (hoursAgo, fp = 'a', log_date = '2026-11-08') => ({ log_date, fingerprint: fp, created_at: new Date(T0 - hoursAgo * H).toISOString() })
const base = { now: T0, today: '2026-11-08', fingerprint: 'b' }

test('check-in: first one is due straight away', () => {
  assert.equal(checkinDue({ ...base, last: null }), true)
})

test('check-in: waits the interval, then only if something changed', () => {
  assert.equal(checkinDue({ ...base, last: last(1) }), false)
  assert.equal(checkinDue({ ...base, last: last(3.1) }), true) // changed
  assert.equal(checkinDue({ ...base, fingerprint: 'a', last: last(3.1) }), false) // nothing new
  assert.equal(checkinDue({ ...base, fingerprint: 'a', last: last(6.1) }), true) // gentle reminder
  assert.equal(checkinDue({ ...base, everyHours: 2, last: last(2.5) }), true)
})

test('check-in: new day, off switch, daily cap and failure pause', () => {
  assert.equal(checkinDue({ ...base, last: last(0.5, 'b', '2026-11-07') }), true)
  assert.equal(checkinDue({ ...base, last: null, everyHours: 0 }), false)
  assert.equal(checkinDue({ ...base, last: null, todayCount: MAX_PER_DAY }), false)
  assert.equal(checkinDue({ ...base, last: null, failedAt: T0 - 0.5 * H }), false)
  assert.equal(checkinDue({ ...base, last: null, failedAt: T0 - 1.5 * H }), true)
})

test('check-in fingerprint changes with what is logged', () => {
  const a = checkinFingerprint({ entries: [{ calories: 300, servings: 1 }] })
  const b = checkinFingerprint({ entries: [{ calories: 300, servings: 1 }], waterMl: 500 })
  assert.notEqual(a, b)
  assert.equal(a, checkinFingerprint({ entries: [{ calories: 300, servings: 1 }], waterMl: 100 })) // under a glass: same
})

test('check-in context is compact and lists what is missing', () => {
  const ctx = buildCheckinContext({
    now: new Date(2026, 10, 8, 14, 5),
    today: '2026-11-08',
    profile: { display_name: 'R', sex: 'male', units: 'imperial', goal_weight_kg: 85 },
    targets: { calories: 2100, protein: 150, carbs: 220, fat: 65 },
    entries: [{ meal: 'breakfast', name: 'Ackee and saltfish', servings: 1, calories: 380, protein_g: 22, carbs_g: 8, fat_g: 29 }],
    recentDaily: { '2026-11-05': { calories: 1900, protein: 120 }, '2026-11-07': { calories: 2200, protein: 140 }, '2026-11-08': { calories: 380 } },
    previous: { headline: 'Good start', tips: [{ text: 'Drink water' }] },
  })
  assert.equal(ctx.local_time, '14:05')
  assert.deepEqual(ctx.so_far_today.meals_not_logged, ['lunch', 'dinner', 'snack'])
  assert.equal(ctx.so_far_today.kcal, 380)
  assert.deepEqual(ctx.previous_days.map((d) => d.date), ['2026-11-05', '2026-11-07'])
  assert.deepEqual(ctx.previous_checkin.tips, ['Drink water'])
  assert.ok(JSON.stringify(ctx).length < 1500)
})

test('keyboard inset: detects the iPhone keyboard, ignores toolbars and zoom', () => {
  assert.equal(keyboardInset({ layoutHeight: 844, vvHeight: 500, vvTop: 0 }), 344)
  assert.equal(keyboardInset({ layoutHeight: 844, vvHeight: 450, vvTop: 60 }), 334) // Safari panned the page
  assert.equal(isKeyboardOpen(keyboardInset({ layoutHeight: 844, vvHeight: 790 })), false) // toolbar change
  assert.equal(keyboardInset({ layoutHeight: 844, vvHeight: 400, scale: 2 }), 0) // pinch zoom
})
