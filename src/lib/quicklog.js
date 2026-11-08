// "Log anything": turn a short phrase into an action, and order the Log
// sheet's options by what's most likely needed right now. Pure and tested.
import { GLP1_MEDS } from '../data/glp1.js'
import { BOTTLE_ML, GLASS_ML, waterPaceFraction } from './glp1.js'

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
 *   { type: 'exercise', minutes, kind, mode?, activity? } | { type: 'dose', med, dose }
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

  return { type: 'food', query: input.trim(), drink: DRINK.test(text) }
}

/**
 * Order the Log sheet's actions for right now. Returns
 * [{ id, score, reason }] sorted best first.
 */
export function suggestLogActions({ hour, onGlp1, dose, weighed, moodLogged, waterMl = 0, waterTarget = 2500, mealsLogged = {} }) {
  const meal = guessMeal(new Date(2000, 0, 1, Math.floor(hour), Math.round((hour % 1) * 60)))
  const mealLabel = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'a snack' }[meal]
  const expected = waterTarget * waterPaceFraction(hour)
  const out = [
    { id: 'meal', score: mealsLogged[meal] ? 55 : 72, reason: mealsLogged[meal] ? 'Add more food' : `Log ${mealLabel}` },
    { id: 'drink', score: 50, reason: 'Juice, tea, soda…' },
    {
      id: 'water',
      score: waterMl < expected - 250 ? 68 : 42,
      reason: waterMl < expected - 250 ? 'Behind for this time of day' : 'Add a glass',
    },
    { id: 'exercise', score: 45, reason: 'Treadmill or home' },
    { id: 'mood', score: moodLogged ? 12 : hour >= 17 ? 74 : 35, reason: moodLogged ? 'Update check-in' : 'How are you today?' },
    { id: 'weight', score: weighed ? 8 : hour < 11 ? 80 : 30, reason: weighed ? 'Already weighed' : hour < 11 ? 'Morning weigh-in' : 'Weigh-in' },
    {
      id: 'dose',
      score: !onGlp1 ? 5 : dose?.state === 'overdue' ? 100 : dose?.state === 'due' || dose?.state === 'none' ? 95 : 15,
      reason: !onGlp1 ? 'Track a GLP-1 medicine' : dose?.label || 'GLP-1',
    },
  ]
  return out.sort((a, b) => b.score - a.score)
}
