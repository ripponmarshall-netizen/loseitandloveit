// Everything logged for one day, shared by Today and the Log sheet.
// One fetch per (store, date, data version): screens that ask for the same
// day get the same promise, and a cached result shows instantly.
import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'

const caches = new WeakMap()
const soft = (p) => p.then((value) => ({ value }), (e) => ({ value: null, error: e.message }))

function load(store, date, version) {
  let cache = caches.get(store)
  if (!cache) caches.set(store, (cache = new Map()))
  const key = `${date}|${version}`
  if (!cache.has(key)) {
    const slot = { value: null }
    slot.promise = Promise.all([
      store.listEntries(date, date),
      // Optional tables: a missing migration shouldn't break the day.
      soft(store.listWorkouts(date, date)),
      soft(store.listDailyLogs(date, date)),
      soft(store.listRecentDoses(12)),
    ]).then(([entries, workouts, daily, doses]) => {
      slot.value = {
        entries,
        workouts: workouts.value || [],
        workoutError: workouts.error || null,
        daily: daily.value?.[0] || null,
        checkinError: daily.error || doses.error || null,
        doses: doses.value || [],
      }
      return slot.value
    })
    slot.promise.catch(() => cache.delete(key))
    cache.set(key, slot)
    // Keep the cache small.
    if (cache.size > 12) cache.delete(cache.keys().next().value)
  }
  return cache.get(key)
}

export function useDay(date) {
  const { store, dataVersion, toast } = useApp()
  const slot = load(store, date, dataVersion)
  const [state, setState] = useState(() => ({ date, data: slot.value }))

  useEffect(() => {
    let cancelled = false
    const s = load(store, date, dataVersion)
    if (s.value) setState({ date, data: s.value })
    s.promise
      .then((data) => !cancelled && setState({ date, data }))
      .catch((e) => {
        if (cancelled) return
        toast(e.message, 'error')
        setState({ date, data: { entries: [], workouts: [], daily: null, doses: [], workoutError: null, checkinError: null } })
      })
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion, toast])

  // Keep showing the previous data while a refresh for the same day loads
  // (no spinner flash after every add); show nothing when the day changes.
  return state.date === date ? state.data : slot.value
}
