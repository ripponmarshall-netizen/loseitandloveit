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
