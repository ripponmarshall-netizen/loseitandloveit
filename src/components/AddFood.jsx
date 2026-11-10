import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import { estimateMeal, photoToBase64, searchFoodDatabases } from '../lib/ai.js'
import { buildRefs, dbItemToFood, gramsToServings, isBarcode, rankFoods } from '../lib/foodSearch.js'
import { formatDayLabel } from '../lib/dates.js'
import { MEALS, MEAL_LABEL } from '../lib/meals.js'
import { Icon, Segmented, Sheet, Spinner, Stepper, Switch, Thinking } from './ui.jsx'

const MEAL_OPTS = MEALS.map((m) => [m, MEAL_LABEL[m]])
const SOURCE_BADGE = {
  builtin: ['jam', 'Jamaican list'],
  mine: ['mine', 'My food'],
  recent: ['recent', 'Recent'],
  usda: ['usda', 'USDA'],
  off: ['off', 'Open Food Facts'],
}
const sourceOf = (f) => (f.db ? f.db : f.builtin ? 'builtin' : f.recent ? 'recent' : 'mine')

function Badge({ food }) {
  const [cls, text] = SOURCE_BADGE[sourceOf(food)]
  return <span className={`badge ${cls}`}>{text}</span>
}

export default function AddFood({ date, meal: initialMeal, tab: initialTab, query = '', drinks = false, onClose }) {
  const { today, mode } = useApp()
  const [meal, setMeal] = useState(initialMeal)
  // Describing the meal to the AI is the default way in. Drinks stay a pick
  // list, and without an account there is no AI, so both open on Search.
  const aiFirst = mode === 'cloud' && !drinks
  const [tab, setTab] = useState(initialTab || (aiFirst ? 'ai' : 'search'))
  const [aiText, setAiText] = useState(aiFirst ? query : '')
  const day = formatDayLabel(date, today)

  return (
    <Sheet tall title={`${drinks ? 'Add a drink' : 'Add food'}${day === 'Today' ? '' : ` · ${day}`}`} onClose={onClose}>
      <div className="stack" style={{ marginBottom: 14 }}>
        <Segmented label="Meal" value={meal} onChange={setMeal} options={MEAL_OPTS} />
        <div className="mode-tabs" role="tablist" aria-label="How to add">
          {[
            ['ai', 'AI estimate'],
            ['search', 'Search'],
            ['quick', 'Quick add'],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'search' && (
        <SearchTab
          date={date}
          meal={meal}
          initialQuery={query}
          drinks={drinks}
          onDone={onClose}
          onAskAi={(q) => {
            setAiText(q)
            setTab('ai')
          }}
        />
      )}
      {tab === 'ai' && <AiTab date={date} meal={meal} onDone={onClose} initialText={aiText} />}
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

function FoodRow({ food, onPick, i = 0 }) {
  return (
    <button className="list-row rise" style={{ '--i': Math.min(i, 10) }} onClick={() => onPick(food)}>
      <span className="label">
        <span className="ellipsis" style={{ display: 'block' }}>{food.name}</span>
        <span className="sub ellipsis">
          <Badge food={food} /> {food.serving || '1 serving'}
        </span>
      </span>
      <span className="entry-kcal">{Math.round(food.calories)}</span>
    </button>
  )
}

/** Debounced USDA + Open Food Facts search through the Edge Function. */
function useOnlineSearch(query, enabled, sources) {
  const [state, setState] = useState({ loading: false, results: [], errors: {}, query: '' })
  useEffect(() => {
    const q = query.trim()
    const barcode = isBarcode(q) ? q.replace(/\s+/g, '') : null
    if (!enabled || (!barcode && q.length < 3)) {
      setState({ loading: false, results: [], errors: {}, query: '' })
      return
    }
    const ctl = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    const t = setTimeout(async () => {
      try {
        const res = await searchFoodDatabases({ query: barcode ? undefined : q, barcode, sources, signal: ctl.signal })
        setState({ loading: false, results: (res.results || []).map(dbItemToFood), errors: res.errors || {}, query: q })
      } catch (e) {
        if (e.name !== 'AbortError') setState({ loading: false, results: [], errors: { all: e.message }, query: q })
      }
    }, barcode ? 0 : 650)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [query, enabled, sources.usda, sources.off]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

const DRINKS = BUILTIN_FOODS.filter((f) => /\bdrink\b/.test(f.tags || ''))

function SearchTab({ date, meal, onDone, onAskAi, initialQuery = '', drinks = false }) {
  const { store, toast, mode, prefs } = useApp()
  const [q, setQ] = useState(initialQuery)
  const [recent, setRecent] = useState([])
  const [mine, setMine] = useState([])
  const [picked, setPicked] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const sources = { usda: prefs.usda, off: prefs.off }
  const onlineOn = mode === 'cloud' && (prefs.usda || prefs.off)
  const online = useOnlineSearch(q, onlineOn, sources)

  useEffect(() => {
    Promise.all([store.listRecentFoods(30), store.listFoods()])
      .then(([r, m]) => {
        setRecent(r)
        setMine(m)
      })
      .catch((e) => toast(e.message, 'error'))
  }, [store, toast])

  const sections = useMemo(() => {
    if (!q.trim() && drinks) {
      return [
        ['Drinks', DRINKS],
        ['Recent', recent.filter((f) => DRINKS.some((d) => d.name === f.name)).slice(0, 6)],
      ]
    }
    if (!q.trim()) {
      return [
        ['Recent', recent.slice(0, 10)],
        ['My foods', mine],
        ['Jamaican staples & basics', showAll ? BUILTIN_FOODS : BUILTIN_FOODS.slice(0, 20)],
      ]
    }
    return [
      ['My foods', rankFoods(mine, q)],
      ['Recent', rankFoods(recent, q).slice(0, 6)],
      ['Jamaican staples & basics', rankFoods(BUILTIN_FOODS, q)],
    ]
  }, [q, recent, mine, showAll, drinks])
  const localCount = sections.reduce((s, [, l]) => s + l.length, 0)

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

  const noResults = q.trim() && localCount === 0 && !online.loading && online.results.length === 0

  return (
    <div>
      <div className="search-field">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          enterKeyHint="search"
          placeholder={drinks ? 'Sorrel, juice, tea, soda…' : 'Ackee, patty, Grace… or a barcode'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {sections.map(([label, list]) =>
        list.length ? (
          <section key={label}>
            <div className="list-header">{label}</div>
            <div className="list">
              {list.map((f, i) => (
                <FoodRow key={f.id} food={f} i={i} onPick={setPicked} />
              ))}
              {!q.trim() && label.startsWith('Jamaican') && !showAll && (
                <button className="list-row action" onClick={() => setShowAll(true)}>
                  Show all {BUILTIN_FOODS.length}
                </button>
              )}
            </div>
          </section>
        ) : null,
      )}

      {onlineOn && (online.loading || online.results.length > 0 || Object.keys(online.errors).length > 0) && (
        <section>
          <div className="list-header row" style={{ gap: 6 }}>
            Online databases {online.loading && <Spinner />}
          </div>
          {online.results.length > 0 && (
            <div className="list">
              {online.results.map((f, i) => (
                <FoodRow key={f.id} food={f} i={i} onPick={setPicked} />
              ))}
            </div>
          )}
          {Object.entries(online.errors).map(([k, msg]) => (
            <div key={k} className="list-footer">
              {k === 'usda' ? 'USDA' : k === 'off' ? 'Open Food Facts' : 'Search'}: {msg}
            </div>
          ))}
          {online.results.length > 0 && <div className="list-footer">Values per 100 g or per label serving. Check packaged foods against the label.</div>}
        </section>
      )}

      {noResults && (
        <div className="card center" style={{ marginTop: 16 }}>
          <p className="muted small">No match for “{q.trim()}”.</p>
          <button className="btn secondary sm" onClick={() => onAskAi(q.trim())}>
            <Icon name="sparkles" size={16} /> Estimate it with AI
          </button>
        </div>
      )}

      <p className="list-footer" style={{ marginTop: 14 }}>
        {mode !== 'cloud'
          ? 'Sign in to also search USDA FoodData Central and Open Food Facts.'
          : onlineOn
            ? 'Type 3+ letters to also search USDA and Open Food Facts. Built-in values are estimates for typical portions.'
            : 'Online databases are off (Settings → Food databases).'}
      </p>
    </div>
  )
}

function MacroTiles({ food, n = 1 }) {
  const tiles = [
    ['kcal', Math.round(food.calories * n), 'var(--green)'],
    ['Protein', `${Math.round(food.protein_g * n)} g`, 'var(--protein)'],
    ['Carbs', `${Math.round(food.carbs_g * n)} g`, 'var(--carbs)'],
    ['Fat', `${Math.round(food.fat_g * n)} g`, 'var(--fat)'],
  ]
  return (
    <div className="grid4">
      {tiles.map(([l, v, c]) => (
        <div key={l} className="stat" style={{ '--c': c, padding: '10px 8px', textAlign: 'center' }}>
          <div className="l">{l}</div>
          <div className="v num" style={{ fontSize: 18 }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

function ServingPicker({ food, date, meal, onBack, onDone, onDeleted }) {
  const { store, toast } = useApp()
  const [servings, setServings] = useState(1)
  const [grams, setGrams] = useState(food.serving_g ? String(food.serving_g) : '')
  const [saveToMine, setSaveToMine] = useState(false)
  const { add, busy } = useAdd(onDone)
  const n = Number(servings) || 0
  const src = sourceOf(food)
  const isMine = src === 'mine'

  function onServings(v) {
    setServings(v)
    if (food.serving_g && Number(v)) setGrams(String(Math.round(Number(v) * food.serving_g)))
  }
  function onGrams(v) {
    setGrams(v)
    const s = gramsToServings(v, food.serving_g)
    if (s) setServings(s)
  }

  function submit() {
    const entry = {
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
      source: src === 'recent' ? 'recent' : 'library',
    }
    add([entry], { saveFoods: saveToMine ? [{ ...entry, id: undefined }] : [] })
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
    <div className="page">
      <button className="link small row" style={{ gap: 2 }} onClick={onBack}>
        <Icon name="left" size={18} /> Back
      </button>
      <h2 style={{ margin: '12px 0 4px' }}>{food.name}</h2>
      <p className="small muted">
        <Badge food={food} /> Per {food.serving || 'serving'}
      </p>
      <MacroTiles food={food} />
      {food.per100 && (
        <p className="tiny muted" style={{ margin: '8px 4px 0' }}>
          Per 100 g: {food.per100.calories} kcal · P {food.per100.protein_g} · C {food.per100.carbs_g} · F {food.per100.fat_g}
        </p>
      )}

      <div className="row between" style={{ margin: '20px 0' }}>
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Servings</div>
          <Stepper value={servings} onChange={onServings} />
        </div>
        {food.serving_g ? (
          <label style={{ width: 110 }}>
            <div className="tiny muted" style={{ marginBottom: 6 }}>or grams</div>
            <input className="input num" inputMode="decimal" value={grams} onChange={(e) => onGrams(e.target.value)} aria-label="Grams" />
          </label>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <div className="tiny muted">Total</div>
            <strong className="num" style={{ fontSize: 28, letterSpacing: '-0.02em' }}>{Math.round(food.calories * n)}</strong>
            <span className="muted"> kcal</span>
          </div>
        )}
      </div>

      {(src === 'usda' || src === 'off') && (
        <label className="list" style={{ marginBottom: 14, display: 'block' }}>
          <span className="list-row">
            <span className="label">Save to My foods</span>
            <Switch checked={saveToMine} onChange={setSaveToMine} label="Save to My foods" />
          </span>
        </label>
      )}

      <button className="btn block" disabled={busy || !n} onClick={submit}>
        Add {Math.round(food.calories * n)} kcal to {MEAL_LABEL[meal]}
      </button>
      {isMine && (
        <button className="btn destructive block" style={{ marginTop: 10 }} onClick={remove}>
          Remove from My foods
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- AI

const AI_STEPS = ['Reading your meal…', 'Checking food databases…', 'Comparing with Jamaican portions…', 'Adding it up…']

function AiTab({ date, meal, onDone, initialText = '' }) {
  const { mode, toast, store, prefs } = useApp()
  const [text, setText] = useState(initialText)
  const [photo, setPhoto] = useState(null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [result, setResult] = useState(null)
  const [saveToMine, setSaveToMine] = useState(false)
  const [mine, setMine] = useState([])
  const fileRef = useRef()
  const { add, busy } = useAdd(onDone)

  useEffect(() => {
    if (mode === 'cloud') store.listFoods().then(setMine).catch(() => {})
  }, [store, mode])

  useEffect(() => {
    if (!loading) return
    setStep(0)
    const id = setInterval(() => setStep((s) => Math.min(s + 1, AI_STEPS.length - 1)), 2200)
    return () => clearInterval(id)
  }, [loading])

  if (mode !== 'cloud') {
    return (
      <div className="card warn small">
        AI estimates need an account (the AI runs on the server so the API key stays secret). Sign out, then create an account to use it.
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
        refs: buildRefs(BUILTIN_FOODS, mine),
        sources: { usda: prefs.usda, off: prefs.off },
        checkDatabases: prefs.aiChecks,
      })
      setResult({
        notes: res.notes,
        lookedUp: res.looked_up || [],
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
          reference: it.reference,
        })),
      })
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const update = (key, k, v) => setResult((r) => ({ ...r, items: r.items.map((it) => (it.key === key ? { ...it, [k]: v } : it)) }))
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

  const refBadge = (ref = '') => {
    const r = ref.toLowerCase()
    if (r.startsWith('usda')) return 'usda'
    if (r.startsWith('open food')) return 'off'
    if (r.startsWith('jamaican')) return 'jam'
    if (r.startsWith('my') || r.startsWith('user') || r.startsWith('saved')) return 'mine'
    return 'recent'
  }

  return (
    <div>
      <label className="field">
        <textarea
          className="input"
          autoFocus
          rows={3}
          placeholder="What did you eat? e.g. 2 fried dumplings, 1 cup ackee and saltfish, mint tea with 2 sugars"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="What did you eat?"
        />
      </label>
      {photo && (
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <img className="photo-preview" src={photo.preview} alt="Meal" />
          <button className="icon-btn filled" style={{ position: 'absolute', top: 8, right: 8, background: 'rgb(0 0 0 / 0.5)', color: '#fff' }} aria-label="Remove photo" onClick={() => setPhoto(null)}>
            <Icon name="close" strokeWidth={2.6} />
          </button>
        </div>
      )}
      <div className="row">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
        <button className="btn gray" type="button" onClick={() => fileRef.current.click()} aria-label={photo ? 'Change photo' : 'Add photo'}>
          <Icon name="camera" size={20} />
        </button>
        <button className="btn grow" disabled={loading || (!text.trim() && !photo)} onClick={run}>
          <Icon name="sparkles" size={18} /> Estimate
        </button>
      </div>

      {loading && (
        <div className="card" style={{ marginTop: 14 }}>
          <Thinking status={prefs.aiChecks ? AI_STEPS[step] : 'Mimi is thinking…'} />
        </div>
      )}

      {!loading && !result && (
        <p className="list-footer" style={{ marginTop: 10 }}>
          Mention portions and cooking (fried, boiled, with coconut milk). A photo plus a short description works best.
          {prefs.aiChecks && ' The AI checks your saved foods, the Jamaican list, USDA and Open Food Facts before it estimates.'}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          {result.notes && <p className="small muted" style={{ margin: '0 4px 10px' }}>{result.notes}</p>}
          {result.items.length === 0 && <p className="small">No food items found.</p>}
          {result.items.map((it, i) => (
            <div key={it.key} className="card rise" style={{ '--i': i, padding: 12, opacity: it.on ? 1 : 0.45, transition: 'opacity 0.2s' }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <input className="check" type="checkbox" checked={it.on} onChange={(e) => update(it.key, 'on', e.target.checked)} aria-label="Include" />
                <input className="input grow" value={it.name} onChange={(e) => update(it.key, 'name', e.target.value)} aria-label="Name" />
              </div>
              <div className="row wrap tiny muted" style={{ marginBottom: 8, gap: 6 }}>
                <span>{it.serving}</span>
                {it.reference && <span className={`badge ${refBadge(it.reference)}`}>{it.reference}</span>}
                <span className={`badge ${it.confidence === 'high' ? 'jam' : it.confidence === 'low' ? 'off' : 'recent'}`}>{it.confidence} confidence</span>
              </div>
              <div className="grid4">
                <label className="field"><span>kcal</span><input className="input" inputMode="numeric" value={it.calories} onChange={(e) => update(it.key, 'calories', e.target.value)} /></label>
                <label className="field"><span>Protein</span><input className="input" inputMode="numeric" value={it.protein_g} onChange={(e) => update(it.key, 'protein_g', e.target.value)} /></label>
                <label className="field"><span>Carbs</span><input className="input" inputMode="numeric" value={it.carbs_g} onChange={(e) => update(it.key, 'carbs_g', e.target.value)} /></label>
                <label className="field"><span>Fat</span><input className="input" inputMode="numeric" value={it.fat_g} onChange={(e) => update(it.key, 'fat_g', e.target.value)} /></label>
              </div>
            </div>
          ))}
          {result.lookedUp.length > 0 && <p className="list-footer" style={{ marginBottom: 10 }}>Looked up: {result.lookedUp.join(', ')}</p>}
          {result.items.length > 0 && (
            <>
              <div className="list" style={{ marginBottom: 12 }}>
                <label className="list-row">
                  <span className="label">Also save to My foods</span>
                  <Switch checked={saveToMine} onChange={setSaveToMine} label="Also save to My foods" />
                </label>
              </div>
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
      <div className="list" style={{ marginBottom: 14 }}>
        <label className="list-row">
          <span className="label">Save to My foods for next time</span>
          <Switch checked={saveToMine} onChange={setSaveToMine} label="Save to My foods" />
        </label>
      </div>
      <button className="btn block" disabled={busy || !f.calories}>
        Add to {MEAL_LABEL[meal]}
      </button>
    </form>
  )
}
