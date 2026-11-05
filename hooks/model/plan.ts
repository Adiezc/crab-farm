// The one plan model: the app's task list, TodoWrite, the Task tools or the prompt, folded into steps and seats.
// Every adapter turns a tool call into PlanEvents; one pure reducer applies them. Same reference when nothing changes.
import type { Ms, Plan, PlanSource, Step, StepStatus } from '../../types'

export type PlanItem = { name: string; status: StepStatus; doing?: string }
export type PlanEvent =
  | { kind: 'replace'; source: 'plan' | 'todo'; items: PlanItem[]; scope?: string }
  | { kind: 'move'; advance?: boolean; done?: number[]; start?: number }
  | { kind: 'finish' }
  | { kind: 'create'; id: string; name: string; doing?: string }
  | { kind: 'update'; id: string; status?: StepStatus | 'deleted'; name?: string; doing?: string }
  | { kind: 'sync'; tasks: { id: string; name: string; status: StepStatus }[] }
  | { kind: 'prompt'; name: string; turnId: string }

export const MAX_STEPS = 24
export const SEATS = 6
export const MAX_CALLS = 999

export const emptyPlan = (): Plan => ({ source: 'prompt', rev: 0, steps: [], seats: Array.from({ length: SEATS }, () => null) })

// A plan of one step is named after the first words of the prompt, never the app's reminders.
export const taskName = (text: string, n: number): string =>
  text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ') || `task ${n}`

// --- adapters ---------------------------------------------------------------

const isPlanTool = (tool: string): boolean => tool.includes('ccd_turn') && tool.endsWith('__update_plan')
const isWrapTool = (tool: string): boolean => tool.includes('ccd_turn') && tool.endsWith('__wrap_up')
const asStatus = (s: unknown): StepStatus => (s === 'completed' || s === 'in_progress' ? s : 'pending')
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const nums = (v: unknown): number[] | undefined => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : undefined)

const items = (list: unknown[], nameKey: string): PlanItem[] =>
  list.slice(0, MAX_STEPS).map(raw => {
    const it = rec(raw)
    const doing = text(it.activeForm)
    const item: PlanItem = { name: text(it[nameKey]) ?? 'step', status: asStatus(it.status) }
    return doing ? { ...item, doing } : item
  })

/** What a tool call (and, after it runs, its result) says about the plan. The Task tools speak only through results. */
export function toEvents(tool: string, args: Record<string, unknown>, result?: unknown): PlanEvent[] {
  const r = rec(result)
  if (isPlanTool(tool)) {
    if (result !== undefined) return []
    const scope = text(args.scope)
    if (Array.isArray(args.items)) return [{ kind: 'replace', source: 'plan', items: items(args.items, 'content'), ...(scope ? { scope } : {}) }]
    const move: PlanEvent = { kind: 'move' }
    if (args.advance === true) move.advance = true
    const done = nums(args.done)
    if (done) move.done = done
    if (typeof args.start === 'number') move.start = args.start
    return move.advance || move.done || move.start !== undefined ? [move] : []
  }
  if (isWrapTool(tool)) return result === undefined ? [{ kind: 'finish' }] : []
  switch (tool) {
    case 'TodoWrite': {
      // Before it runs the input; after, the result's list is the one the app keeps.
      const list = result === undefined ? args.todos : r.newTodos
      return Array.isArray(list) ? [{ kind: 'replace', source: 'todo', items: items(list, 'content') }] : []
    }
    case 'TaskCreate': {
      const task = rec(r.task)
      const id = task.id
      if (typeof id !== 'string' && typeof id !== 'number') return []
      const doing = text(args.activeForm)
      return [{ kind: 'create', id: String(id), name: text(task.subject) ?? text(args.subject) ?? `task ${id}`, ...(doing ? { doing } : {}) }]
    }
    case 'TaskUpdate': {
      if (result === undefined || r.success === false) return []
      const id = args.taskId ?? r.taskId
      if (typeof id !== 'string' && typeof id !== 'number') return []
      const ev: PlanEvent = { kind: 'update', id: String(id) }
      const status = args.status ?? rec(r.statusChange).to
      if (status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'deleted') ev.status = status
      const name = text(args.subject)
      if (name) ev.name = name
      const doing = text(args.activeForm)
      if (doing) ev.doing = doing
      return [ev]
    }
    case 'TaskList': {
      if (!Array.isArray(r.tasks)) return []
      const tasks = r.tasks.map(rec).filter(t => typeof t.id === 'string' || typeof t.id === 'number')
        .map(t => ({ id: String(t.id), name: text(t.subject) ?? `task ${String(t.id)}`, status: asStatus(t.status) }))
      return [{ kind: 'sync', tasks }]
    }
    default:
      return []
  }
}

// --- the reducer ------------------------------------------------------------

// Which step a list's entry is, across lists: its name and how many steps of that name came before it.
const listIds = (names: readonly string[]): string[] => {
  const seen = new Map<string, number>()
  return names.map(name => { const k = seen.get(name) ?? 0; seen.set(name, k + 1); return `n:${k}:${name}` })
}

const sameStep = (a: Step, b: Step): boolean =>
  a.id === b.id && a.name === b.name && a.doing === b.doing && a.status === b.status && a.calls === b.calls &&
  a.startedAt === b.startedAt && a.lastAt === b.lastAt && a.doneAt === b.doneAt && a.paid === b.paid && a.goneAt === b.goneAt

/** A step moved to a status, stamped as it starts and as it finishes. */
const withStatus = (s: Step, status: StepStatus, now: Ms): Step => {
  if (s.status === status) return s
  const next: Step = { ...s, status }
  if (status === 'in_progress' && next.startedAt === undefined) next.startedAt = now
  if (status === 'completed') next.doneAt = now
  else delete next.doneAt
  return next
}

type Wanted = { id: string; name: string; status: StepStatus; doing?: string }

/**
 * The plan becomes these steps. A step named again keeps its calls, stamps, `paid` and seat; one the new list drops
 * leaves. From another source, progress carries over by name, and the prompt step is absorbed by the first step in
 * progress (else the first step): its calls, start and seat, so the crab on screen keeps standing.
 */
const rebuild = (plan: Plan, source: PlanSource, wanted: Wanted[], now: Ms): Plan => {
  const isSwitch = source !== plan.source
  const byId = new Map(plan.steps.map(s => [s.id, s]))
  const claimed = new Set<string>()
  const renamed = new Map<string, string>()   // old id → new id, for seats
  const steps = wanted.slice(0, MAX_STEPS).map((w): Step => {
    let old = byId.get(w.id)
    if (!old && isSwitch) old = plan.steps.find(s => !claimed.has(s.id) && !s.id.startsWith('p:') && s.name === w.name)
    if (!old) return withStatus({ id: w.id, name: w.name, status: 'pending', calls: 0, ...(w.doing ? { doing: w.doing } : {}) }, w.status, now)
    claimed.add(old.id)
    if (old.id !== w.id) renamed.set(old.id, w.id)
    const kept: Step = { ...old, id: w.id, name: w.name }
    if (w.doing) kept.doing = w.doing
    else delete kept.doing
    // A step finished before keeps the moment it finished.
    const moved = old.status === w.status ? kept : withStatus(kept, w.status, now)
    return sameStep(moved, old) ? old : moved
  })
  const prompt = plan.steps.find(s => s.id.startsWith('p:') && !claimed.has(s.id))
  if (prompt && source !== 'prompt' && steps.length > 0) {
    const i = Math.max(0, steps.findIndex(s => s.status === 'in_progress'))
    const target = steps[i]
    if (target && !byId.has(target.id)) {
      const startedAt = target.startedAt === undefined ? prompt.startedAt : prompt.startedAt === undefined ? target.startedAt : Math.min(prompt.startedAt, target.startedAt)
      const merged: Step = { ...target, calls: Math.max(target.calls, prompt.calls) }
      if (startedAt !== undefined) merged.startedAt = startedAt
      if (prompt.lastAt !== undefined && merged.lastAt === undefined) merged.lastAt = prompt.lastAt
      steps[i] = merged
      renamed.set(prompt.id, target.id)
    }
  }
  const ids = new Set(steps.map(s => s.id))
  const seats = plan.seats.map(id => {
    if (id === null) return null
    const now2 = renamed.get(id) ?? id
    return ids.has(now2) ? now2 : null
  })
  const isSame = !isSwitch && steps.length === plan.steps.length && steps.every((s, i) => s === plan.steps[i]) &&
    seats.every((id, i) => id === plan.seats[i])
  if (isSame) return plan
  return seatSteps({ source, rev: isSwitch ? plan.rev + 1 : plan.rev, steps, seats })
}

const asWanted = (s: Step): Wanted => (s.doing ? { id: s.id, name: s.name, status: s.status, doing: s.doing } : { id: s.id, name: s.name, status: s.status })
const taskOrder = (a: Wanted, b: Wanted): number => {
  const x = Number(a.id.slice(2)), y = Number(b.id.slice(2))
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Status changes in place, keeping every other step's reference.
const restatus = (plan: Plan, status: (s: Step, i: number) => StepStatus, now: Ms): Plan => {
  let changed = false
  const steps = plan.steps.map((s, i) => {
    const next = withStatus(s, status(s, i), now)
    if (next !== s) changed = true
    return next
  })
  return changed ? seatSteps({ ...plan, steps }) : plan
}

/** One plan event applied. Same reference when it changes nothing. */
export function reducePlan(plan: Plan, ev: PlanEvent, now: Ms): Plan {
  switch (ev.kind) {
    case 'replace': {
      // The newest source that brings a step owns the plan; an empty list from another source is nothing to follow.
      if (ev.items.length === 0 && ev.source !== plan.source) return plan
      const names = ev.items.map(it => it.name)
      const ids = listIds(names)
      return rebuild(plan, ev.source, ev.items.map((it, i) => ({ ...it, id: ids[i] ?? `n:0:${it.name}` })), now)
    }
    case 'move': {
      if (plan.source === 'prompt') return plan
      const st = plan.steps.map(s => s.status)
      if (ev.advance) {
        const cur = st.indexOf('in_progress')
        if (cur >= 0) st[cur] = 'completed'
        const next = st.indexOf('pending')
        if (next >= 0) st[next] = 'in_progress'
      }
      for (const n of ev.done ?? []) if (st[n - 1] !== undefined) st[n - 1] = 'completed'
      if (ev.start !== undefined && st[ev.start - 1] !== undefined) {
        // One step in progress at a time, as the list keeps it.
        for (let i = 0; i < st.length; i++) if (st[i] === 'in_progress') st[i] = 'pending'
        st[ev.start - 1] = 'in_progress'
      }
      return restatus(plan, (s, i) => st[i] ?? s.status, now)
    }
    case 'finish':
      return restatus(plan, () => 'completed', now)
    case 'create': {
      const id = `k:${ev.id}`
      const kept = plan.source === 'tasks' ? plan.steps.map(asWanted) : []
      if (kept.some(w => w.id === id)) return plan
      const wanted = [...kept, { id, name: ev.name, status: 'pending' as const, ...(ev.doing ? { doing: ev.doing } : {}) }].sort(taskOrder)
      return rebuild(plan, 'tasks', wanted, now)
    }
    case 'update': {
      const id = `k:${ev.id}`
      const kept = plan.source === 'tasks' ? plan.steps.map(asWanted) : []
      const i = kept.findIndex(w => w.id === id)
      if (ev.status === 'deleted') return i < 0 ? plan : rebuild(plan, 'tasks', kept.filter(w => w.id !== id), now)
      // An id the farm never saw becomes a step named after its subject.
      const was: Wanted = kept[i] ?? { id, name: ev.name ?? `task ${ev.id}`, status: 'pending' }
      const next: Wanted = { ...was, ...(ev.name ? { name: ev.name } : {}), ...(ev.status ? { status: ev.status } : {}), ...(ev.doing ? { doing: ev.doing } : {}) }
      const wanted = i < 0 ? [...kept, next].sort(taskOrder) : kept.map((w, k) => (k === i ? next : w))
      return rebuild(plan, 'tasks', wanted, now)
    }
    case 'sync': {
      if (ev.tasks.length === 0 && plan.source !== 'tasks') return plan
      const old = new Map(plan.steps.map(s => [s.id, s]))
      const wanted = ev.tasks.map((t): Wanted => {
        const id = `k:${t.id}`
        const doing = old.get(id)?.doing
        return { id, name: t.name, status: t.status, ...(doing ? { doing } : {}) }
      }).sort(taskOrder)
      return rebuild(plan, 'tasks', wanted, now)
    }
    case 'prompt': {
      // A real list with work left never yields to a prompt.
      const hasWork = plan.steps.some(s => s.status !== 'completed')
      if (plan.source !== 'prompt' && hasWork) return plan
      const id = `p:${ev.turnId}`
      if (plan.source === 'prompt' && plan.steps.length === 1 && plan.steps[0]?.id === id) return plan
      return seatSteps({
        source: 'prompt', rev: plan.rev + 1, seats: plan.seats.map(() => null),
        steps: [{ id, name: ev.name, status: 'in_progress', calls: 0, startedAt: now }],
      })
    }
  }
}

/** A main-loop call made while a step is in progress: its crops grow. Capped, and then the same reference. */
export function countCall(plan: Plan, stepId: string | undefined, now: Ms): Plan {
  const i = plan.steps.findIndex(s => s.id === stepId)
  const s = plan.steps[i]
  if (!s || s.status !== 'in_progress' || s.calls >= MAX_CALLS) return plan
  return { ...plan, steps: plan.steps.map((x, k) => (k === i ? { ...x, calls: x.calls + 1, lastAt: now } : x)) }
}

/** The step in progress, the one started most recently when there are several. */
export function currentStep(plan: Plan): Step | undefined {
  let best: Step | undefined
  for (const s of plan.steps) {
    if (s.status !== 'in_progress') continue
    if (!best || (s.startedAt ?? 0) >= (best.startedAt ?? 0)) best = s
  }
  return best
}

/** The step a call or a helper goes to: the current one, else the next pending, else the last (1.2's helpStep). */
export function workStep(plan: Plan): Step | undefined {
  return currentStep(plan) ?? plan.steps.find(s => s.status === 'pending') ?? plan.steps[plan.steps.length - 1]
}

/**
 * Each step keeps its plot while it's in view. A new step takes a free seat, else the seat of the completed step that
 * finished first; the step in progress is always seated, evicting the last pending one if it must. Seats go to new
 * steps in list order, so a fresh list reads left to right, top to bottom.
 */
export function seatSteps(plan: Plan): Plan {
  const index = new Map(plan.steps.map((s, i) => [s.id, i]))
  const seats: (string | null)[] = Array.from({ length: SEATS }, (_, i) => {
    const id = plan.seats[i]
    return id !== undefined && id !== null && index.has(id) ? id : null
  })
  const seated = new Set(seats.filter((id): id is string => id !== null))
  const stepOf = (id: string): Step | undefined => plan.steps[index.get(id) ?? -1]
  const unseated = plan.steps.filter(s => !seated.has(s.id))
  const byDoneDesc = (a: Step, b: Step): number => (b.doneAt ?? -1) - (a.doneAt ?? -1) || (index.get(b.id) ?? 0) - (index.get(a.id) ?? 0)
  const queue = [
    ...unseated.filter(s => s.status === 'in_progress'),
    ...unseated.filter(s => s.status === 'pending'),
    ...unseated.filter(s => s.status === 'completed').sort(byDoneDesc),
  ]
  let free = seats.filter(id => id === null).length
  const toFree: Step[] = []
  const evict = (pred: (s: Step) => boolean, pick: (a: Step, b: Step) => number): number => {
    const victims = seats.map((id, i) => ({ s: id === null ? undefined : stepOf(id), i })).filter(v => v.s && pred(v.s))
    victims.sort((a, b) => pick(a.s as Step, b.s as Step))
    return victims[0]?.i ?? -1
  }
  for (const s of queue) {
    if (free > 0) { toFree.push(s); free--; continue }
    if (s.status === 'completed') continue
    // The completed step that finished first gives up its plot.
    let i = evict(v => v.status === 'completed', (a, b) => (a.doneAt ?? -1) - (b.doneAt ?? -1))
    if (i < 0 && s.status === 'in_progress') i = evict(v => v.status === 'pending', (a, b) => (index.get(b.id) ?? 0) - (index.get(a.id) ?? 0))
    if (i >= 0) seats[i] = s.id
  }
  toFree.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0))
  for (const s of toFree) {
    const i = seats.indexOf(null)
    if (i >= 0) seats[i] = s.id
  }
  return seats.length === plan.seats.length && seats.every((id, i) => id === plan.seats[i]) ? plan : { ...plan, seats }
}

/** The plot a step sits on, or -1. */
export const plotOf = (plan: Plan, stepId: string): number => plan.seats.indexOf(stepId)

