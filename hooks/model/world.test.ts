import { expect, test } from 'claude-code/testing'
import { BEAT } from '../contracts'
import type { JobKind, LandmarkId, Pt, ResolveFn, RouteFn } from '../contracts'
import { at, timeline } from './jobs'
import { home as realHome, resolve as realResolve, route as realRoute, YARD as REAL_YARD } from './layout'
import { mulberry32 } from './rng'
import { RESIDENT, emptyLive, farmTime, reduce, shownCoins } from './world'
import type { FarmEvent, WorldCtx } from './world'
import type { Crab, Live } from '../../types'

// A small farm of our own: six plots, an L-shaped route, a few landmarks.
const PLOTS: Pt[] = [{ x: 57, y: 109 }, { x: 109, y: 109 }, { x: 57, y: 143 }, { x: 109, y: 143 }, { x: 57, y: 177 }, { x: 109, y: 177 }]
const home = (plot: number): Pt => { const p = PLOTS[plot] ?? { x: 57, y: 109 }; return { x: p.x - 7, y: p.y + 12 } }
const YARD: Pt = { x: 96, y: 80 }
const route: RouteFn = (from, to) => [{ x: to.x, y: from.y }]
const PLACES: Partial<Record<JobKind, [LandmarkId, Pt]>> = {
  water: ['pond', { x: 66, y: 206 }], sprinkle: ['row', { x: 0, y: 0 }], haul: ['yard', YARD], compost: ['compost', { x: 38, y: 190 }],
  hire: ['barnDoor', { x: 56, y: 80 }], post: ['gate', { x: 156, y: 206 }], scout: ['fence', { x: 147, y: 117 }],
}
const resolve: ResolveFn = (kind, plot) => {
  const p = PLOTS[plot] ?? { x: 57, y: 109 }
  if (kind === 'arrive') return { land: 'home', to: home(plot) }
  const place = PLACES[kind]
  return place && kind !== 'sprinkle' ? { land: place[0], to: place[1] } : { land: 'row', to: { x: p.x + 15, y: p.y + 1 } }
}
const ctx: WorldCtx = { owned: 0, route, resolve, home, yard: YARD }
const T0 = 1_800_000_000_000

const PLAN = 'mcp__ccd_turn__update_plan'
const list = (...s: [string, string][]) => ({ items: s.map(([content, status]) => ({ content, status })) })
let use = 0
const call = (tool: string, args: Record<string, unknown> = {}, over: Partial<Extract<FarmEvent, { kind: 'call' }>> = {}): FarmEvent =>
  ({ kind: 'call', tool, args, useId: `u${++use}`, ...over })
const result = (tool: string, res: unknown = {}, over: Partial<Extract<FarmEvent, { kind: 'result' }>> = {}): FarmEvent =>
  ({ kind: 'result', tool, useId: `u${use}`, result: res, isError: false, ...over })

/** Events applied in order, `gap` ms apart, from `now`. */
const run = (l: Live, now: number, gap: number, ...evs: FarmEvent[]): Live => evs.reduce((x, ev, i) => reduce(x, ev, now + i * gap, ctx), l)
const where = (l: Live, c: Crab, now: number): Pt => at(timeline(c, home(c.plot), route, l.turn.isWorking), farmTime(l, now)).pt
const crabOf = (l: Live, stepId: string): Crab | undefined => l.crabs.find(c => c.stepId === stepId && c.leavingAt === undefined)
const live = (l: Live): Crab[] => l.crabs.filter(c => c.leavingAt === undefined)

test('a new farm has its farmhand at plot 0, and the first prompt makes him its crab', async () => {
  const l = emptyLive(T0, home(0))
  expect(l.crabs.map(c => [c.stepId, c.plot, c.anchor.pt])).toEqual([[RESIDENT, 0, home(0)]])
  expect(l.crabs[0]?.anchor.ft).toBe(Math.ceil(T0 / BEAT) * BEAT)
  const m = reduce(l, { kind: 'turnStart', turnId: 't1', text: 'Lets test crab farm' }, T0 + 1000, ctx)
  expect(m.plan.steps.map(s => [s.id, s.name, s.status])).toEqual([['p:t1', 'Lets test crab farm', 'in_progress']])
  expect(m.crabs.map(c => [c.stepId, c.plot])).toEqual([['p:t1', 0]])
  expect(m.crabs[0]?.anchor).toEqual(l.crabs[0]?.anchor)
  expect(m.turn).toMatchObject({ isWorking: true, id: 't1', hadTools: false })
  expect(m.rev).toBe(l.rev + 1)
})

test('a full session: prompt, plan, calls, a helper, an ask, an answer, and the wrap-up', async () => {
  let l = emptyLive(T0, home(0))
  l = run(l, T0, 1000,
    { kind: 'turnStart', turnId: 't1', text: 'Lets test crab farm' },
    call(PLAN, { scope: 'first_task', ...list(['Read the source', 'in_progress'], ['Rework the plots', 'pending'], ['Ship it', 'pending']) }),
    result(PLAN),
  )
  // The prompt's crab keeps standing as the list's first step; the two new steps walk out of the barn, 4 beats apart.
  expect(l.plan.source).toBe('plan')
  expect(l.tasks).toBe(1)
  expect(live(l).map(c => [c.stepId, c.plot])).toEqual([['n:0:Read the source', 0], ['n:0:Rework the plots', 1], ['n:0:Ship it', 2]])
  const arrive = (c?: Crab) => c?.jobs.find(j => j.kind === 'arrive')?.t0 ?? 0
  expect(arrive(crabOf(l, 'n:0:Ship it')) - arrive(crabOf(l, 'n:0:Rework the plots'))).toBe(4 * BEAT)
  expect(crabOf(l, 'n:0:Read the source')?.jobs.map(j => j.kind)).toEqual(['stake'])

  // A Bash call is an errand to the pond whose act holds until the command returns.
  l = reduce(l, call('Bash', { command: 'ls -la' }), T0 + 5000, ctx)
  l = reduce(l, call('Bash', { command: 'npm test' }), T0 + 5100, ctx)
  const test1 = crabOf(l, 'n:0:Read the source')?.jobs.find(j => j.kind === 'sprinkle')
  expect(test1).toMatchObject({ isOpen: true, tool: 'Bash', note: 'npm test' })
  expect(test1?.until).toBeUndefined()
  l = reduce(l, result('Bash', { stdout: 'fail' }, { isError: true }), T0 + 30_000, ctx)
  expect(crabOf(l, 'n:0:Read the source')?.jobs.find(j => j.kind === 'sprinkle')).toMatchObject({ ok: false })
  expect(l.fx.map(f => f.kind)).toEqual(['puddle'])
  expect(l.plan.steps[0]?.calls).toBe(3)

  // The step finishes: its crab picks the row and hauls the crate to the yard, and the coins land with it.
  l = reduce(l, call(PLAN, { advance: true }), T0 + 31_000, ctx)
  const done = crabOf(l, 'n:0:Read the source')
  expect(done?.jobs.slice(-2).map(j => j.kind)).toEqual(['harvest', 'haul'])
  expect(l.plan.steps[0]).toMatchObject({ status: 'completed', paid: true })
  const coins = l.fx.find(f => f.kind === 'coins')
  expect(coins?.at).toEqual(YARD)
  expect(coins?.value).toBe(14)
  expect(l.earn.coins).toBe(14)
  expect(shownCoins(l, farmTime(l, T0 + 31_000))).toBe(0)
  expect(shownCoins(l, coins?.t0 ?? 0)).toBe(14)
  expect(crabOf(l, 'n:0:Rework the plots')?.jobs.some(j => j.kind === 'stake')).toBe(true)

  // A helper joins the step in progress.
  l = reduce(l, { kind: 'spawn', agentId: 'ag1', model: 'claude-haiku-5-5', label: 'look around', useId: 'agent-1' }, T0 + 32_000, ctx)
  expect(l.helpers.map(h => [h.stepId, h.plot, h.slot, h.model])).toEqual([['n:0:Rework the plots', 1, 0, 'haiku']])

  // Claude asks: farm time stands still until the answer.
  l = reduce(l, { kind: 'ask', tool: 'Bash' }, T0 + 33_000, ctx)
  expect(farmTime(l, T0 + 90_000)).toBe(farmTime(l, T0 + 33_000))
  l = reduce(l, { kind: 'askClear' }, T0 + 93_000, ctx)
  expect(l.asking).toBeUndefined()
  expect(l.clock.pausedMs).toBe(60_000)

  l = run(l, T0 + 94_000, 1000, { kind: 'turnEnd', reason: 'answer' }, { kind: 'turnStart', turnId: 't2', text: 'go on' })
  // A list with work left carries on into the next turn.
  expect(l.plan.steps.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])
  l = run(l, T0 + 100_000, 1000, call('mcp__ccd_turn__wrap_up', { recap: 'done' }), { kind: 'turnEnd', reason: 'answer' })
  // Rework had a call (the advance), so it pays; Ship never started, so it brings nothing.
  expect(l.plan.steps.map(s => [s.status, s.paid])).toEqual([['completed', true], ['completed', true], ['completed', undefined]])
  expect(l.earn).toMatchObject({ coins: 26, calls: 6, harvests: 2 })
  expect(shownCoins(l, farmTime(l, T0 + 10_000_000))).toBe(26)

  // A later prompt with no list gets its own crab at plot 0; the finished steps' crabs go into the barn, the helper
  // still running comes along.
  l = reduce(l, { kind: 'turnStart', turnId: 't3', text: 'fix the typo in README' }, T0 + 200_000, ctx)
  expect(live(l).map(c => [c.stepId, c.plot])).toEqual([['p:t3', 0]])
  expect(l.helpers.map(h => [h.stepId, h.plot])).toEqual([['p:t3', 0]])
  expect(l.crabs.filter(c => c.leavingAt !== undefined).length).toBe(3)
  // Once they are in, they are gone.
  l = reduce(l, call('Read', { file_path: 'README.md' }), T0 + 400_000, ctx)
  expect(l.crabs.map(c => c.stepId)).toEqual(['p:t3'])
})

test('helpers follow a re-sent list, one with no id leaves with its turn, and each later prompt gets its own step', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000,
    { kind: 'turnStart', turnId: '1', text: 'explain the farm' },
    call(PLAN, list(['Read', 'completed'], ['Draw', 'in_progress'])),
    { kind: 'spawn', agentId: 'ag1', model: 'claude-haiku-5-5', label: 'u1', useId: 'u1' },
    { kind: 'spawn', model: 'claude-haiku-5-5', label: 'u2', useId: 'u2' },
  )
  expect(l.helpers.map(h => [h.id, h.stepId, h.slot])).toEqual([['u1', 'n:0:Draw', 0], ['u2', 'n:0:Draw', 1]])
  // The list again, a step added in front: both helpers stay with Draw, and Draw's crab keeps its plot.
  const drawPlot = crabOf(l, 'n:0:Draw')?.plot
  l = reduce(l, call(PLAN, list(['Plan', 'completed'], ['Read', 'completed'], ['Draw', 'in_progress'])), T0 + 10_000, ctx)
  expect(l.helpers.map(h => h.stepId)).toEqual(['n:0:Draw', 'n:0:Draw'])
  expect(crabOf(l, 'n:0:Draw')?.plot).toBe(drawPlot)
  // The turn ends: the helper with no id goes, the one still running stays.
  l = reduce(l, { kind: 'turnEnd', reason: 'answer' }, T0 + 11_000, ctx)
  expect(l.helpers.map(h => [h.id, h.endedAt !== undefined])).toEqual([['u1', false], ['u2', true]])
  l = run(l, T0 + 12_000, 1000, { kind: 'turnStart', turnId: '2', text: 'go on' }, call('mcp__ccd_turn__wrap_up'), { kind: 'turnEnd', reason: 'answer' })
  // A prompt with no list gets its own crab, the running helper with it; so does the next prompt, though the turn
  // before never wrapped up.
  l = reduce(l, { kind: 'turnStart', turnId: '3', text: 'quick question' }, T0 + 20_000, ctx)
  expect(l.plan.steps.map(s => s.id)).toEqual(['p:3'])
  expect(l.helpers.find(h => h.id === 'u1')?.stepId).toBe('p:3')
  l = reduce(l, { kind: 'turnEnd', reason: 'answer' }, T0 + 21_000, ctx)
  const crab3 = crabOf(l, 'p:3')
  l = reduce(l, { kind: 'turnStart', turnId: '4', text: 'rename the barn' }, T0 + 22_000, ctx)
  expect(l.plan.steps.map(s => s.name)).toEqual(['rename the barn'])
  expect(l.helpers.find(h => h.id === 'u1')?.stepId).toBe('p:4')
  // The same crab carries on under the new prompt, without a walk to the barn and back.
  expect(crabOf(l, 'p:4')?.anchor).toEqual(crab3?.anchor)
})

test('helpers on a step the list drops go where a new helper would', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000,
    { kind: 'turnStart', turnId: '1', text: 'x' },
    call(PLAN, list(['A', 'completed'], ['B', 'in_progress'])),
    call(PLAN, { start: 1 }),
    { kind: 'spawn', agentId: 'ag1', model: 'opus', label: 'on A', useId: 'u1' },
    call(PLAN, { start: 2 }),
    { kind: 'spawn', agentId: 'ag2', model: 'sonnet', label: 'on B', useId: 'u2' },
  )
  expect(l.helpers.map(h => h.stepId)).toEqual(['n:0:A', 'n:0:B'])
  l = reduce(l, call(PLAN, list(['Z', 'completed'], ['B', 'in_progress'], ['C', 'pending'])), T0 + 10_000, ctx)
  expect(l.helpers.map(h => [h.stepId, h.slot])).toEqual([['n:0:B', 1], ['n:0:B', 0]])
})

test('a step the list drops before it finished is composted, then its crab walks into the barn', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000,
    { kind: 'turnStart', turnId: '1', text: 'x' },
    call(PLAN, list(['A', 'in_progress'], ['B', 'pending'])),
  )
  const b = crabOf(l, 'n:0:B')
  l = reduce(l, call(PLAN, list(['A', 'in_progress'])), T0 + 20_000, ctx)
  const gone = l.crabs.find(c => c.stepId === 'n:0:B')
  expect(gone?.leavingAt).toBeDefined()
  expect(gone?.plot).toBe(b?.plot)
  expect(gone?.jobs.slice(-2).map(j => j.kind)).toEqual(['compost', 'leave'])
  expect(l.plan.seats[b?.plot ?? -1]).toBeNull()
})

test('the prompt\'s step is harvested when its turn answers after doing some work, and only then', async () => {
  const turn = (reason: 'answer' | 'aborted', tools: boolean) => {
    let l = reduce(emptyLive(T0, home(0)), { kind: 'turnStart', turnId: '1', text: 'x' }, T0, ctx)
    if (tools) l = reduce(l, call('Read', { file_path: 'a.ts' }), T0 + 1000, ctx)
    return reduce(l, { kind: 'turnEnd', reason }, T0 + 5000, ctx)
  }
  expect(turn('answer', true).plan.steps[0]).toMatchObject({ status: 'completed', paid: true })
  expect(turn('answer', true).earn.harvests).toBe(1)
  expect(turn('answer', false).plan.steps[0]?.status).toBe('in_progress')
  expect(turn('aborted', true).plan.steps[0]?.status).toBe('in_progress')
  expect(turn('aborted', true).turn.outcome).toBe('aborted')
})

test('a list sent again never pays twice', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000,
    { kind: 'turnStart', turnId: '1', text: 'x' },
    call(PLAN, list(['A', 'in_progress'], ['B', 'pending'])),
    call(PLAN, { advance: true }),
  )
  expect(l.earn.harvests).toBe(1)
  l = run(l, T0 + 10_000, 1000, call(PLAN, list(['A', 'completed'], ['B', 'in_progress'])), call(PLAN, list(['A', 'in_progress'], ['B', 'in_progress'])))
  l = reduce(l, call(PLAN, list(['A', 'completed'], ['B', 'in_progress'])), T0 + 20_000, ctx)
  expect(l.earn.harvests).toBe(1)
})

test('the Task tools speak through their results, a subagent\'s too; its other calls change nothing', async () => {
  let l = reduce(emptyLive(T0, home(0)), { kind: 'turnStart', turnId: '1', text: 'x' }, T0, ctx)
  l = reduce(l, call('TaskCreate', { subject: 'Dig' }), T0 + 100, ctx)
  expect(l.plan.source).toBe('prompt')
  l = reduce(l, result('TaskCreate', { task: { id: '1', subject: 'Dig' } }, { args: { subject: 'Dig' } }), T0 + 200, ctx)
  expect(l.plan.steps.map(s => [s.id, s.calls])).toEqual([['k:1', 1]])
  expect(crabOf(l, 'k:1')?.plot).toBe(0)
  const sub = { agentId: 'ag9' }
  l = reduce(l, result('TaskCreate', { task: { id: '2', subject: 'Plant' } }, { args: {}, ...sub }), T0 + 300, ctx)
  l = reduce(l, result('TaskUpdate', { success: true, taskId: '2' }, { args: { taskId: '2', status: 'in_progress' }, ...sub }), T0 + 400, ctx)
  expect(l.plan.steps.map(s => [s.id, s.status])).toEqual([['k:1', 'pending'], ['k:2', 'in_progress']])
  expect(reduce(l, call('Read', {}, sub), T0 + 500, ctx)).toBe(l)
  expect(reduce(l, result('Read', {}, sub), T0 + 500, ctx)).toBe(l)
  // A failed create makes nothing.
  expect(reduce(l, result('TaskCreate', { task: { id: '3', subject: 'x' } }, { isError: true, args: {} }), T0 + 600, ctx).plan).toBe(l.plan)
})

test('a helper brings in its crates from the tools it used, and the coins land with the first', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000,
    { kind: 'turnStart', turnId: '1', text: 'x' },
    call('Agent', { description: 'look' }),
    { kind: 'spawn', agentId: 'ag1', model: 'claude-sonnet-5-5', label: 'look', useId: `u${use}` },
    { kind: 'agentEnd', agentId: 'ag1', reason: 'answer' },
    result('Agent', { status: 'completed', toolStats: { readCount: 12, searchCount: 4, bashCount: 3, editFileCount: 2, linesAdded: 0, linesRemoved: 0, otherToolCount: 0 } }),
  )
  expect(l.helpers[0]).toMatchObject({ outcome: 'done', crates: 3, model: 'sonnet' })
  expect(l.earn).toMatchObject({ helpers: 1, crates: 3, coins: 3 })
  const fx = l.fx.find(f => f.kind === 'coins')
  expect(fx?.value).toBe(3)
  expect((fx?.t0 ?? 0) > farmTime(l, T0 + 4000)).toBe(true)
  // A failed helper walks back empty-handed and pays nothing; an unknown one is nothing.
  const m = reduce(reduce(l, { kind: 'spawn', agentId: 'ag2', model: 'haiku', label: 'x' }, T0 + 5000, ctx), { kind: 'agentEnd', agentId: 'ag2', reason: 'error' }, T0 + 6000, ctx)
  expect(m.helpers[1]?.outcome).toBe('failed')
  expect(m.earn.helpers).toBe(1)
  expect(reduce(m, { kind: 'agentEnd', agentId: 'nobody', reason: 'answer' }, T0 + 7000, ctx)).toBe(m)
})

test('the ask freeze: every crab resumes from the exact pixel where it stopped', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 100, { kind: 'turnStart', turnId: '1', text: 'x' }, call('Bash', { command: 'echo hi' }))
  l = reduce(l, result('Bash'), T0 + 600, ctx)
  // Mid-way back from the pond, Claude asks.
  const crab = () => l.crabs[0] as Crab
  const askAt = T0 + 4300
  const before = where(l, crab(), askAt)
  l = reduce(l, { kind: 'ask', tool: 'Bash' }, askAt, ctx)
  expect(l.asking).toEqual({ since: askAt, tool: 'Bash' })
  for (const dt of [1000, 30_000, 600_000]) expect(where(l, crab(), askAt + dt)).toEqual(before)
  // A second ask while frozen changes nothing.
  expect(reduce(l, { kind: 'ask', tool: 'Edit' }, askAt + 5000, ctx)).toBe(l)
  const clearAt = askAt + 600_000
  l = reduce(l, { kind: 'askClear' }, clearAt, ctx)
  expect(where(l, crab(), clearAt)).toEqual(before)
  expect(where(l, crab(), clearAt + 2000)).not.toEqual(before)
  // The answer clears the freeze as the call's result comes back, too.
  let m = reduce(l, { kind: 'ask', tool: 'Bash' }, clearAt + 100, ctx)
  m = reduce(m, result('Bash'), clearAt + 9100, ctx)
  expect(m.asking).toBeUndefined()
  expect(m.clock.pausedMs).toBe(l.clock.pausedMs + 9000)
})

test('the context compacting sends the working crab to the compost heap', async () => {
  let l = reduce(emptyLive(T0, home(0)), { kind: 'turnStart', turnId: '1', text: 'x' }, T0, ctx)
  l = reduce(l, { kind: 'compact' }, T0 + 1000, ctx)
  expect(l.crabs[0]?.jobs.map(j => j.kind)).toEqual(['compost'])
  expect(l.fx.map(f => f.kind)).toEqual(['compost'])
})

test('a clear starts the farm again', async () => {
  let l = run(emptyLive(T0, home(0)), T0, 1000, { kind: 'turnStart', turnId: '1', text: 'x' }, call('Read'), { kind: 'spawn', agentId: 'a', model: 'opus', label: 'x' })
  l = reduce(l, { kind: 'clear' }, T0 + 9000, ctx)
  expect(l.plan.steps).toEqual([])
  expect(l.helpers).toEqual([])
  expect(l.crabs.map(c => c.stepId)).toEqual([RESIDENT])
  expect(l.earn.calls).toBe(0)
})

test('calls past full growth leave the crop as it is, and at 999 leave the plan the same', async () => {
  let l = reduce(emptyLive(T0, home(0)), { kind: 'turnStart', turnId: '1', text: 'x' }, T0, ctx)
  for (let i = 0; i < 9; i++) l = reduce(l, call('Read'), T0 + 1000 * (i + 1), ctx)
  expect(Math.min(8, l.plan.steps[0]?.calls ?? 0)).toBe(8)
  const full: Live = { ...l, plan: { ...l.plan, steps: l.plan.steps.map(s => ({ ...s, calls: 999 })) } }
  expect(reduce(full, call('Read'), T0 + 20_000, ctx).plan).toBe(full.plan)
})

test('it runs on the real farm\'s routes and landmarks', async () => {
  const real: WorldCtx = { owned: 12, route: realRoute, resolve: realResolve, home: realHome, yard: REAL_YARD }
  let l = emptyLive(T0, realHome(0))
  const evs: FarmEvent[] = [
    { kind: 'turnStart', turnId: '1', text: 'build the barn' },
    call(PLAN, list(['Look', 'in_progress'], ['Build', 'pending'], ['Ship', 'pending'])),
    call('Read', { file_path: 'a.ts' }), call('Bash', { command: 'npm test' }), result('Bash'), call('WebFetch', { url: 'https://x.y' }), result('WebFetch'),
    call(PLAN, { advance: true }), { kind: 'spawn', agentId: 'a1', model: 'haiku', label: 'x' }, { kind: 'agentEnd', agentId: 'a1', reason: 'answer' },
    call('mcp__ccd_turn__wrap_up'), { kind: 'turnEnd', reason: 'answer' },
  ]
  evs.forEach((ev, i) => { l = reduce(l, ev, T0 + i * 1500, real) })
  for (const c of l.crabs) {
    const legs = timeline(c, realHome(c.plot), realRoute, false)
    expect(legs.every(g => g.t0 % BEAT === 0 && (g.from.x === g.to.x || g.from.y === g.to.y))).toBe(true)
  }
  expect(l.earn.harvests).toBe(2)
})

// ---- the same-reference property, on random worlds ----

const canon = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))

const randomEvent = (r: () => number, l: Live): FarmEvent => {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  const status = () => pick(['pending', 'in_progress', 'completed'])
  const roll = r()
  if (roll < 0.06) return { kind: 'turnStart', turnId: pick(['1', '2', '3', l.turn.id ?? '1']), text: pick(['fix it', 'go on', '']) }
  if (roll < 0.11) return { kind: 'turnEnd', reason: pick(['answer', 'aborted', 'error', 'refusal'] as const) }
  if (roll < 0.15) return { kind: 'ask', tool: 'Bash' }
  if (roll < 0.19) return { kind: 'askClear' }
  if (roll < 0.24) return { kind: 'spawn', ...(r() < 0.7 ? { agentId: pick(['a1', 'a2', 'a3', 'a4']) } : {}), model: pick(['haiku', 'opus']), label: 'x', useId: `s${Math.floor(r() * 6)}` }
  if (roll < 0.28) return { kind: 'agentEnd', agentId: pick(['a1', 'a2', 'a3', 'nobody']), reason: pick(['answer', 'error']) }
  if (roll < 0.30) return { kind: 'compact' }
  if (roll < 0.305) return { kind: 'clear' }
  const sub = r() < 0.1 ? { agentId: 'a1' } : {}
  if (roll < 0.40) {
    const n = 1 + Math.floor(r() * 8)
    return call(PLAN, r() < 0.5 ? { items: names.slice(0, n).map(content => ({ content, status: status() })) } : pick([{ advance: true }, { start: n }, { done: [n] }]), sub)
  }
  if (roll < 0.45) return call(pick(['TodoWrite', 'mcp__ccd_turn__wrap_up']), { todos: names.slice(0, 3).map(content => ({ content, status: status(), activeForm: content })) }, sub)
  if (roll < 0.55) {
    const id = String(1 + Math.floor(r() * 5))
    const tool = pick(['TaskCreate', 'TaskUpdate', 'TaskList'])
    const res = tool === 'TaskCreate' ? { task: { id, subject: pick(names) } } : tool === 'TaskUpdate' ? { success: r() < 0.9, taskId: id }
      : { tasks: names.slice(0, 1 + Math.floor(r() * 4)).map((subject, i) => ({ id: String(i + 1), subject, status: status(), blockedBy: [] })) }
    return result(tool, res, { args: { taskId: id, status: pick(['pending', 'in_progress', 'completed', 'deleted']) }, isError: r() < 0.1, ...sub })
  }
  if (roll < 0.80) {
    const [tool, args] = pick<[string, Record<string, unknown>]>([['Read', { file_path: 'a.ts' }], ['Edit', { file_path: 'b.ts' }], ['Bash', { command: 'npm test' }],
      ['Bash', { command: 'ls' }], ['WebFetch', { url: 'https://a.b' }], ['Grep', { pattern: 'x' }], ['mcp__github__create_issue', {}], ['Agent', { description: 'x' }]])
    return call(tool, args, sub)
  }
  return result(pick(['Bash', 'WebFetch', 'Read', 'mcp__github__create_issue', 'Agent', 'Unknown']), { status: 'completed', toolStats: { readCount: 30 } }, { isError: r() < 0.2, ...sub })
}

test('same reference when nothing changes, for every event on random worlds; and nothing jumps', async () => {
  const r = mulberry32(42)
  let checks = 0
  let unchanged = 0
  for (let w = 0; w < 120; w++) {
    let l = emptyLive(T0, home(0))
    let now = T0
    for (let e = 0; e < 60; e++) {
      now += Math.floor(r() * 5000)
      const ev = randomEvent(r, l)
      const next = reduce(l, ev, now, ctx)
      const isSame = canon(next) === canon(l)
      if (isSame) { expect(next).toBe(l); unchanged++ }
      expect(next === l).toBe(next.rev === l.rev)
      // Every seated step has its crab on its plot, one crab a plot; the farmhand keeps an empty farm.
      const staying = next.crabs.filter(c => c.leavingAt === undefined)
      next.plan.seats.forEach((id, plot) => { if (id !== null) expect(staying.filter(c => c.stepId === id && c.plot === plot).length).toBe(1) })
      expect(new Set(staying.map(c => c.plot)).size).toBe(staying.length)
      if (next.plan.steps.length === 0) expect(staying.length).toBeGreaterThan(0)
      expect(next.helpers.length).toBeLessThan(25)
      expect(next.fx.length).toBeLessThan(9)
      // Nobody already on the farm moves at the moment of the event (a clear starts a new farm).
      if (ev.kind !== 'clear') {
        const ft = farmTime(l, now)
        for (const c of next.crabs) {
          const was = l.crabs.find(o => o.plot === c.plot && (o.stepId === c.stepId || canon(o.anchor) === canon(c.anchor)) && o.leavingAt === c.leavingAt || o.plot === c.plot && o.stepId === c.stepId)
          if (!was) continue
          const a = at(timeline(c, home(c.plot), route, true), ft).pt, b = at(timeline(was, home(was.plot), route, true), ft).pt
          if (a.x !== b.x || a.y !== b.y) console.log(JSON.stringify({ ev, ft, was, c }))
          expect(a).toEqual(b)
          checks++
        }
      }
      l = next
    }
  }
  expect(checks).toBeGreaterThan(3000)
  expect(unchanged).toBeGreaterThan(100)
})
