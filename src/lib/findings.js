// Patterns in the user's own log, worked out here (not by the AI) so they're
// real: each one needs a minimum number of days and a difference big enough
// to matter, or it stays quiet. Mimi's check-ins and chat get the top few as
// plain facts and only phrase them. A small model asked to "find patterns" in
// raw rows finds them in noise.
//
// Pure: no React or storage. Unit-tested in tests/findings.test.js.

import { SYMPTOM_BY_ID } from '../data/glp1.js'
import { adaptiveTdee, dailyTotals, displayWeight, entryTotals, isLoggedDay, latestWeighIn, trendOn } from './calc.js'
import { addDays, daysBetween, logicalToday } from './dates.js'

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB')
const pct = (x) => `${Math.round(x * 100)}%`
const hours = (min) => `${(Math.round((min / 60) * 10) / 10).toFixed(1)} h`
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Foods high in salt, which holds water overnight (Jamaican staples included).
const SALTY = /\b(salt ?fish|salt mackerel|corned beef|bully beef|ham|bacon|sausages?|hot ?dogs?|salami|pepperoni|noodles?|ramen|cup soup|soup mix|cock soup|fried rice|chow mein|soy|pizza|patty|patties|fried chicken|jerk|pickled|crackers?)\b/i
// Stomach symptoms that GLP-1 medicines cause, usually a day or two after a weekly dose.
const GUT = new Set(['nausea', 'vomiting', 'constipation', 'diarrhoea', 'reflux', 'bloating'])

const SCALE_JUMP_KG = 0.7 // about 1.5 lb in a day: almost always water
const SHORT_SLEEP_MIN = 360
const GOOD_SLEEP_MIN = 420

/**
 * @param {object} o
 * @param {string} o.today            logical today ('YYYY-MM-DD')
 * @param {object[]} [o.entries]      food entries, the last 60 days or so
 * @param {object[]} [o.dailyLogs]    daily check-in rows (water, symptoms, sleep, steps), last 90 days or so
 * @param {object[]} [o.weights]      weigh-ins
 * @param {object[]} [o.series]       trendSeries(weights)
 * @param {object[]} [o.doses]        recent GLP-1 doses
 * @param {object|null} [o.plan]      glp1Plan(profile)
 * @param {object|null} [o.targets]   computeTargets()
 * @param {string} [o.units]          'imperial' | 'metric'
 * @param {number} [o.dayStartHour]
 * @returns {{ id: string, score: number, text: string }[]} most useful first
 */
export function computeFindings({ today, entries = [], dailyLogs = [], weights = [], series = [], doses = [], plan = null, targets = null, units = 'imperial', dayStartHour = 0 }) {
  const daily = dailyTotals(entries)
  const logs = Object.fromEntries(dailyLogs.filter((l) => l?.log_date).map((l) => [l.log_date, l]))
  const ctx = { today, entries, daily, logs, dailyLogs, weights, series, doses, plan, targets, units, dayStartHour }
  return [scaleJump, lightDays, maintenanceGap, glp1Timing, sleepAndFood, mealPattern, topFoods, lowSteps]
    .map((f) => f(ctx))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
}

// ---------- a jump on the scale, explained ----------

export function scaleJump({ today, entries, daily, logs, weights, series, units }) {
  const newest = latestWeighIn(weights)
  if (!newest || newest.log_date < addDays(today, -1)) return null
  const before = weights.filter((w) => w.log_date < newest.log_date && w.log_date >= addDays(newest.log_date, -4))
  const prev = latestWeighIn(before)
  if (!prev) return null
  const jump = Number(newest.weight_kg) - Number(prev.weight_kg)
  if (jump < SCALE_JUMP_KG) return null
  // A trend that's really climbing isn't noise: leave that to the weekly numbers.
  const last = series[series.length - 1]
  const ref = trendOn(series, addDays(today, -7))
  const week = last && ref && ref !== last ? last.trend - ref.trend : null
  if (week != null && week > 0.25) return null

  const dayBefore = addDays(newest.log_date, -1)
  const facts = []
  const when = newest.log_date === today ? 'Today’s' : 'Yesterday’s'
  const gap = daysBetween(prev.log_date, newest.log_date)
  facts.push(`${when} weigh-in is ${displayWeight(jump, units)} above the one ${gap === 1 ? 'the day before' : `${gap} days before`}${week != null ? `, while the 7-day trend is ${week <= 0 ? '−' : '+'}${displayWeight(Math.abs(week), units)}` : ''}. A rise this size in a day is almost always water, not fat.`)
  if (newest.note) facts.push(`Note on the weigh-in: “${String(newest.note).slice(0, 80)}”.`)
  const salty = [...new Set(entries.filter((e) => e.log_date === dayBefore && SALTY.test(e.name || '')).map((e) => e.name))].slice(0, 3)
  if (salty.length) facts.push(`Salty food the day before: ${salty.join(', ')}.`)
  const carbs = daily[dayBefore]?.carbs
  const usualCarbs = avg(Object.entries(daily).filter(([d, t]) => d < dayBefore && d >= addDays(dayBefore, -14) && isLoggedDay(t)).map(([, t]) => t.carbs))
  if (carbs && usualCarbs && carbs >= usualCarbs * 1.3 && carbs - usualCarbs >= 40) facts.push(`Carbs the day before: ${fmt(carbs)} g vs about ${fmt(usualCarbs)} g usually (carbs hold water).`)
  const water = logs[dayBefore]?.water_ml
  const usualWater = avg(Object.values(logs).filter((l) => l.log_date < dayBefore && l.log_date >= addDays(dayBefore, -14) && Number(l.water_ml) > 0).map((l) => Number(l.water_ml)))
  if (water > 0 && usualWater && water <= usualWater * 0.75) facts.push(`Water the day before: ${(water / 1000).toFixed(1)} L vs about ${(usualWater / 1000).toFixed(1)} L usually.`)
  const sleep = logs[newest.log_date]?.sleep_min
  if (sleep != null && sleep < SHORT_SLEEP_MIN) facts.push(`Slept ${hours(sleep)} the night before.`)
  return { id: 'scale-jump', score: newest.log_date === today ? 0.95 : 0.7, text: facts.join(' ') }
}

// ---------- signs that food is going unlogged ----------

export function lightDays({ today, daily, targets, plan }) {
  const from = addDays(today, -14)
  const days = Object.entries(daily).filter(([d, t]) => d >= from && d < today && t.count > 0)
  if (days.length < 6) return null
  const bar = Math.max(800, Math.round(((targets?.calories || 0) * 0.55) / 50) * 50)
  const light = days.filter(([, t]) => t.calories < bar)
  if (light.length < 4) return null
  const why = plan
    ? 'On a GLP-1 these may be real low-intake days (a problem of its own); otherwise a meal or snacks probably went unlogged.'
    : 'Those days probably miss a meal or snacks, which makes the totals and the maintenance estimate look lower than they are.'
  return { id: 'light-days', score: 0.55, text: `On ${light.length} of the ${days.length} days with food logged in the last 2 weeks, under ${fmt(bar)} kcal was logged. ${why}` }
}

export function maintenanceGap({ today, daily, series, targets }) {
  if (!targets?.tdee) return null
  const a = adaptiveTdee({ daily, series, endDate: addDays(today, -1) })
  if (!a || a.confidence === 'low') return null
  const gap = targets.tdee - a.tdee
  if (gap < 350) return null
  return {
    id: 'maintenance-gap',
    score: 0.5,
    text: `Maintenance measured from logged food and the weight trend is about ${fmt(a.tdee)} kcal a day (${a.loggedDays} logged days), ${fmt(gap)} below the formula’s ${fmt(targets.tdee)}. Either some food isn’t being logged, or maintenance really is lower than the formula says (it can be 10% or more out for some people).`,
  }
}

// ---------- GLP-1: what the days after a dose look like ----------

export function glp1Timing({ today, daily, logs, doses, plan }) {
  if (!plan || plan.frequency !== 'weekly') return null
  const from = addDays(today, -84)
  const days = [...new Set(doses.filter((d) => d?.log_date >= from && d.log_date <= today).map((d) => d.log_date))].sort()
  if (days.length < 3) return null
  const sinceDose = (date) => {
    let last = null
    for (const d of days) if (d <= date) last = d
    return last ? daysBetween(last, date) : null
  }
  const early = { sym: 0, logs: 0, kcal: [], hits: {} }
  const later = { sym: 0, logs: 0, kcal: [] }
  for (let d = days[0]; d < today; d = addDays(d, 1)) {
    const k = sinceDose(d)
    const g = k === 1 || k === 2 ? early : k >= 3 && k <= 6 ? later : null
    if (!g) continue
    const log = logs[d]
    if (log) {
      g.logs++
      const gut = (log.symptoms || []).filter((s) => GUT.has(s))
      if (gut.length) {
        g.sym++
        if (g.hits) for (const s of gut) g.hits[s] = (g.hits[s] || 0) + 1
      }
    }
    if (isLoggedDay(daily[d])) g.kcal.push(daily[d].calories)
  }
  const facts = []
  const eRate = early.logs ? early.sym / early.logs : 0
  const lRate = later.logs ? later.sym / later.logs : 0
  if (early.logs >= 3 && later.logs >= 4 && early.sym >= 2 && eRate >= 0.4 && eRate >= 2 * lRate) {
    const top = Object.entries(early.hits).sort((a, b) => b[1] - a[1])[0][0]
    facts.push(`Stomach symptoms (mostly ${SYMPTOM_BY_ID[top]?.label.toLowerCase() || top}) were logged on ${early.sym} of ${early.logs} check-ins 1–2 days after a dose, vs ${later.sym} of ${later.logs} later in the week.`)
  }
  const eKcal = avg(early.kcal)
  const lKcal = avg(later.kcal)
  if (early.kcal.length >= 3 && later.kcal.length >= 4 && lKcal - eKcal >= 250) {
    facts.push(`Calories 1–2 days after a dose average ${fmt(eKcal)} vs ${fmt(lKcal)} later in the week.`)
  }
  if (!facts.length) return null
  // Where today sits: in those days now, or about to be (a dose due) matters most.
  const k = sinceDose(today)
  if (k === 0) facts.push('Today is dose day.')
  else if (k <= 5) facts.push(`Today is day ${k} after the dose.`)
  else facts.push(k === 6 ? 'The next dose is due tomorrow.' : 'The next dose is due.')
  const score = k <= 2 ? 0.8 : k >= 6 ? 0.6 : 0.4
  return { id: 'glp1-timing', score, text: facts.join(' ') }
}

// ---------- sleep (Apple Health) and the next day's food ----------

export function sleepAndFood({ today, daily, dailyLogs, logs }) {
  const from = addDays(today, -90)
  const nights = dailyLogs.filter((l) => l.log_date >= from && l.log_date < today && l.sleep_min != null && isLoggedDay(daily[l.log_date]))
  const short = nights.filter((l) => l.sleep_min < SHORT_SLEEP_MIN).map((l) => daily[l.log_date].calories)
  const good = nights.filter((l) => l.sleep_min >= GOOD_SLEEP_MIN).map((l) => daily[l.log_date].calories)
  if (short.length < 4 || good.length < 4) return null
  const diff = avg(short) - avg(good)
  if (Math.abs(diff) < 150) return null
  const facts = [`After nights under 6 h of sleep, ${fmt(Math.abs(diff))} kcal ${diff > 0 ? 'more' : 'less'} was logged the next day than after 7 h or more (${plural(short.length, 'short night')} vs ${good.length}, from Apple Health).`]
  const lastNight = logs[today]?.sleep_min
  if (lastNight != null) facts.push(`Last night: ${hours(lastNight)}.`)
  return { id: 'sleep-food', score: lastNight != null && lastNight < SHORT_SLEEP_MIN ? 0.75 : 0.45, text: facts.join(' ') }
}

// ---------- when the food goes in ----------

const ms = (iso) => Date.parse(iso || '') || 0

export function mealPattern({ today, entries, daily, dayStartHour }) {
  const from = addDays(today, -28)
  const logged = Object.keys(daily).filter((d) => d >= from && d < today && isLoggedDay(daily[d]))
  if (logged.length < 10) return null
  const inWindow = entries.filter((e) => logged.includes(e.log_date))
  const facts = []

  const breakfastDays = new Set(inWindow.filter((e) => e.meal === 'breakfast').map((e) => e.log_date)).size
  const total = inWindow.reduce((s, e) => s + entryTotals(e).calories, 0)
  const evening = inWindow.filter((e) => e.meal === 'dinner' || e.meal === 'snack').reduce((s, e) => s + entryTotals(e).calories, 0)
  const eveningShare = total ? evening / total : 0
  if (breakfastDays / logged.length <= 0.5) facts.push(`Breakfast was logged on ${breakfastDays} of ${logged.length} days.`)
  if (eveningShare >= 0.6) facts.push(`Dinner and snacks are ${pct(eveningShare)} of the calories logged.`)

  // Late eating, from when each item was logged. Items logged on another day
  // (catching up) and "copy the day before" batches (several meals in the
  // same second) don't say when food was eaten, so they're left out.
  const batches = new Map()
  for (const e of inWindow) {
    const k = Math.floor(ms(e.created_at) / 1000)
    batches.set(k, (batches.get(k) || new Set()).add(e.meal))
  }
  const lateKcal = {}
  for (const e of inWindow) {
    const t = ms(e.created_at)
    if (!t || batches.get(Math.floor(t / 1000)).size > 1) continue
    const at = new Date(t)
    if (logicalToday(dayStartHour, at) !== e.log_date) continue
    const h = at.getHours()
    if (h >= 21 || h < dayStartHour) lateKcal[e.log_date] = (lateKcal[e.log_date] || 0) + entryTotals(e).calories
  }
  const lateDays = Object.values(lateKcal).filter((k) => k >= 300).length
  if (lateDays >= 4 && lateDays / logged.length >= 0.3) facts.push(`On ${lateDays} of ${logged.length} days, 300+ kcal was logged after 9 pm.`)

  if (!facts.length) return null
  return { id: 'meal-pattern', score: 0.45, text: `Last 4 weeks: ${facts.join(' ')}` }
}

// ---------- the foods behind most of the calories ----------

export function topFoods({ today, entries, daily }) {
  const from = addDays(today, -27)
  const loggedDays = Object.keys(daily).filter((d) => d >= from && isLoggedDay(daily[d])).length
  if (loggedDays < 7) return null
  const by = new Map()
  let total = 0
  for (const e of entries) {
    if (e.log_date < from || e.log_date > today) continue
    const t = entryTotals(e)
    total += t.calories
    const key = String(e.name || '').trim().toLowerCase()
    const g = by.get(key) || { name: String(e.name || '').trim(), kcal: 0, protein: 0, times: 0 }
    g.kcal += t.calories
    g.protein += t.protein
    g.times++
    by.set(key, g)
  }
  if (!total) return null
  const top = [...by.values()].sort((a, b) => b.kcal - a.kcal).filter((g) => g.kcal / total >= 0.05).slice(0, 5)
  if (!top.length || top[0].kcal / total < 0.08) return null
  const per100 = (g) => (g.kcal ? (g.protein / g.kcal) * 100 : 0)
  const list = top.map((g) => `${g.name} ${pct(g.kcal / total)} (${plural(g.times, 'time')}, ${per100(g).toFixed(1)} g protein per 100 kcal)`)
  const swap = top.slice(0, 3).find((g) => per100(g) < 3)
  return {
    id: 'top-foods',
    score: 0.35,
    text: `Biggest sources of calories over the last 4 weeks: ${list.join('; ')}.${swap ? ` Lowest in protein for its calories: ${swap.name}.` : ''}`,
  }
}

// ---------- steps (Apple Health) ----------

export function lowSteps({ today, dailyLogs }) {
  const recent = dailyLogs.filter((l) => l.steps != null && l.log_date < today && l.log_date >= addDays(today, -10))
  if (recent.length < 4) return null
  const a = avg(recent.map((l) => Number(l.steps)))
  if (a >= 5000) return null
  return { id: 'low-steps', score: 0.3, text: `Steps averaged ${fmt(a)} a day over ${recent.length} recent days (Apple Health). Under 5,000 a day counts as inactive; a 10-minute walk after meals adds about 1,000.` }
}

/** Recent sleep and steps for the AI's snapshot, or null without recent Apple Health data. */
export function recentHealth({ today, dailyLogs = [] }) {
  const recent = dailyLogs.filter((l) => l.log_date <= today && l.log_date >= addDays(today, -7))
  const sleep = recent.filter((l) => l.sleep_min != null).map((l) => l.sleep_min)
  const steps = recent.filter((l) => l.steps != null && l.log_date < today).map((l) => Number(l.steps))
  if (!sleep.length && !steps.length) return null
  const last = dailyLogs.find((l) => l.log_date === today)?.sleep_min
  return {
    sleep_avg_hours: sleep.length ? Math.round((avg(sleep) / 60) * 10) / 10 : undefined,
    sleep_last_night_hours: last != null ? Math.round((last / 60) * 10) / 10 : undefined,
    steps_avg: steps.length ? Math.round(avg(steps)) : undefined,
    days: Math.max(sleep.length, steps.length),
  }
}
