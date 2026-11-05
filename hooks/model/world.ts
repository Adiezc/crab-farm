// The farm's one reducer: every event of a session, applied to the live state (spec 3.2). Pure: the time comes in as
// `now`, and the farm's places (routes, landmarks, homes, the yard) through `ctx`, so tests can pass their own.
// It returns the same reference when nothing changes, so the engine writes, and the pane redraws, only when it must.
import { BEAT } from '../contracts'
import type { Ft, JobKind, LandmarkId, Ms, Pt, ResolveFn, RouteFn } from '../contracts'
import type { Crab, Fx, Helper, Job, Live, Model, Plan, Step } from '../../types'
import { BARN_IN, ceilBeat, close, endOf, enqueue, helperLegs, restAt, spansOf } from './jobs'
import { countCall, emptyPlan, reducePlan, taskName, toEvents, workStep } from './plan'
import type { PlanEvent } from './plan'
import { earnCall, earnHarvest, earnHelper, emptyEarn } from './progress'
import { classify } from './tools'

export type FarmEvent =
  /** A main-loop turn starting. `model`, when known, is the model driving it: the working crab's hat band. */
  | { kind: 'turnStart'; text: string; turnId: string; model?: string }
  | { kind: 'turnEnd'; reason: Live['turn']['outcome'] }
  /** A tool call about to run. `agentId` is set for a subagent's call; only its Task tools count (their list is shared). */
  | { kind: 'call'; tool: string; args: Record<string, unknown>; useId: string; isReadOnly?: boolean; agentId?: string }
  /** The call returned. `args` are the call's own, which the Task tools' results need beside their ids. */
  | { kind: 'result'; tool: string; useId: string; result: unknown; isError: boolean; args?: Record<string, unknown>; agentId?: string }
  | { kind: 'ask'; tool: string }
  | { kind: 'askClear' }
  /** A subagent starting. `useId` is the Agent call's tool_use_id: its result later says how many crates it brings. */
  | { kind: 'spawn'; agentId?: string; model: string; label: string; useId?: string }
  | { kind: 'agentEnd'; agentId: string; reason: string }
  | { kind: 'compact' }
  | { kind: 'clear' }
  /** What the farm knows of its session: the project's folder name for the sign, the main loop's model for the hat. */
  | { kind: 'meta'; project?: string; model?: string }

export type WorldCtx = { owned: number; route: RouteFn; resolve: ResolveFn; home: (plot: number) => Pt; yard: Pt }

/** The farmhand who keeps plot 0 when there is no plan. */
export const RESIDENT = 'resident'
/** home(0), where the farmhand starts (spec 3.1). */
const HOME0: Pt = { x: 50, y: 121 }
const MAX_HELPERS = 24
const MAX_FX = 8
const FX_MS = 30_000
const STAGGER = 16 * BEAT
const ARRIVE_GAP = 4 * BEAT
/** restSince while an act holds: idle routines never start. */
const BUSY = Number.MAX_SAFE_INTEGER

/** Farm time: wall time less every pause, standing still while Claude asks you something. */
export const farmTime = (live: Live, now: Ms): Ft => (live.clock.pauseFrom ?? now) - live.clock.pausedMs

export function emptyLive(now: Ms, home0: Pt = HOME0): Live {
  const ft = ceilBeat(now)
  return {
    rev: 0,
    turn: { isWorking: false, text: '', hadTools: false },
    clock: { pausedMs: 0 },
    plan: emptyPlan(),
    crabs: [{ stepId: RESIDENT, plot: 0, anchor: { ft, pt: { ...home0 } }, jobs: [], restSince: ft }],
    helpers: [],
    fx: [],
    tasks: 0,
    seq: 1,
    earn: emptyEarn(now),
  }
}

/**
 * The coins the board shows at farm time `ft`: everything credited so far, less the coins still riding on a crate
 * that hasn't landed. The number moves when a crate lands, never on a tool call (spec 6.2).
 */
export const shownCoins = (live: Live, ft: Ft): number =>
  live.earn.shown - live.fx.reduce((n, f) => n + (f.kind === 'coins' && f.t0 > ft ? f.value ?? 0 : 0), 0)

// ---- one reduction's working set ----

type W = { now: Ms; ft: Ft; ctx: WorldCtx; seq: number }
const take = (w: W): number => w.seq++

const isLeaving = (c: Crab): boolean => c.leavingAt !== undefined
const plotTop = (w: W, plot: number): Pt => { const h = w.ctx.home(plot); return { x: h.x + 7, y: h.y - 12 } }
const where = (w: W, kind: JobKind, plot: number): { land: LandmarkId; to: Pt } => w.ctx.resolve(kind, plot, w.ctx.owned)

const chore = (w: W, kind: JobKind, plot: number, t0: Ft, to?: Pt): Job => {
  const dest = to ? { land: 'barnIn' as LandmarkId, to } : where(w, kind, plot)
  return { n: take(w), kind, t0, to: dest.to, land: dest.land, isOpen: false, count: 1, tool: '' }
}

/** A crab with its restSince kept to when its queue lands it home, after any change to its jobs. */
const settled = (c: Crab, w: W): Crab => {
  const rest = restAt(c, w.ctx.home(c.plot), w.ctx.route) ?? BUSY
  return rest === c.restSince ? c : { ...c, restSince: rest }
}
const queue = (c: Crab, job: Job, w: W): Crab => settled(enqueue(c, job, w.ft, w.ctx.home(c.plot), w.ctx.route), w)

/** A model's family from an alias or a full id ('claude-haiku-5-5' → haiku); anything unknown is opus. */
export const modelOf = (model: string): Model => {
  const m = model.toLowerCase()
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('fable') ? 'fable' : 'opus'
}
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Events as the engine may really send them (a tool with no input, a prompt with no text): nothing odd throws. */
const tidy = (ev: FarmEvent): FarmEvent => {
  switch (ev.kind) {
    case 'call': return { ...ev, tool: str(ev.tool), args: rec(ev.args) }
    case 'result': return ev.args === undefined ? { ...ev, tool: str(ev.tool) } : { ...ev, tool: str(ev.tool), args: rec(ev.args) }
    case 'turnStart': return { ...ev, text: str(ev.text), turnId: str(ev.turnId) }
    case 'spawn': return { ...ev, model: str(ev.model), label: str(ev.label) }
    case 'ask': return { ...ev, tool: str(ev.tool) }
    default: return ev
  }
}

/** Coins earned since the board last moved ride on this effect; the board credits them as it lands. */
const coinsFx = (l: Live, w: W, at: Pt, t0: Ft): Live => {
  const value = l.earn.coins - l.earn.shown
  if (value <= 0) return l
  const fx: Fx = { n: take(w), kind: 'coins', at: { ...at }, t0, value }
  return { ...l, fx: [...l.fx, fx], earn: { ...l.earn, shown: l.earn.coins } }
}

// ---- the plan, its seats and its crabs ----

/** A crab that lost its plot this reduction, by plot and step: it leaves once any harvest of its own is queued. */
const departKey = (c: Crab): string => `${c.plot}:${c.stepId}`

/**
 * Every seated step gets its crab and every crab without a seat is marked to leave (`depart` sends it, after
 * `harvests`, so a finished step evicted at once still picks its row). A crab hands over to the step now on its plot
 * and keeps standing when that step is its own carried on: the prompt step absorbed by a list, the farmhand's first
 * step, or a step another source names again (spec 8.3, 8.4). New crabs walk out of the barn, 4 beats apart.
 */
const reseat = (l: Live, old: Plan, w: W): { live: Live; renamed: Map<string, string>; departing: Set<string> } => {
  const { plan } = l
  const ids = new Set(plan.steps.map(s => s.id))
  const oldIds = new Set(old.steps.map(s => s.id))
  const renamed = new Map<string, string>()
  const departing = new Set<string>()
  const kept = new Set<string>()
  // The farmhand keeps an empty farm.
  const isKept = (c: Crab): boolean => plan.seats[c.plot] === c.stepId || c.stepId === RESIDENT && plan.steps.length === 0
  for (const c of l.crabs) if (!isLeaving(c) && isKept(c)) kept.add(c.stepId)
  let changed = false
  const crabs = l.crabs.map(c => {
    if (isLeaving(c) || isKept(c)) return c
    changed = true
    const seat = plan.seats[c.plot]
    const now = plan.steps.find(s => s.id === seat)
    const isCarried = now !== undefined && !oldIds.has(now.id) && old.steps.some(s => s.id === c.stepId && s.name === now.name)
    const canHandOver = !ids.has(c.stepId) && (c.stepId === RESIDENT || c.stepId.startsWith('p:') || isCarried)
    if (canHandOver && seat !== null && seat !== undefined && !kept.has(seat)) {
      kept.add(seat)
      renamed.set(c.stepId, seat)
      return { ...c, stepId: seat }
    }
    departing.add(departKey(c))
    return c
  })
  let k = 0
  const arrive = (stepId: string, plot: number): void => {
    const T = ceilBeat(w.ft)
    const crab: Crab = { stepId, plot, anchor: { ft: T, pt: { ...BARN_IN } }, jobs: [], restSince: BUSY }
    crabs.push(queue(crab, chore(w, 'arrive', plot, T + ARRIVE_GAP * k++), w))
    changed = true
  }
  plan.seats.forEach((id, plot) => { if (id !== null && !kept.has(id)) arrive(id, plot) })
  if (plan.steps.length === 0 && !crabs.some(c => !isLeaving(c) && !departing.has(departKey(c)))) arrive(RESIDENT, 0)
  return { live: changed ? { ...l, crabs } : l, renamed, departing }
}

/** The crabs marked to leave walk into the barn, after any harvest of theirs; a step dropped unfinished is composted first. */
const depart = (l: Live, old: Plan, departing: Set<string>, w: W): Live => {
  if (departing.size === 0) return l
  const ids = new Set(l.plan.steps.map(s => s.id))
  const crabs = l.crabs.map(c => {
    if (isLeaving(c) || !departing.has(departKey(c))) return c
    let x = c
    const was = old.steps.find(s => s.id === c.stepId)
    if (was && was.status !== 'completed' && !ids.has(c.stepId)) x = queue(x, chore(w, 'compost', c.plot, w.ft), w)
    x = queue(x, chore(w, 'leave', c.plot, w.ft, BARN_IN), w)
    return { ...x, leavingAt: w.ft }
  })
  return { ...l, crabs }
}

/** Running helpers stay with their step; when it leaves the plots they go where a new helper would. */
const rehome = (l: Live, renamed: Map<string, string>): Live => {
  const { plan } = l
  const target = workStep(plan)
  const goTo = target && plan.seats.includes(target.id) ? target.id : undefined
  const used = new Map<string, Set<number>>()
  const use = (id: string, slot: number): void => { const s = used.get(id) ?? new Set(); s.add(slot); used.set(id, s) }
  for (const h of l.helpers) if (h.endedAt === undefined && plan.seats.includes(h.stepId) && !renamed.has(h.stepId)) use(h.stepId, h.slot)
  let changed = false
  const helpers = l.helpers.map((h): Helper => {
    if (h.endedAt !== undefined) return h
    let id = renamed.get(h.stepId) ?? h.stepId
    if (!plan.seats.includes(id)) id = goTo ?? id
    const plot = plan.seats.indexOf(id)
    if (plot < 0 || id === h.stepId && plot === h.plot) return h
    const taken = used.get(id) ?? new Set<number>()
    let slot = h.slot
    if (taken.has(slot)) { slot = 0; while (taken.has(slot)) slot++ }
    use(id, slot)
    changed = true
    return { ...h, stepId: id, plot, slot }
  })
  return changed ? { ...l, helpers } : l
}

/**
 * Steps that just finished are paid once (spec 6.2). A seated one is harvested: its crab picks the row, then hauls the
 * crate to the yard, and the coins land with it. Several at once are staggered 16 beats apart.
 */
const harvests = (l: Live, old: Plan, w: W): Live => {
  const was = new Map(old.steps.map(s => [s.id, s.status]))
  let out = l
  let k = 0
  l.plan.steps.forEach((s, i) => {
    if (s.status !== 'completed' || s.paid || was.get(s.id) === 'completed') return
    const paid = earnHarvest(out.earn, s, w.now)
    if (paid.coins === 0) return
    const steps = out.plan.steps.map((x, j): Step => (j === i ? { ...x, paid: true } : x))
    out = { ...out, earn: paid.earn, plan: { ...out.plan, steps } }
    const ci = out.crabs.findIndex(c => c.stepId === s.id && !isLeaving(c))
    const crab = out.crabs[ci]
    if (!crab) {
      // No plot in view: the coins go straight on the board.
      out = { ...out, earn: { ...out.earn, shown: out.earn.coins } }
      return
    }
    const t0 = w.ft + STAGGER * k++
    let c = queue(crab, chore(w, 'harvest', crab.plot, t0), w)
    const haul = chore(w, 'haul', crab.plot, t0)
    c = queue(c, haul, w)
    const lands = spansOf(c, w.ctx.home(c.plot), w.ctx.route)[c.jobs.findIndex(j => j.n === haul.n)]?.arrive
    out = { ...out, crabs: out.crabs.map((x, j) => (j === ci ? c : x)) }
    out = coinsFx(out, w, haul.to, lands !== undefined && lands !== Infinity ? lands : w.ft)
  })
  return out
}

/** The plan moved: crabs re-seated, helpers re-homed, finished steps harvested, crabs without a plot sent off. */
const withPlan = (l: Live, plan: Plan, w: W): Live => {
  if (plan === l.plan) return l
  const old = l.plan
  const seated = reseat({ ...l, plan }, old, w)
  return depart(harvests(rehome(seated.live, seated.renamed), old, w), old, seated.departing, w)
}

const planEvents = (l: Live, evs: PlanEvent[], w: W): Live => {
  let plan = l.plan
  for (const ev of evs) plan = reducePlan(plan, ev, w.now)
  return withPlan(l, plan, w)
}

// ---- the ask freeze ----

/** The ask is answered: one write adds the pause to pausedMs, and every crab resumes from where it stood (spec 3.7). */
const unfreeze = (l: Live, now: Ms): Live => {
  if (!l.asking && l.clock.pauseFrom === undefined) return l
  const pausedMs = l.clock.pausedMs + (l.clock.pauseFrom === undefined ? 0 : Math.max(0, now - l.clock.pauseFrom))
  const { asking: _, ...rest } = l
  return { ...rest, clock: { pausedMs } }
}

// ---- events ----

/**
 * A turn is over (or a new one began without its end ever arriving): any ask is answered, whatever it left running
 * ends now, and a helper with no id leaves with it, empty-handed. Nothing stays frozen or holding into the next turn.
 */
const windUp = (l0: Live, w: W, ok: boolean): Live => {
  const l = unfreeze(l0, w.now)
  w.ft = farmTime(l, w.now)
  let changed = l !== l0
  const crabs = l.crabs.map(c => {
    let x = c
    for (const j of c.jobs) if (j.isOpen && j.until === undefined) x = close(x, j.n, w.ft, ok)
    if (x === c) return c
    changed = true
    return settled(x, w)
  })
  const helpers = l.helpers.map(h => {
    if (h.agentId !== undefined || h.endedAt !== undefined) return h
    changed = true
    return { ...h, endedAt: w.ft }
  })
  return changed ? { ...l, crabs, helpers } : l0
}

const turnStart = (l0: Live, ev: Extract<FarmEvent, { kind: 'turnStart' }>, w: W): Live => {
  // The turn under way announced again (a reload replays it) is nothing new: its errands keep running.
  if (ev.turnId && l0.turn.isWorking && l0.turn.id === ev.turnId) return ev.model ? meta(l0, { kind: 'meta', model: ev.model }) : l0
  const l = windUp(l0, w, true)
  // Only the prompt's start is kept: nothing draws more, and a pasted log would ride along on every write.
  const turn: Live['turn'] = { isWorking: true, id: ev.turnId, text: ev.text.slice(0, 200), startedAt: w.now, hadTools: false }
  const next: Live = ev.model ? { ...l, turn, model: modelOf(ev.model) } : { ...l, turn }
  // With no list, one already done, or one made from the last prompt, the prompt is a plan of one step (spec 8.4).
  return withPlan(next, reducePlan(l.plan, { kind: 'prompt', name: taskName(ev.text, l.tasks + 1), turnId: ev.turnId }, w.now), w)
}

const turnEnd = (l0: Live, ev: Extract<FarmEvent, { kind: 'turnEnd' }>, w: W): Live => {
  // Even a second end (or one with no turn) closes whatever is still open: reduce gives back the same farm if nothing was.
  let l = windUp(l0, w, ev.reason === 'answer' || ev.reason === 'refusal')
  const turn: Live['turn'] = { ...l.turn, isWorking: false }
  if (ev.reason) turn.outcome = ev.reason
  else delete turn.outcome
  l = { ...l, turn }
  // A prompt's step is brought in when its turn answered after doing some work.
  if (ev.reason === 'answer' && l0.turn.hadTools && l.plan.source === 'prompt') l = planEvents(l, [{ kind: 'finish' }], w)
  return l
}

const PLAN_SCOPES = new Set(['first_task', 'new_task'])
const isTaskTool = (tool: string): boolean => tool === 'TaskCreate' || tool === 'TaskUpdate' || tool === 'TaskList'

const call = (l0: Live, ev: Extract<FarmEvent, { kind: 'call' }>, w: W): Live => {
  // A subagent's calls are its own business; its Task tools speak through their results. A call with no tool is nothing.
  if (ev.agentId !== undefined || !ev.tool) return l0
  // The call's own coin first, so a step it finishes carries it to the yard.
  let l: Live = { ...l0, earn: earnCall(l0.earn, w.now), turn: l0.turn.hadTools ? l0.turn : { ...l0.turn, hadTools: true } }
  l = planEvents(l, toEvents(ev.tool, ev.args), w)
  if (ev.tool.includes('ccd_turn') && ev.tool.endsWith('__update_plan') && typeof ev.args.scope === 'string' && PLAN_SCOPES.has(ev.args.scope)) l = { ...l, tasks: l.tasks + 1 }
  // It counts toward the step it is made for, once the plan has moved.
  const target = workStep(l.plan)
  l = { ...l, plan: countCall(l.plan, target?.id, w.now) }
  // The call becomes an errand of the working step's crab, or the farmhand's.
  const ci = l.crabs.findIndex(c => !isLeaving(c) && c.stepId === (target?.id ?? RESIDENT))
  const crab = l.crabs[ci]
  if (!crab) return l
  const cls = classify(ev.tool, ev.args, ev.isReadOnly)
  // A tinker that only looks does it at the row; one that changes things goes into the barn (spec 3.3).
  const dest = where(w, cls.kind === 'tinker' && !cls.isOpen ? 'inspect' : cls.kind, crab.plot)
  const edits = ev.tool === 'MultiEdit' && Array.isArray(ev.args.edits) ? Math.min(4, Math.max(1, ev.args.edits.length)) : 1
  const job: Job = { n: take(w), kind: cls.kind, t0: w.ft, to: dest.to, land: dest.land, isOpen: cls.isOpen, count: edits, tool: ev.tool }
  if (cls.note !== undefined) job.note = cls.note
  if (cls.hue !== undefined) job.hue = cls.hue
  const c = queue(crab, job, w)
  return { ...l, crabs: l.crabs.map((x, i) => (i === ci ? c : x)) }
}

/** The oldest job still holding for this tool closes: the act ends now, a fail leaves a puddle, a pass a sparkle. */
const closeFor = (l: Live, tool: string, ok: boolean, w: W): Live => {
  let best: { ci: number; job: Job } | undefined
  l.crabs.forEach((c, ci) => {
    for (const job of c.jobs) if (job.isOpen && job.until === undefined && job.tool === tool && (!best || job.n < best.job.n)) best = { ci, job }
  })
  if (!best) return l
  const { ci, job } = best
  const crabs = l.crabs.map((c, i) => (i === ci ? settled(close(c, job.n, w.ft, ok), w) : c))
  const mark: Fx['kind'] | undefined = !ok ? 'puddle' : job.kind === 'sprinkle' ? 'sparkle' : undefined
  const fx = mark ? [...l.fx, { n: take(w), kind: mark, at: { ...job.to }, t0: ceilBeat(w.ft) }] : l.fx
  return { ...l, crabs, fx }
}

/** The Agent tool returned: its subagent's crates, 1 to 3, from the tools it used (spec 3.6). */
const crates = (l: Live, ev: Extract<FarmEvent, { kind: 'result' }>): Live => {
  const r = rec(ev.result)
  const i = l.helpers.findIndex(h => h.id === ev.useId || (typeof r.agentId === 'string' && h.agentId === r.agentId))
  const h = l.helpers[i]
  if (!h || r.status === 'async_launched') return l
  const s = rec(r.toolStats)
  const n = Math.min(3, Math.max(1, Math.ceil((num(s.readCount) + num(s.searchCount) + num(s.bashCount) + num(s.editFileCount)) / 10)))
  if (n === h.crates) return l
  const helpers = l.helpers.map((x, j) => (j === i ? { ...x, crates: n } : x))
  const earn = h.outcome === 'done' ? { ...l.earn, crates: l.earn.crates + n - h.crates } : l.earn
  return { ...l, helpers, earn }
}

const result = (l0: Live, ev: Extract<FarmEvent, { kind: 'result' }>, w: W): Live => {
  // Once the call that asked has run, the person has answered. Another call returning meanwhile (a Read run in
  // parallel, a subagent's) leaves the farm frozen: the question is still on screen.
  const isAnswer = !l0.asking || ev.agentId === undefined && (l0.asking.tool === ev.tool || l0.asking.tool === '')
  let l = isAnswer ? unfreeze(l0, w.now) : l0
  w.ft = farmTime(l, w.now)
  if (ev.agentId !== undefined && !isTaskTool(ev.tool)) return l
  if (!ev.isError) l = planEvents(l, toEvents(ev.tool, ev.args ?? {}, ev.result ?? null), w)
  if (ev.agentId !== undefined) return l
  l = closeFor(l, ev.tool, !ev.isError, w)
  return ev.tool === 'Agent' || ev.tool === 'Task' ? crates(l, ev) : l
}

const spawn = (l: Live, ev: Extract<FarmEvent, { kind: 'spawn' }>, w: W): Live => {
  // The working step's plot; when that step has none in view (every step done, more than six), the first plot in use.
  const target = workStep(l.plan)
  const seat = target ? l.plan.seats.indexOf(target.id) : -1
  const first = l.plan.seats.findIndex(id => id !== null)
  const plot = seat >= 0 ? seat : Math.max(0, first)
  const stepId = (seat >= 0 ? target?.id : l.plan.seats[first]) ?? RESIDENT
  const id = ev.useId ?? ev.agentId ?? `h${take(w)}`
  const others = l.helpers.filter(h => h.id !== id)
  const taken = new Set(others.filter(h => h.endedAt === undefined && h.stepId === stepId).map(h => h.slot))
  let slot = 0
  while (taken.has(slot)) slot++
  const helper: Helper = { id, stepId, plot, slot, label: ev.label, model: modelOf(ev.model), since: w.ft, crates: 1 }
  if (ev.agentId !== undefined) helper.agentId = ev.agentId
  let helpers = [...others, helper]
  // At most 24: the ones already leaving go first, then the oldest.
  while (helpers.length > MAX_HELPERS) {
    const gone = helpers.findIndex(h => h.endedAt !== undefined)
    helpers = helpers.filter((_, j) => j !== (gone >= 0 ? gone : 0))
  }
  return { ...l, helpers }
}

const agentEnd = (l: Live, ev: Extract<FarmEvent, { kind: 'agentEnd' }>, w: W): Live => {
  const i = l.helpers.findIndex(h => h.agentId === ev.agentId && h.endedAt === undefined)
  const h = l.helpers[i]
  if (!h) return l
  const isDone = ev.reason === 'answer'
  const ended: Helper = { ...h, endedAt: w.ft, outcome: isDone ? 'done' : 'failed' }
  const out: Live = { ...l, helpers: l.helpers.map((x, j) => (j === i ? ended : x)) }
  if (!isDone) return out
  // Done: it ferries its crates to the yard, and the coins land with the first one.
  const paid: Live = { ...out, earn: earnHelper(out.earn, h.crates) }
  const legs = helperLegs(ended, plotTop(w, h.plot), w.ctx.yard, w.ctx.route, 'full').legs
  const drop = legs.find(g => g.pose === 'stand' && g.to.x === w.ctx.yard.x && g.to.y === w.ctx.yard.y)
  return coinsFx(paid, w, w.ctx.yard, drop?.t0 ?? w.ft)
}

/** The context was compacted: the working crab wheels a barrow to the compost heap (spec 3.2). */
const compact = (l: Live, w: W): Live => {
  const target = workStep(l.plan)
  const ci = l.crabs.findIndex(c => !isLeaving(c) && c.stepId === (target?.id ?? RESIDENT))
  const crab = l.crabs[ci]
  // One barrow at a time: a crab held by a long act doesn't pile up chores, however often the context compacts.
  if (!crab) return l
  const ends = spansOf(crab, w.ctx.home(crab.plot), w.ctx.route).map(s => s.end)
  if (crab.jobs.some((j, i) => j.kind === 'compost' && (ends[i] ?? Infinity) > w.ft)) return l
  const job = chore(w, 'compost', crab.plot, w.ft)
  const c = queue(crab, job, w)
  const lands = spansOf(c, w.ctx.home(c.plot), w.ctx.route)[c.jobs.findIndex(j => j.n === job.n)]?.arrive
  const fx: Fx = { n: take(w), kind: 'compost', at: { ...job.to }, t0: lands !== undefined && lands !== Infinity ? lands : ceilBeat(w.ft) }
  return { ...l, crabs: l.crabs.map((x, i) => (i === ci ? c : x)), fx: [...l.fx, fx] }
}

/** The project's name and the main loop's model, carried from one farm to another (a clear starts a new farm). */
const withMeta = (l: Live, from: Live): Live => {
  const out: Live = { ...l }
  if (from.project !== undefined) out.project = from.project
  if (from.model !== undefined) out.model = from.model
  return out
}

/** The sign's project name (blank clears it) and the hat's model. Same reference when they are as they were. */
const meta = (l: Live, ev: Extract<FarmEvent, { kind: 'meta' }>): Live => {
  let out = l
  if (typeof ev.project === 'string') {
    const project = ev.project.trim()
    if (project && project !== l.project) out = { ...out, project }
    if (!project && l.project !== undefined) { const { project: _, ...rest } = out; out = rest }
  }
  if (typeof ev.model === 'string' && ev.model.trim()) {
    const model = modelOf(ev.model)
    if (model !== l.model) out = { ...out, model }
  }
  return out
}

// ---- tidying, piggybacked on a change ----

/** Effects past their 30 s, crabs gone into the barn, helpers whose walk home ended: none are drawn any more. */
const prune = (l: Live, w: W): Live => {
  const fx = l.fx.filter(f => f.t0 + FX_MS >= w.ft).slice(-MAX_FX)
  const crabs = l.crabs.filter(c => !isLeaving(c) || endOf(c, w.ctx.home(c.plot), w.ctx.route) > w.ft)
  const helpers = l.helpers.filter(h => {
    if (h.endedAt === undefined) return true
    const last = helperLegs(h, plotTop(w, h.plot), w.ctx.yard, w.ctx.route, 'full').legs.at(-1)
    return last !== undefined && last.t0 + last.beats * BEAT > w.ft
  })
  const isSame = fx.length === l.fx.length && crabs.length === l.crabs.length && helpers.length === l.helpers.length
  return isSame ? l : { ...l, fx, crabs, helpers }
}

/** Deep equality as JSON sees it: a key holding undefined is no key. */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const kx = Object.keys(x).filter(k => x[k] !== undefined), ky = Object.keys(y).filter(k => y[k] !== undefined)
  return kx.length === ky.length && kx.every(k => same(x[k], y[k]))
}

/**
 * One event applied to the farm (spec 3.2). The same reference when nothing changes; otherwise `rev` moves on.
 * `ctx.owned` is how many builds stand, so jobs go to the nearest landmark that exists when they are queued.
 */
export function reduce(live: Live, ev0: FarmEvent, now: Ms, ctx: WorldCtx): Live {
  if (ev0 === null || typeof ev0 !== 'object' || !Number.isFinite(now)) return live
  const ev = tidy(ev0)
  const w: W = { now, ft: farmTime(live, now), ctx, seq: live.seq }
  let next: Live
  switch (ev.kind) {
    case 'turnStart': next = turnStart(live, ev, w); break
    case 'turnEnd': next = turnEnd(live, ev, w); break
    case 'call': next = call(live, ev, w); break
    case 'result': next = result(live, ev, w); break
    case 'ask':
      next = live.asking ? live : { ...live, asking: { since: now, tool: ev.tool }, clock: { ...live.clock, pauseFrom: now } }
      break
    case 'askClear': next = unfreeze(live, now); break
    case 'spawn': next = spawn(live, ev, w); break
    case 'agentEnd': next = agentEnd(live, ev, w); break
    case 'compact': next = compact(live, w); break
    case 'clear': next = { ...withMeta(emptyLive(now, ctx.home(0)), live), seq: Math.max(1, live.seq) }; break
    case 'meta': next = meta(live, ev); break
    default: next = live
  }
  if (next === live) return live
  if (w.seq !== live.seq) next = { ...next, seq: w.seq }
  next = prune(next, w)
  return same(next, live) ? live : { ...next, rev: live.rev + 1 }
}

