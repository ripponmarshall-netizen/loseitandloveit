import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { appleType, healthDays, matchesWorkout, parseWorkout, readAppleHealth, readAppleWorkouts, scanHealth, scanWorkouts, stableId } from '../src/lib/appleHealth.js'

const NEW = `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="32.5" durationUnit="min" sourceName="Rippon&#8217;s Apple Watch" startDate="2026-11-02 07:05:12 -0500" endDate="2026-11-02 07:37:42 -0500">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="x" endDate="y" sum="152.4" unit="Cal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="x" endDate="y" sum="1.5" unit="mi"/>
 </Workout>`
const OLD = `<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" totalEnergyBurned="210" totalEnergyBurnedUnit="kcal" sourceName="Watch" startDate="2026-11-03 02:30:00 -0500" endDate="2026-11-03 03:15:00 -0500"/>`
const TREAD = `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1800" durationUnit="s" startDate="2026-11-04 18:00:00 -0500" endDate="2026-11-04 18:30:00 -0500"><MetadataEntry key="HKIndoorWorkout" value="1"/><WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="4.5" unit="km"/><WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="1200" unit="kJ"/></Workout>`
const XML = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [ ]>\n<HealthData locale="en_JM">\n <Record type="HKQuantityTypeIdentifierStepCount" value="12"/>\n ${NEW}\n <Record type="x"/>\n ${OLD}\n ${TREAD}\n <ActivitySummary dateComponents="2026-11-04"/>\n</HealthData>\n`

test('iOS 16+ workouts read their totals from WorkoutStatistics', () => {
  const w = parseWorkout(NEW)
  assert.equal(w.log_date, '2026-11-02')
  assert.equal(w.name, 'Outdoor walk')
  assert.equal(w.kind, 'other')
  assert.equal(w.activity, 'bodyweight') // fallback before 0006
  assert.equal(w.duration_min, 32.5)
  assert.equal(w.calories_burned, 152)
  assert.equal(w.calories_source, 'device')
  assert.equal(w.distance_km, 2.41)
  assert.equal(w.source, 'apple')
  assert.equal(w.notes, 'From Rippon’s Apple Watch')
})

test('older exports use attributes; strength maps onto the at-home form; night shifts count to the day before', () => {
  const w = parseWorkout(OLD, { dayStartHour: 4 })
  assert.equal(w.log_date, '2026-11-02')
  assert.equal(w.kind, 'home')
  assert.equal(w.activity, 'weights')
  assert.equal(w.name, 'Strength training')
  assert.equal(w.calories_burned, 210)
  assert.equal(parseWorkout(OLD).log_date, '2026-11-03')
})

test('an indoor run with a distance becomes a treadmill session; seconds and kJ are converted', () => {
  const w = parseWorkout(TREAD)
  assert.equal(w.kind, 'treadmill')
  assert.equal(w.mode, 'run')
  assert.equal(w.duration_min, 30)
  assert.equal(w.speed_kmh, 9)
  assert.equal(w.calories_burned, 287)
})

test('no energy figure: estimate net calories from the type and weight', () => {
  const w = parseWorkout('<Workout workoutActivityType="HKWorkoutActivityTypeYoga" duration="60" durationUnit="min" startDate="2026-11-05 06:00:00 -0500"/>', { weightKg: 100 })
  assert.equal(w.calories_source, 'estimate')
  assert.equal(w.calories_burned, 150) // (2.5 - 1) MET x 100 kg x 1 h
  assert.equal(w.kind, 'home')
  assert.equal(parseWorkout('<Workout workoutActivityType="HKWorkoutActivityTypeYoga" startDate="nope"/>'), null)
})

test('unknown types get a readable label; ids are stable and uuid-shaped', () => {
  assert.equal(appleType('HKWorkoutActivityTypeWaterPolo').label, 'Water polo')
  assert.equal(appleType('HKWorkoutActivityTypeCricket').label, 'Cricket')
  assert.equal(stableId('a'), stableId('a'))
  assert.notEqual(stableId('a'), stableId('b'))
  assert.match(stableId('apple|x'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('the scanner finds workouts split across chunks and skips WorkoutEvent-like tags', async () => {
  async function* chunks(s, n) {
    for (let i = 0; i < s.length; i += n) yield s.slice(i, i + n)
  }
  for (const n of [1, 7, 64, 100000]) {
    const got = []
    const count = await scanWorkouts(chunks(XML, n), (x) => got.push(x))
    assert.equal(count, 3, `chunk ${n}`)
    assert.ok(got[0].startsWith('<Workout ') && got[0].endsWith('</Workout>'))
    assert.ok(got[1].endsWith('/>'))
  }
})

// A minimal zip with one entry (method 0 = stored, 8 = deflate).
function zip(name, data, method) {
  const body = method === 8 ? deflateRawSync(data) : data
  const n = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(n.length, 26)
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(method, 10)
  cd.writeUInt32LE(body.length, 20)
  cd.writeUInt32LE(data.length, 24)
  cd.writeUInt16LE(n.length, 28)
  cd.writeUInt32LE(0, 42)
  const cdOffset = 30 + n.length + body.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + n.length, 12)
  end.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, n, body, cd, n, end])
}

test('reads export.zip (deflated or stored) and a bare export.xml, newest first', async () => {
  const data = Buffer.from(XML)
  for (const method of [8, 0]) {
    const file = new File([zip('apple_health_export/export.xml', data, method)], 'export.zip')
    let last = 0
    const ws = await readAppleWorkouts(file, { onProgress: (p) => (last = p) })
    assert.equal(ws.length, 3)
    assert.deepEqual(ws.map((w) => w.log_date), ['2026-11-04', '2026-11-03', '2026-11-02'])
    assert.equal(last, 1)
  }
  const xml = await readAppleWorkouts(new File([data], 'export.xml'))
  assert.equal(xml.length, 3)
  await assert.rejects(readAppleWorkouts(new File([zip('other.txt', data, 0)], 'export.zip')), /No export.xml/)
  await assert.rejects(readAppleWorkouts(new File(['hello'], 'notes.txt')), /Health export/)
})

test('search matches name, type group, month and weekday', () => {
  const w = parseWorkout(NEW)
  assert.ok(matchesWorkout(w, 'walk'))
  assert.ok(matchesWorkout(w, 'november'))
  assert.ok(matchesWorkout(w, 'monday walk'))
  assert.ok(matchesWorkout(w, 'watch'))
  assert.ok(!matchesWorkout(w, 'swim'))
  assert.ok(matchesWorkout(w, ''))
})

// ---------- sleep and steps ----------

const step = (src, start, value, close = false) =>
  `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${src}" unit="count" startDate="${start} -0500" endDate="${start} -0500" value="${value}"${close ? '><MetadataEntry key="x" value="y"/></Record>' : '/>'}`
const sleep = (src, start, end, value = 'AsleepCore') =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${src}" startDate="${start} -0500" endDate="${end} -0500" value="HKCategoryValueSleepAnalysis${value}">\n  <MetadataEntry key="HKTimeZone" value="America/Jamaica"/>\n </Record>`
const HEALTH = [
  '<?xml version="1.0"?>\n<HealthData locale="en_JM">',
  // Steps: iPhone and Watch both count the same walk; the day takes the bigger source, not the sum.
  step('iPhone', '2026-11-02 08:00:00', 1200), step('iPhone', '2026-11-02 17:00:00', 2300, true), step('Watch', '2026-11-02 08:00:00', 4100),
  step('iPhone', '2026-11-03 02:30:00', 500), // before a 4 am day start: counts to the 2nd there
  '<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" value="61"/>',
  // Sleep ending on the morning of the 3rd: Watch stages (core and deep overlap by 10 min), plus an iPhone guess that's shorter.
  sleep('Watch', '2026-11-02 23:00:00', '2026-11-03 02:10:00'),
  sleep('Watch', '2026-11-03 02:00:00', '2026-11-03 03:00:00', 'AsleepDeep'),
  sleep('Watch', '2026-11-03 03:00:00', '2026-11-03 03:20:00', 'Awake'),
  sleep('Watch', '2026-11-03 03:20:00', '2026-11-03 06:20:00', 'AsleepREM'),
  sleep('iPhone', '2026-11-02 22:30:00', '2026-11-03 07:00:00', 'InBed'),
  sleep('iPhone', '2026-11-03 00:00:00', '2026-11-03 05:00:00', 'Asleep'),
  // A nap on the afternoon of the 3rd counts with that day; sleep ending after 6 pm counts to the next.
  sleep('Watch', '2026-11-03 14:00:00', '2026-11-03 14:30:00'),
  sleep('Watch', '2026-11-03 21:00:00', '2026-11-03 23:00:00'),
  NEW,
  '</HealthData>',
].join('\n ')

test('sleep and steps: one figure a day, the fuller source wins, overlaps counted once', () => {
  const acc = healthDays()
  for (const tag of HEALTH.match(/<Record type="HKQuantityTypeIdentifierStepCount"[^>]*>/g)) acc.steps(tag)
  for (const tag of HEALTH.match(/<Record type="HKCategoryTypeIdentifierSleepAnalysis"[^>]*>/g)) acc.sleep(tag)
  assert.deepEqual(acc.days(), [
    { log_date: '2026-11-02', steps: 4100 },
    { log_date: '2026-11-03', steps: 500, sleep_min: 7 * 60 + 30 }, // 23:00–03:00 + 03:20–06:20 + 14:00–14:30
    { log_date: '2026-11-04', sleep_min: 120 },
  ])
  const shifted = healthDays({ dayStartHour: 4 })
  for (const tag of HEALTH.match(/<Record type="HKQuantityTypeIdentifierStepCount"[^>]*>/g)) shifted.steps(tag)
  assert.deepEqual(shifted.days(), [{ log_date: '2026-11-02', steps: 4100 }]) // 3,500 + 500 from iPhone < 4,100
})

test('the scanner finds workouts, steps and sleep however the stream is chunked', async () => {
  for (const size of [7, 64, 100000]) {
    const chunks = async function* () {
      for (let i = 0; i < HEALTH.length; i += size) yield HEALTH.slice(i, i + size)
    }
    const seen = { workout: 0, steps: 0, sleep: 0 }
    const n = await scanHealth(chunks(), { workout: () => seen.workout++, steps: () => seen.steps++, sleep: () => seen.sleep++ })
    assert.deepEqual(seen, { workout: 1, steps: 4, sleep: 8 }, `chunks of ${size}`)
    assert.equal(n, 13)
  }
})

test('readAppleHealth returns the workouts and the days from one pass', async () => {
  const file = new File([zip('apple_health_export/export.xml', HEALTH, 8)], 'export.zip')
  const { workouts, days } = await readAppleHealth(file)
  assert.equal(workouts.length, 1)
  assert.deepEqual(days.map((d) => d.log_date), ['2026-11-02', '2026-11-03', '2026-11-04'])
  assert.deepEqual(await readAppleWorkouts(file).then((w) => w.length), 1)
})
