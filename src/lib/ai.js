import { supabase } from './supabase.js'
import { AI_FUNCTION_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to use the AI features.')
  return {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
  }
}

async function errorFrom(res) {
  try {
    const j = await res.json()
    return new Error(j.error || `AI request failed (${res.status})`)
  } catch {
    return new Error(`AI request failed (${res.status})`)
  }
}

/**
 * Stream a coach reply. Calls onText(fullTextSoFar) as tokens arrive and
 * onStatus(text) while the coach is checking the food databases.
 * Resolves with the final text.
 *
 * refs: the user's saved foods + built-in list (see buildRefs) the coach can search.
 * sources: { usda, off } which online databases to use.
 */
export async function streamCoach({ message, history, context, refs, sources, onText, onStatus, signal }) {
  const res = await fetch(AI_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'coach', message, history, context, refs, sources }),
    signal,
  })
  if (!res.ok || !res.body) throw await errorFrom(res)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const ev = JSON.parse(line)
      if (ev.t === 'delta') {
        text += ev.v
        onText?.(text)
      } else if (ev.t === 'reset') {
        text = ''
        onText?.(text)
      } else if (ev.t === 'status') {
        onStatus?.(ev.v)
      } else if (ev.t === 'error') {
        throw new Error(ev.message)
      }
    }
  }
  return text
}

export async function estimateMeal({ text, image, refs, sources, checkDatabases = true }) {
  const res = await fetch(AI_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'estimate', text, image, refs, sources, check_databases: checkDatabases }),
  })
  if (!res.ok) throw await errorFrom(res)
  return res.json()
}

/**
 * Search USDA FoodData Central and Open Food Facts (through the Edge Function,
 * which holds the USDA key and isn't blocked by CORS). No AI credit is used.
 * Returns { results: [{ id, source, name, brand, per100, serving_g, serving_text }], errors }.
 */
export async function searchFoodDatabases({ query, barcode, sources, signal }) {
  const res = await fetch(AI_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'food_search', query, barcode, sources }),
    signal,
  })
  if (!res.ok) throw await errorFrom(res)
  return res.json()
}

// Shrink a photo before upload: max 1280px, JPEG ~80%. Keeps requests small
// and cheap; the model doesn't need more detail than that to judge a plate.
export function photoToBase64(file, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      resolve({ media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that photo.'))
    }
    img.src = url
  })
}
