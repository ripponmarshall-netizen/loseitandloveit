import { useCallback, useEffect, useRef, useState } from 'react'

// Stroke icons (24×24, currentColor) so they match the theme and the active tab colour.
const ICONS = {
  today: (
    <>
      <path d="M7 3v8M4.5 3v5.5a2.5 2.5 0 0 0 5 0V3M7 11v10" />
      <path d="M17.5 21V3c-2 1.5-3 4.5-3 8.5h3" />
    </>
  ),
  progress: (
    <>
      <path d="M3 6l6 6 4-4 8 8" />
      <path d="M15 16h6v-6" />
    </>
  ),
  coach: <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 20.5 11.5z" />,
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
}

export function Icon({ name, size = 24, stroke = 2 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

const CLOSE_MS = 200

/**
 * Bottom sheet. Closes with an animation from the ✕, the backdrop, Escape,
 * or by dragging the handle down. onClose runs once the animation ends.
 */
export function Sheet({ title, onClose, children }) {
  const [closing, setClosing] = useState(false)
  const sheetRef = useRef()
  const backdropRef = useRef()
  const downOnBackdrop = useRef(false)
  const drag = useRef(null)
  const onCloseRef = useRef(onClose)
  const closingRef = useRef(false)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setTimeout(() => onCloseRef.current(), CLOSE_MS)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    const prev = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      ;[html.style.overflow, document.body.style.overflow] = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [close])

  // Drag the handle/header down to dismiss.
  const onPointerDown = (e) => {
    if (e.target.closest('button')) return
    drag.current = { y: e.clientY, dy: 0, t: Date.now() }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const dy = Math.max(0, e.clientY - drag.current.y)
    drag.current.dy = dy
    const s = sheetRef.current
    s.style.transition = 'none'
    s.style.transform = `translateY(${dy}px)`
    backdropRef.current.style.backgroundColor = `rgb(0 0 0 / ${0.4 * Math.max(0, 1 - dy / 400)})`
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const { dy, t } = drag.current
    drag.current = null
    const s = sheetRef.current
    const fast = dy > 40 && dy / Math.max(1, Date.now() - t) > 0.5
    if (dy > 110 || fast) {
      s.style.setProperty('--drag', `translateY(${dy}px)`)
      close()
    } else {
      s.style.transition = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)'
      s.style.transform = ''
      backdropRef.current.style.backgroundColor = ''
    }
  }

  return (
    <div
      ref={backdropRef}
      className={`sheet-backdrop${closing ? ' closing' : ''}`}
      // Only close when the tap both started and ended on the backdrop, so
      // dragging a text selection out of the sheet doesn't dismiss it.
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => e.target === e.currentTarget && downOnBackdrop.current && close()}
    >
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="sheet-handle" />
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Close" onClick={close}>
              <Icon name="close" size={18} stroke={2.4} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, step = 0.5, min = 0.25 }) {
  const set = (v) => onChange(Math.max(min, Math.round(v * 100) / 100))
  return (
    <div className="stepper">
      <button type="button" aria-label="Fewer servings" onClick={() => set(Number(value) - step)}>−</button>
      <input
        inputMode="decimal"
        aria-label="Servings"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value.replace(',', '.'))}
        onBlur={(e) => set(Number(e.target.value) || 1)}
      />
      <button type="button" aria-label="More servings" onClick={() => set(Number(value) + step)}>+</button>
    </div>
  )
}

// Sweeps in from empty on first paint, then animates between values.
function useMounted() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return on
}

export function Ring({ value, max, size = 132, stroke = 12, children }) {
  const mounted = useMounted()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = mounted && max > 0 ? Math.min(value / max, 1) : 0
  const over = max > 0 && value > max
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {value > 0 && (
          <circle
            className="ring-arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={over ? 'var(--accent)' : 'var(--brand)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

export function MacroBar({ label, value, target, color }) {
  const mounted = useMounted()
  const over = target > 0 && value > target * 1.05
  const pct = mounted && target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className={`macro${over ? ' over' : ''}`}>
      <div className="row between">
        <span>{label}</span>
        <span className="num muted">
          {Math.round(value)} / {target} g
        </span>
      </div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemax={target}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// Tiny, safe renderer for coach replies: paragraphs, bullet and numbered
// lists, **bold**. Builds React elements (no innerHTML), so model output
// can't inject markup.
export function MiniMarkdown({ text }) {
  const blocks = []
  let list = null
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const m = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.*)$/)
    if (m) {
      const type = m[1] ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        list = { type, items: [] }
        blocks.push(list)
      }
      list.items.push(m[2])
    } else {
      list = null
      if (line.trim()) blocks.push({ type: 'p', text: line.replace(/^#+\s*/, '') })
    }
  }
  const inline = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part,
    )
  return blocks.map((b, i) => {
    if (b.type === 'p') return <p key={i}>{inline(b.text, i)}</p>
    const List = b.type
    return (
      <List key={i}>
        {b.items.map((it, j) => (
          <li key={j}>{inline(it, `${i}-${j}`)}</li>
        ))}
      </List>
    )
  })
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />
}

export function Loading({ page = false }) {
  return (
    <div className={`loading${page ? ' page' : ''}`}>
      <Spinner />
    </div>
  )
}
