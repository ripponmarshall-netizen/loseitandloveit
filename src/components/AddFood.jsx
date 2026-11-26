import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import { estimateMeal, photoToBase64, searchFoodDatabases } from '../lib/ai.js'
import { buildRefs, correctionRefs, dbItemToFood, gramsToServings, isBarcode, isCorrection, rankFoods } from '../lib/foodSearch.js'
import { formatDayLabel } from '../lib/dates.js'
import { foodEmoji } from '../lib/foodEmoji.js'
import { kcalLooksWrong, validServings } from '../lib/calc.js'
import { MEALS, MEAL_LABEL } from '../lib/meals.js'
import { CountUp, Icon, Segmented, Sheet, Spinner, Stepper, Switch, Thinking, useSheetClose } from './ui.jsx'

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
  const [sheetRef, dismiss] = useSheetClose(onClose)
  const day = formatDayLabel(date, today)

  return (
    <Sheet ref={sheetRef} tall title={`${drinks ? 'Add a drink' : 'Add food'}${day === 'Today' ? '' : ` · ${day}`}`} onClose={onClose}>
      <div className="stack mb-4">
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
          onDone={dismiss}
          onAskAi={(q) => {
            setAiText(q)
            setTab('ai')
          }}
        />
      )}
      {tab === 'ai' && <AiTab date={date} meal={meal} onDone={dismiss} initialText={aiText} />}
      {tab === 'quick' && <QuickTab date={date} meal={meal} onDone={dismiss} />}
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

/** One food in a list. `badge`: show where it's from (lists that mix sources; elsewhere the section header says it). */
function FoodRow({ food, onPick, i = 0, badge = false }) {
  return (
    <button className="list-row entry-row rise" style={{ '--i': Math.min(i, 10) }} onClick={() => onPick(food)}>
      <span className="entry-emoji" aria-hidden="true">{foodEmoji(food.name)}</span>
      <span className="label">
        <span className="ellipsis d-block">{food.name}</span>
        <span className="sub ellipsis">
          {badge && <><Badge food={food} />{' '}</>}
          {food.serving || '1 serving'}
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

  // A search the app's own lists couldn't answer, noted when the search is
  // left (not on every keystroke): what the food list should add next.
  const typed = q.trim()
  const miss = useRef(null)
  miss.current = typed.length >= 3 && !isBarcode(typed) && localCount === 0 && !online.loading ? typed : null
  useEffect(() => () => miss.current && store.logFoodFeedback({ kind: 'search_miss', query: miss.current }).catch(() => {}), [store])
  const pickOnline = (f) => {
    if (miss.current) store.logFoodFeedback({ kind: 'search_miss', query: miss.current, picked: f.name }).catch(() => {})
    setPicked(f)
  }

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
          <div className="list-header row">
            Online databases {online.loading && <Spinner />}
          </div>
          {online.results.length > 0 && (
            <div className="list">
              {online.results.map((f, i) => (
                <FoodRow key={f.id} food={f} i={i} onPick={pickOnline} badge />
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
        <div className="card empty-state mt-4">
          <p className="muted small">No match for “{q.trim()}”.</p>
          <button className="btn secondary sm" onClick={() => onAskAi(q.trim())}>
            <Icon name="sparkles" size={16} /> Estimate it with AI
          </button>
        </div>
      )}

      <p className="list-footer mt-4">
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
    ['kcal', Math.round(food.calories * n), 'var(--kcal)'],
    ['Protein', `${Math.round(food.protein_g * n)} g`, 'var(--protein)'],
    ['Carbs', `${Math.round(food.carbs_g * n)} g`, 'var(--carbs)'],
    ['Fat', `${Math.round(food.fat_g * n)} g`, 'var(--fat)'],
  ]
  return (
    <div className="grid4">
      {tiles.map(([l, v, c]) => (
        <div key={l} className="stat compact" style={{ '--c': c }}>
          <div className="l">{l}</div>
          <div className="v num">{v}</div>
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
  const n = validServings(servings) ?? 0
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
      <button className="link small with-icon" onClick={onBack}>
        <Icon name="left" size={18} /> Back
      </button>
      <h2 className="title3 mt-3 mb-1">{food.name}</h2>
      <p className="small muted">
        <Badge food={food} /> Per {food.serving || 'serving'}
      </p>
      <MacroTiles food={food} />
      {food.per100 && (
        <p className="tiny muted mt-2">
          Per 100 g: {food.per100.calories} kcal · P {food.per100.protein_g} · C {food.per100.carbs_g} · F {food.per100.fat_g}
        </p>
      )}

      <div className="amount-row">
        <div>
          <span className="field-label">Servings</span>
          <Stepper value={servings} onChange={onServings} />
        </div>
        {food.serving_g ? (
          <label className="grams-field">
            <span className="field-label">or grams</span>
            <input className="input num" inputMode="decimal" value={grams} onChange={(e) => onGrams(e.target.value)} aria-label="Grams" />
          </label>
        ) : (
          <div className="amount-total">
            <span className="field-label">Total</span>
            <span className="figure"><CountUp value={Math.round(food.calories * n)} from={Math.round(food.calories * n)} /></span>
            <span className="figure-unit"> kcal</span>
          </div>
        )}
      </div>

      {(src === 'usda' || src === 'off') && (
        <label className="list mb-4">
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
        <button className="btn destructive block mt-3" onClick={remove}>
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

  // Her saved foods, and AI estimates she corrected before: the AI checks both first.
  useEffect(() => {
    if (mode !== 'cloud') return
    Promise.all([store.listFoods(), store.listFoodFeedback().catch(() => [])])
      .then(([foods, feedback]) => setMine([...correctionRefs(feedback), ...foods]))
      .catch(() => {})
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
          // What the AI said, to notice a correction when it's added.
          orig: { name: it.name, calories: Math.round(it.calories), protein_g: Math.round(it.protein_g), carbs_g: Math.round(it.carbs_g), fat_g: Math.round(it.fat_g) },
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
    chosen.forEach((it, i) => {
      if (!it.orig || !isCorrection(it.orig, entries[i])) return
      const e = entries[i]
      store.logFoodFeedback({
        kind: 'ai_correction', query: text.trim() || null, name: e.name, serving: e.serving,
        est_kcal: it.orig.calories, est_protein_g: it.orig.protein_g, est_carbs_g: it.orig.carbs_g, est_fat_g: it.orig.fat_g,
        kcal: e.calories, protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g,
      }).catch(() => {})
    })
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
        <div className="photo-wrap">
          <img className="photo-preview" src={photo.preview} alt="Meal" />
          <button className="icon-btn filled on-photo" aria-label="Remove photo" onClick={() => setPhoto(null)}>
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
        <div className="card mt-4">
          <Thinking status={prefs.aiChecks ? AI_STEPS[step] : 'Mimi is thinking…'} />
        </div>
      )}

      {!loading && !result && (
        <p className="list-footer mt-3">
          Mention portions and cooking (fried, boiled, with coconut milk). A photo plus a short description works best.
          {prefs.aiChecks && ' The AI checks your saved foods, the Jamaican list, USDA and Open Food Facts before it estimates.'}
        </p>
      )}

      {result && (
        <div className="mt-4">
          {result.notes && <p className="small muted">{result.notes}</p>}
          {result.items.length === 0 && <p className="small">No food items found.</p>}
          {result.items.map((it, i) => (
            <div key={it.key} className={`card compact rise ai-item${it.on ? '' : ' off'}`} style={{ '--i': i }}>
              <div className="row mb-2">
                <input className="check" type="checkbox" checked={it.on} onChange={(e) => update(it.key, 'on', e.target.checked)} aria-label="Include" />
                <input className="input grow" value={it.name} onChange={(e) => update(it.key, 'name', e.target.value)} aria-label="Name" />
              </div>
              <div className="row wrap tiny muted mb-2">
                <span>{it.serving}</span>
                {it.reference && <span className={`badge ${refBadge(it.reference)}`}>{it.reference}</span>}
                {it.confidence && (
                  <span className={`badge ${it.confidence === 'high' ? 'jam' : it.confidence === 'low' ? 'off' : 'recent'}`}>{it.confidence} confidence</span>
                )}
              </div>
              <div className="grid4">
                <label className="field"><span>kcal</span><input className="input" inputMode="numeric" value={it.calories} onChange={(e) => update(it.key, 'calories', e.target.value)} /></label>
                <label className="field"><span>Protein</span><input className="input" inputMode="numeric" value={it.protein_g} onChange={(e) => update(it.key, 'protein_g', e.target.value)} /></label>
                <label className="field"><span>Carbs</span><input className="input" inputMode="numeric" value={it.carbs_g} onChange={(e) => update(it.key, 'carbs_g', e.target.value)} /></label>
                <label className="field"><span>Fat</span><input className="input" inputMode="numeric" value={it.fat_g} onChange={(e) => update(it.key, 'fat_g', e.target.value)} /></label>
              </div>
            </div>
          ))}
          {result.lookedUp.length > 0 && <p className="list-footer mb-3">Looked up: {result.lookedUp.join(', ')}</p>}
          {result.items.length > 0 && (
            <>
              <div className="list mb-3">
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
    if (kcalLooksWrong(entry) && !window.confirm(`${Math.round(entry.calories).toLocaleString('en-GB')} kcal in one item. Is that right?`)) return
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
      <div className="list mb-4">
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
