import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPRINGS, animateSpring, projectFling, rubberBand, settleTime, springAt, springEasing, trackVelocity } from '../src/lib/spring.js'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('springAt: starts where it was told, at the speed it was given', () => {
  for (const s of Object.values(SPRINGS)) {
    const p = springAt(s, { from: 10, to: 110, velocity: 250 }, 0)
    close(p.value, 10)
    close(p.velocity, 250)
  }
  // Overdamped too
  const p = springAt({ response: 0.5, damping: 1.6 }, { from: 0, to: 1, velocity: 3 }, 0)
  close(p.value, 0)
  close(p.velocity, 3)
})

test('springAt: velocity is the derivative of position (all three damping regimes)', () => {
  for (const s of [SPRINGS.smooth, SPRINGS.bouncy, { response: 0.4, damping: 1.8 }]) {
    for (const t of [0.02, 0.1, 0.25, 0.6]) {
      const h = 1e-5
      const a = springAt(s, { from: 0, to: 100, velocity: -40 }, t - h).value
      const b = springAt(s, { from: 0, to: 100, velocity: -40 }, t + h).value
      close(springAt(s, { from: 0, to: 100, velocity: -40 }, t).velocity, (b - a) / (2 * h), 1e-3)
    }
  }
})

test('springAt: critically damped never overshoots; bouncy does, then settles', () => {
  let maxSmooth = 0
  let maxBouncy = 0
  for (let t = 0; t < 2; t += 0.005) {
    maxSmooth = Math.max(maxSmooth, springAt(SPRINGS.smooth, { from: 0, to: 1 }, t).value)
    maxBouncy = Math.max(maxBouncy, springAt(SPRINGS.bouncy, { from: 0, to: 1 }, t).value)
  }
  assert.ok(maxSmooth <= 1 + 1e-9)
  assert.ok(maxBouncy > 1.05 && maxBouncy < 1.25, `bouncy peak ${maxBouncy}`)
  close(springAt(SPRINGS.bouncy, { from: 0, to: 1 }, 3).value, 1, 1e-4)
})

test('settleTime: stiffer springs settle sooner, and the spring is close to rest by then', () => {
  const quick = settleTime({ response: 0.3, damping: 1 })
  const slow = settleTime({ response: 0.8, damping: 1 })
  assert.ok(quick < slow)
  for (const s of Object.values(SPRINGS)) {
    const T = settleTime(s, { from: 0, to: 1 }, 0.001)
    for (let t = T; t < T + 1; t += 0.01) assert.ok(Math.abs(springAt(s, { from: 0, to: 1 }, t).value - 1) < 0.001)
  }
})

test('springEasing: a CSS linear() curve from 0 to 1', () => {
  const { easing, duration } = springEasing(SPRINGS.bouncy)
  assert.match(easing, /^linear\(0, .*, 1\)$/)
  const pts = easing.slice(7, -1).split(', ').map(Number)
  assert.equal(pts.length, 49)
  assert.ok(Math.max(...pts) > 1) // keeps its overshoot
  assert.ok(duration > 300 && duration < 2000)
})

test('rubberBand: follows the finger at first, then resists, never past the size', () => {
  close(rubberBand(0, 400), 0)
  assert.ok(rubberBand(10, 400) > 5 && rubberBand(10, 400) < 10)
  assert.ok(rubberBand(1e6, 400) < 400)
  close(rubberBand(-50, 400), -rubberBand(50, 400))
})

test('projectFling and trackVelocity', () => {
  close(projectFling(1000), 499, 1e-6)
  close(projectFling(0), 0)
  const samples = [
    { t: 0, v: 0 },
    { t: 100, v: 10 },
    { t: 150, v: 40 },
    { t: 200, v: 100 },
  ]
  // Only the last 80 ms count: (100 - 40) / 50 ms
  close(trackVelocity(samples), 1200)
  assert.equal(trackVelocity([{ t: 0, v: 5 }]), 0)
})

test('animateSpring: runs to the target and can be picked up mid-flight', () => {
  let clock = 0
  const queue = []
  const raf = (fn) => queue.push(fn)
  const step = (ms) => {
    clock += ms
    const fns = queue.splice(0)
    fns.forEach((f) => f())
  }
  const seen = []
  let done = false
  const h = animateSpring({ from: 0, to: 300, spring: SPRINGS.smooth, onUpdate: (v) => seen.push(v), onDone: () => (done = true), now: () => clock, raf, caf: () => {} })
  step(16)
  step(100)
  const mid = h.state()
  assert.ok(mid.value > 0 && mid.value < 300 && mid.velocity > 0)
  for (let i = 0; i < 200 && !done; i++) step(16)
  assert.ok(done)
  assert.equal(seen[seen.length - 1], 300)
  assert.deepEqual(h.state(), { value: 300, velocity: 0 })
})
