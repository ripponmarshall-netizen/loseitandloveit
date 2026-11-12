// "Log anything": turn a short phrase into an action. Pure and tested.
import { GLP1_MEDS } from '../data/glp1.js'
import { WORKOUT_TYPES } from '../data/appleWorkouts.js'
import { BOTTLE_ML, GLASS_ML } from './glp1.js'

export function guessMeal(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 4 && h < 10.5) return 'breakfast'
  if (h >= 10.5 && h < 15) return 'lunch'
  if (h >= 17 && h < 21.5) return 'dinner'
  return 'snack'
}

const NUM = '(\\d+(?:[.,]\\d+)?)'
const toNum = (s) => Number(String(s).replace(',', '.'))

const WATER_UNITS = [
  [/^(ml|millilitres?|milliliters?)$/, 1],
  [/^(l|litres?|liters?|ltrs?)$/, 1000],
  [/^(oz|fl ?oz|ounces?)$/, 29.5735],
  [/^(cups?|glass(es)?|mugs?)$/, GLASS_ML],
  [/^(bottles?)$/, BOTTLE_ML],
]
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 }

function waterMl(text) {
  if (!/\bwater\b/.test(text) || /\b(coconut|soda|tonic)\b/.test(text)) return null
  // Foods named after water: "water crackers", "water biscuits", "water bread".
  if (/\bwater\s+(crackers?|biscuits?|bread|crax)\b/.test(text)) return null
  const m =
    text.match(new RegExp(`${NUM}\\s*([a-z ]+?)\\s*(?:of\\s+)?water`)) ||
    text.match(new RegExp(`water\\s*${NUM}\\s*([a-z]*)`)) ||
    text.match(/\b(a|an|one|two|three|four|five|half)\s+(?:a\s+)?([a-z]+?)\s+(?:of\s+)?water/)
  if (!m) return GLASS_ML // just "water"
  const n = WORD_NUM[m[1]] ?? toNum(m[1])
  const unit = m[2].trim().split(' ').pop() // "2 big glasses" -> "glasses"
  const hit = WATER_UNITS.find(([re]) => re.test(unit))
  if (!hit) return n > 20 ? n : n * GLASS_ML // "500 water" = ml, "2 water" = glasses
  return Math.round(n * hit[1])
}

const EXERCISE = [
  [/\b(treadmill)\b/, { kind: 'treadmill', mode: 'walk' }],
  [/\b(run|ran|jog|jogged|running|jogging)\b/, { kind: 'treadmill', mode: 'run' }],
  [/\b(walk|walked|walking)\b/, { kind: 'treadmill', mode: 'walk' }],
  [/\b(hiit|circuit|burpees?)\b/, { kind: 'home', activity: 'hiit' }],
  [/\b(skip|skipping|jump rope)\b/, { kind: 'home', activity: 'skipping' }],
  [/\b(yoga|stretch|stretching|mobility)\b/, { kind: 'home', activity: 'mobility' }],
  [/\b(weights?|dumbbells?|lifting|lifted|gym)\b/, { kind: 'home', activity: 'weights' }],
  [/\b(workout|work out|push-?ups?|squats?|exercise|training)\b/, { kind: 'home', activity: 'bodyweight' }],
]

// Every Apple workout type by its label, variants and HealthKit name
// ("table tennis", "cycling", "pool swim"), longest first so the most
// specific wins.
const splitKey = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
const OTHER_WORKOUTS = WORKOUT_TYPES.flatMap((t) =>
  [...new Set([t.label, splitKey(t.key), ...(t.variants || [])].map((n) => n.toLowerCase()))]
    .filter((n) => n !== 'other' && n !== 'other workout' && n !== 'play')
    .map((n) => ({ n, re: new RegExp(`\\b${n.replace(/[-\s]+/g, '[-\\s]?')}\\b`), type: t })),
).sort((a, b) => b.n.length - a.n.length)

const MOOD_WORDS = [
  [/\b(awful|terrible|horrible|miserable)\b/, 1],
  [/\b(bad|low|down|sad|rough|meh)\b/, 2],
  [/\b(ok|okay|fine|alright|so-so)\b/, 3],
  [/\b(good|well|happy|decent)\b/, 4],
  [/\b(great|amazing|excellent|fantastic|brilliant)\b/, 5],
]

const DRINK = /\b(juice|soda|pop|tea|coffee|milk|latte|drink|smoothie|shake|beer|wine|rum|punch|sorrel|malta|lemonade|bag juice|coconut water|energy drink)\b/

/**
 * Parse a phrase. Returns one of:
 *   { type: 'water', ml } | { type: 'weight', value, unit } | { type: 'mood', mood }
 *   { type: 'exercise', minutes, kind, mode?, activity?, typeKey?, name? } | { type: 'dose', med, dose }
 *   { type: 'food', query, drink } | null for empty input
 */
export function parseQuickLog(input) {
  const text = String(input || '').toLowerCase().trim().replace(/\s+/g, ' ')
  if (!text) return null

  const ml = waterMl(text)
  if (ml) return { type: 'water', ml }

  const w = text.match(new RegExp(`^(?:weigh(?:ed)?(?: in)?|weight|i weigh)\\s*:?\\s*${NUM}\\s*(lbs?|pounds?|kg|kilos?)?$`))
  const w2 = !w && text.match(new RegExp(`^${NUM}\\s*(lbs?|pounds?|kg|kilos?)$`))
  const wm = w || w2
  if (wm) return { type: 'weight', value: toNum(wm[1]), unit: wm[2] ? (/^k/.test(wm[2]) ? 'kg' : 'lb') : null }

  const medNames = GLP1_MEDS.filter((m) => m.id !== 'other')
  const med = medNames.find((m) => text.includes(m.label.toLowerCase()) || text.includes(m.generic.split(' ')[0]))
  if (med || /\b(jab|injection|injected|dose)\b/.test(text)) {
    const d = text.match(new RegExp(`${NUM}\\s*(mg|mcg)`))
    return { type: 'dose', med: med?.id || null, dose: d ? toNum(d[1]) : null }
  }

  if (/^(mood|feeling|feel|felt|i feel|i'm feeling|im feeling|today was|day was)\b/.test(text)) {
    const hit = MOOD_WORDS.find(([re]) => re.test(text))
    if (hit) return { type: 'mood', mood: hit[1] }
    return { type: 'mood', mood: null }
  }

  const minutes = text.match(new RegExp(`${NUM}\\s*(?:min|mins|minutes|m)\\b`)) || text.match(new RegExp(`${NUM}\\s*(?:hr|hrs|hours?|h)\\b`))
  const ex = EXERCISE.find(([re]) => re.test(text))
  if (ex && (minutes || !DRINK.test(text))) {
    const mins = minutes ? toNum(minutes[1]) * (/\bh/.test(minutes[0].replace(/^[\d.,\s]+/, '')) ? 60 : 1) : null
    return { type: 'exercise', minutes: mins, ...ex[1] }
  }

  // Any other workout ("45 min cycling", "tennis"): needs a duration, or to be
  // the whole phrase, so foods are never mistaken for sport.
  const other = OTHER_WORKOUTS.find((o) => o.re.test(text))
  if (other && (minutes || text === other.n)) {
    const mins = minutes ? toNum(minutes[1]) * (/\bh/.test(minutes[0].replace(/^[\d.,\s]+/, '')) ? 60 : 1) : null
    return { type: 'exercise', minutes: mins, kind: 'other', typeKey: other.type.key, name: other.type.label }
  }

  return { type: 'food', query: input.trim(), drink: DRINK.test(text) }
}
