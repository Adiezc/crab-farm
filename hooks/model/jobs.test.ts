import { expect, test } from 'claude-code/testing'
import { BEAT } from '../contracts'
import type { JobKind, Leg, Pt, RouteFn } from '../contracts'
import { BARN_IN, CHORES, LAG_MS, MAX_JOBS, actBeats, at, ceilBeat, close, endOf, enqueue, helperLegs, restAt, spansOf, timeline } from './jobs'
import { BARN_DOOR, home as homeOf, lengthOf, resolve, route as realRoute } from './layout'
import { mulberry32 } from './rng'
import type { Crab, Helper, Job } from '../../types'

// An L-shaped route: across, then up or down. Every leg is straight and whole-pixel.
const route: RouteFn = (from, to) => [{ x: to.x, y: from.y }]
const HOME: Pt = { x: 50, y: 121 }
const ROW: Pt = { x: 72, y: 110 }
const POND: Pt = { x: 66, y: 206 }
const BARN: Pt = { x: 56, y: 80 }
const T0 = 1_000_000 * BEAT

let seq = 1
const job = (kind: JobKind, t0: number, to: Pt, over: Partial<Job> = {}): Job =>
  ({ n: seq++, kind, t0, to, land: 'row', isOpen: false, count: 1, tool: kind, ...over })
const crab = (over: Partial<Crab> = {}): Crab => ({ stepId: 'n:0:a', plot: 0, anchor: { ft: T0, pt: HOME }, jobs: [], restSince: T0, ...over })
const legsOf = (c: Crab): Leg[] => timeline(c, HOME, route, true)
const where = (c: Crab, t: number): Pt => at(legsOf(c), t).pt
const end = (c: Crab, i: number): number => spansOf(c, HOME, route)[i]?.end ?? NaN

test('a crab with nothing to do sits at home, typing while the turn works', async () => {
  const c = crab()
  expect(at(timeline(c, HOME, route, true), T0 + 5000)).toEqual({ pt: HOME, pose: 'type', face: 1, leg: timeline(c, HOME, route, true)[0] })
  expect(at(timeline(c, HOME, route, false), T0 + 5000).pose).toBe('sit')
  expect(restAt(c, HOME, route)).toBe(T0)
})

test('a job walks there at a trot, acts, and walks home; every leg starts on a beat', async () => {
  const c = enqueue(crab(), job('till', T0 + 10, ROW), T0 + 10, HOME, route)
  const legs = legsOf(c)
  expect(legs.every(l => l.t0 % BEAT === 0 && Number.isInteger(l.beats))).toBe(true)
  expect(legs.map(l => l.pose)).toEqual(['walk', 'walk', 'work', 'walk', 'walk', 'type'])
  // 22 px across then 11 up, at 2 px a beat; the act is one hoe strike.
  expect(legs[0]?.beats).toBe(11)
  expect(legs[1]?.beats).toBe(6)
  expect(legs[2]).toEqual({ t0: T0 + BEAT + 17 * BEAT, beats: 12, from: ROW, to: ROW, pose: 'work', prop: 'hoe' })
  expect(where(c, legs[2]?.t0 ?? 0)).toEqual(ROW)
  expect(at(legs, T0 + 1e9).pt).toEqual(HOME)
})

test('timeline durations match the spec within one beat', async () => {
  const trip = (plot: number, to: Pt): number => {
    const h = homeOf(plot)
    const c: Crab = { stepId: 'x', plot, anchor: { ft: T0, pt: h }, jobs: [job('hire', T0, to)], restSince: T0 }
    const s = spansOf(c, h, realRoute)[0]
    return ((s?.arrive ?? 0) - (s?.start ?? 0)) / 1000
  }
  // home(0) to the barn door, 47 px at a trot: 2.9 s.
  expect(Math.abs(trip(0, BARN_DOOR) - 2.9)).toBeLessThan(BEAT / 1000 + 0.01)
  // Any trip takes its route's length at 2 px a beat, give or take a beat per corner.
  for (let plot = 0; plot < 6; plot++) {
    for (const kind of ['water', 'post', 'mill', 'scout', 'lookout'] as const) {
      const to = resolve(kind, plot, 12).to
      const px = lengthOf([homeOf(plot), ...realRoute(homeOf(plot), to), to])
      const corners = realRoute(homeOf(plot), to).length + 1
      expect(Math.abs(trip(plot, to) - (px / 2) * (BEAT / 1000))).toBeLessThan((corners * BEAT) / 1000 + 0.001)
    }
  }
  // Acts: a Read crouches 1.5 s, an Edit strikes for 1.5 s, a harvest picks three times over 2.25 s.
  expect([actBeats(job('inspect', 0, ROW)), actBeats(job('till', 0, ROW)), actBeats(job('harvest', 0, ROW))].map(b => b * BEAT / 1000)).toEqual([1.5, 1.5, 2.25])
  // Merged calls add half a second each, up to 6 s.
  expect(actBeats(job('inspect', 0, ROW, { count: 3 }))).toBe(20)
  expect(actBeats(job('inspect', 0, ROW, { count: 50 }))).toBe(48)
})

test('a call of the same kind still under way merges, taking the newest tool and note', async () => {
  let c = enqueue(crab(), job('inspect', T0, ROW, { tool: 'Read', note: 'a.ts' }), T0, HOME, route)
  const before = end(c, 0)
  c = enqueue(c, job('inspect', T0 + 500, ROW, { tool: 'Bash', note: 'cat b.ts' }), T0 + 500, HOME, route)
  expect(c.jobs.length).toBe(1)
  expect(c.jobs[0]).toMatchObject({ count: 2, tool: 'Bash', note: 'cat b.ts' })
  expect(end(c, 0)).toBe(before + 4 * BEAT)
})

test('an open act holds until the tool returns, and closing it sends the crab home from there', async () => {
  let c = enqueue(crab(), job('water', T0, POND, { isOpen: true, tool: 'Bash' }), T0, HOME, route)
  const legs = legsOf(c)
  expect(legs[legs.length - 1]?.isOpen).toBe(true)
  expect(at(legs, T0 + 60_000)).toMatchObject({ pt: POND, pose: 'work', prop: 'bucket' })
  expect(endOf(c, HOME, route)).toBe(Infinity)
  expect(restAt(c, HOME, route)).toBeUndefined()
  const n = c.jobs[0]?.n ?? -1
  const closed = close(c, n, T0 + 40_000, false)
  expect(closed.jobs[0]).toMatchObject({ until: T0 + 40_000, ok: false })
  expect(end(closed, 0)).toBe(T0 + 40_000)
  expect(where(closed, T0 + 40_000)).toEqual(POND)
  expect(where(closed, T0 + 1e7)).toEqual(HOME)
  // A second close keeps the first end; an unknown job is the same crab.
  expect(close(closed, n, T0 + 50_000, false)).toBe(closed)
  expect(close(closed, 9_999_999, T0, true)).toBe(closed)
})

test('a new job cuts the walk home where the crab is, never snapping back', async () => {
  let c = enqueue(crab(), job('water', T0, POND), T0, HOME, route)
  const back = legsOf(c).find(l => l.pose === 'walk' && l.from.x === POND.x && l.from.y === POND.y)
  const ft = (back?.t0 ?? 0) + 5 * BEAT + 40
  const here = where(c, ft)
  expect(here).not.toEqual(POND)
  expect(here).not.toEqual(HOME)
  c = enqueue(c, job('till', ft, ROW), ft, HOME, route)
  expect(c.anchor).toEqual({ ft: ceilBeat(ft), pt: here })
  expect(c.jobs.length).toBe(1)
  expect(where(c, ft)).toEqual(here)
})

test('finished jobs leave the queue and the anchor moves to where the last one ended', async () => {
  let c = enqueue(crab(), job('till', T0, ROW), T0, HOME, route)
  c = enqueue(c, job('water', T0 + 100, POND), T0 + 100, HOME, route)
  const e0 = end(c, 0)
  c = enqueue(c, job('inspect', e0 + 200, ROW), e0 + 200, HOME, route)
  expect(c.jobs.map(j => j.kind)).toEqual(['water', 'inspect'])
  expect(c.anchor).toEqual({ ft: e0, pt: ROW })
})

test('at most three tool jobs; a fourth joins the last one queued', async () => {
  let c = crab()
  const kinds: JobKind[] = ['till', 'scout', 'inspect', 'post', 'sow']
  kinds.forEach((k, i) => { c = enqueue(c, job(k, T0 + i, i % 2 ? ROW : { x: 81, y: 110 }), T0 + i, HOME, route) })
  expect(c.jobs.length).toBe(MAX_JOBS)
  expect(c.jobs.map(j => j.kind)).toEqual(['till', 'scout', 'inspect'])
  expect(c.jobs[2]?.tool).toBe('sow')
})

test('chores are never merged, dropped or capped, and never absorb a call', async () => {
  let c = crab()
  c = enqueue(c, job('harvest', T0, ROW), T0, HOME, route)
  c = enqueue(c, job('haul', T0, BARN), T0, HOME, route)
  c = enqueue(c, job('harvest', T0, ROW), T0, HOME, route)
  for (const k of ['till', 'scout', 'inspect', 'sow', 'post'] as JobKind[]) c = enqueue(c, job(k, T0 + 10, ROW), T0 + 10, HOME, route)
  expect(c.jobs.filter(j => CHORES.has(j.kind)).map(j => j.kind)).toEqual(['harvest', 'haul', 'harvest'])
  expect(c.jobs.filter(j => !CHORES.has(j.kind)).length).toBeLessThan(MAX_JOBS + 1)
  expect(c.jobs.filter(j => CHORES.has(j.kind)).every(j => j.tool === 'harvest' || j.tool === 'haul')).toBe(true)
})

test('a burst of 50 calls in 10 s ends no more than 20 s behind', async () => {
  const rnd = mulberry32(7)
  const kinds: JobKind[] = ['inspect', 'till', 'scout', 'water', 'sow', 'post', 'pack']
  const spots: Pt[] = [ROW, POND, BARN, { x: 147, y: 117 }, { x: 156, y: 206 }]
  let c = crab()
  let ft = T0
  for (let i = 0; i < 50; i++) {
    ft += 200
    const kind = kinds[Math.floor(rnd() * kinds.length)] as JobKind
    const isOpen = kind === 'water' || kind === 'post'
    c = enqueue(c, job(kind, ft, spots[Math.floor(rnd() * spots.length)] as Pt, { isOpen, tool: kind }), ft, HOME, route)
    // Each tool returns before the next call, as the model waits for it.
    const open = c.jobs.find(j => j.isOpen && j.until === undefined)
    if (open) c = close(c, open.n, ft + 50, true)
    const spans = spansOf(c, HOME, route)
    const last = spans[spans.length - 1]?.end ?? ft
    expect(last - ft).toBeLessThan(LAG_MS + 1)
  }
})

test('cut continuity: over 1,000 random sequences, nothing the crab did up to now moves at any enqueue or close', async () => {
  const rnd = mulberry32(2026)
  const kinds: JobKind[] = ['inspect', 'till', 'scout', 'water', 'sprinkle', 'post', 'sow', 'harvest', 'haul', 'compost']
  const spots: Pt[] = [ROW, POND, BARN, HOME, { x: 81, y: 110 }, { x: 147, y: 117 }, { x: 96, y: 80 }]
  let checks = 0
  for (let s = 0; s < 1000; s++) {
    let c = crab({ anchor: { ft: T0, pt: spots[s % spots.length] as Pt } })
    let ft = T0 + Math.floor(rnd() * 4000)
    for (let e = 0; e < 12; e++) {
      ft += Math.floor(rnd() * 6000)
      const before = legsOf(c)
      let after: Crab
      const open = c.jobs.find(j => j.isOpen && j.until === undefined)
      if (open && rnd() < 0.5) after = close(c, open.n, ft, rnd() < 0.8)
      else {
        const kind = kinds[Math.floor(rnd() * kinds.length)] as JobKind
        const isOpen = (kind === 'water' || kind === 'sprinkle' || kind === 'post') && rnd() < 0.7
        after = enqueue(c, job(kind, ft, spots[Math.floor(rnd() * spots.length)] as Pt, { isOpen }), ft, HOME, route)
      }
      const legs = legsOf(after)
      // Now, and every moment before the next beat (when the old picture would next have moved).
      for (const t of [ft, ceilBeat(ft) - 1, ft + 1]) {
        if (t < ft || t >= ceilBeat(ft) && t !== ft) continue
        expect(at(legs, t).pt).toEqual(at(before, t).pt)
        checks++
      }
      expect(legs.every(l => l.t0 % BEAT === 0)).toBe(true)
      c = after
    }
  }
  expect(checks).toBeGreaterThan(12_000)
})

test('a crab on its way out walks into the barn and never comes home', async () => {
  let c = enqueue(crab(), job('compost', T0, { x: 38, y: 190 }), T0, HOME, route)
  c = { ...enqueue(c, job('leave', T0, BARN_IN), T0, HOME, route), leavingAt: T0 }
  const legs = legsOf(c)
  expect(legs[legs.length - 1]?.to).toEqual(BARN_IN)
  expect(endOf(c, HOME, route)).toBe((legs[legs.length - 1]?.t0 ?? 0) + (legs[legs.length - 1]?.beats ?? 0) * BEAT)
  expect(at(legs, T0 + 1e9).pt).toEqual(BARN_IN)
})

test('where an actor is: waiting at its first leg, holding whole steps between beats, staying past its last', async () => {
  const legs: Leg[] = [{ t0: 1000, beats: 4, from: { x: 0, y: 0 }, to: { x: 8, y: 0 }, pose: 'walk' }, { t0: 1500, beats: 2, from: { x: 8, y: 0 }, to: { x: 8, y: 0 }, pose: 'work', prop: 'hoe' }]
  expect(at(legs, 0)).toMatchObject({ pt: { x: 0, y: 0 }, pose: 'stand', face: 1 })
  expect(at(legs, 1000 + BEAT + 60).pt).toEqual({ x: 2, y: 0 })
  expect(at(legs, 1000 + 2 * BEAT).pt).toEqual({ x: 4, y: 0 })
  expect(at(legs, 1600)).toMatchObject({ pt: { x: 8, y: 0 }, pose: 'work', prop: 'hoe', face: 1 })
  expect(at([{ ...legs[0] as Leg, from: { x: 8, y: 0 }, to: { x: 0, y: 0 } }], 1200).face).toBe(-1)
  expect(at(legs, 1e9)).toMatchObject({ pt: { x: 8, y: 0 }, pose: 'work' })
  expect(at([], 5).pt).toEqual({ x: 0, y: 0 })
})

const helper = (over: Partial<Helper> = {}): Helper =>
  ({ id: 'h1', agentId: 'a1', stepId: 'n:0:a', plot: 0, slot: 0, label: 'look', model: 'haiku', since: T0, crates: 2, ...over })
const TOP: Pt = { x: 57, y: 109 }
const YARD: Pt = { x: 96, y: 80 }

test('a helper walks out of the barn to its slot, then loops: work in place, a crate to the yard, and back', async () => {
  const h = helperLegs(helper(), TOP, YARD, route, 'full')
  expect(h.loop).toBeDefined()
  const period = h.loop?.period ?? 0
  const cycle = h.legs
  expect(cycle[0]).toMatchObject({ t0: 0, pose: 'work', from: { x: 65, y: 109 } })
  expect((cycle[0]?.beats ?? 0)).toBeGreaterThan(127)
  expect(cycle.some(l => l.pose === 'carry' && l.prop === 'crate')).toBe(true)
  const last = cycle[cycle.length - 1] as Leg
  expect((last.t0 + last.beats * BEAT) / 1000).toBe(period)
  expect(last.to).toEqual({ x: 65, y: 109 })
  // The intro walks out of the barn door and works until the loop's phase is at its start.
  const intro = h.intro ?? []
  expect(intro[0]?.from).toEqual(BARN_DOOR)
  const loopFrom = (intro[intro.length - 1]?.t0 ?? 0) + (intro[intro.length - 1]?.beats ?? 0) * BEAT
  expect(((loopFrom / 1000 + (h.loop?.offset ?? 0)) % period + period) % period).toBeLessThan(0.001)
  // Every slot shares the period, a third of it apart, so at most one mini of a plot is ever walking.
  const all = [0, 1, 2].map(slot => helperLegs(helper({ slot }), TOP, YARD, route, 'full'))
  expect(new Set(all.map(x => x.loop?.period)).size).toBe(1)
  for (let t = 0; t < period * 1000; t += BEAT) {
    const walking = all.filter(x => {
      const phase = ((t / 1000 + (x.loop?.offset ?? 0)) % period) * 1000
      return at(x.legs, phase).pose !== 'work'
    })
    expect(walking.length).toBeLessThan(2)
  }
  // Calm: work in place only. Still: one held pose at its slot.
  expect(helperLegs(helper(), TOP, YARD, route, 'calm').legs.every(l => l.pose === 'work')).toBe(true)
  expect(helperLegs(helper(), TOP, YARD, route, 'still')).toEqual({ legs: [{ t0: T0, beats: 8, from: { x: 65, y: 109 }, to: { x: 65, y: 109 }, pose: 'work', isOpen: true }] })
})

test('a helper done ferries its crates and goes into the barn; a failed one walks back empty-handed', async () => {
  const done = helperLegs(helper({ endedAt: T0 + 60_000, outcome: 'done', crates: 3 }), TOP, YARD, route, 'full')
  expect(done.loop).toBeUndefined()
  expect(done.legs.filter(l => l.pose === 'stand' && l.to.x === YARD.x && l.to.y === YARD.y).length).toBe(3)
  expect(done.legs[done.legs.length - 1]?.to).toEqual(BARN_IN)
  const failed = helperLegs(helper({ endedAt: T0 + 60_000, outcome: 'failed' }), TOP, YARD, route, 'full')
  expect(failed.legs.some(l => l.prop === 'crate')).toBe(false)
  expect(failed.legs[failed.legs.length - 1]?.to).toEqual(BARN_IN)
})
