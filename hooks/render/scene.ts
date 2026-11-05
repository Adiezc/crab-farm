// The farm's state, at a moment, as one draw list: what stands where, who moves how, the signs, the board, the sky.
// Every surface draws from it: the SVG for the desktop app, VS Code and mobile, the cells for the terminal.
// Pure. Positions are never invented here: crabs come from their jobs, helpers from their loops, the rest from the
// calendar and the seed, so a list built a moment later agrees with this one about where everyone is.

import { BEAT, SHIPPED_BUILDS } from '../contracts'
import type {
  Actor, Board, DrawList, Ft, IconId, JobKind, LandmarkId, Leg, Motion, Ms, Pt, Season, Sign, SpriteId, Static, Surface,
  UnlockId, Weather, Zone,
} from '../contracts'
import type { Bank, Crab, Helper, Job, Live, Step } from '../../types'
import { at, endOf, helperLegs, timeline } from '../model/jobs'
import { currentStep } from '../model/plan'
import { BUILD_ORDER, PADS, PLOTS, PLOT_H, PLOT_W, YARD, home, route } from '../model/layout'
import { eventsAt, hemisphereOf, localTime, seasonOf, sky, weatherOf } from '../model/clock'
import { ambientActors, idleActor } from '../model/ambient'
import { LADDER, nextBuild, owned } from '../model/progress'
import { boardBox } from './text'

type Opts = { motion: Motion; hemisphere: 'auto' | 'north' | 'south'; tz?: string }

const MIN = 60_000
/** A crab whose turn ended this long ago, with nothing left to do, starts its idle routines. */
const IDLE_AFTER = 2 * MIN
/** Idle routines are picked per slot of this length (spec 5.4). */
const SLOT = 3 * MIN
/** How long an effect shows: coins float up and fade, a puddle dries. */
export const FX_MS: Readonly<Record<string, number>> = { coins: 2_000, sparkle: 1_500, golden: 2_000, confetti: 3_000, compost: 1_000, puddle: 30_000 }

const pt = (x: number, y: number): Pt => ({ x, y })

// ---- the crab's look ----

/** The crab-Claude's frames for every pose: two frames each, swapped on the shared beat. */
export const CRAB_FRAMES: Actor['frames'] = {
  stand: ['crab_stand', 'crab_stand'], walk: ['crab_walk1', 'crab_walk2'], carry: ['crab_carry1', 'crab_carry2'],
  type: ['crab_type', 'crab_stand'], think: ['crab_stand', 'crab_stand'], work: ['crab_crouch', 'crab_reach'],
  sit: ['crab_sit', 'crab_sit'], sleep: ['crab_sleep', 'crab_sleep'], look: ['crab_look', 'crab_stand'],
  cheer: ['crab_armsup', 'crab_happy'], holdSign: ['crab_armsup', 'crab_armsup'],
}

/** The hat of the season: a flower crown in spring, straw through autumn, a beanie in winter, a hood in the rain. */
export const hatOf = (season: Season, weather: Weather): SpriteId =>
  weather?.kind === 'rain' ? 'hat_hood' : season === 'spring' ? 'hat_crown' : season === 'winter' ? 'hat_beanie' : 'hat_straw'

const MODEL_OF = (model: string): 'haiku' | 'sonnet' | 'opus' | 'fable' => {
  const m = model.toLowerCase()
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('fable') ? 'fable' : 'opus'
}
const miniFrames = (model: string): Actor['frames'] => {
  const m = MODEL_OF(model)
  const a = `mini_${m}_0` as SpriteId, b = `mini_${m}_1` as SpriteId, c = `mini_${m}_carry` as SpriteId
  return { stand: [a, a], walk: [a, b], work: [b, a], carry: [c, c] }
}

// ---- words ----

/** The bubble each job kind shows (tools.ts keeps the same table for classify). */
const ICON: Readonly<Record<JobKind, IconId>> = {
  inspect: 'scroll', scout: 'magnifier', till: 'quill', sow: 'quill', pots: 'quill', water: 'terminal', sprinkle: 'terminal',
  mill: 'terminal', deliver: 'terminal', pack: 'terminal', ship: 'terminal', post: 'globe', lookout: 'globe', hire: 'roster',
  trade: 'plug', stake: 'plan', almanac: 'book', bell: 'heart', alarm: 'gear', watch: 'dots', blueprint: 'plan',
  backfield: 'dots', tinker: 'gear', harvest: 'heart', haul: 'heart', compost: 'dots', arrive: 'dots', leave: 'zzz',
  basket: 'heart', muster: 'heart',
}
/** What a job looks like in words, for the alt text and the hover card. */
export const DOING: Readonly<Record<JobKind, string>> = {
  inspect: 'reading', scout: 'searching', till: 'tilling', sow: 'sowing', pots: 'potting', water: 'watering',
  sprinkle: 'sprinkling', mill: 'milling', deliver: 'unloading', pack: 'packing', ship: 'shipping', post: 'posting',
  lookout: 'looking out', hire: 'hiring', trade: 'trading', stake: 'staking', almanac: 'reading the almanac',
  bell: 'ringing the bell', alarm: 'winding the clock', watch: 'watching', blueprint: 'drafting', backfield: 'in the backfield',
  tinker: 'tinkering', harvest: 'harvesting', haul: 'hauling', compost: 'composting', arrive: 'arriving', leave: 'leaving',
  basket: 'fetching the basket', muster: 'gathering',
}
const PLACE: Partial<Record<LandmarkId, string>> = {
  home: 'its plot', row: 'its row', fence: 'the fence', barnDoor: 'the barn', barnIn: 'the barn', eave: 'the eaves',
  yard: 'the yard', pond: 'the pond', compost: 'the compost', lookout: 'the lookout', stump: 'the stump', shade: 'the shade',
  gate: 'the gate', coop: 'the coop', barrel: 'the rain barrel', mailbox: 'the mailbox', bench: 'the bench', well: 'the well',
  jetty: 'the jetty', windmill: 'the windmill', orchard: 'the orchard', sign: 'its sign',
}
const BUILD_NAME = (id: UnlockId): string => LADDER.find(r => r.id === id)?.name ?? id

/** Thousands with commas, as the board shows them. */
export const commas = (n: number): string => String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// ---- the farm's clock ----

/** Farm time: wall time less the pauses, standing still while Claude asks. */
export const farmTimeOf = (live: Live, now: Ms): Ft => (live.clock.pauseFrom ?? now) - live.clock.pausedMs

const plotOf = (plot: number): { x: number; y: number; w: number; h: number } => {
  const p = PLOTS[Math.min(Math.max(plot, 0), 5)] ?? pt(57, 109)
  return { x: p.x, y: p.y, w: PLOT_W, h: PLOT_H }
}

// ---- what the farm owns ----

/** Lifetime coins the board shows: everything folded and synced, and this session's coins once they landed. */
const shownCoins = (live: Live, bank: Bank): number => bank.others.coins + live.earn.shown
/** Builds standing and drawn: never fewer than the bank says, never past the shipped ones. */
export const builtCount = (live: Live, bank: Bank): number =>
  Math.min(SHIPPED_BUILDS, Math.max(bank.owned, owned(shownCoins(live, bank))))
const lifetimeHarvests = (live: Live, bank: Bank): number => bank.others.harvests + live.earn.harvests

// ---- crops ----

type Stage = 'none' | 'seed' | 'sprout' | 'grow' | 'ripe'

/** A step's crops: seeded by its first calls and grown by more of them, and by time, as 1.2's were; ripe once done. */
export const cropStage = (step: Step | undefined, now: Ms): Stage => {
  if (!step || step.goneAt !== undefined || step.status === 'pending') return 'none'
  if (step.status === 'completed') return 'ripe'
  const calls = Math.min(step.calls, 8)
  const byCalls = calls === 0 ? 0 : calls < 3 ? 1 : calls < 8 ? 2 : 3
  const minutes = step.startedAt === undefined ? 0 : Math.max(0, now - step.startedAt) / MIN
  const byTime = minutes < 2 ? 0 : minutes < 15 ? 2 : 3
  return (['none', 'seed', 'sprout', 'grow'] as const)[Math.max(byCalls, byTime)] ?? 'none'
}

const cropStatics = (plot: number, stage: Stage, isDroopy: boolean): Static[] => {
  if (stage === 'none') return []
  const p = plotOf(plot)
  const out: Static[] = []
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 3; k++) {
      const x = p.x + 6 + k * 9 + row * 4
      const y = row ? p.y + p.h - 1 : p.y + 8
      const v = (k + row + plot) % 3
      const sprite: SpriteId = stage === 'seed' ? 'crop_seed' : stage === 'sprout' ? 'crop_sprout'
        : (`crop_${stage}_${v}` as SpriteId)
      out.push(isDroopy ? { sprite, at: pt(x - 2.5, y - 9), filter: 'droop' } : { sprite, at: pt(x - 2.5, y - 9) })
    }
  return out
}

// ---- buildings ----

/** Where a build's sprite stands: its pad's corner, and the sprite that shows it. */
const BUILD_SPRITE: Partial<Record<UnlockId, SpriteId>> = {
  scarecrow: 'scarecrow', coop: 'coop', barrel: 'barrel', mailbox: 'mailbox', bench: 'bench', flowers: 'flowers',
  hive: 'hive', well: 'well', jetty: 'jetty', windmill: 'windmill',
}
/** The picture a build is known by on the board's bar and in words. */
export const buildIcon = (id: UnlockId): SpriteId => BUILD_SPRITE[id] ?? (id === 'cat' ? 'cat_sit' : 'scaffold_2')

const isOpenAt = (crabs: Crab[], kind: JobKind, land?: LandmarkId): boolean =>
  crabs.some(c => c.jobs.some(j => j.kind === kind && j.isOpen && j.until === undefined && (!land || j.land === land)))

const buildStatics = (count: number, crabs: Crab[], now: Ms, bank: Bank): Static[] => {
  const out: Static[] = []
  for (const id of BUILD_ORDER.slice(0, count)) {
    const [x, y] = PADS[id]
    if (id === 'well') out.push({ sprite: isOpenAt(crabs, 'water', 'well') ? 'well_pump' : 'well', at: pt(x, y) })
    else if (id === 'mailbox') out.push({ sprite: isOpenAt(crabs, 'post', 'mailbox') ? 'mailbox_up' : 'mailbox', at: pt(x, y) })
    else if (id === 'windmill') out.push({ sprite: 'windmill', at: pt(x, y) }, { sprite: 'blades', at: pt(x - 3, y - 6) })
    else if (id === 'orchard') {
      // Three saplings (there is no tree sprite yet): young from the day it was built, grown after a fortnight.
      const days = (now - (bank.builtAt.orchard ?? now)) / 86_400_000
      const sprite: SpriteId = days >= 14 ? 'crop_ripe_1' : days >= 5 ? 'crop_grow_1' : 'crop_sprout'
      for (const dy of [4, 18, 32]) out.push({ sprite, at: pt(x + 5, y + dy) })
    } else {
      const sprite = BUILD_SPRITE[id]
      if (sprite) out.push({ sprite, at: pt(x, y) })
    }
  }
  return out
}

/** The next build, a ghost at its pad: posts, then a frame, then a roof as the coins come in. */
const ghostStatic = (id: UnlockId, progress: number): Static => {
  const [x, y, w, h] = PADS[id]
  if (id === 'cat') return { sprite: 'cat_sleep', at: pt(x, y), opacity: 0.35, filter: 'ghost' }
  const stage = Math.min(2, Math.floor(progress * 3))
  return { sprite: `scaffold_${stage}` as SpriteId, at: pt(Math.round(x + w / 2 - 8), y + h - 16), opacity: 0.35, filter: 'ghost' }
}

// The harvest piles up in the yard: a crate per 10 harvests, three by three, and bales at 5, 15, 30, 60, 100, 200.
const CRATE_SPOTS = [[88, 72], [95, 72], [102, 72], [91, 66], [98, 66], [88, 60], [95, 60], [102, 60], [95, 54]] as const
const BALES = [[5, 78, 82], [15, 70, 82], [30, 74, 76], [60, 108, 74], [100, 108, 68], [200, 112, 62]] as const

const yardStatics = (harvests: number): Static[] => {
  const out: Static[] = []
  for (const [n, x, y] of BALES) if (harvests >= n) out.push({ sprite: 'bale', at: pt(x, y) })
  const crates = Math.min(CRATE_SPOTS.length, Math.floor(harvests / 10))
  CRATE_SPOTS.slice(0, crates).forEach(([x, y]) => out.push({ sprite: 'crate_full', at: pt(x, y) }))
  return out
}

// ---- crabs ----

/** Where a step's laptop sits: beside the crab's home, right of its feet. */
const laptopAt = (plot: number): Pt => { const p = plotOf(plot); return pt(p.x - 4, p.y + 8) }

/** The job under way at ft, or the last one queued. */
const jobNow = (crab: Crab): Job | undefined => crab.jobs[crab.jobs.length - 1]

type CrabState = 'working' | 'thinking' | 'asking' | 'waiting' | 'stopped' | 'done' | 'next' | 'idle'

/** Whether a crab is between turns, done or next, and has finished what it was doing: its routines take over. */
const isIdle = (crab: Crab, step: Step | undefined, live: Live, ft: Ft): boolean => {
  if (crab.leavingAt !== undefined) return false
  if (endOf(crab, home(crab.plot), route) > ft) return false
  if (!step || step.status !== 'in_progress') return true
  return !live.turn.isWorking && ft - crab.restSince >= IDLE_AFTER
}

const stateOf = (crab: Crab, step: Step | undefined, live: Live, ft: Ft, isCurrent: boolean): CrabState => {
  if (step?.status === 'completed') return 'done'
  if (step?.status === 'pending') return 'next'
  if (live.asking && isCurrent) return 'asking'
  if (live.turn.isWorking && step?.status === 'in_progress') return live.turn.hadTools || crab.jobs.length ? 'working' : 'thinking'
  if (live.turn.outcome === 'aborted' || live.turn.outcome === 'error') return 'stopped'
  if (isIdle(crab, step, live, ft)) return 'idle'
  return 'waiting'
}

/** A crab's laptop, typing along with its crab: its keys light up on the crab's typing beats. */
const laptopActor = (id: string, legs: Leg[], spot: Pt): Actor => {
  const feet = pt(spot.x + 4.5, spot.y + 7)
  return {
    id, kind: 'critter', clock: 'farm', still: feet,
    frames: { type: ['laptop_0', 'laptop_1'], stand: ['laptop_0', 'laptop_0'] },
    legs: legs.map(l => ({ t0: l.t0, beats: l.beats, from: feet, to: feet, pose: l.pose === 'type' ? 'type' : 'stand', ...(l.isOpen ? { isOpen: true } : {}) })),
  }
}

/** The ask freeze: the asking crab holds up its sign where it stands. */
const holdSignLegs = (legs: Leg[], ft: Ft, here: Pt): Leg[] =>
  [...legs.filter(l => l.t0 + l.beats * BEAT <= ft), { t0: Math.floor(ft / BEAT) * BEAT, beats: 1, from: here, to: here, pose: 'holdSign', isOpen: true }]

// ---- helpers ----

/** A helper's actor id: its plot in the second character, so the picture can count and fold them per plot. */
const helperId = (h: Helper, i: number): string => `h${Math.min(Math.max(h.plot, 0), 5)}${i}`

const helperActor = (h: Helper, i: number, ft: Ft, motion: Motion): Actor | undefined => {
  const top = plotOf(h.plot)
  const { legs, loop, intro } = helperLegs(h, pt(top.x, top.y), YARD, route, motion)
  const frames = miniFrames(h.model)
  const strip = (ls: Leg[]): Leg[] => ls.map(l => (l.prop === 'crate' ? { t0: l.t0, beats: l.beats, from: l.from, to: l.to, pose: l.pose, ...(l.isOpen ? { isOpen: true } : {}) } : l))
  const id = helperId(h, i)
  if (!legs.length) return undefined
  if (h.endedAt !== undefined || !loop) {
    // A one-shot: gone once it is in the barn.
    const last = legs[legs.length - 1] as Leg
    if (!last.isOpen && last.t0 + last.beats * BEAT <= ft) return undefined
    return { id, kind: 'mini', clock: 'farm', frames, legs: strip(legs) }
  }
  const introEnd = intro?.length ? Math.max(...intro.map(l => l.t0 + l.beats * BEAT)) : -Infinity
  if (intro?.length && ft < introEnd) {
    // Still on its way out of the barn: the walk, then one round of its loop, so it never stalls before the next redraw.
    const round = legs.map(l => ({ ...l, t0: l.t0 + introEnd }))
    return { id, kind: 'mini', clock: 'farm', frames, legs: strip([...intro, ...round]) }
  }
  return { id, kind: 'mini', clock: 'farm', frames, legs: strip(legs), loop }
}

// ---- hover cards ----

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const up = (s: string): string => s.toUpperCase()
const hhmm = (ms: Ms, tz?: string): string => {
  const l = localTime(ms, tz)
  const m = Math.floor((l as { minutes?: number }).minutes ?? l.hour * 60)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** Minutes as a card shows them: exact under ten, then in fives, so the card changes only now and then. */
const bucketMin = (ms: number): number => { const m = Math.floor(ms / MIN); return m < 10 ? m : Math.floor(m / 5) * 5 }
/** A step's state for its card, from the state alone (never the time), so the card reads the same until it changes. */
const cardState = (step: Step, live: Live, isCurrent: boolean): CrabState =>
  step.status === 'completed' ? 'done' : step.status === 'pending' ? 'next'
    : live.asking && isCurrent ? 'asking'
      : live.turn.isWorking ? (live.turn.hadTools ? 'working' : 'thinking')
        : live.turn.outcome === 'aborted' || live.turn.outcome === 'error' ? 'stopped' : 'waiting'

const STATE_WORD: Record<CrabState, string> = {
  working: 'working', thinking: 'thinking', asking: 'needs your OK', waiting: 'your move', stopped: 'stopped',
  done: 'done', next: 'next', idle: 'resting',
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
const dayMonth = (ms: Ms, tz?: string): string => {
  const d = localTime(ms, tz).date.split('-')
  return `${Number(d[2] ?? 1)} ${MONTHS[Number(d[1] ?? 1) - 1] ?? ''}`
}
/** What each build does for the crabs, on its card. */
const ROLE: Partial<Record<UnlockId, string>> = {
  scarecrow: 'keeps the crows off', coop: 'hens and eggs', barrel: 'nearer water for bash', mailbox: 'web fetches go here',
  bench: 'lunch and a sit', cat: 'naps in the sun', flowers: 'butterflies and bees', hive: 'bees and honey',
  well: 'bash fetches water here', jetty: 'fishing', windmill: 'builds run the mill', orchard: 'saplings, then fruit',
}

const plotZone = (step: Step, index: number, total: number, crab: Crab | undefined, helpers: Helper[], state: CrabState, tz?: string): Zone => {
  const p = plotOf(crab?.plot ?? 0)
  const lines = [clip(up(`${index + 1}/${total} ${step.name}`), 38)]
  lines.push(clip(up(step.doing && state === 'working' ? `${STATE_WORD[state]} · ${step.doing}` : STATE_WORD[state]), 38))
  const job = crab ? jobNow(crab) : undefined
  if (job && (state === 'working' || state === 'asking')) {
    const tool = `${job.tool.startsWith('mcp__') ? job.tool.split('__')[1] ?? job.tool : job.tool}${job.count > 1 ? ` ×${job.count}` : ''}${job.note ? `: ${job.note}` : ''}`
    lines.push(clip(up(`now: ${DOING[job.kind]} (${tool})`), 38))
  } else if (job && PLACE[job.land]) lines.push(clip(up(`last: ${DOING[job.kind]} at ${PLACE[job.land]}`), 38))
  const parts: string[] = []
  if (step.startedAt !== undefined) {
    parts.push(`since ${hhmm(step.startedAt, tz)}`)
    const end = step.doneAt ?? step.lastAt ?? step.startedAt
    parts.push(`${bucketMin(end - step.startedAt)} min`)
  }
  parts.push(`${step.calls} call${step.calls === 1 ? '' : 's'}`)
  if (helpers.length) parts.push(`${helpers.length} helper${helpers.length === 1 ? '' : 's'}`)
  lines.push(clip(up(parts.join(' · ')), 38))
  return { id: `p${crab?.plot ?? 0}`, rect: [p.x - 16, p.y - 8, p.w + 18, p.h + 19], lines: lines.slice(0, 4) }
}

const helperZone = (plot: number, helpers: Helper[], tz?: string): Zone => {
  const p = plotOf(plot)
  const lines = helpers.slice(0, 4).map(h => clip(up(`${MODEL_OF(h.model)} · ${h.label} · since ${hhmm(h.since, tz)}`), 38))
  return { id: `m${plot}`, rect: [p.x + 2, p.y - 9, p.w - 2, 9], lines }
}

// ---- the list ----

/**
 * The farm at `now`: everything one picture shows. `now` already carries the surface's latency lead. Farm time
 * drives crabs, helpers and effects; the wall clock drives the sky, the weather and the animals.
 */
export function sceneOf(live: Live, bank: Bank, now: Ms, opts: Opts & { surface: Surface }): DrawList {
  const ft = farmTimeOf(live, now)
  const motion = opts.motion
  const hemi = hemisphereOf(opts.tz, opts.hemisphere)
  const skyNow = sky(now, hemi)
  const season = seasonOf(now, hemi)
  const date = localTime(now, opts.tz).date
  const day = weatherOf(bank.seed, date, season)
  const weather = day && now >= day.from && now < day.to ? day : null
  const events = withFireflies(eventsAt(bank.seed, now, bank), skyNow.step, date)
  const count = builtCount(live, bank)
  const coins = shownCoins(live, bank)
  const next = nextBuild(coins)
  const plan = live.plan
  const current = currentStep(plan)
  const stepById = new Map(plan.steps.map(s => [s.id, s]))
  const hat = hatOf(season, weather)
  const isAsking = live.asking !== undefined
  const isStopped = !live.turn.isWorking && (live.turn.outcome === 'aborted' || live.turn.outcome === 'error')

  const statics: Static[] = []
  const actors: Actor[] = []
  const signs: Sign[] = []
  const zones: Zone[] = []

  // The plots: each seated step's crops and sign.
  const seated = plan.seats.map((id, plot) => ({ plot, step: id ? stepById.get(id) : undefined }))
  for (const { plot, step } of seated) {
    if (!step) continue
    const stage = cropStage(step, now)
    statics.push(...cropStatics(plot, stage, isStopped && step.status === 'in_progress'))
    signs.push({ plot, text: step.name, isCurrent: step.id === current?.id })
  }

  // The crabs, or the resident farmhand when there is no plan.
  const crabs: Crab[] = live.crabs.length || plan.steps.length ? live.crabs
    : [{ stepId: 'resident', plot: 0, anchor: { ft: 0, pt: home(0) }, jobs: [], restSince: 0 }]
  const idleIds = crabs.filter(c => isIdle(c, stepById.get(c.stepId), live, ft)).map(c => c.stepId)
  const travellers = motion === 'full' ? idleIds.slice(0, 2) : []
  const running = live.helpers.filter(h => h.endedAt === undefined)

  crabs.forEach((crab, i) => {
    const step = stepById.get(crab.stepId)
    const isCurrent = !!step && step.id === current?.id
    const state = stateOf(crab, step, live, ft, isCurrent || (!current && i === 0))
    const h = home(crab.plot)
    // Ids say who is who to the picture: c a crab on its errands, i a crab at its idle routines.
    let id = `c${i}`
    let actor: Actor
    if (isIdle(crab, step, live, ft)) {
      id = `i${i}`
      actor = idleActor(crab, crab.plot, bank.seed, now, ft, { owned: count, travellers, sky: skyNow.step, weather, idleCrabs: idleIds })
      actor = { ...actor, id, ...(actor.hat || actor.kind !== 'crab' ? {} : { hat }) }
    } else {
      const isWorking = state === 'working' || state === 'thinking'
      let legs = timeline(crab, h, route, isWorking)
      const job = jobNow(crab)
      let bubble: IconId | undefined
      if (state === 'asking') {
        legs = holdSignLegs(legs, ft, legs.length ? at(legs, ft).pt : h)
        bubble = 'alert'
      } else if (state === 'thinking') bubble = 'dots'
      else if (state === 'working') bubble = job ? ICON[job.kind] : 'dots'
      else if (state === 'waiting' && (isCurrent || !current)) bubble = 'ask'
      // Rain: a crab out on an errand carries an umbrella.
      if (weather?.kind === 'rain') legs = legs.map(l => (l.pose === 'walk' && !l.prop ? { ...l, prop: 'umbrella' } : l))
      actor = {
        id, kind: 'crab', clock: 'farm', frames: CRAB_FRAMES, hat, legs,
        ...(bubble ? { bubble } : {}), ...(state === 'asking' ? { isAsking: true } : {}),
      }
      // The laptop by its home: typing along while the turn works, dark while it thinks or after a stop.
      if (step?.status === 'in_progress') {
        const spot = laptopAt(crab.plot)
        if (state === 'working') actors.push(laptopActor(`l${i}`, legs, spot))
        else statics.push({ sprite: state === 'thinking' || state === 'stopped' ? 'laptop_2' : 'laptop_0', at: spot })
      }
    }
    actors.push(actor)
  })

  // The helpers, each on its step's plot.
  live.helpers.forEach((hp, i) => {
    const a = helperActor(hp, i, ft, motion)
    if (a) actors.push(a)
  })

  // Builds, the next one's scaffold, the yard's harvest, and the life around them.
  statics.push(...buildStatics(count, crabs, now, bank))
  if (next && next.index < SHIPPED_BUILDS) statics.push(ghostStatic(next.id, next.progress))
  statics.push(...yardStatics(lifetimeHarvests(live, bank)))
  if (bank.snowmanYear !== undefined && season === 'winter') statics.push({ sprite: 'snowman', at: pt(80, 84) })
  actors.push(...ambientActors(bank.seed, now, count, skyNow.step, season, weather, motion))

  // The hover zones: a card per seated step, per helper strip, per build, the scaffold and the board.
  const total = plan.steps.length
  for (const { plot, step } of seated) {
    if (!step) continue
    const crab = live.crabs.find(c => c.stepId === step.id)
    const hs = running.filter(h => h.stepId === step.id)
    zones.push(plotZone(step, plan.steps.indexOf(step), total, crab ?? { stepId: step.id, plot, anchor: { ft: 0, pt: home(plot) }, jobs: [], restSince: 0 },
      hs, cardState(step, live, step.id === current?.id), opts.tz))
    if (hs.length) zones.push(helperZone(plot, hs, opts.tz))
  }
  for (const id of BUILD_ORDER.slice(0, count)) {
    const [x, y, w, h] = PADS[id]
    const built = bank.builtAt[id]
    zones.push({ id: `b${id}`, rect: [x, y, w, h], lines: [up(BUILD_NAME(id)), ...(built ? [`BUILT ${dayMonth(built, opts.tz)}`] : []), ...(ROLE[id] ? [up(ROLE[id] as string)] : [])] })
  }
  if (next && next.index < SHIPPED_BUILDS) {
    const [x, y, w, h] = PADS[next.id]
    const have = Math.round(next.progress * next.cost)
    zones.push({ id: 'next', rect: [x, y, w, h], lines: [up(`next: ${BUILD_NAME(next.id)}`), `${commas(have)} / ${commas(next.cost)} COINS`] })
  }
  const board = boardOf(live, coins, next)
  const bb = boardBox(board)
  zones.push({ id: 'board', rect: [bb.x, bb.y, bb.w, bb.h], lines: almanac(live, bank, opts.tz) })

  const fx = live.fx.filter(f => ft - f.t0 >= 0 && ft - f.t0 < (FX_MS[f.kind] ?? 2_000))

  const dl: DrawList = {
    now, ft, motion, lod: 0, sky: skyNow.step, season, weather, events, statics, actors, signs, board, fx, zones, alt: '',
  }
  return { ...dl, alt: altOf(live, coins, next, current, plan.steps.length, running.length) }
}

/** Fireflies come out after dark from May to September (spec 1). */
const withFireflies = (events: string[], step: string, date: string): string[] => {
  const month = Number(date.split('-')[1] ?? 0)
  return (step === 'night' || step === 'dusk') && month >= 5 && month <= 9 && !events.includes('fireflies') ? [...events, 'fireflies'] : events
}

const boardOf = (live: Live, coins: number, next: ReturnType<typeof nextBuild>): Board => {
  const steps = live.plan.steps.filter(s => s.goneAt === undefined)
  const done = steps.filter(s => s.status === 'completed').length
  const helpers = live.helpers.filter(h => h.endedAt === undefined).length
  return {
    isWorking: live.turn.isWorking, isAsking: live.asking !== undefined,
    rows: [['TASKS', String(live.tasks)], ['STEPS', `${done}/${steps.length}`], ['HELPERS', String(helpers)], ['COINS', commas(coins)]],
    ...(next && next.index < SHIPPED_BUILDS ? { next: { sprite: buildIcon(next.id), progress: next.progress } } : {}),
  }
}

const almanac = (live: Live, bank: Bank, tz?: string): string[] => {
  const t = bank.others
  return [
    `${commas(t.coins + live.earn.shown)} COINS · ${commas(t.harvests + live.earn.harvests)} HARVESTS`,
    `${commas(t.crates + live.earn.crates)} CRATES · ${commas(t.helpers + live.earn.helpers)} HELPERS`,
    `${commas(bank.days)} DAYS FARMED · ${commas(t.golden + live.earn.golden)} GOLDEN`,
    `FARM BORN ${dayMonth(bank.bornAt, tz)}`,
  ]
}

const altOf = (live: Live, coins: number, next: ReturnType<typeof nextBuild>, current: Step | undefined, total: number, helpers: number): string => {
  const steps = live.plan.steps.filter(s => s.goneAt === undefined)
  const done = steps.filter(s => s.status === 'completed').length
  const parts: string[] = []
  let head = total ? `Crab Farm: ${done} of ${steps.length} steps done` : 'Crab Farm: resting'
  if (current) {
    const crab = live.crabs.find(c => c.stepId === current.id)
    const job = crab ? jobNow(crab) : undefined
    const doing = live.asking ? `needs your OK (${live.asking.tool})`
      : live.turn.isWorking ? (job ? `${DOING[job.kind]} (${job.tool.startsWith('mcp__') ? job.tool.split('__')[1] ?? job.tool : job.tool})` : 'thinking')
        : 'your move'
    head += `, now "${current.name}", ${doing}`
  } else if (!total) head += live.turn.isWorking ? ', working' : ', waiting for a prompt'
  parts.push(head)
  if (helpers) parts.push(`${helpers} helper${helpers === 1 ? '' : 's'}`)
  parts.push(`${commas(coins)} coins`)
  if (next) parts.push(`next build ${BUILD_NAME(next.id)}, ${Math.floor(next.progress * 100)}%`)
  return parts.join('; ')
}

/** Short words for the picture, the same the alt attribute carries. */
export const altText = (dl: DrawList): string => dl.alt

// ---- when the picture must be redrawn ----

/**
 * A key that changes exactly when the picture would, between state changes: the sky step, the weather block, an
 * event starting or ending, a crop stage, an idle routine's slot, a helper out of the barn or gone into it, an effect
 * ending, the builds, the hour (the cat's sun patch), the day. Everything else moves on its own, by CSS.
 */
export function sceneKey(live: Live, bank: Bank, now: Ms, opts: Opts): string {
  const ft = farmTimeOf(live, now)
  const hemi = hemisphereOf(opts.tz, opts.hemisphere)
  const lt = localTime(now, opts.tz)
  const season = seasonOf(now, hemi)
  const day = weatherOf(bank.seed, lt.date, season)
  const isWet = !!day && now >= day.from && now < day.to
  const stepById = new Map(live.plan.steps.map(s => [s.id, s]))
  const crabs = live.crabs.map(c => {
    const step = stepById.get(c.stepId)
    const over = endOf(c, home(c.plot), route) <= ft
    const idle = isIdle(c, step, live, ft)
    const waited = ft - c.restSince >= IDLE_AFTER
    return `${c.plot}${over ? 'o' : ''}${waited ? 'w' : ''}${idle ? `i${Math.floor((ft - c.restSince) / SLOT)}` : ''}`
  }).join(',')
  const resident = live.crabs.length || live.plan.steps.length ? '' : `r${Math.floor(ft / SLOT)}`
  const crops = live.plan.seats.map(id => (id ? cropStage(stepById.get(id), now)[0] : '-')).join('')
  const helpers = live.helpers.map((h, i) => (helperActor(h, i, ft, opts.motion) ? (h.endedAt === undefined ? phaseOf(h, ft, opts.motion) : 'e') : 'x')).join('')
  const fx = live.fx.filter(f => ft - f.t0 >= 0 && ft - f.t0 < (FX_MS[f.kind] ?? 2_000)).map(f => f.n).join('.')
  return [
    opts.motion, sky(now, hemi).step, season, lt.date, lt.hour, isWet ? day?.kind : '', eventsAt(bank.seed, now, bank).join('+'),
    builtCount(live, bank), crabs, resident, crops, helpers, fx,
  ].join('|')
}

/** Whether a running helper is still on its way out of the barn (its picture changes when it starts its loop). */
const phaseOf = (h: Helper, ft: Ft, motion: Motion): string => {
  const top = plotOf(h.plot)
  const { intro } = helperLegs(h, pt(top.x, top.y), YARD, route, motion)
  const end = intro?.length ? Math.max(...intro.map(l => l.t0 + l.beats * BEAT)) : -Infinity
  return ft < end ? 'i' : 'l'
}

