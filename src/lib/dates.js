// All dates in the app are local calendar dates as 'YYYY-MM-DD' strings.
// Jamaica is UTC-5 with no daylight saving, but nothing here assumes that.

const pad = (n) => String(n).padStart(2, '0')

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Noon local time avoids off-by-one surprises around midnight and DST.
export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

export function addDays(iso, n) {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / 86400000)
}

// Shift workers eat across midnight. With dayStartHour = 4, a 2am snack
// after a night shift still counts toward the previous day's log.
export function logicalToday(dayStartHour = 0, now = new Date()) {
  const d = new Date(now)
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1)
  return toISODate(d)
}

export function lastNDates(endIso, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endIso, -i))
  return out
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const LONG_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

export function formatDayLabel(iso, todayIso) {
  const diff = daysBetween(todayIso, iso)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  return DAY_FMT.format(parseISODate(iso))
}

export function formatShortDate(iso) {
  return SHORT_FMT.format(parseISODate(iso))
}

export function formatLongDate(iso) {
  return LONG_FMT.format(parseISODate(iso))
}

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short' })

// Goal dates can be years away: "12 Mar" this year, "Mar ’28" otherwise
// (short enough for a third-width stat tile).
export function formatEta(iso, todayIso) {
  if (iso.slice(0, 4) === todayIso.slice(0, 4)) return formatShortDate(iso)
  return `${MONTH_FMT.format(parseISODate(iso))} ’${iso.slice(2, 4)}`
}

// How far away a date is, roughly: "in 3 days", "in 5 weeks", "in 7 months".
export function formatTimeUntil(iso, todayIso) {
  const days = daysBetween(todayIso, iso)
  if (days <= 0) return 'now'
  if (days < 14) return `in ${days} day${days === 1 ? '' : 's'}`
  if (days < 7 * 26) return `in ${Math.round(days / 7)} weeks`
  const months = Math.round(days / 30.44)
  return months < 24 ? `in ${months} months` : `in ${Math.round(months / 12)} years`
}
