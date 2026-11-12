// Apple Fitness workouts, from the Health app's "Export All Health Data" file.
//
// A web app can't read HealthKit, so the export is the way in: the Health app
// writes export.zip (apple_health_export/export.xml inside). It is read here,
// on the phone, as a stream: the file can be hundreds of MB and is never
// uploaded or held in memory whole.
//
// Pure apart from web-standard globals (Blob, DecompressionStream,
// TextDecoderStream), which Safari 16.4+ and Node 18+ both have.

import { addDays } from './dates.js'
import { WORKOUT_GROUPS, WORKOUT_TYPE_BY_KEY } from '../data/appleWorkouts.js'

// Apple type -> how the app stores it (see src/data/appleWorkouts.js). Types
// that fit the existing forms map onto them (indoor walk/run -> treadmill,
// strength -> weights...), so they can be edited like any other workout;
// everything else is kind 'other'.
export const GROUPS = WORKOUT_GROUPS

const PREFIX = 'HKWorkoutActivityType'
const splitWords = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** 'HKWorkoutActivityTypeTraditionalStrengthTraining' -> its row in TYPES (or a generic one). */
export function appleType(raw) {
  const key = String(raw || '').replace(PREFIX, '') || 'Other'
  const t = WORKOUT_TYPE_BY_KEY[key]
  if (t) return t
  const label = splitWords(key)
  return { key, label: label.charAt(0) + label.slice(1).toLowerCase(), group: 'other', fallback: 'bodyweight', met: 4 }
}

// ---------- one <Workout> element ----------

const attrs = (tag) => {
  const out = {}
  for (const m of tag.matchAll(/([A-Za-z_:]+)="([^"]*)"/g)) out[m[1]] = decode(m[2])
  return out
}
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()])

const KM = { km: 1, m: 0.001, mi: 1.609344, yd: 0.0009144, ft: 0.0003048 }
const toKm = (v, unit) => (Number.isFinite(v) && KM[unit] ? v * KM[unit] : null)
// Health writes kcal as "Cal" or "kcal"; some apps use kJ.
const toKcal = (v, unit) => (!Number.isFinite(v) ? null : /^kj$/i.test(unit || '') ? v / 4.184 : v)
const toMin = (v, unit) => (!Number.isFinite(v) ? null : unit === 's' ? v / 60 : unit === 'hr' || unit === 'h' ? v * 60 : v)

/**
 * A short, stable, uuid-shaped id from a string: the same workout imported
 * twice (or from two devices) gets the same id, so it can never be added twice.
 */
export function stableId(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0xdeadbeef, h4 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
    h3 = Math.imul(h3 ^ c, 0xc2b2ae35)
    h4 = Math.imul(h4 ^ c, 0x27d4eb2f)
  }
  h1 = Math.imul(h1 ^ (h2 >>> 15), 0x2c1b3c6d)
  h2 = Math.imul(h2 ^ (h3 >>> 13), 0x297a2d39)
  h3 = Math.imul(h3 ^ (h4 >>> 16), 0x85ebca6b)
  h4 = Math.imul(h4 ^ (h1 >>> 13), 0xc2b2ae35)
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('')
  // Shaped as a version-4 uuid so the database's uuid column takes it.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Parse one <Workout ...>...</Workout> block from export.xml into a workout
 * ready for store.importWorkouts, or null if it isn't usable.
 *   dayStartHour: a 2am workout after a night shift counts toward the day before
 *   weightKg:     for an estimate when Health has no energy figure
 */
export function parseWorkout(xml, { dayStartHour = 0, weightKg = null } = {}) {
  const open = xml.match(/^<Workout\s[^>]*>/)
  if (!open) return null
  const a = attrs(open[0])
  const start = a.startDate || ''
  const d = start.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
  if (!d) return null
  const type = appleType(a.workoutActivityType)

  let minutes = toMin(Number(a.duration), a.durationUnit)
  let kcal = toKcal(Number(a.totalEnergyBurned), a.totalEnergyBurnedUnit)
  let km = toKm(Number(a.totalDistance), a.totalDistanceUnit)
  // iOS 16+ moved the totals into <WorkoutStatistics> children.
  for (const m of xml.matchAll(/<WorkoutStatistics\s[^>]*>/g)) {
    const s = attrs(m[0])
    const sum = Number(s.sum)
    if (/ActiveEnergyBurned$/.test(s.type) && !(kcal > 0)) kcal = toKcal(sum, s.unit)
    else if (/Distance/.test(s.type) && !(km > 0)) km = toKm(sum, s.unit)
  }
  if (!(minutes > 0) && a.endDate) {
    const t0 = Date.parse(start.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'))
    const t1 = Date.parse(a.endDate.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (t1 > t0) minutes = (t1 - t0) / 60000
  }
  if (!(minutes > 0)) return null
  minutes = Math.min(600, Math.round(minutes * 10) / 10)

  const indoorMeta = xml.match(/<MetadataEntry key="HKIndoorWorkout" value="(\d)"/)
  const indoor = indoorMeta ? indoorMeta[1] === '1' : null
  const name = type.inOut && indoor != null ? `${indoor ? 'Indoor' : 'Outdoor'} ${type.label.toLowerCase()}` : type.label

  const hour = Number(d[2])
  const log_date = hour < dayStartHour ? addDays(d[1], -1) : d[1]
  const estimated = !(kcal > 0)
  if (estimated) kcal = weightKg ? ((type.met - 1) * weightKg * minutes) / 60 : 0
  km = km > 0 ? Math.round(Math.min(100, km) * 100) / 100 : null

  const w = {
    id: stableId(`apple|${start}|${type.key}`),
    log_date,
    started_at: start, // for display and sorting only; not stored
    group: type.group, // ditto
    source: 'apple',
    name: name.slice(0, 120),
    duration_min: minutes,
    distance_km: km,
    calories_burned: Math.max(0, Math.min(5000, Math.round(kcal))),
    calories_source: estimated ? 'estimate' : 'device',
    notes: a.sourceName ? `From ${a.sourceName}`.slice(0, 1000) : null,
  }
  if (indoor && (type.key === 'Walking' || type.key === 'Running') && km) {
    // A treadmill session: keep it editable in the treadmill form.
    const speed = Math.round((km / (minutes / 60)) * 10) / 10
    if (speed > 0 && speed <= 25) return { ...w, kind: 'treadmill', mode: type.key === 'Running' ? 'run' : 'walk', speed_kmh: speed, incline_pct: 0 }
  }
  if (type.home) return { ...w, kind: 'home', activity: type.home, intensity: 'moderate', exercises: [] }
  return { ...w, kind: 'other', activity: type.fallback, intensity: 'moderate' }
}

// ---------- streaming the file ----------

/**
 * Pull every <Workout> out of a stream of text chunks (export.xml is mostly
 * other records; workouts are a tiny part of it).
 * @param {AsyncIterable<string>} chunks
 * @param {(xml:string)=>void} onWorkout
 */
export async function scanWorkouts(chunks, onWorkout) {
  let buf = ''
  let n = 0
  for await (const chunk of chunks) {
    buf += chunk
    for (;;) {
      const i = buf.indexOf('<Workout ')
      if (i < 0) {
        buf = buf.slice(-9) // a tag split across chunks
        break
      }
      if (i > 0) buf = buf.slice(i)
      const gt = buf.indexOf('>')
      if (gt < 0) break
      let end
      if (buf[gt - 1] === '/') end = gt + 1
      else {
        const close = buf.indexOf('</Workout>', gt)
        if (close < 0) break
        end = close + 10
      }
      onWorkout(buf.slice(0, end))
      n++
      buf = buf.slice(end)
    }
  }
  return n
}

async function* textChunks(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

// Counts the raw bytes going through, for a progress bar.
const counter = (onBytes) => {
  let seen = 0
  return new TransformStream({
    transform(chunk, ctl) {
      seen += chunk.byteLength
      onBytes?.(seen)
      ctl.enqueue(chunk)
    },
  })
}

const u16 = (v, o) => v.getUint16(o, true)
const u32 = (v, o) => v.getUint32(o, true)
const u64 = (v, o) => Number(v.getBigUint64(o, true))
const view = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer())

/**
 * Find a file inside a zip without reading the rest of it.
 * Returns { offset, size, method } of the stored data, or null.
 */
export async function findZipEntry(blob, test) {
  const tailLen = Math.min(blob.size, 65557)
  const tail = await view(blob, blob.size - tailLen, blob.size)
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('That file isn’t a zip. Choose export.zip from the Health app.')
  let count = u16(tail, eocd + 10)
  let cdSize = u32(tail, eocd + 12)
  let cdOffset = u32(tail, eocd + 16)
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    // Zip64: the real numbers are in the zip64 end record.
    const loc = eocd - 20
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('This zip is in a format that can’t be read here.')
    const recAt = u64(tail, loc + 8)
    const rec = await view(blob, recAt, recAt + 56)
    count = u64(rec, 32)
    cdSize = u64(rec, 40)
    cdOffset = u64(rec, 48)
  }
  const cd = await view(blob, cdOffset, cdOffset + cdSize)
  const names = new TextDecoder()
  let p = 0
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (u32(cd, p) !== 0x02014b50) break
    const method = u16(cd, p + 10)
    let size = u32(cd, p + 20)
    let usize = u32(cd, p + 24)
    const nameLen = u16(cd, p + 28)
    const extraLen = u16(cd, p + 30)
    const commentLen = u16(cd, p + 32)
    let local = u32(cd, p + 42)
    const name = names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen))
    if (test(name)) {
      // Zip64 extra field: the 8-byte values for whichever fields were maxed out.
      let e = p + 46 + nameLen
      const eEnd = e + extraLen
      while (e + 4 <= eEnd) {
        const id = u16(cd, e)
        const len = u16(cd, e + 2)
        if (id === 1) {
          let q = e + 4
          if (usize === 0xffffffff) { usize = u64(cd, q); q += 8 }
          if (size === 0xffffffff) { size = u64(cd, q); q += 8 }
          if (local === 0xffffffff) local = u64(cd, q)
        }
        e += 4 + len
      }
      const lh = await view(blob, local, local + 30)
      if (u32(lh, 0) !== 0x04034b50) throw new Error('The zip looks damaged. Try exporting again.')
      return { name, method, size, offset: local + 30 + u16(lh, 26) + u16(lh, 28) }
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/**
 * Read workouts from export.zip (or an unzipped export.xml).
 * @param {Blob} file
 * @param {{ dayStartHour?:number, weightKg?:number, onProgress?:(fraction:number, found:number)=>void }} [opts]
 * @returns {Promise<object[]>} newest first
 */
export async function readAppleWorkouts(file, { dayStartHour = 0, weightKg = null, onProgress } = {}) {
  const found = []
  let bytes = file
  let total = file.size
  let stream
  const isZip = /\.zip$/i.test(file.name || '') || (await file.slice(0, 2).text()) === 'PK'
  if (isZip) {
    const entry = await findZipEntry(file, (n) => /(^|\/)export\.xml$/i.test(n))
    if (!entry) throw new Error('No export.xml in that zip. Choose the export.zip the Health app made.')
    if (entry.method !== 0 && entry.method !== 8) throw new Error('This zip is compressed in a way that can’t be read here.')
    bytes = file.slice(entry.offset, entry.offset + entry.size)
    total = entry.size
    if (entry.method === 8 && typeof DecompressionStream === 'undefined') throw new Error('Update iOS to read the zip here, or unzip it in Files and choose export.xml.')
    stream = bytes.stream().pipeThrough(counter((b) => onProgress?.(b / total, found.length)))
    if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'))
  } else {
    stream = bytes.stream().pipeThrough(counter((b) => onProgress?.(b / total, found.length)))
  }
  let blocks = 0
  await scanWorkouts(textChunks(stream), (xml) => {
    blocks++
    const w = parseWorkout(xml, { dayStartHour, weightKg })
    if (w) found.push(w)
  })
  if (!blocks && !isZip && !/<HealthData|<!DOCTYPE HealthData/i.test(await file.slice(0, 4096).text())) {
    throw new Error('That doesn’t look like a Health export. Choose export.zip or export.xml.')
  }
  onProgress?.(1, found.length)
  // One workout recorded by both iPhone and Watch has the same start and type: keep one.
  const byId = new Map()
  for (const w of found) if (!byId.has(w.id) || w.calories_burned > byId.get(w.id).calories_burned) byId.set(w.id, w)
  return [...byId.values()].sort((x, y) => (x.started_at < y.started_at ? 1 : -1))
}

/** Free-text search over imported workouts: name, type, month, weekday, source. */
export function matchesWorkout(w, query) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return true
  const [y, m, d] = w.log_date.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  const hay = [
    w.name,
    GROUPS[w.group]?.label,
    w.notes,
    date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    w.log_date,
  ].join(' ').toLowerCase()
  return q.split(/\s+/).every((t) => hay.includes(t))
}
