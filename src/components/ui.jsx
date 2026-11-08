import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PENGUIN_THINKING, PENGUIN_WORKOUT } from '../assets/penguins.js'

// ---------------------------------------------------------------- icons
// Simple line icons drawn for this app (SF Symbols-like, not copies).

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  updown: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6',
  up: 'M12 19V5M6 11l6-6 6 6',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  sparkles: 'M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6zM18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  today: 'M8 3v7a2 2 0 0 1-2 2H5M5 3v9M11 3v7a2 2 0 0 1-2 2M8 12v9M17 3c-2 2-2.5 5-2.5 7.5 0 1 .5 1.5 1.5 1.5h1v9M17 3v18',
  chart: 'M4 19h16M7 16v-4M12 16V8M17 16v-7',
  trend: 'M4 17l5-5 4 3 7-8M15 7h5v5',
  chat: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3 9.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
  scale: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9.5a3 3 0 0 1 6 0M12 9.5l1.5-1.5',
  flame: 'M12 3c3 3.5 6 6.5 6 10.5A6 6 0 0 1 6 13.5c0-2 1-3.5 2.5-5 .3 1.6 1 2.6 2 3 0-3.2.5-5.8 1.5-8.5z',
  run: 'M13.5 4.5a1.5 1.5 0 1 0 0 .01M9 20l2.5-5 3 2.5V21M7 12l2.5-3.5 4 1 2 3h3M11.5 15l-2-4',
  house: 'M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5M10 19v-5h4v5',
  target: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 20c.8-3.5 3.5-5.5 7-5.5s6.2 2 7 5.5',
  ruler: 'M4 16L16 4l4 4L8 20zM8 12l2 2M11 9l2 2M14 6l2 2',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  db: 'M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6zM5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5',
  leaf: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7',
  globe: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8c-2.5-2.5-3.5-5-3.5-8s1-5.5 3.5-8z',
  note: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6M9 18h3',
  share: 'M12 15V4M8 8l4-4 4 4M6 12v7h12v-7',
  download: 'M12 4v11M8 11l4 4 4-4M6 19h12',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  logout: 'M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  barcode: 'M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8v.5',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  check: 'M5 12.5l4.5 4.5L19 7',
}

export function Icon({ name, size, className, style, strokeWidth = 2 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

const Chevron = () => (
  <svg className="chev" viewBox="0 0 8 14" aria-hidden="true">
    <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ---------------------------------------------------------------- penguins

export function Penguin({ kind = 'workout', size, className = '' }) {
  return (
    <span
      className={className}
      style={size ? { display: 'inline-block', width: size, height: size } : undefined}
      // Static markup from src/assets/penguins.js, never user input.
      dangerouslySetInnerHTML={{ __html: kind === 'thinking' ? PENGUIN_THINKING : PENGUIN_WORKOUT }}
    />
  )
}

/** Full-screen loader: the workout penguin (same as the pre-JS splash). */
export function PenguinLoader({ label = 'Warming up…' }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <Penguin kind="workout" />
      <p className="splash-sub" style={{ marginTop: 10 }}>{label}</p>
    </div>
  )
}

/** Inline "the AI is thinking" row with the thinking penguin. */
export function Thinking({ status = 'Thinking…', size = 64 }) {
  return (
    <div className="thinking" role="status" aria-live="polite">
      <Penguin kind="thinking" size={size} />
      <span className="thinking-status">{status}</span>
    </div>
  )
}

// ---------------------------------------------------------------- sheet

const CLOSE_MS = 260

/** Bottom sheet: slides up, swipe down on the header or tap outside to close. */
export function Sheet({ title, onClose, children, action }) {
  const [closing, setClosing] = useState(false)
  const sheetRef = useRef()
  const drag = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const close = () => {
    if (closing) return
    setClosing(true)
    setTimeout(() => closeRef.current(), CLOSE_MS)
  }

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const onTouchStart = (e) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 }
    sheetRef.current.style.transition = 'none'
  }
  const onTouchMove = (e) => {
    if (!drag.current) return
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    drag.current.dy = dy
    sheetRef.current.style.transform = `translateY(${dy}px)`
  }
  const onTouchEnd = () => {
    const el = sheetRef.current
    const dy = drag.current?.dy || 0
    drag.current = null
    if (dy > 110) {
      el.style.setProperty('--drag', `${dy}px`)
      el.style.transform = ''
      close()
    } else {
      el.style.transition = 'transform 0.4s var(--spring)'
      el.style.transform = ''
    }
  }

  // Portal to <body> so no animated ancestor can trap the fixed backdrop.
  return createPortal(
    <div className={`sheet-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="sheet-grabber" />
          <div className="sheet-head">
            <h2 className="ellipsis">{title}</h2>
            <div className="row">
              {action}
              <button className="icon-btn filled" aria-label="Close" onClick={close}>
                <Icon name="close" strokeWidth={2.6} />
              </button>
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- controls

export function Segmented({ value, options, onChange, label }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value))
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': i }}>
      <span className="thumb" aria-hidden="true" />
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, color }) {
  return (
    <span className="switch" style={color ? { '--c': color } : undefined}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="knob" />
    </span>
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
        onChange={(e) => onChange(e.target.value.replace(',', '.'))}
        onBlur={(e) => set(Number(e.target.value) || 1)}
      />
      <button type="button" aria-label="More" onClick={() => set(Number(value) + step)}>+</button>
    </div>
  )
}

// ---------------------------------------------------------------- grouped lists (iOS Settings style)

export function ListSection({ header, footer, children, big }) {
  return (
    <section>
      {header && <div className={`list-header${big ? ' big' : ''}`}>{header}</div>}
      <div className="list">{children}</div>
      {footer && <div className="list-footer">{footer}</div>}
    </section>
  )
}

function RowIcon({ icon, color }) {
  if (!icon) return null
  return (
    <span className="row-icon" style={{ '--c': color }}>
      <Icon name={icon} strokeWidth={2.2} />
    </span>
  )
}

/** Tappable row: icon, label (+ sub), value and chevron. */
export function ListRow({ icon, color, label, sub, value, onClick, chevron = !!onClick, className = '', children }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`list-row${icon ? ' has-icon' : ''} ${className}`} onClick={onClick}>
      <RowIcon icon={icon} color={color} />
      <span className="label">
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
      {value != null && <span className="value num">{value}</span>}
      {children}
      {chevron && <Chevron />}
    </Tag>
  )
}

/** Row with an iOS switch. */
export function ToggleRow({ icon, color, label, sub, checked, onChange }) {
  return (
    <label className={`list-row${icon ? ' has-icon' : ''}`}>
      <RowIcon icon={icon} color={color} />
      <span className="label">
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  )
}

/** Row that opens the native iOS picker: shows the current choice with ⌃⌄. */
export function MenuRow({ icon, color, label, sub, value, options, onChange }) {
  const current = options.find(([v]) => String(v) === String(value))
  return (
    <label className={`list-row menu-row${icon ? ' has-icon' : ''}`}>
      <RowIcon icon={icon} color={color} />
      <span className="label">
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className="value">
        {current?.[2] || current?.[1]}
        <Icon name="updown" size={14} />
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- data display

/** Activity-style ring with a green→mint gradient; orange when over. */
export function Ring({ value, max, size = 140, stroke = 14, children }) {
  const id = useId().replace(/:/g, '')
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const target = max > 0 ? Math.min(value / max, 1) : 0
  const over = max > 0 && value > max
  // Start empty, then animate to the value after mount.
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const t = requestAnimationFrame(() => setPct(target))
    return () => cancelAnimationFrame(t)
  }, [target])
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={over ? 'var(--orange)' : 'var(--ring-a)'} />
            <stop offset="1" stopColor={over ? 'var(--red)' : 'var(--ring-b)'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
        <circle
          className="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={pct > 0 ? 1 : 0}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

export function MacroBar({ label, value, target, color }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="macro" style={{ '--c': color }}>
      <div className="tiny" style={{ color, fontWeight: 600 }}>{label}</div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="caption muted num" style={{ marginTop: 3 }}>
        {Math.round(value)} / {target} g
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
