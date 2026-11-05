// A crab's errands: the queue rules, the timeline they fold into, and where an actor is at any moment. Pure.
// Positions are never stored: a crab keeps an anchor and up to three jobs, and its legs are folded from them on demand.
// Every leg starts on a beat and moves whole pixels on beats, so a picture built at any moment agrees with any other.
import { BEAT } from '../contracts'
import type { Ft, JobKind, Leg, Motion, Pose, Prop, Pt, RouteFn } from '../contracts'
import type { Crab, Helper, Job } from '../../types'

/** Where crabs come out of and go into the barn (section 3.1). */
export const BARN_DOOR: Pt = { x: 56, y: 80 }
export const BARN_IN: Pt = { x: 56, y: 76 }

export const MAX_JOBS = 3
/** The farm shows the gist of the work at most this far behind it. */
export const LAG_MS = 20_000
const TROT = 2
const STROLL = 1
const LONG_ROUTE = 60

/** Up to the next beat: a new start never lies in the past. */
export const ceilBeat = (ms: number): number => Math.ceil(ms / BEAT) * BEAT

type Act = { beats: number; pose: Pose; prop?: Prop; carry?: Prop; slow?: true }
/** Each kind's act at its destination, in beats; merged calls add 4 beats up to MAX_ACT. */
const ACT: Record<JobKind, Act> = {
  inspect: { beats: 12, pose: 'work' },
  scout: { beats: 16, pose: 'look', prop: 'magnifier' },
  till: { beats: 12, pose: 'work', prop: 'hoe' },
  sow: { beats: 16, pose: 'work', prop: 'sack' },
  pots: { beats: 12, pose: 'work', prop: 'can' },
  water: { beats: 24, pose: 'work', prop: 'bucket' },
  sprinkle: { beats: 16, pose: 'work', prop: 'can' },
  mill: { beats: 16, pose: 'work', prop: 'crank' },
  deliver: { beats: 12, pose: 'carry', prop: 'sack' },
  pack: { beats: 16, pose: 'work', prop: 'hammer' },
  ship: { beats: 12, pose: 'carry', prop: 'crate' },
  post: { beats: 16, pose: 'carry', prop: 'letter' },
  lookout: { beats: 20, pose: 'look' },
  hire: { beats: 8, pose: 'cheer' },
  trade: { beats: 16, pose: 'carry', prop: 'crate' },
  stake: { beats: 8, pose: 'work', prop: 'hammer' },
  almanac: { beats: 24, pose: 'sit', prop: 'book' },
  bell: { beats: 8, pose: 'cheer' },
  alarm: { beats: 12, pose: 'work', prop: 'crank' },
  watch: { beats: 16, pose: 'sit' },
  blueprint: { beats: 12, pose: 'work', prop: 'book' },
  backfield: { beats: 8, pose: 'stand' },
  tinker: { beats: 12, pose: 'work', prop: 'hammer' },
  harvest: { beats: 18, pose: 'work', prop: 'basket' },
  haul: { beats: 4, pose: 'stand', carry: 'crate', slow: true },
  compost: { beats: 8, pose: 'work', carry: 'crate', slow: true },
  arrive: { beats: 0, pose: 'stand', slow: true },
  leave: { beats: 0, pose: 'stand', slow: true },
  basket: { beats: 8, pose: 'stand', carry: 'basket', slow: true },
  muster: { beats: 8, pose: 'stand' },
}
const MAX_ACT = 48

/** Farm moments, not tool calls: never merged, never dropped by the lag bound or the cap. */
export const CHORES: ReadonlySet<JobKind> = new Set<JobKind>(['harvest', 'haul', 'compost', 'arrive', 'leave', 'basket', 'muster'])

/** How long a job's act lasts at least, in beats. */
export const actBeats = (job: Job): number => {
  const a = ACT[job.kind]
  return a.beats === 0 ? 0 : Math.min(Math.max(a.beats, MAX_ACT), a.beats + 4 * (Math.max(1, job.count) - 1))
}

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y
const span = (a: Pt, b: Pt): number => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))

/** The corner points from one point to another, both ends included, no repeats. */
const path = (from: Pt, to: Pt, route: RouteFn): Pt[] => {
  const pts: Pt[] = [from]
  for (const p of [...route(from, to), to]) {
    const last = pts[pts.length - 1]
    if (!last || !same(last, p)) pts.push({ x: p.x, y: p.y })
  }
  return pts
}
const lengthOf = (pts: Pt[]): number => pts.slice(1).reduce((n, p, i) => n + span(pts[i] as Pt, p), 0)

/** Walk a path from time t: one leg per straight run. Returns when it arrives. */
const walk = (legs: Leg[], pts: Pt[], t: number, speed: number, pose: Pose, prop?: Prop): number => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt, b = pts[i] as Pt
    const beats = Math.ceil(span(a, b) / speed)
    if (beats === 0) continue
    legs.push(prop ? { t0: t, beats, from: a, to: b, pose, prop } : { t0: t, beats, from: a, to: b, pose })
    t += beats * BEAT
  }
  return t
}
const stay = (legs: Leg[], at: Pt, t: number, beats: number, pose: Pose, prop?: Prop, isOpen?: true): number => {
  if (beats <= 0 && !isOpen) return t
  const leg: Leg = { t0: t, beats: Math.max(beats, 1), from: at, to: at, pose }
  if (prop) leg.prop = prop
  if (isOpen) leg.isOpen = true
  legs.push(leg)
  return t + leg.beats * BEAT
}

type Span = { start: number; arrive: number; end: number }   // end is Infinity while an open act holds
type Fold = { legs: Leg[]; spans: Span[]; restAt?: number }

/** The jobs folded into legs from the anchor, with each job's start, arrival and end. */
const fold = (crab: Crab, home: Pt, route: RouteFn, isWorking: boolean): Fold => {
  const legs: Leg[] = []
  const spans: Span[] = []
  let t = crab.anchor.ft
  let pt = crab.anchor.pt
  for (const job of crab.jobs) {
    const start = Math.max(t, ceilBeat(job.t0))
    // A job queued after the last one ended waits where the crab stands.
    if (start > t) stay(legs, pt, t, (start - t) / BEAT, same(pt, home) ? (isWorking ? 'type' : 'sit') : 'stand')
    const a = ACT[job.kind]
    const pts = path(pt, job.to, route)
    const speed = a.slow ? STROLL : TROT
    const arrive = walk(legs, pts, start, speed, a.carry ? 'carry' : 'walk', a.carry)
    const min = actBeats(job)
    if (job.isOpen && job.until === undefined) {
      // An open act holds its pose until the tool returns, and nothing after it is drawn yet.
      stay(legs, job.to, arrive, Math.max(min, 1), a.pose, a.prop, true)
      spans.push({ start, arrive, end: Infinity })
      return { legs, spans }
    }
    const end = job.isOpen ? Math.max(arrive + min * BEAT, ceilBeat(job.until ?? 0)) : arrive + min * BEAT
    stay(legs, job.to, arrive, (end - arrive) / BEAT, a.pose, a.prop)
    spans.push({ start, arrive, end })
    t = end
    pt = job.to
  }
  // A crab on its way out never comes back home.
  if (crab.leavingAt !== undefined || crab.jobs[crab.jobs.length - 1]?.kind === 'leave') return { legs, spans }
  const back = path(pt, home, route)
  t = walk(legs, back, t, lengthOf(back) > LONG_ROUTE ? TROT : STROLL, 'walk')
  stay(legs, home, t, 8, isWorking ? 'type' : 'sit', undefined, true)
  return { legs, spans, restAt: t }
}

/** A crab's legs from its anchor: its jobs, then home to type (while the turn works) or sit. */
export function timeline(crab: Crab, home: Pt, route: RouteFn, isWorking: boolean): Leg[] {
  return fold(crab, home, route, isWorking).legs
}

/** When the crab's queue next lets it rest at home, or undefined while an act holds. */
export const restAt = (crab: Crab, home: Pt, route: RouteFn): number | undefined => fold(crab, home, route, true).restAt

/** When the crab's last leg ends (a leaving crab is gone then), Infinity while an act holds. */
export const endOf = (crab: Crab, home: Pt, route: RouteFn): number => {
  const f = fold(crab, home, route, true)
  if (f.spans.some(s => s.end === Infinity)) return Infinity
  const last = f.legs[f.legs.length - 1]
  return last ? (last.isOpen ? last.t0 : last.t0 + last.beats * BEAT) : crab.anchor.ft
}

/** When each job starts, arrives and ends, in queue order. */
export const spansOf = (crab: Crab, home: Pt, route: RouteFn): Span[] => fold(crab, home, route, true).spans

const merged = (last: Job, job: Job, isCounted: boolean): Job => {
  const next: Job = { ...last, count: Math.min(999, last.count + (isCounted ? job.count : 0)), tool: job.tool }
  if (job.note !== undefined) next.note = job.note
  else delete next.note
  if (job.hue !== undefined) next.hue = job.hue
  if (job.isOpen) {
    next.isOpen = true
    delete next.until
  }
  delete next.ok
  return next
}

/** Job k absorbs a call; its act grows only while it still ends within the lag bound. */
const absorb = (c: Crab, k: number, job: Job, ft: Ft, home: Pt, route: RouteFn): Crab => {
  const into = merged(c.jobs[k] as Job, job, true)
  const grown: Crab = { ...c, jobs: c.jobs.map((j, i) => (i === k ? into : j)) }
  const end = fold(grown, home, route, true).spans[k]?.end
  if (end === undefined || end === Infinity || end - ft <= LAG_MS) return grown
  return { ...c, jobs: c.jobs.map((j, i) => (i === k ? merged(j, job, false) : j)) }
}

/**
 * A job queued on a crab (section 3.4), in the spec's order:
 * 1. compact: jobs whose act ended by now leave, and the anchor moves to where and when the last of them ended;
 * 2. merge: a job of the same kind still under way absorbs the call;
 * 3. cut: with nothing left to do, the crab starts from where it stands now, never snapping back;
 * 4. lag bound: a job that would end more than 20 s from now joins the last tool job queued instead;
 * 5. cap: so does a fourth tool job.
 * Chores (harvest, haul, arrive, leave...) are farm moments: never merged, never dropped, never absorbing a call.
 * Nothing the crab does at or before `ft` changes.
 */
export function enqueue(crab: Crab, job: Job, ft: Ft, home: Pt, route: RouteFn): Crab {
  const T = ceilBeat(ft)
  const before = fold(crab, home, route, true)
  // 1. Compact.
  let drop = 0
  while (drop < crab.jobs.length && (before.spans[drop]?.end ?? Infinity) <= ft) drop++
  let c: Crab = crab
  if (drop > 0) c = { ...crab, anchor: { ft: (before.spans[drop - 1] as Span).end, pt: (crab.jobs[drop - 1] as Job).to }, jobs: crab.jobs.slice(drop) }
  // 3. Cut the walk home (done first so every later rule sees where the crab really starts).
  if (c.jobs.length === 0) c = { ...c, anchor: { ft: T, pt: at(before.legs, ft).pt } }
  const next: Job = { ...job, t0: Math.max(ceilBeat(job.t0), T) }
  const grown: Crab = { ...c, jobs: [...c.jobs, next] }
  if (CHORES.has(job.kind)) return grown
  // 2. Merge with the last job when it is the same kind (every job left is still under way).
  const last = c.jobs.length - 1
  const tail = c.jobs[last]
  if (tail && tail.kind === job.kind) return absorb(c, last, job, ft, home, route)
  // 4 and 5. The lag bound and the cap. A queue held by a tool still running can't say when the job would start.
  const span = fold(grown, home, route, true).spans[grown.jobs.length - 1]
  const isLate = span !== undefined && span.arrive + actBeats(next) * BEAT - ft > LAG_MS
  const tools = c.jobs.filter(j => !CHORES.has(j.kind)).length
  if (!isLate && tools < MAX_JOBS) return grown
  let k = last
  while (k >= 0 && CHORES.has((c.jobs[k] as Job).kind)) k--
  // Only chores ahead: the call waits its turn after them.
  return k < 0 ? grown : absorb(c, k, job, ft, home, route)
}

/** The tool behind job `n` returned. Same reference for an unknown `n` or nothing new. */
export function close(crab: Crab, n: number, until: Ft, ok: boolean): Crab {
  const i = crab.jobs.findIndex(j => j.n === n)
  const job = crab.jobs[i]
  if (!job) return crab
  // A job already closed keeps its end: moving it later would rewrite a walk already drawn.
  const nextUntil = job.until ?? until
  const nextOk = job.ok === false ? false : ok
  if (job.until === nextUntil && job.ok === nextOk) return crab
  const next: Job = { ...job, until: nextUntil, ok: nextOk }
  return { ...crab, jobs: crab.jobs.map((j, k) => (k === i ? next : j)) }
}

// --- helpers ----------------------------------------------------------------

const WORK_BEATS = 128
const DROP_BEATS = 8

/** A helper's slot on top of its plot: (p.x + 8 + 9k, p.y). Beyond the third it shows as +N on the last one. */
export const slotPt = (plotTop: Pt, slot: number): Pt => ({ x: plotTop.x + 8 + 9 * Math.min(Math.max(slot, 0), 2), y: plotTop.y })

/** A crate's round trip from a slot to the yard and back, in beats. */
const tripBeats = (slot: Pt, yard: Pt, route: RouteFn): number => {
  const legs: Leg[] = []
  let t = walk(legs, path(slot, yard, route), 0, STROLL, 'carry', 'crate')
  t = stay(legs, yard, t, DROP_BEATS, 'stand')
  return walk(legs, path(yard, slot, route), t, STROLL, 'walk') / BEAT
}

/**
 * A subagent's legs. While it runs: `intro` (absolute farm time) walks it from the barn to its slot and holds there
 * until its loop's phase comes round; `legs` is then one period of its loop (from 0), work in place and, under full
 * motion, a crate carried to the yard and back. Every slot of a plot shares one period, long enough that the three
 * trips, a third of a period apart, never overlap: at most one mini per plot is walking. Once ended it is a one-shot:
 * done ferries its crates and goes into the barn, failed walks back.
 */
export function helperLegs(h: Helper, plotTop: Pt, yard: Pt, route: RouteFn, motion: Motion): { legs: Leg[]; loop?: { period: number; offset: number }; intro?: Leg[] } {
  const slot = slotPt(plotTop, h.slot)
  if (motion === 'still') {
    return h.endedAt === undefined ? { legs: [{ t0: h.since, beats: 8, from: slot, to: slot, pose: 'work', isOpen: true }] } : { legs: [] }
  }
  // One period of the loop, from 0: work, then the trip, ending at the period's end.
  const cycle: Leg[] = []
  let periodBeats = WORK_BEATS
  if (motion === 'full') {
    const longest = Math.max(...[0, 1, 2].map(k => tripBeats(slotPt(plotTop, k), yard, route)))
    periodBeats = Math.max(WORK_BEATS + longest, 3 * longest)
    let t = stay(cycle, slot, 0, periodBeats - tripBeats(slot, yard, route), 'work')
    t = walk(cycle, path(slot, yard, route), t, STROLL, 'carry', 'crate')
    t = stay(cycle, yard, t, DROP_BEATS, 'stand')
    walk(cycle, path(yard, slot, route), t, STROLL, 'walk')
  } else {
    stay(cycle, slot, 0, WORK_BEATS, 'work')
  }
  const offsetBeats = motion === 'full' ? Math.min(h.slot, 2) * Math.floor(periodBeats / 3) : 0
  // The walk from the barn, then work in place until the loop's phase is at its start.
  const intro: Leg[] = []
  const since = ceilBeat(h.since)
  const arrived = walk(intro, path(BARN_DOOR, slot, route), since, STROLL, 'walk')
  const phase = (arrived / BEAT + offsetBeats) % periodBeats
  const hold = (periodBeats - phase) % periodBeats
  const loopFrom = stay(intro, slot, arrived, hold, 'work')
  const loop = { period: (periodBeats * BEAT) / 1000, offset: (offsetBeats * BEAT) / 1000 }
  if (h.endedAt === undefined) return { legs: cycle, loop, intro }

  // Where it was when it ended, then home through the barn door.
  const end = ceilBeat(h.endedAt)
  const here = end < loopFrom ? at(intro, end).pt : at(cycle, ((end / BEAT + offsetBeats) % periodBeats) * BEAT).pt
  const out: Leg[] = []
  let u = end
  let pt = here
  if (h.outcome === 'done') {
    for (let k = 0; k < Math.max(1, Math.min(3, h.crates)); k++) {
      if (k > 0) { u = walk(out, path(pt, slot, route), u, STROLL, 'walk'); pt = slot }
      u = walk(out, path(pt, yard, route), u, STROLL, 'carry', 'crate')
      u = stay(out, yard, u, DROP_BEATS, 'stand')
      pt = yard
    }
  } else {
    u = stay(out, pt, u, 8, 'stand')
  }
  u = walk(out, path(pt, BARN_DOOR, route), u, STROLL, 'walk')
  walk(out, [BARN_DOOR, BARN_IN], u, STROLL, 'walk')
  return { legs: out }
}

// --- where an actor is --------------------------------------------------------

/** The point a leg has reached after k whole beats: whole pixels, the same steps the renderer's steps(n) take. */
const stepAt = (leg: Leg, k: number): Pt => {
  const dx = leg.to.x - leg.from.x, dy = leg.to.y - leg.from.y
  const len = Math.max(Math.abs(dx), Math.abs(dy))
  if (len === 0) return leg.from
  const speed = Math.ceil(len / Math.max(1, leg.beats))
  const d = Math.min(len, Math.max(0, k) * speed)
  return { x: leg.from.x + Math.round((dx * d) / len), y: leg.from.y + Math.round((dy * d) / len) }
}

const faceAt = (legs: Leg[], i: number): 1 | -1 => {
  for (let k = i; k >= 0; k--) {
    const l = legs[k] as Leg
    if (l.to.x !== l.from.x) return l.to.x > l.from.x ? 1 : -1
  }
  return 1
}

/**
 * Where an actor is at time t, how it stands and which way it faces: the one position function. Before its first
 * leg it waits at that leg's start; between beats it holds the last whole step; past its last leg it stays there.
 */
export function at(legs: Leg[], t: number): { pt: Pt; pose: Pose; face: 1 | -1; prop?: Prop; leg?: Leg } {
  const first = legs[0]
  if (!first) return { pt: { x: 0, y: 0 }, pose: 'stand', face: 1 }
  let i = -1
  for (let k = 0; k < legs.length; k++) {
    if ((legs[k] as Leg).t0 <= t) i = k
    else break
  }
  if (i < 0) {
    const isMove = !same(first.from, first.to)
    const r = { pt: first.from, pose: isMove ? ('stand' as Pose) : first.pose, face: faceAt(legs, 0), leg: first }
    return first.prop && !isMove ? { ...r, prop: first.prop } : r
  }
  const leg = legs[i] as Leg
  const k = Math.floor((t - leg.t0) / BEAT)
  const isDone = k >= leg.beats && !leg.isOpen
  const pt = isDone ? leg.to : stepAt(leg, Math.min(k, leg.beats))
  const pose: Pose = isDone && leg.pose === 'walk' ? 'stand' : leg.pose
  const r = { pt, pose, face: faceAt(legs, i), leg }
  return leg.prop ? { ...r, prop: leg.prop } : r
}
