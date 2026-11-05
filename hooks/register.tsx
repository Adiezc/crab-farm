import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Bank, Critter12, Farm12, Live, Model, Plan12 } from '../types'
import { SHIPPED_BUILDS } from './contracts'
import type { Motion } from './contracts'
import { beginsAtZero, boot, dawnBasket, flush, sync } from './store'
import { RESIDENT, emptyLive, reduce } from './model/world'
import type { FarmEvent, WorldCtx } from './model/world'
import { workStep } from './model/plan'
import { crabName, crabNames } from './model/names'
import { LADDER, basketDate, emptyBank, nextBuild, shippedOwned } from './model/progress'
import { YARD, home, resolve, route } from './model/layout'
import { DOING, altText, builtCount, commas, daysFarmed, sceneKey, sceneOf, toolName } from './render/scene'
import { farmSvg } from './render/svg'
import { hoverSvg } from './render/overlay'
import { NARROW_VIEW, desktopWidth, isNarrow, termCamera } from './render/camera'
import type { TermCamera } from './render/camera'
import { rasterFrame, termLines } from './render/raster'

// A purely visual farm: it only listens to what Claude already does and draws it. No model calls, no tools for the
// model, no network, so it costs no usage. This file is the wiring: each hook turns an event into a FarmEvent, the
// pure reducer (model/world.ts) makes the next farm, and it is written only when it changed. The renderers draw it.
// Every hook keeps the farm out of Claude's way: state work sits in a try, and a tool always runs.

const PANE = 'crab-farm'
const TITLE = 'Crab Farm'
const HEARTBEAT_MS = 30_000
const FRAME_MS = 250
/** How far ahead of the clock each surface draws, so a picture that arrives late is still on the beat (spec 4.1). */
const LEAD: Readonly<Record<string, number>> = { desktop: 30, vscode: 30, mobile: 250 }
/** A subagent's calls of these still move the plan: the task list is shared. */
const TASK_TOOLS: ReadonlySet<string> = new Set(['TaskCreate', 'TaskUpdate', 'TaskList'])
/** Permission modes in which an ask reaches no person: a classifier settles it, or nobody is asked. */
const QUIET_MODES: ReadonlySet<string> = new Set(['auto', 'bypassPermissions', 'dontAsk'])

// Rev 0 is the atom's unwritten initial: the first write of a session starts the farm at rev 1.
const LIVE = atom({ plugin: 'crab-farm', key: 'live' } as const, emptyLive(0), { shape: 'live-2' })
const BANK = atom({ plugin: 'crab-farm', key: 'bank' } as const, emptyBank(0, 0), { shape: 'bank-2' })
// 1.2's values, read once to carry a farm across a reload from 1.2, never written.
const FARM12 = atom({ plugin: 'crab-farm', key: 'farm' } as const, { isWorking: false, turnText: '', turnHadTools: false, taskCount: 0, harvest: 0 } as Farm12)
const PLAN12 = atom({ plugin: 'crab-farm', key: 'plan' } as const, { seq: 0, steps: [] } as Plan12)
const CRITTERS12 = atom({ plugin: 'crab-farm', key: 'critters' } as const, [] as Critter12[])

type Config = { motion: Motion; hemisphere: 'auto' | 'north' | 'south'; hover: boolean; terminalStyle: 'pixels' | 'text'; spinnerWords: boolean }

/** The options from /config, with anything unknown read as its default. */
export const configOf = (o: PluginOptions): Config => ({
  motion: o.motion === 'calm' || o.motion === 'still' ? o.motion : 'full',
  hemisphere: o.hemisphere === 'north' || o.hemisphere === 'south' ? o.hemisphere : 'auto',
  hover: o.hover !== false,
  terminalStyle: o.terminalStyle === 'text' ? 'text' : 'pixels',
  spinnerWords: o.spinnerWords === true,
})

const zone = (): string | undefined => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined }
}

/** The model driving the main loop, by family; none for a model the farm has no colour for. */
export const modelOf = (id: unknown): Model | undefined => {
  if (typeof id !== 'string') return undefined
  const m = id.toLowerCase()
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('opus') ? 'opus' : m.includes('fable') ? 'fable' : undefined
}

/** The project's folder name, for the sign by the gate. */
export const projectOf = (cwd: unknown): string | undefined =>
  typeof cwd === 'string' ? cwd.split(/[\\/]/).filter(Boolean).pop() : undefined

const withMeta = (l: Live, meta: { project?: string | undefined; model?: Model | undefined }): Live => {
  let out = l
  if (meta.project !== undefined && meta.project !== out.project) out = { ...out, project: meta.project }
  if (meta.model !== undefined && meta.model !== out.model) out = { ...out, model: meta.model }
  return out
}

const ctxOf = (live: Live, bank: Bank): WorldCtx => ({ owned: builtCount(live, bank), route, resolve, home, yard: YARD })

/**
 * A 1.2 farm carried into 2.0 when the plugin reloads mid-session: its plan becomes the list (each step keeping its
 * calls, its stamps, and finished steps already paid), its running critters the helpers, its turn the turn.
 */
export function fromV12(live: Live, farm: Farm12, plan: Plan12, critters: readonly Critter12[], now: number, ctx: WorldCtx): Live {
  // 1.2's auto plan (one step named after the last prompt) was no list: carried as one, it would never yield to the
  // next prompt. Left behind, the next prompt makes its own step.
  const steps = plan.isAuto ? [] : plan.steps
  if (!steps.length && !critters.some(c => c.status === 'running')) return live
  let l = live
  if (steps.length) {
    const newTodos = steps.map(s => ({ content: s.name, status: s.status, activeForm: s.name }))
    l = reduce(l, { kind: 'result', tool: 'TodoWrite', useId: 'v12', isError: false, args: { todos: newTodos }, result: { oldTodos: [], newTodos } }, now, ctx)
    const old = new Map(steps.map(s => [s.name, s]))
    l = { ...l, plan: { ...l.plan, steps: l.plan.steps.map(s => {
      const o = old.get(s.name)
      if (!o) return s
      const out = { ...s, calls: Math.max(s.calls, o.tools) }
      if (o.startedAt !== undefined) out.startedAt = o.startedAt
      if (o.doneAt !== undefined) out.doneAt = o.doneAt
      if (s.status === 'completed') out.paid = true
      return out
    }) } }
  }
  for (const c of critters) if (c.status === 'running') l = reduce(l, { kind: 'spawn', model: c.model, label: c.label, useId: c.id, ...(c.agentId ? { agentId: c.agentId } : {}) }, now, ctx)
  return { ...l, tasks: Math.max(l.tasks, farm.taskCount), turn: { ...l.turn, isWorking: farm.isWorking, text: farm.turnText.slice(0, 200), hadTools: farm.turnHadTools } }
}

// ---- words, for /farm stats, the text farm and the spinner ----

const toolWord = toolName
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** What one seated step's crab is up to, in a few words. */
const crabWord = (live: Live, stepId: string): string => {
  const step = live.plan.steps.find(s => s.id === stepId)
  const crab = live.crabs.find(c => c.stepId === stepId && c.leavingAt === undefined)
  if (step?.status === 'completed') return 'done'
  if (step?.status === 'pending') return 'next'
  const isWork = !step || step.id === workStep(live.plan)?.id
  if (live.asking && isWork) return `needs your OK (${toolWord(live.asking.tool)})`
  if (!live.turn.isWorking) return live.turn.outcome === 'aborted' || live.turn.outcome === 'error' ? 'stopped' : step ? 'your move' : 'resting'
  const job = isWork ? crab?.jobs.at(-1) : undefined
  return job ? `${DOING[job.kind]} (${toolWord(job.tool) || 'chore'}${job.note ? `: ${job.note}` : ''})` : isWork ? 'thinking' : 'waiting its turn'
}

type CrabRow = { crab: string; name: string; word: string; helpers: number; isBusy: boolean }
/** One row per crab on the farm: its name, its step and what it is up to. The farmhand when there is no plan. */
const crabRows = (live: Live, seed: number): CrabRow[] => {
  const seated = live.plan.seats.filter((id): id is string => id !== null)
  const running = (id?: string): number => live.helpers.filter(h => h.endedAt === undefined && (id === undefined || h.stepId === id)).length
  if (!seated.length) return [{ crab: crabName(seed, RESIDENT), name: 'the farmhand', word: crabWord(live, RESIDENT), helpers: running(), isBusy: live.turn.isWorking }]
  const ids = live.plan.steps.map(s => s.id)
  const names = crabNames(seed, ids)
  return seated.map(id => {
    const step = live.plan.steps.find(s => s.id === id)
    return { crab: names[ids.indexOf(id)] ?? '', name: step?.name ?? id, word: crabWord(live, id), helpers: running(id), isBusy: step?.status === 'in_progress' && live.turn.isWorking }
  })
}

/** The spinner's word while a turn works: the working crab's errand, `Watering`, `Tilling`; none while it thinks. */
export const spinnerWord = (live: Live): string | undefined => {
  if (!live.turn.isWorking) return undefined
  if (live.asking) return 'Waiting at the gate'
  const id = workStep(live.plan)?.id ?? RESIDENT
  const job = live.crabs.find(c => c.stepId === id && c.leavingAt === undefined)?.jobs.at(-1)
  return job ? cap(DOING[job.kind]) : undefined
}

/** `/farm stats`: the farm in a few lines, the same everywhere, panes or not. */
export function statsText(live: Live, bank: Bank): string {
  const coins = bank.others.coins + live.earn.coins
  const all = shippedOwned(coins)
  const next = nextBuild(coins)
  const steps = live.plan.steps.filter(s => s.goneAt === undefined)
  const done = steps.filter(s => s.status === 'completed').length
  const lines = [`Crab Farm · ${commas(coins)} coins · ${all} of ${SHIPPED_BUILDS} builds`]
  lines.push(next
    ? `Next build: ${LADDER[next.index]?.name ?? next.id}, ${commas(Math.floor(next.progress * next.cost))} of ${commas(next.cost)} coins (${Math.floor(next.progress * 100)}%)`
    : 'Every build of this version stands; coins keep counting for the next.')
  lines.push(`Harvests ${commas(bank.others.harvests + live.earn.harvests)} · crates ${commas(bank.others.crates + live.earn.crates)} · days farmed ${commas(daysFarmed(live, bank))}`)
  lines.push(`This session: ${done} of ${steps.length} steps done · ${commas(live.earn.calls)} tool calls · ${commas(live.earn.coins)} coins`)
  for (const r of crabRows(live, bank.seed)) lines.push(`  ${r.crab} · ${clip(r.name, 40)}: ${r.word}${r.helpers ? ` · ${r.helpers} helper${r.helpers === 1 ? '' : 's'}` : ''}`)
  return lines.join('\n')
}

// ---- module memory: caches and timers only; a reload loses them and session.start makes them again ----

type Timer = ReturnType<EngineInterface['clock']['every']>
let heartbeat: Timer | undefined
let frames: Timer | undefined
let sid = ''
let beats = 0
let isShown = true
let flushed = ''
/** Set when a session ends for a /clear or a /resume: its ledger is closed, and the process goes on under another id. */
let switching = false
/** The session's permission mode, from the classic events that carry it: in some modes nobody is asked. */
let mode = ''
/** The last picture drawn: what the heartbeat compares against, and what the terminal loop draws from. */
let drawn: { key: string; live: Live; bank: Bank } | undefined
/** The bank as last read or written: a call needs only its build count, so it is not read again for every call. */
let banked: Bank | undefined
let term: { cam: TermCamera; hash: number; still: number; tick: number } | undefined

async function commitLive($: EngineInterface, fn: (l: Live) => Live): Promise<Live> {
  const before = await read($, LIVE)
  const after = fn(before)
  return after === before ? before : update($, LIVE, fn)
}

const sameBank = (a: Bank, b: Bank): boolean => JSON.stringify({ ...a, syncedAt: 0 }) === JSON.stringify({ ...b, syncedAt: 0 })

async function commitBank($: EngineInterface, bank: Bank): Promise<void> {
  if (!sameBank(await read($, BANK), bank)) await update($, BANK, () => bank)
  banked = bank
}

/** One event through the reducer, and `extra` after it; written only when the farm changed. */
async function apply($: EngineInterface, ev: FarmEvent, extra?: (l: Live) => Live): Promise<Live> {
  const now = Date.now()
  const bank = banked ?? (banked = await read($, BANK))
  return commitLive($, l => { const n = reduce(l, ev, now, ctxOf(l, bank)); return extra ? extra(n) : n })
}

/** This session's ledger to the store, when its earnings moved since the last write. */
async function save($: EngineInterface, live: Live, isClosed = false, id = sid): Promise<void> {
  const mark = JSON.stringify(live.earn)
  if (!id || (!isClosed && mark === flushed)) return
  await flush($, id, live.earn, Date.now(), isClosed)
  flushed = mark
}

const stopFrames = (): void => { frames?.cancel(); frames = undefined }

// The options, set once per load: a change in /config reloads the module.
let cfg = configOf({})
let opts: { motion: Motion; hemisphere: Config['hemisphere']; tz?: string } = { motion: 'full', hemisphere: 'auto' }

// Every 30 s: redraw only when the picture would change by the clock alone (the sky, a crop, a routine), refresh
// whether the pane shows, and every 5 minutes save this session's coins and read everyone else's.
async function beat($: EngineInterface): Promise<void> {
  beats++
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  const wasShown = isShown
  isShown = pane?.isShown === true
  if (beats % 10 === 0) {
    await save($, await read($, LIVE))
    if (sid) await commitBank($, await sync($, sid, Date.now()))
  }
  if (!isShown) { stopFrames(); return }
  if (!wasShown || (drawn && sceneKey(drawn.live, drawn.bank, Date.now(), opts) !== drawn.key)) $.ui.invalidate('ui.render')
}

function arm($: EngineInterface): void {
  heartbeat?.cancel()
  stopFrames()
  beats = 0
  heartbeat = $.clock.every(HEARTBEAT_MS, () => void beat($).catch(() => undefined))
}

// The terminal's frames: the picture again every 250 ms, blitted only when a cell changed. It slows to once a
// second when nothing in view moves, and stops when the pane hides, closes or is resized (a redraw restarts it).
async function frame($: EngineInterface): Promise<void> {
  const t = term
  if (!t || !drawn || !isShown) return stopFrames()
  t.tick++
  if (t.still >= 4 && t.tick % 4 !== 0) return
  const dl = sceneOf(drawn.live, drawn.bank, Date.now(), { ...opts, surface: 'terminal' })
  const f = rasterFrame(dl, t.cam)
  if (f.hash === t.hash) { if (f.movers === 0) t.still++; return }
  t.still = 0
  const r = await $.ui.blit({ requestId: PANE, key: 'farm', cells: f.cells, columns: t.cam.cols, rows: t.cam.rows })
  if ('deny' in r && r.deny !== undefined) { stopFrames(); term = undefined } else t.hash = f.hash
}

async function start($: EngineInterface, cwd: string): Promise<void> {
  arm($)
  try {
    await $.command.register({ name: 'farm', argumentHint: '[stats]', description: 'Show or hide Crab Farm, the pixel farm of what Claude is working on; /farm stats tells the farm in words' })
  } catch {
    // No command: the pane still opens.
  }
  const now = Date.now()
  try {
    sid = await $.session.id()
    // A farm not yet written in this process earns from zero: a resumed session's stored ledgers are not in it.
    if ((await read($, LIVE)).rev === 0) beginsAtZero(sid)
    await commitBank($, await boot($, sid, now))
  } catch {
    // No store: the farm runs on this session's coins alone.
  }
  let model: Model | undefined
  try { model = modelOf(await $.session.model()) } catch { model = undefined }
  const bank = await read($, BANK)
  const live = await read($, LIVE)
  let carried: Live | undefined
  if (live.rev === 0) {
    // A fresh session, or a reload from 1.2: its plan and helpers come along.
    const fresh = { ...emptyLive(now, home(0)), rev: 1 }
    try {
      const [farm, plan, critters] = [await read($, FARM12), await read($, PLAN12), await read($, CRITTERS12)]
      carried = fromV12(fresh, farm, plan, critters, now, ctxOf(fresh, bank))
    } catch {
      carried = fresh
    }
  }
  await commitLive($, l => withMeta(l.rev === 0 && carried ? carried : l, { project: projectOf(cwd), model }))
  // Opens with every session; closing it (its X or /farm) lasts for this session. Where nothing places panes
  // (no screen, or an editor that seats none) it waits, and /farm stats still tells the farm.
  void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  cfg = configOf(options)
  const tz = zone()
  opts = { motion: cfg.motion, hemisphere: cfg.hemisphere, ...(tz ? { tz } : {}) }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try { await start($, e.cwd) } catch { /* the farm stays asleep; Claude goes on */ }
    return started
  })

  // /clear and an in-session /resume: the conversation goes on under another id with no session.start, so the farm
  // starts that conversation afresh and re-arms here. Its earnings begin at zero; the last one's ledger is closed.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    try {
      if (typeof e.permission_mode === 'string') mode = e.permission_mode
      const model = modelOf(e.model)
      // A new id is a new conversation in this process; the same id (a startup, a compact) is not.
      const id = await $.session.id()
      if (e.source === 'clear' || (sid !== '' && id !== sid)) {
        // A switch no session.end announced: the last conversation's ledger is closed here.
        if (!switching && sid !== '' && id !== sid) await save($, await read($, LIVE), true, sid)
        switching = false
        arm($)
        sid = id
        flushed = ''
        const was = await read($, LIVE)
        await apply($, { kind: 'clear' }, l => withMeta(l, { project: was.project, model: model ?? was.model }))
        beginsAtZero(sid)
        await commitBank($, await sync($, sid, Date.now()))
      } else if (model) await commitLive($, l => withMeta(l, { model }))
    } catch { /* drawn as it was */ }
    return r
  })

  // Each prompt carries the permission mode, which the person may have changed since the last.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.permission_mode === 'string') mode = e.permission_mode
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    try { const model = modelOf(e.to_model); if (model) await commitLive($, l => withMeta(l, { model })) } catch { /* the hat keeps its band */ }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // Closed under the id this process has been writing, which is the ending session's.
    try { await save($, await read($, LIVE), true, sid || e.sessionId) } catch { /* the next boot folds what is there */ }
    // A /clear or a /resume goes on in this process: the heartbeat keeps beating and SessionStart re-arms.
    if (e.reason === 'clear' || e.reason === 'resume') switching = true
    else { heartbeat?.cancel(); stopFrames() }
    return next(e)
  })

  on('command.run', { command: 'farm' }, async ($, e) => {
    if (/^\s*stats?\b/i.test(e.args ?? '')) {
      try { return { text: statsText(await read($, LIVE), await read($, BANK)) } } catch { return { text: 'Crab Farm has nothing to tell yet.' } }
    }
    // Closes only a farm the person can see. One opened at start that waits unplaced (a terminal under 144 columns,
    // an editor that seats no pane) or hides behind another tab is opened, asked, which places it at any width.
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane?.isPlaced && pane.isShown) {
      await $.ui.close({ id: PANE })
      stopFrames()
      isShown = false
      return { text: 'Crab Farm closed for this session. /farm brings it back; /farm stats tells it in words.' }
    }
    const r = await $.ui.open({ id: PANE, title: TITLE, ...(pane?.isPlaced ? { focus: true as const } : {}) })
    if (r.isPlaced) isShown = true
    return { text: r.isPlaced ? 'Crab Farm opened.' : 'Crab Farm is open but this window places no panes; /farm stats tells the farm in words.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) { stopFrames(); term = undefined; isShown = false }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    try {
      let model: Model | undefined
      try { model = modelOf(await $.session.model()) } catch { model = undefined }
      await apply($, { kind: 'turnStart', text: e.text, turnId: e.turnId }, l => withMeta(l, { model }))
      // The first prompt after 05:00 finds the dawn basket: its coins go to the store, the bank shows them.
      const now = Date.now()
      const date = basketDate(now)
      const bank = banked ?? await read($, BANK)
      if (date && sid && bank.basketDay !== date) {
        await dawnBasket($, date, builtCount(await read($, LIVE), bank), now)
        await commitBank($, await sync($, sid, now))
      }
    } catch { /* the turn goes on */ }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        const live = await apply($, { kind: 'turnEnd', reason: e.reason }, l => withMeta(l, { model: modelOf(e.usage?.model) }))
        await save($, live)
      } else await apply($, { kind: 'agentEnd', agentId: e.agentId, reason: e.reason })
    } catch { /* the helper finishes undrawn */ }
    return next(e)
  })

  // The main loop's calls become errands, one write a call; a subagent's count only through the Task tools, whose
  // list is shared. Whatever goes wrong here, the call goes on.
  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    if (!isMain && !TASK_TOOLS.has(e.tool)) return next(e)
    const { tool, tool_use_id: useId, agentId, ...rest } = e as unknown as Record<string, unknown> & { tool: string; tool_use_id: string; agentId?: string }
    const args = rest as Record<string, unknown>
    if (isMain) {
      try { await apply($, { kind: 'call', tool, args, useId }) } catch { /* a missed errand costs a sprout, never the call */ }
    }
    const ran = await next(e)
    try {
      const r = ran as unknown as { result?: unknown; isError?: boolean; deny?: string }
      await apply($, { kind: 'result', tool, useId, args, result: r.result, isError: r.isError === true || r.deny !== undefined, ...(agentId ? { agentId } : {}) })
    } catch { /* the mark stays up a call longer; the result still goes back */ }
    return ran
  })

  // A main-loop call put to the person raises the red mark and stops the farm's clock until the call returns. An ask
  // reaches a person through a dialog or the host's (the desktop app's, the editor's) card; in auto mode the
  // classifier settles it, and bypass and don't-ask modes ask nobody, so those draw no mark.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (!e.agentId && e.tool_use_id && e.approver !== undefined && !QUIET_MODES.has(mode) && verdict.decision === 'ask') {
      try { await apply($, { kind: 'ask', tool: e.tool }) } catch { /* the prompt still shows */ }
    }
    return verdict
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('deny' in started && started.deny !== undefined) return started
    try {
      const ok = started as { agentId?: string; model?: string }
      await apply($, { kind: 'spawn', model: ok.model ?? e.model ?? '', label: e.description, useId: e.tool_use_id, ...(ok.agentId ? { agentId: ok.agentId } : {}) })
    } catch { /* a helper not drawn; the subagent still runs */ }
    return started
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in r && r.skip !== undefined)) {
      try { await apply($, { kind: 'compact' }) } catch { /* no barrow this time */ }
    }
    return r
  })

  // Opt-in: the spinner's word becomes the farm's job, for windows that place no pane.
  if (cfg.spinnerWords) {
    on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
      try {
        const word = spinnerWord(await read($, LIVE))
        if (word) return next({ ...e, props: { ...e.props, word } })
      } catch { /* the engine's own word */ }
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const live = await read($, LIVE)
    const bank = await read($, BANK)
    banked = bank
    const surface = e.surface
    const now = Date.now() + (LEAD[surface] ?? 0)
    const dl = sceneOf(live, bank, now, { ...opts, surface: surface === 'terminal' || surface === 'vscode' || surface === 'mobile' ? surface : 'desktop' })
    drawn = { key: sceneKey(live, bank, now, opts), live, bank }
    const cols = e.props.bodyColumns

    if (surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const narrow = Number.isFinite(cols) && isNarrow(cols)
      const view = { narrow }
      const picture = farmSvg(dl, view).svg
      // The desktop gets a width on the 90 px grid; VS Code and mobile none, so the picture fits their panel.
      let size: { width: number; height: number } | undefined
      if (surface === 'desktop') {
        const w = desktopWidth(cols).w
        size = { width: w, height: Math.round(narrow ? (w * NARROW_VIEW.h) / NARROW_VIEW.w : (w * 250) / 180) }
      }
      // The hover cards ride over the picture only where a pointer rests and a Box can sit on the picture.
      const overlay = cfg.hover && (surface === 'desktop' || surface === 'vscode') ? hoverSvg(dl, view) : undefined
      return (
        <Box key="farm" flexDirection="column">
          <Svg source={picture} alt={altText(dl)} {...size} />
          {overlay && (
            <Box position="absolute" top={0} left={0}>
              <Svg source={overlay} alt="Hover a plot, a helper or a build for its card" isInteractive {...size} />
            </Box>
          )}
        </Box>
      )
    }

    if (surface === 'terminal' && cfg.terminalStyle === 'pixels' && 'Raster' in ui) {
      const { Raster } = ui
      const cam = termCamera(cols, e.props.scroll.bodyRows)
      const f = rasterFrame(dl, cam)
      const [header = '', status = ''] = termLines(dl, cam.cols)
      // Drawn means shown: the heartbeat may not have seen the pane come back yet.
      isShown = true
      if (!term || term.cam !== cam) term = { cam, hash: f.hash, still: 0, tick: 0 }
      else term.hash = f.hash
      if (cfg.motion !== 'still' && isShown && !frames) frames = $.clock.every(FRAME_MS, () => void frame($).catch(() => undefined))
      return (
        <Box flexDirection="column">
          {cam.textRows > 1 && <Text bold>{header}</Text>}
          <Raster key="farm" columns={cam.cols} rows={cam.rows} cells={f.cells} />
          <Text dimColor={!dl.board.isWorking}>{status}</Text>
        </Box>
      )
    }

    // The text farm: a line per crab, as 1.2 drew it.
    const coins = bank.others.coins + live.earn.shown
    const steps = live.plan.steps.filter(s => s.goneAt === undefined)
    const done = steps.filter(s => s.status === 'completed').length
    const icon = (w: string): string => (w === 'done' ? '🧺' : w === 'next' ? '🟫' : w === 'stopped' ? '🥀' : w.startsWith('needs') ? '❗' : w === 'your move' ? '🌸' : '🌱')
    return (
      <Box flexDirection="column">
        <Text>🦀 Crab Farm · {done}/{steps.length} steps · {commas(coins)} coins</Text>
        {crabRows(live, bank.seed).map(r => (
          <Text dimColor={!r.isBusy}>
            {icon(r.word)} {r.crab} · {clip(r.name, 30)} · {r.word}{r.helpers ? ` · ${r.helpers} helper${r.helpers === 1 ? '' : 's'}` : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
