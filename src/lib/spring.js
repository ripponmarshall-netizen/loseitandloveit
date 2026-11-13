// Motion as physics: a damped spring (mass 1), solved exactly rather than
// stepped, so it is stable at any frame rate and can be picked up mid-flight
// with the velocity it already has.
//
// Springs are described the way SwiftUI does: `response` is the period of the
// undamped oscillation in seconds (how quick it feels) and `damping` is the
// damping ratio (1 = no overshoot, lower = bouncier).
//
// Pure: no browser imports. The rAF loop takes its clock and scheduler as
// arguments, so tests can drive it.

export const SPRINGS = {
  smooth: { response: 0.5, damping: 1 }, // sheets, bars, anything that shouldn't overshoot
  snappy: { response: 0.38, damping: 0.8 }, // controls: switches, segmented thumbs, presses
  bouncy: { response: 0.5, damping: 0.62 }, // things that pop in: badges, dots, toasts
  lens: { response: 0.42, damping: 0.72 }, // the tab bar's selection pill
}

const TAU = 2 * Math.PI

/** Natural frequency (rad/s) and damping ratio from a { response, damping } spring. */
export function springParams({ response = 0.5, damping = 1 } = {}) {
  return { omega: TAU / Math.max(0.01, response), zeta: Math.max(0, damping) }
}

/**
 * Where a spring is `t` seconds after it starts at `from` (moving at `velocity`
 * units/s) heading for `to`. Returns { value, velocity }.
 */
export function springAt(spring, { from = 0, to = 1, velocity = 0 } = {}, t = 0) {
  const { omega: w, zeta: z } = springParams(spring)
  const x0 = from - to // displacement from rest
  const v0 = velocity
  let x
  let v
  if (Math.abs(z - 1) < 1e-6) {
    // Critically damped
    const b = v0 + w * x0
    const e = Math.exp(-w * t)
    x = e * (x0 + b * t)
    v = e * (b - w * (x0 + b * t))
  } else if (z < 1) {
    // Underdamped: oscillates inside a decaying envelope
    const a = z * w
    const wd = w * Math.sqrt(1 - z * z)
    const b = (v0 + a * x0) / wd
    const e = Math.exp(-a * t)
    const c = Math.cos(wd * t)
    const s = Math.sin(wd * t)
    x = e * (x0 * c + b * s)
    v = e * (-a * (x0 * c + b * s) + wd * (b * c - x0 * s))
  } else {
    // Overdamped: two decaying exponentials
    const r = w * Math.sqrt(z * z - 1)
    const r1 = -z * w + r
    const r2 = -z * w - r
    const c1 = (v0 - r2 * x0) / (r1 - r2)
    const c2 = x0 - c1
    x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t)
    v = c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t)
  }
  return { value: to + x, velocity: v }
}

/**
 * Seconds until the spring stays within `epsilon` of its target (measured on
 * the decay envelope, so an underdamped spring passing through the target
 * doesn't count as settled).
 */
export function settleTime(spring, { from = 0, to = 1, velocity = 0 } = {}, epsilon = 0.001) {
  const { omega: w, zeta: z } = springParams(spring)
  const x0 = from - to
  const span = Math.max(Math.abs(x0), 1e-9)
  const tol = epsilon * (Math.abs(x0) > 1e-9 ? span : 1)
  let envelope
  if (Math.abs(z - 1) < 1e-6) {
    const b = Math.abs(velocity + w * x0)
    envelope = (t) => Math.exp(-w * t) * (Math.abs(x0) + b * t)
  } else if (z < 1) {
    const a = z * w
    const wd = w * Math.sqrt(1 - z * z)
    const amp = Math.hypot(x0, (velocity + a * x0) / wd)
    envelope = (t) => Math.exp(-a * t) * amp
  } else {
    const r = w * Math.sqrt(z * z - 1)
    const r1 = -z * w + r
    const r2 = -z * w - r
    const c1 = (velocity - r2 * x0) / (r1 - r2)
    const c2 = x0 - c1
    envelope = (t) => Math.abs(c1) * Math.exp(r1 * t) + Math.abs(c2) * Math.exp(r2 * t)
  }
  const dt = 1 / 240
  for (let t = 0; t < 10; t += dt) if (envelope(t) < tol) return t
  return 10
}

/**
 * The spring as a CSS easing: `linear()` sampled from 0 to 1 starting at
 * rest. Played over any duration it is the same spring, scaled in time.
 * Returns { easing, duration } with duration in ms (the natural settle time).
 */
export function springEasing(spring, { samples = 48, epsilon = 0.002 } = {}) {
  const T = settleTime(spring, { from: 0, to: 1 }, epsilon)
  const pts = []
  for (let i = 0; i <= samples; i++) {
    const v = i === samples ? 1 : springAt(spring, { from: 0, to: 1 }, (T * i) / samples).value
    pts.push(Number(v.toFixed(4)))
  }
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(T * 1000) }
}

/**
 * iOS-style rubber banding: the further past the edge you drag, the less it
 * moves. `dimension` is the size of the thing being dragged.
 */
export function rubberBand(offset, dimension, constant = 0.55) {
  if (!dimension) return 0
  const sign = Math.sign(offset)
  const x = Math.abs(offset)
  return sign * (1 - 1 / ((x * constant) / dimension + 1)) * dimension
}

/** How far a flick at `velocity` (units/s) would coast with UIScrollView's normal deceleration. */
export function projectFling(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/** Velocity (units/s) from recent { t (ms), v } samples, oldest first. */
export function trackVelocity(samples, windowMs = 80) {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[0]
  for (const s of samples) {
    if (last.t - s.t <= windowMs) {
      first = s
      break
    }
  }
  const dt = last.t - first.t
  return dt > 0 ? ((last.v - first.v) / dt) * 1000 : 0
}

/**
 * Run a spring frame by frame. `onUpdate(value, velocity)` every frame,
 * `onDone()` once settled. Returns a handle: `stop()` halts it and
 * `state()` reads { value, velocity } now, so a new spring can carry on
 * from exactly where this one is.
 */
export function animateSpring({
  from,
  to,
  velocity = 0,
  spring = SPRINGS.smooth,
  onUpdate,
  onDone,
  epsilon = 0.5, // in the units being animated (px by default)
  now = () => performance.now(),
  raf = (fn) => requestAnimationFrame(fn),
  caf = (id) => cancelAnimationFrame(id),
}) {
  const start = now()
  const span = Math.abs(from - to)
  const T = span < epsilon && Math.abs(velocity) < epsilon ? 0 : settleTime(spring, { from, to, velocity }, span > 0 ? epsilon / span : 1)
  let id = 0
  let stopped = false
  const at = (ms) => springAt(spring, { from, to, velocity }, Math.min(ms / 1000, T))
  const frame = () => {
    if (stopped) return
    const t = now() - start
    if (t / 1000 >= T) {
      stopped = true
      onUpdate?.(to, 0)
      onDone?.()
      return
    }
    const s = at(t)
    onUpdate?.(s.value, s.velocity)
    id = raf(frame)
  }
  id = raf(frame)
  return {
    stop() {
      stopped = true
      caf(id)
    },
    state() {
      if (stopped && now() - start >= T * 1000) return { value: to, velocity: 0 }
      return at(now() - start)
    },
    get done() {
      return stopped
    },
  }
}
