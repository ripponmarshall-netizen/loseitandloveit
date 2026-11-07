import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import { estimateMeal, photoToBase64 } from '../lib/ai.js'
import { formatDayLabel } from '../lib/dates.js'
import { Segmented, Sheet, Spinner, Stepper } from './ui.jsx'
import { MEALS } from '../lib/meals.js'

const MEAL_OPTS = MEALS.map((m) => [m, m === 'snack' ? 'Snack' : m[0].toUpperCase() + m.slice(1)])

export default function AddFood({ date, meal: initialMeal, tab: initialTab, onClose }) {
  const { today } = useApp()
  const [meal, setMeal] = useState(initialMeal)
  const [tab, setTab] = useState(initialTab || 'search')
  const title = `Add food · ${formatDayLabel(date, today)}`

  return (
    <Sheet title={title} onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <Segmented value={meal} onChange={setMeal} options={MEAL_OPTS} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ['search', '🔎 Search'],
            ['ai', '✨ AI estimate'],
            ['quick', '⚡ Quick add'],
          ]}
        />
      </div>
      {tab === 'search' && <SearchTab date={date} meal={meal} onDone={onClose} />}
      {tab === 'ai' && <AiTab date={date} meal={meal} onDone={onClose} />}
      {tab === 'quick' && <QuickTab date={date} meal={meal} onDone={onClose} />}
    </Sheet>
  )
}

function useAdd(onDone) {
  const { store, bumpData, toast } = useApp()
  const [busy, setBusy] = useState(false)
  async function add(entries, { saveFoods = [] } = {}) {
    setBusy(true)
    try {
      await store.addEntries(entries)
      for (const f of saveFoods) await store.saveFood(f)
      bumpData()
      const kcal = entries.reduce((s, e) => s + Math.round(Number(e.calories) * Number(e.servings ?? 1)), 0)
      toast(`Added ${entries.length > 1 ? `${entries.length} items, ` : ''}${kcal} kcal`)
      onDone()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }
  return { add, busy }
}

// ---------------------------------------------------------------- search

function matches(food, words) {
  const hay = `${food.name} ${food.tags || ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

function SearchTab({ date, meal, onDone }) {
  const { store, toast } = useApp()
  const [q, setQ] = useState('')
  const [recent, setRecent] = useState([])
  const [mine, setMine] = useState([])
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    Promise.all([store.listRecentFoods(30), store.listFoods()])
      .then(([r, m]) => {
        setRecent(r)
        setMine(m)
      })
      .catch((e) => toast(e.message, 'error'))
  }, [store, toast])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const sections = useMemo(() => {
    if (!words.length) {
      return [
        ['Recent', recent.slice(0, 12)],
        ['My foods', mine],
        ['Jamaican staples & basics', BUILTIN_FOODS],
      ]
    }
    return [
      ['Recent', recent.filter((f) => matches(f, words))],
      ['My foods', mine.filter((f) => matches(f, words))],
      ['Jamaican staples & basics', BUILTIN_FOODS.filter((f) => matches(f, words))],
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, recent, mine])
  const total = sections.reduce((s, [, l]) => s + l.length, 0)

  if (picked) {
    return (
      <ServingPicker
        food={picked}
        date={date}
        meal={meal}
        onBack={() => setPicked(null)}
        onDone={onDone}
        onDeleted={(id) => {
          setMine((m) => m.filter((f) => f.id !== id))
          setPicked(null)
        }}
      />
    )
  }

  return (
    <div>
      <input
        className="input"
        type="search"
        placeholder="Search: ackee, patty, rice…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {sections.map(([label, list]) =>
        list.length ? (
          <div key={label}>
            <div className="list-label">{label}</div>
            {list.map((f) => (
              <button key={f.id} className="food-item" onClick={() => setPicked(f)}>
                <div className="grow">
                  <div className="ellipsis">{f.name}</div>
                  <div className="tiny muted ellipsis">{f.serving || '1 serving'}</div>
                </div>
                <span className="num small">{Math.round(f.calories)} kcal</span>
              </button>
            ))}
          </div>
        ) : null,
      )}
      {total === 0 && (
        <p className="muted small center" style={{ marginTop: 16 }}>
          No match. Try ✨ AI estimate or ⚡ Quick add.
        </p>
      )}
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Built-in values are estimates for typical portions. Tap one, adjust, then use “Save to My foods” from your log to keep your own version.
      </p>
    </div>
  )
}

function ServingPicker({ food, date, meal, onBack, onDone, onDeleted }) {
  const { store, toast } = useApp()
  const [servings, setServings] = useState(1)
  const { add, busy } = useAdd(onDone)
  const n = Number(servings) || 0
  const isMine = !food.builtin && !food.recent

  function submit() {
    add([
      {
        log_date: date,
        meal,
        name: food.name,
        serving: food.serving,
        servings: n || 1,
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
        food_id: isMine ? food.id : food.food_id,
        source: food.recent ? 'recent' : 'library',
      },
    ])
  }

  async function remove() {
    try {
      await store.deleteFood(food.id)
      toast('Removed from My foods')
      onDeleted(food.id)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div>
      <button className="link small" onClick={onBack}>‹ Back to list</button>
      <h2 style={{ marginTop: 10 }}>{food.name}</h2>
      <p className="small muted">
        Per {food.serving || 'serving'}: {Math.round(food.calories)} kcal · P {food.protein_g} · C {food.carbs_g} · F {food.fat_g}
      </p>
      <div className="row between" style={{ margin: '16px 0' }}>
        <Stepper value={servings} onChange={setServings} />
        <div style={{ textAlign: 'right' }}>
          <div className="small muted">Total</div>
          <strong className="num" style={{ fontSize: 24 }}>{Math.round(food.calories * n)} kcal</strong>
        </div>
      </div>
      <button className="btn block" disabled={busy || !n} onClick={submit}>
        Add to {meal}
      </button>
      {isMine && (
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={remove}>
          Remove from My foods
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- AI

function AiTab({ date, meal, onDone }) {
  const { mode, toast } = useApp()
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [saveToMine, setSaveToMine] = useState(false)
  const fileRef = useRef()
  const { add, busy } = useAdd(onDone)

  if (mode !== 'cloud') {
    return (
      <div className="card flat warn small">
        AI estimates need an account (the AI runs on the server so your API key stays secret). Sign out, then create an account
        to use it.
      </div>
    )
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await photoToBase64(file))
    } catch (err) {
      toast(err.message, 'error')
    }
    e.target.value = ''
  }

  async function run() {
    setLoading(true)
    setResult(null)
    try {
      const res = await estimateMeal({
        text: text.trim(),
        image: photo ? { media_type: photo.media_type, data: photo.data } : undefined,
      })
      setResult({
        notes: res.notes,
        items: (res.items || []).map((it, i) => ({
          key: i,
          on: true,
          name: it.name,
          serving: it.serving,
          calories: String(Math.round(it.calories)),
          protein_g: String(Math.round(it.protein_g)),
          carbs_g: String(Math.round(it.carbs_g)),
          fat_g: String(Math.round(it.fat_g)),
          confidence: it.confidence,
        })),
      })
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const update = (key, k, v) =>
    setResult((r) => ({ ...r, items: r.items.map((it) => (it.key === key ? { ...it, [k]: v } : it)) }))
  const chosen = result?.items.filter((it) => it.on) || []
  const chosenKcal = chosen.reduce((s, it) => s + (Number(it.calories) || 0), 0)

  function submit() {
    const entries = chosen.map((it) => ({
      log_date: date,
      meal,
      name: it.name,
      serving: it.serving,
      servings: 1,
      calories: Number(it.calories) || 0,
      protein_g: Number(it.protein_g) || 0,
      carbs_g: Number(it.carbs_g) || 0,
      fat_g: Number(it.fat_g) || 0,
      source: 'ai',
    }))
    add(entries, { saveFoods: saveToMine ? entries : [] })
  }

  return (
    <div>
      <label className="field">
        <span>What did you eat?</span>
        <textarea
          className="input"
          placeholder="e.g. 2 fried dumplings, 1 cup ackee and saltfish, small callaloo, cup of mint tea with 2 sugars"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {photo && (
        <div style={{ position: 'relative' }}>
          <img className="photo-preview" src={photo.preview} alt="Meal" />
          <button className="btn sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => setPhoto(null)}>
            Remove
          </button>
        </div>
      )}
      <div className="row">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
        <button className="btn ghost" type="button" onClick={() => fileRef.current.click()}>
          📷 {photo ? 'Change photo' : 'Photo'}
        </button>
        <button className="btn grow" disabled={loading || (!text.trim() && !photo)} onClick={run}>
          {loading ? <Spinner /> : 'Estimate'}
        </button>
      </div>
      <p className="tiny muted" style={{ marginTop: 6 }}>
        Mention portions and cooking (fried, boiled, with coconut milk) for better estimates. A photo plus a short description works best.
      </p>

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.notes && <p className="small muted">{result.notes}</p>}
          {result.items.length === 0 && <p className="small">No food items found.</p>}
          {result.items.map((it) => (
            <div key={it.key} className="card flat" style={{ padding: 12, opacity: it.on ? 1 : 0.5 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <input type="checkbox" checked={it.on} onChange={(e) => update(it.key, 'on', e.target.checked)} aria-label="Include" style={{ width: 22, height: 22 }} />
                <input className="input grow" value={it.name} onChange={(e) => update(it.key, 'name', e.target.value)} aria-label="Name" />
              </div>
              <div className="row small muted" style={{ marginBottom: 6 }}>
                <span className="grow ellipsis">{it.serving}</span>
                <span className="tag">{it.confidence} confidence</span>
              </div>
              <div className="grid4">
                <label className="field"><span>kcal</span><input className="input" inputMode="numeric" value={it.calories} onChange={(e) => update(it.key, 'calories', e.target.value)} /></label>
                <label className="field"><span>P</span><input className="input" inputMode="numeric" value={it.protein_g} onChange={(e) => update(it.key, 'protein_g', e.target.value)} /></label>
                <label className="field"><span>C</span><input className="input" inputMode="numeric" value={it.carbs_g} onChange={(e) => update(it.key, 'carbs_g', e.target.value)} /></label>
                <label className="field"><span>F</span><input className="input" inputMode="numeric" value={it.fat_g} onChange={(e) => update(it.key, 'fat_g', e.target.value)} /></label>
              </div>
            </div>
          ))}
          {result.items.length > 0 && (
            <>
              <label className="row small" style={{ margin: '4px 0 12px' }}>
                <input type="checkbox" checked={saveToMine} onChange={(e) => setSaveToMine(e.target.checked)} style={{ width: 20, height: 20 }} />
                Also save these to My foods
              </label>
              <button className="btn block" disabled={busy || !chosen.length} onClick={submit}>
                Add {chosen.length} item{chosen.length === 1 ? '' : 's'} · {chosenKcal} kcal
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- quick

function QuickTab({ date, meal, onDone }) {
  const [f, setF] = useState({ name: '', serving: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [saveToMine, setSaveToMine] = useState(false)
  const { add, busy } = useAdd(onDone)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  function submit(e) {
    e.preventDefault()
    const entry = {
      log_date: date,
      meal,
      name: f.name.trim() || 'Quick add',
      serving: f.serving.trim() || null,
      servings: 1,
      calories: Number(f.calories) || 0,
      protein_g: Number(f.protein_g) || 0,
      carbs_g: Number(f.carbs_g) || 0,
      fat_g: Number(f.fat_g) || 0,
      source: 'quick',
    }
    add([entry], { saveFoods: saveToMine && f.name.trim() ? [entry] : [] })
  }

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input className="input" placeholder="e.g. Chicken and chips (cookshop)" value={f.name} onChange={set('name')} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Calories</span>
          <input className="input" inputMode="numeric" required value={f.calories} onChange={set('calories')} />
        </label>
        <label className="field">
          <span>Serving (optional)</span>
          <input className="input" placeholder="1 box" value={f.serving} onChange={set('serving')} />
        </label>
      </div>
      <div className="grid3">
        <label className="field"><span>Protein g</span><input className="input" inputMode="decimal" value={f.protein_g} onChange={set('protein_g')} /></label>
        <label className="field"><span>Carbs g</span><input className="input" inputMode="decimal" value={f.carbs_g} onChange={set('carbs_g')} /></label>
        <label className="field"><span>Fat g</span><input className="input" inputMode="decimal" value={f.fat_g} onChange={set('fat_g')} /></label>
      </div>
      <label className="row small" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={saveToMine} onChange={(e) => setSaveToMine(e.target.checked)} style={{ width: 20, height: 20 }} />
        Save to My foods for next time
      </label>
      <button className="btn block" disabled={busy || !f.calories}>
        Add to {meal}
      </button>
    </form>
  )
}
