import { useEffect } from 'react'

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const ICONS = {
  today: (
    <>
      <path d="M7 3v7a2 2 0 0 0 2 2v9M5 3v5M9 3v5" />
      <path d="M17 21v-7h-2.5V8c0-2.8 1.2-4.5 2.5-5v11" />
    </>
  ),
  progress: (
    <>
      <path d="M3 4v16h18" />
      <path d="m7 9 4 4 3-3 5 5" />
      <path d="M19 11v4h-4" />
    </>
  ),
  coach: <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5Z" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />,
}

// Line icons drawn in the current text colour, so they follow the theme.
export function Icon({ name, size = 24 }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, step = 0.5, min = 0.25 }) {
  const set = (v) => onChange(Math.max(min, Math.round(v * 100) / 100))
  return (
    <div className="stepper">
      <button type="button" aria-label="Less" onClick={() => set(Number(value) - step)}>−</button>
      <input
        inputMode="decimal"
        aria-label="Servings"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
        onBlur={(e) => set(Number(e.target.value) || 1)}
      />
      <button type="button" aria-label="More" onClick={() => set(Number(value) + step)}>+</button>
    </div>
  )
}

export function Ring({ value, max, size = 132, stroke = 12, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const over = max > 0 && value > max
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
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
          style={{ transition: 'stroke-dashoffset 0.4s' }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

export function MacroBar({ label, value, target, color }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="macro">
      <div className="row between">
        <span>{label}</span>
        <span className="num muted">
          {Math.round(value)} / {target} g
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// Tiny, safe renderer for coach replies: paragraphs, "- " bullets, **bold**.
// Builds React elements (no innerHTML), so model output can't inject markup.
export function MiniMarkdown({ text }) {
  const blocks = []
  let list = null
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (m) {
      if (!list) {
        list = []
        blocks.push({ type: 'ul', items: list })
      }
      list.push(m[1])
    } else {
      list = null
      if (line.trim()) blocks.push({ type: 'p', text: line.replace(/^#+\s*/, '') })
    }
  }
  const inline = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part,
    )
  return blocks.map((b, i) =>
    b.type === 'ul' ? (
      <ul key={i}>
        {b.items.map((it, j) => (
          <li key={j}>{inline(it, `${i}-${j}`)}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>{inline(b.text, i)}</p>
    ),
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}
