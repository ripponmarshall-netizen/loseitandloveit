// Pure helpers for food search: local ranking, turning database results
// (per 100 g) into loggable foods, and the reference list sent to the AI.

const r1 = (n) => Math.round(n * 10) / 10

export const words = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/**
 * Every query word must appear in the name or tags. Results are ranked:
 * name starts with the query, then whole-word matches, then shorter names.
 */
export function rankFoods(list, query) {
  const q = words(query)
  if (!q.length) return list
  const phrase = q.join(' ')
  return list
    .map((food) => {
      const nameWords = words(food.name)
      const hay = `${nameWords.join(' ')} ${words(food.tags).join(' ')} ${words(food.brand).join(' ')}`
      if (!q.every((w) => hay.includes(w))) return null
      let score = 0
      if (nameWords.join(' ').startsWith(phrase)) score += 4
      score += q.filter((w) => nameWords.includes(w)).length
      score -= nameWords.length * 0.05
      return { food, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.food)
}

/** A database item (per 100 g, from the Edge Function) as a loggable food. */
export function dbItemToFood(item) {
  const grams = item.serving_g > 0 ? item.serving_g : 100
  const f = grams / 100
  const brandInName = item.brand && item.name.toLowerCase().includes(item.brand.toLowerCase())
  const serving = item.serving_g > 0 ? item.serving_text || `${r1(grams)} g` : '100 g'
  return {
    id: item.id,
    name: item.brand && !brandInName ? `${item.name} (${item.brand})` : item.name,
    serving: item.serving_g > 0 && !/\d\s*g\b/i.test(serving) ? `${serving} (${r1(grams)} g)` : serving,
    serving_g: grams,
    calories: Math.round(item.per100.calories * f),
    protein_g: r1(item.per100.protein_g * f),
    carbs_g: r1(item.per100.carbs_g * f),
    fat_g: r1(item.per100.fat_g * f),
    per100: item.per100,
    db: item.source,
  }
}

/** Grams eaten -> number of servings, for foods with a known serving weight. */
export function gramsToServings(grams, servingG) {
  const g = Number(grams)
  if (!g || !servingG) return 0
  return Math.round((g / servingG) * 100) / 100
}

/** Compact reference list the AI can search: the user's foods first, then the built-ins. */
export function buildRefs(builtins, mine = []) {
  const pick = (f, src) => ({
    name: f.name,
    serving: f.serving || undefined,
    calories: Math.round(Number(f.calories) || 0),
    protein_g: Number(f.protein_g) || 0,
    carbs_g: Number(f.carbs_g) || 0,
    fat_g: Number(f.fat_g) || 0,
    tags: f.tags || undefined,
    src,
  })
  return [...mine.slice(0, 200).map((f) => pick(f, 'mine')), ...builtins.map((f) => pick(f, 'jamaican'))]
}

/** Barcodes are 8–14 digits (EAN-8, UPC-A, EAN-13, GTIN-14). */
export const isBarcode = (q) => /^\d{8,14}$/.test(String(q).replace(/\s+/g, ''))

/**
 * AI estimates the user corrected before logging, as foods the AI can look up
 * next time (newest correction of each name wins). feedback: newest first,
 * from store.listFoodFeedback().
 */
export function correctionRefs(feedback = [], limit = 50) {
  const seen = new Set()
  const out = []
  for (const f of feedback) {
    if (f?.kind !== 'ai_correction' || !f.name || f.kcal == null) continue
    const key = f.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: f.name, serving: f.serving || undefined, calories: Number(f.kcal), protein_g: Number(f.protein_g) || 0, carbs_g: Number(f.carbs_g) || 0, fat_g: Number(f.fat_g) || 0, tags: 'corrected' })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Did the user change an AI estimate enough to be worth remembering? A new
 * name, calories off by 10% (and 20 kcal), or a macro off by 15% (and 3 g).
 */
export function isCorrection(orig, final) {
  const far = (a, b, rel, abs) => Math.abs(Number(b) - Number(a)) >= Math.max(abs, Math.abs(Number(a)) * rel)
  const renamed = words(orig.name).join(' ') !== words(final.name).join(' ')
  return renamed || far(orig.calories, final.calories, 0.1, 20) || ['protein_g', 'carbs_g', 'fat_g'].some((k) => far(orig[k], final[k], 0.15, 3))
}

/**
 * Missed searches grouped (most asked first) and the latest AI corrections,
 * for the Settings list of what the food list is missing. feedback: newest first.
 */
export function summariseFoodFeedback(feedback = []) {
  const misses = new Map()
  for (const f of feedback) {
    if (f?.kind !== 'search_miss' || !f.query) continue
    const key = words(f.query).join(' ')
    if (!key) continue
    const m = misses.get(key) || { query: f.query.trim(), times: 0, last: f.created_at, picked: null }
    m.times++
    m.picked ||= f.picked || null
    misses.set(key, m)
  }
  return {
    misses: [...misses.values()].sort((a, b) => b.times - a.times || String(b.last).localeCompare(String(a.last))),
    corrections: feedback.filter((f) => f?.kind === 'ai_correction' && f.name),
  }
}
