// The on-screen keyboard on iPhone covers the bottom of the page without
// shrinking it, so bottom sheets and the coach composer ended up hidden behind
// it while you typed. This tracks the *visible* area (window.visualViewport)
// and exposes it to CSS:
//   --vv-top, --vv-h  the visible area, in layout-viewport pixels
//   --kb              how much of the screen the keyboard covers
//   html.kb-open      set while the keyboard is up
// styles.css pins sheets and the composer to that area.

const KEYBOARD_MIN_PX = 120 // smaller changes are browser toolbars, not a keyboard

export function keyboardInset({ layoutHeight, vvHeight, vvTop = 0, scale = 1 }) {
  if (!layoutHeight || !vvHeight || scale > 1.05) return 0 // pinch-zoomed: not a keyboard
  return Math.max(0, Math.round(layoutHeight - vvHeight - vvTop))
}

export function isKeyboardOpen(inset) {
  return inset > KEYBOARD_MIN_PX
}

const isField = (el) =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|file)$/.test(el.type)))

/** Start watching. Returns a function that stops. Safe to call without visualViewport. */
export function watchKeyboard() {
  const vv = window.visualViewport
  const root = document.documentElement
  if (!vv) return () => {}
  let raf = 0
  let wasOpen = false

  const update = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const inset = keyboardInset({ layoutHeight: root.clientHeight, vvHeight: vv.height, vvTop: vv.offsetTop, scale: vv.scale })
      const open = isKeyboardOpen(inset)
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
      root.style.setProperty('--kb', `${open ? inset : 0}px`)
      root.classList.toggle('kb-open', open)
      // Keyboard just appeared: keep the field you're typing in visible
      // inside its sheet (the sheet has just shrunk to fit above the keyboard).
      if (open && !wasOpen) revealFocused()
      wasOpen = open
    })
  }

  const revealFocused = () => {
    const el = document.activeElement
    if (isField(el) && el.closest('.sheet')) el.scrollIntoView({ block: 'nearest' })
  }
  // Moving between fields with the keyboard already up.
  const onFocusIn = (e) => {
    if (wasOpen && isField(e.target) && e.target.closest('.sheet')) setTimeout(revealFocused, 60)
  }

  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  document.addEventListener('focusin', onFocusIn)
  update()
  return () => {
    cancelAnimationFrame(raf)
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    document.removeEventListener('focusin', onFocusIn)
    root.classList.remove('kb-open')
  }
}
