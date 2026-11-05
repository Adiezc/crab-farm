// Ambient life: what idle crabs do between jobs, and the animals and critters that live on the farm. Pure.
// Idle routines are one-shots on farm time, one per 3-minute slot shared by every crab, each starting and ending at
// the crab's home, so a switch never jumps. Animals and critters are loops on the wall clock, each ending where it
// starts, and every move steps whole pixels on the beat at a whole number of pixels per beat.

import { BEAT } from '../contracts'
import type {
  Actor, Ft, Hemisphere, IconId, Leg, Motion, Ms, Pose, Prop, Pt, Season, SkyStep, SpriteId, Weather,
} from '../contracts'
import type { Crab } from '../../types'
import { hash32, roll, weightedPick } from './rng'
import { PLOTS, home, isBuilt, lengthOf, route, rowSpot, spot } from './layout'
import { isDark, isDaylight, isWet, localTime, skySpan } from './clock'
import { at } from './jobs'

type Frames = Actor['frames']
const pair = (a: SpriteId, b: SpriteId = a): readonly [SpriteId, SpriteId] => [a, b]

/** The crab-Claude's frames by pose; frame B only where the pose animates (a blink every half second would flicker). */
export const CRAB_FRAMES: Frames = {
  stand: pair('crab_stand'), walk: pair('crab_walk1', 'crab_walk2'), type: pair('crab_type'), think: pair('crab_stand'),
  work: pair('crab_crouch', 'crab_reach'), carry: pair('crab_carry1', 'crab_carry2'), sit: pair('crab_sit'),
  sleep: pair('crab_sleep'), look: pair('crab_look'), cheer: pair('crab_happy', 'crab_armsup'), holdSign: pair('crab_armsup'),
}
const HEN: Frames = { stand: pair('hen_0'), walk: pair('hen_0', 'hen_1'), work: pair('hen_1', 'hen_0'), sit: pair('hen_1') }
const CHICK: Frames = { stand: pair('chick'), walk: pair('chick'), work: pair('chick'), sit: pair('chick') }
const CAT: Frames = { sleep: pair('cat_sleep'), stand: pair('cat_sit'), walk: pair('cat_walk_0', 'cat_walk_1') }
const CROW: Frames = { stand: pair('crow_0'), cheer: pair('crow_1', 'crow_0') }
const BIRD: Frames = { stand: pair('bird_0'), walk: pair('bird_0', 'bird_1'), look: pair('bird_1') }
const BEE: Frames = { walk: pair('bee'), work: pair('bee') }
const BUTTERFLY: Frames = { stand: pair('butterfly_1'), walk: pair('butterfly_0', 'butterfly_1') }
const FISH: Frames = { stand: pair('fish_0'), cheer: pair('fish_0', 'fish_1'), look: pair('ripple') }
const FROG: Frames = { stand: pair('frog'), cheer: pair('frog') }
const BAT: Frames = { stand: pair('bat_0', 'bat_1'), walk: pair('bat_0', 'bat_1') }
const LEAF: Frames = { walk: pair('leaf_0', 'leaf_1') }
const CLOUD: Frames = { stand: pair('cloud'), walk: pair('cloud') }
const STAR: Frames = { stand: pair('sparkle_0'), walk: pair('sparkle_0', 'sparkle_1') }
const OWL: Frames = { stand: pair('owl_0'), look: pair('owl_1') }
const FOX: Frames = { stand: pair('fox_0'), walk: pair('fox_0', 'fox_1'), look: pair('fox_0') }

/** The hat a crab wears: a hood in rain or snow, else the season's (flower crown, straw, straw, beanie). */
export const hatOf = (season: Season, weather?: Weather, now?: Ms): SpriteId =>
  isWet(weather ?? null, now) ? 'hat_hood'
    : season === 'spring' ? 'hat_crown' : season === 'winter' ? 'hat_beanie' : 'hat_straw'

// ---- legs, a pen at a time ----

/** A timeline being written: its legs so far, the time the next starts, and where the actor stands. */
type Pen = { legs: Leg[]; t: number; at: Pt }
const pen = (at: Pt, t = 0): Pen => ({ legs: [], t, at })

const hold = (p: Pen, beats: number, pose: Pose, prop?: Prop): Pen => {
  if (beats <= 0) return p
  const leg: Leg = { t0: p.t, beats, from: p.at, to: p.at, pose }
  if (prop) leg.prop = prop
  p.legs.push(leg)
  p.t += beats * BEAT
  return p
}

/**
 * A straight move at `speed` whole px per beat; a remainder the speed does not divide goes at 1 px per beat, so
 * every step is the same size and lands on the beat. A move off the axes goes along x, then y.
 */
const line = (p: Pen, to: Pt, speed: number, pose: Pose, prop?: Prop): Pen => {
  if (p.at.x !== to.x && p.at.y !== to.y) return line(line(p, { x: to.x, y: p.at.y }, speed, pose, prop), to, speed, pose, prop)
  const dx = Math.sign(to.x - p.at.x), dy = Math.sign(to.y - p.at.y)
  const len = Math.abs(to.x - p.at.x) + Math.abs(to.y - p.at.y)
  const fast = len - (len % speed)
  const step = (px: number, beats: number): void => {
    if (px <= 0) return
    const next = { x: p.at.x + dx * px, y: p.at.y + dy * px }
    const leg: Leg = { t0: p.t, beats, from: p.at, to: next, pose }
    if (prop) leg.prop = prop
    p.legs.push(leg)
    p.t += beats * BEAT
    p.at = next
  }
  step(fast, fast / speed)
  step(len - fast, len - fast)
  return p
}

/** Out of sight in one beat: a critter's way back to its start, around the outside of the world. */
const jump = (p: Pen, to: Pt, pose: Pose = 'stand'): Pen => {
  p.legs.push({ t0: p.t, beats: 1, from: p.at, to, pose })
  p.t += BEAT
  p.at = to
  return p
}

/** Along the paths to a place: a stroll, or a trot when the way is longer than 60 px. */
const trip = (p: Pen, to: Pt, pose: Pose = 'walk', prop?: Prop): Pen => {
  const path = route(p.at, to)
  const speed = lengthOf(path) > 60 ? 2 : 1
  for (const q of path.slice(1)) line(p, q, speed, pose, prop)
  return p
}
const tripBeats = (from: Pt, to: Pt): number => trip(pen(from), to).t / BEAT

// ---- idle crabs ----

export const SLOT_MS = 180_000
const SLOT_BEATS = SLOT_MS / BEAT

/**
 * The idle slot a farm time falls in. Slots are shared by every crab (3 minutes of farm time from the epoch), so
 * the crabs who may travel take turns and two crabs who chat agree on it. A crab plays routines from the first
 * slot that starts after it came to rest; until then it sits at home.
 */
export const idleSlot = (crab: Crab, ft: Ft): number => Math.floor(Math.max(ft, crab.restSince) / SLOT_MS)

/**
 * The idle crabs allowed to travel this slot, at most two, taking turns slot by slot. Pass the idle crabs free to
 * roam (not a pending step's, which waits by its plot); only those at rest since before the slot began can go.
 */
export const travellersOf = (idle: readonly Crab[], ft: Ft, max = 2): string[] => {
  const slot = Math.floor(ft / SLOT_MS)
  const ready = idle.filter(c => c.restSince <= slot * SLOT_MS).map(c => c.stepId).sort()
  if (ready.length <= max) return ready
  const start = (slot * max) % ready.length
  return Array.from({ length: max }, (_, i) => ready[(start + i) % ready.length] as string)
}

export type IdleCtx = {
  owned: number
  /** The crabs who may leave their plots this slot (travellersOf); empty under calm or still motion. */
  travellers: string[]
  sky: SkyStep
  weather: Weather
  idleCrabs: string[]
  /** Given, the routine follows the sky at its slot's start, so a sky step mid-slot never switches it. */
  hemi?: Hemisphere
  /** Given, the crab wears the season's hat. */
  season?: Season
  /** Its step is pending: idle, but visibly next. */
  isPending?: boolean
  /** A build's ribbon-cutting: idle crabs gather at this point to hammer the scaffold. */
  scaffold?: Pt
}

export type Routine =
  | 'rest' | 'sleep' | 'shelter' | 'sharpen' | 'chat'
  | 'tend' | 'watch' | 'nap' | 'wander' | 'fish' | 'lunch' | 'sunset' | 'hens' | 'cat' | 'scaffold'

/** What the slot looks like from its start: the sky, rain, the clock, and what stands on the farm. */
type Cond = { step: SkyStep; isWet: boolean; minutes: number; owned: number; scaffold?: Pt }

const condOf = (now: Ms, ft: Ft, slot: number, ctx: IdleCtx): Cond => {
  const wall0 = now - (ft - slot * SLOT_MS)
  const step = ctx.hemi ? skySpan(wall0, ctx.hemi).step : ctx.sky
  const c: Cond = { step, isWet: isWet(ctx.weather, ctx.weather ? wall0 : undefined), minutes: localTime(wall0).minutes, owned: ctx.owned }
  if (ctx.scaffold) c.scaffold = ctx.scaffold
  return c
}

const CHAT_WEIGHT = 10
/** The weighted routines a crab who may travel chooses from, all but the idle-time nap bonus. */
const travelTable = (c: Cond): { item: Routine; weight: number }[] => [
  { item: 'tend', weight: 20 },
  { item: 'wander', weight: 20 },
  { item: 'fish', weight: isDaylight(c.step) ? (isBuilt('jetty', c.owned) ? 25 : 15) : 0 },
  { item: 'nap', weight: 10 + (c.minutes >= 13 * 60 + 30 ? 10 : 0) },
  { item: 'lunch', weight: c.minutes >= 12 * 60 && c.minutes < 13 * 60 + 30 && isBuilt('bench', c.owned) ? 30 : 0 },
  { item: 'sunset', weight: c.step === 'sunset' && isBuilt('bench', c.owned) ? 30 : 0 },
  { item: 'hens', weight: c.step === 'morning' && isBuilt('coop', c.owned) ? 8 : 0 },
  { item: 'cat', weight: c.step === 'morning' && isBuilt('cat', c.owned) ? 8 : 0 },
  { item: 'scaffold', weight: c.scaffold ? 40 : 0 },
]
/** The in-place routines for a crab who stays on its plot this slot. */
const homeTable = (c: Cond): { item: Routine; weight: number }[] => [
  { item: 'tend', weight: 20 },
  { item: 'watch', weight: 15 },
  { item: 'nap', weight: 10 + (c.minutes >= 13 * 60 + 30 ? 10 : 0) },
]

/** The two crabs who chat this slot, if any: the slot's travellers, by a roll both of them make alike. */
const chatPair = (seed: number, slot: number, c: Cond, ctx: IdleCtx): readonly [string, string] | undefined => {
  const t = [...ctx.travellers].sort()
  const a = t[0], b = t[1]
  if (a === undefined || b === undefined || ctx.idleCrabs.length < 2) return undefined
  const total = travelTable(c).reduce((n, r) => n + r.weight, 0)
  return roll(seed, 'chat', slot, a, b) < CHAT_WEIGHT / (CHAT_WEIGHT + total) ? [a, b] : undefined
}

/**
 * The routine an idle crab plays this slot. Bedtime, shelter and a pending step's hoe come first; then a chat if
 * the slot's two travellers roll one; else a weighted pick, seeded by the crab and the slot.
 */
export const idleRoutine = (crab: Crab, seed: number, now: Ms, ft: Ft, ctx: IdleCtx): Routine => {
  const slot = idleSlot(crab, ft)
  if (slot * SLOT_MS < crab.restSince) return 'rest'
  const c = condOf(now, ft, slot, ctx)
  if (isDark(c.step)) return 'sleep'
  if (c.isWet) return 'shelter'
  if (chatPair(seed, slot, c, ctx)?.includes(crab.stepId)) return 'chat'
  if (ctx.isPending) return 'sharpen'
  const isTraveller = ctx.travellers.includes(crab.stepId)
  const table = isTraveller ? travelTable(c) : homeTable(c)
  const idleMs = slot * SLOT_MS - crab.restSince
  const rows = table.map(r => (r.item === 'nap' && idleMs >= 20 * 60_000 ? { ...r, weight: r.weight + 10 } : r))
  return weightedPick(rows, roll(seed, crab.stepId, slot))
}

/** Places a wandering crab may stroll to: the farm's fixed spots, and the builds that stand. */
const WANDER_ALWAYS = ['pond', 'lookout', 'stump', 'shade', 'gate', 'compost', 'yard', 'barnDoor'] as const
const WANDER_BUILT = ['coop', 'barrel', 'mailbox', 'bench', 'well', 'jetty', 'windmill', 'orchard'] as const

/** Where two chatting crabs meet: pairs of spots on the paths, the first crab on the left facing right. */
const CHAT_SPOTS: readonly (readonly [Pt, Pt])[] = [
  [{ x: 66, y: 100 }, { x: 76, y: 100 }], [{ x: 60, y: 206 }, { x: 70, y: 206 }],
  [{ x: 120, y: 206 }, { x: 130, y: 206 }], [{ x: 125, y: 100 }, { x: 135, y: 100 }],
]
/** Next to the cat's morning spot on the barn step. */
const CAT_SIDE: Pt = { x: 62, y: 80 }

/** Go somewhere, do something there for as long as the slot allows, and be home with 16 beats to spare. */
const away = (p: Pen, end: number, home: Pt, to: Pt, act: (p: Pen, beats: number) => void, approach?: Pt): void => {
  if (approach) { trip(p, approach); line(p, to, 1, 'walk') } else trip(p, to)
  const beats = Math.floor((end - p.t) / BEAT) - tripBeats(to, home) - 16
  act(p, Math.max(8, beats))
  trip(p, home)
}

/**
 * An idle crab's slot as an actor: a one-shot on farm time from the slot's start, from home and back home, its
 * hat by the season, a bubble when it naps or chats. Its meaningful spot, for a still picture, is home.
 */
export const idleActor = (crab: Crab, plot: number, seed: number, now: Ms, ft: Ft, ctx: IdleCtx): Actor => {
  const slot = idleSlot(crab, ft)
  const s0 = slot * SLOT_MS
  const end = s0 + SLOT_MS
  const h = home(plot)
  const kind = idleRoutine(crab, seed, now, ft, ctx)
  const p = pen(h, s0)
  const r = (k: string): number => roll(seed, crab.stepId, slot, k)
  const pause = 8 * (2 + Math.floor(r('pause') * 8))
  let bubble: IconId | undefined

  switch (kind) {
    case 'rest': hold(p, SLOT_BEATS, 'sit'); break
    case 'sleep': case 'nap': hold(p, SLOT_BEATS, 'sleep'); bubble = 'zzz'; break
    case 'shelter': hold(p, SLOT_BEATS, 'sit', 'umbrella'); break
    case 'sharpen': hold(p, SLOT_BEATS, 'work', 'hoe'); break
    case 'watch':
      hold(p, pause * 4, 'sit'); hold(p, 48, 'look'); hold(p, 32, 'stand')
      break
    case 'tend':
      hold(p, pause, 'sit')
      trip(p, rowSpot(plot, 0))
      for (const k of [0, 1, 2]) {
        if (k) line(p, rowSpot(plot, k), 1, 'walk')
        hold(p, 40, 'work')
      }
      trip(p, h)
      break
    case 'wander': {
      const places: Pt[] = [
        ...WANDER_ALWAYS.map(l => spot(l, plot)),
        ...WANDER_BUILT.filter(id => isBuilt(id, ctx.owned)).map(l => spot(l, plot)),
      ].filter(q => q.x !== h.x || q.y !== h.y)
      const to = places[Math.floor(r('to') * places.length)] ?? h
      hold(p, pause, 'sit')
      away(p, end, h, to, (q, beats) => { const look = Math.min(beats, 80 + 8 * Math.floor(r('look') * 20)); hold(q, look, 'look') })
      break
    }
    case 'fish': {
      const to = isBuilt('jetty', ctx.owned) ? spot('jetty', plot) : spot('pond', plot)
      hold(p, pause, 'sit')
      away(p, end, h, to, (q, beats) => {
        // A catch about every 5 minutes: in three slots out of five.
        if (r('catch') < 0.6 && beats > 64) {
          const first = 8 * Math.floor((beats - 16) / 16)
          hold(q, first, 'sit', 'rod'); hold(q, 16, 'cheer'); hold(q, beats - first - 16, 'sit', 'rod')
        } else hold(q, beats, 'sit', 'rod')
      })
      break
    }
    case 'lunch': case 'sunset':
      hold(p, pause, 'sit')
      away(p, end, h, spot('bench', plot), (q, beats) => hold(q, beats, 'sit'))
      break
    case 'hens':
      hold(p, pause, 'sit')
      away(p, end, h, spot('coop', plot), (q, beats) => { hold(q, Math.min(beats, 64), 'work', 'basket'); hold(q, Math.min(32, Math.max(0, beats - 64)), 'stand') })
      break
    case 'cat':
      hold(p, pause, 'sit')
      away(p, end, h, CAT_SIDE, (q, beats) => { hold(q, Math.min(beats, 32), 'work'); hold(q, Math.min(16, Math.max(0, beats - 32)), 'cheer') })
      break
    case 'scaffold':
      away(p, end, h, ctx.scaffold ?? h, (q, beats) => hold(q, beats, 'work', 'hammer'))
      break
    case 'chat': {
      const two = [...ctx.travellers].sort()
      const isLeft = two[0] === crab.stepId
      const spots = CHAT_SPOTS[Math.floor(roll(seed, 'chat-at', slot) * CHAT_SPOTS.length)] ?? CHAT_SPOTS[0] as readonly [Pt, Pt]
      const at = isLeft ? spots[0] : spots[1]
      // The last pixel of the way is a step towards the other crab, so the two face each other.
      const approach = { x: at.x + (isLeft ? -1 : 1), y: at.y }
      away(p, end, h, at, (q, beats) => hold(q, beats, 'stand'), approach)
      bubble = r('bubble') < 0.5 ? 'heart' : 'dots'
      break
    }
  }
  hold(p, (end - p.t) / BEAT, 'sit')

  const a: Actor = { id: `c${plot}`, kind: 'crab', frames: CRAB_FRAMES, legs: p.legs, clock: 'farm', still: h }
  if (bubble) a.bubble = bubble
  if (ctx.season) a.hat = hatOf(ctx.season, ctx.weather, now)
  return a
}

// ---- animals and critters ----

/** The hen run, as the rectangle their feet keep inside (the run is 86–106 × 48–58; a hen is 6 × 6). */
export const HEN_RUN = { x0: 89, y0: 54, x1: 103, y1: 58 } as const
/** The flower border, where the butterflies and the bees' meadow are (23–40 × 136–160). */
export const FLOWERS = { x0: 25, y0: 139, x1: 38, y1: 160 } as const
/** The pond's water (centre 50,219, rx 24, ry 11). */
export const POND = { cx: 50, cy: 219, rx: 24, ry: 11 } as const

/** A loop of the legs a pen wrote from 0, phase-locked to the wall clock with an offset seeded by its id. */
const loopActor = (id: string, kind: Actor['kind'], frames: Frames, p: Pen, seed: number, offset?: number, still?: Pt): Actor => {
  const period = p.t / 1000
  const a: Actor = {
    id, kind, frames, legs: p.legs, clock: 'wall',
    loop: { period, offset: offset ?? Math.round(roll(seed, 'loop', id) * period * 8) / 8 },
  }
  const first = p.legs[0]?.from
  if (still ?? first) a.still = still ?? first
  return a
}

/** A flock in a V: crosses the sky at 5 px per beat once a period, then flies home out of sight above the world. */
const vee = (prefix: string, kind: Actor['kind'], seed: number, periodBeats: number, holdBeats: number, ys: readonly number[], dir: 1 | -1): Actor[] => {
  const offset = Math.round(roll(seed, 'vee', prefix) * (periodBeats / 8)) / 1
  const back = [0, 6, 6, 12, 12]
  return ys.map((y, k) => {
    const x0 = dir === 1 ? -10 - (back[k] ?? 0) : 190 + (back[k] ?? 0)
    const x1 = x0 + 220 * dir
    const p = pen({ x: x0, y })
    hold(p, holdBeats, 'stand')
    line(p, { x: x1, y }, 5, 'walk')
    line(p, { x: x1, y: -20 }, 5, 'walk')
    line(p, { x: x0, y: -20 }, 5, 'walk')
    line(p, { x: x0, y }, 5, 'walk')
    hold(p, periodBeats - p.t / BEAT, 'stand')
    return loopActor(`${prefix}${k}`, kind, BIRD, p, seed, offset)
  })
}

type Group = { actors: Actor[]; moves: boolean; transient?: true }

/** The cat's sun patch moves with the day: the barn step in the morning, the bench at midday, a plot's edge after. */
export const catSpot = (step: SkyStep, minutes: number): Pt =>
  step === 'night' || step === 'predawn' || step === 'dusk' ? { x: 97, y: 70 }
    : minutes < 11 * 60 ? { x: 68, y: 80 } : minutes < 15 * 60 ? { x: 31, y: 91 } : { x: 93, y: 126 }

const animals = (seed: number, now: Ms, owned: number, sky: SkyStep, season: Season, wet: boolean): Group[] => {
  const out: Group[] = []
  const { minutes } = localTime(now)
  const mo = Number(localTime(now).date.slice(5, 7))

  // Hens peck round the run from morning to golden hour, dust-bathe at two, and stay in the coop in rain.
  if (isBuilt('coop', owned) && (sky === 'morning' || sky === 'day' || sky === 'golden') && !wet) {
    const isBath = minutes >= 14 * 60 && minutes < 15 * 60
    const hen = (stops: Pt[], peck: number): Pen => {
      const first = stops[0] as Pt
      const p = pen(first)
      if (isBath) return hold(p, 64, 'sit')
      stops.forEach((s, i) => { if (i) line(p, s, 1, 'walk'); hold(p, peck, 'work') })
      line(p, first, 1, 'walk')
      return p
    }
    const a = hen([{ x: 90, y: 55 }, { x: 98, y: 55 }, { x: 98, y: 58 }, { x: 90, y: 58 }].filter((_, i) => i !== 3), 64)
    // The rectangle's last corner is walked through, not pecked at.
    if (!isBath) { a.legs.splice(a.legs.length - 1, 1); a.t -= 8 * BEAT; line(a, { x: 90, y: 58 }, 1, 'walk'); line(a, { x: 90, y: 55 }, 1, 'walk') }
    const henA = loopActor('ah0', 'animal', HEN, a, seed)
    const b = hen([{ x: 96, y: 54 }, { x: 103, y: 54 }, { x: 103, y: 57 }], 80)
    if (!isBath) { b.legs.splice(b.legs.length - 1, 1); b.t -= 7 * BEAT; line(b, { x: 96, y: 57 }, 1, 'walk'); line(b, { x: 96, y: 54 }, 1, 'walk') }
    out.push({ actors: [henA], moves: !isBath }, { actors: [loopActor('ah1', 'animal', HEN, b, seed)], moves: !isBath })
    // Chicks in late spring, three in a line behind the first hen.
    if (season === 'spring' && mo !== 3 && mo !== 9 && henA.loop) {
      const chicks = [0, 1, 2].map(k => ({
        ...henA, id: `ak${k}`, frames: CHICK,
        loop: { period: henA.loop?.period ?? 1, offset: (henA.loop?.offset ?? 0) - 0.5 * (k + 1) },
      }))
      out.push({ actors: chicks, moves: !isBath })
    }
  }

  // The cat sleeps in its sun patch, breathing, its tail flicking on a 9 s loop.
  if (isBuilt('cat', owned)) {
    out.push({ actors: [loopActor('act', 'animal', CAT, hold(pen(catSpot(sky, minutes)), 72, 'sleep'), seed)], moves: false })
  }

  // Crows at dawn: on two plot edges, or perched on the scarecrow once it stands. A hop every 90 s.
  if ((sky === 'sunrise' || sky === 'morning') && !wet) {
    const perch = isBuilt('scarecrow', owned) ? [{ x: 25, y: 111 }, { x: 35, y: 111 }] : [{ x: 70, y: 193 }, { x: 124, y: 193 }]
    out.push({
      actors: perch.map((q, k) => {
        const p = pen(q)
        hold(p, 600, 'stand'); line(p, { x: q.x, y: q.y - 2 }, 1, 'cheer'); line(p, q, 1, 'cheer'); hold(p, 116, 'stand')
        return loopActor(`aw${k}`, 'animal', CROW, p, seed)
      }),
      moves: false,
    })
  }

  // Frogs on the pond's bank on spring and summer evenings, hopping on a 6 s loop.
  if ((season === 'spring' || season === 'summer') && (sky === 'golden' || sky === 'sunset' || sky === 'dusk')) {
    out.push({
      actors: [{ x: 28, y: 212 }, { x: 29, y: 224 }].map((q, k) => {
        const p = pen(q)
        hold(p, 40, 'stand'); line(p, { x: q.x + 2, y: q.y }, 1, 'cheer'); hold(p, 4, 'stand'); line(p, q, 1, 'cheer')
        return loopActor(`ag${k}`, 'animal', FROG, p, seed)
      }),
      moves: false,
    })
  }
  return out
}

const critters = (seed: number, now: Ms, owned: number, sky: SkyStep, season: Season, weather: Weather, wet: boolean): Group[] => {
  const out: Group[] = []
  const { minutes } = localTime(now)
  const isDay = sky === 'morning' || sky === 'day' || sky === 'golden'
  const isFlowerHours = minutes >= 9 * 60 && minutes < 18 * 60

  // A flock of five crosses the sky in 5 s once every 450 s, in the day and dry.
  if (isDay && !wet) out.push({ actors: vee('af', 'critter', seed, 3600, 3400, [30, 25, 35, 20, 40], 1), moves: true, transient: true })

  // Two butterflies figure-of-eight over the flowers in spring and summer, 09:00 to 18:00, dry.
  if ((season === 'spring' || season === 'summer') && isFlowerHours && !wet) {
    out.push({
      actors: [{ x: 27, y: 144 }, { x: 28, y: 152 }].map((b, k) => {
        const p = pen(b)
        for (let i = 0; i < 2; i++) {
          hold(p, 128, 'stand')
          for (const [dx, dy] of [[4, 0], [4, -4], [8, -4], [8, 0], [4, 0], [4, 4], [0, 4], [0, 0]] as const) {
            line(p, { x: b.x + dx, y: b.y + dy }, 1, 'walk')
          }
        }
        return loopActor(`ay${k}`, 'critter', BUTTERFLY, p, seed, (k * 20 + Math.floor(roll(seed, 'ay') * 40)) % 40)
      }),
      moves: true, transient: true,
    })
  }

  // Bees between the hive and the flowers, 09:00 to 18:00, never in rain or winter: 12 s, 4 s apart.
  if (isBuilt('hive', owned) && isFlowerHours && !wet && season !== 'winter') {
    const base = Math.floor(roll(seed, 'ab') * 12)
    out.push({
      actors: [0, 1, 2].map(k => {
        const p = pen({ x: 126, y: 60 })
        line(p, { x: 126, y: 148 }, 4, 'walk'); line(p, { x: 30, y: 148 }, 4, 'walk'); hold(p, 4, 'work')
        line(p, { x: 126, y: 148 }, 4, 'walk'); line(p, { x: 126, y: 60 }, 4, 'walk')
        return loopActor(`ab${k}`, 'critter', BEE, p, seed, (base + 4 * k) % 12)
      }),
      moves: true, transient: true,
    })
  }

  // A fish jumps in the pond once every 67 s in daylight, leaving a ripple; out of sight below the world otherwise.
  if (isDaylight(sky)) {
    const off = { x: 44, y: 262 }, at = { x: 44, y: 222 }
    const p = pen(off)
    hold(p, 522, 'stand'); line(p, at, 40, 'cheer'); line(p, { x: 44, y: 218 }, 2, 'cheer'); line(p, at, 2, 'cheer')
    hold(p, 8, 'look'); line(p, off, 40, 'stand')
    out.push({ actors: [loopActor('afi', 'critter', FISH, p, seed, undefined, at)], moves: true, transient: true })
  }

  // Bats round the barn roof at summer dusk: 6 s, 2 s apart.
  if (season === 'summer' && sky === 'dusk') {
    out.push({
      actors: [0, 1, 2].map(k => {
        const p = pen({ x: 40, y: 24 })
        for (const q of [{ x: 72, y: 24 }, { x: 72, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 24 }]) line(p, q, 2, 'walk')
        hold(p, 10, 'stand')
        return loopActor(`at${k}`, 'critter', BAT, p, seed, 2 * k)
      }),
      moves: true, transient: true,
    })
  }

  // Falling leaves on windy autumn days: from above the world to below it, zig-zagging, then home out of sight.
  if (season === 'autumn' && weather?.kind === 'windy' && weather.from <= now && now < weather.to) {
    out.push({
      actors: [44, 100, 150].map((x, k) => {
        const p = pen({ x, y: -6 })
        for (let i = 0; i < 8; i++) {
          line(p, { x: p.at.x, y: p.at.y + 32 }, 4, 'walk')
          line(p, { x: i % 2 ? x : x + 4, y: p.at.y }, 4, 'walk')
        }
        line(p, { x, y: 262 }, 12, 'walk'); line(p, { x: -20, y: 262 }, 300, 'walk')
        line(p, { x: -20, y: -6 }, 300, 'walk'); line(p, { x, y: -6 }, 300, 'walk')
        return loopActor(`al${k}`, 'critter', LEAF, p, seed, 3 * k)
      }),
      moves: true, transient: true,
    })
  }

  // Cloud shadows cross the farm every 3½ minutes while it is cloudy or raining.
  if (weather && (weather.kind === 'cloudy' || weather.kind === 'rain') && weather.from <= now && now < weather.to) {
    out.push({
      actors: [70, 160].map((y, k) => {
        const p = pen({ x: -14, y })
        hold(p, 1469, 'stand'); line(p, { x: 194, y }, 1, 'walk')
        line(p, { x: 194, y: -20 }, 300, 'walk'); line(p, { x: -14, y: -20 }, 300, 'walk'); line(p, { x: -14, y }, 300, 'walk')
        return loopActor(`acl${k}`, 'critter', CLOUD, p, seed, 100 * k)
      }),
      moves: true, transient: true,
    })
  }
  return out
}

/** Shooting stars on clear nights, one about every 10 minutes, three every 2 minutes in a meteor shower. */
const stars = (seed: number, sky: SkyStep, wet: boolean, isShower: boolean): Group[] => {
  if (sky !== 'night' || wet) return []
  const n = isShower ? 3 : 1
  const period = isShower ? 960 : 4800
  return [{
    actors: Array.from({ length: n }, (_, k) => {
      const y = 10 + 6 * k + Math.floor(roll(seed, 'as', k) * 4), x0 = 40 + 24 * k
      const p = pen({ x: -10, y })
      hold(p, period - 10, 'stand'); line(p, { x: x0, y }, 300, 'stand'); line(p, { x: x0 + 48, y }, 8, 'walk')
      line(p, { x: x0 + 48, y: -10 }, 300, 'stand'); line(p, { x: -10, y: -10 }, 300, 'stand'); line(p, { x: -10, y }, 300, 'stand')
      return loopActor(`as${k}`, 'critter', STAR, p, seed, (k * period) / (8 * n))
    }),
    moves: true, transient: true,
  }]
}

/** The actors of the day's events: the owl, the fox, the geese and the visitor of the day. */
const eventActors = (seed: number, owned: number, events: readonly string[]): Group[] => {
  const out: Group[] = []
  const has = (id: string): boolean => events.includes(id)
  if (has('owl')) {
    const q = isBuilt('scarecrow', owned) ? { x: 30, y: 105 } : { x: 120, y: 65 }
    out.push({ actors: [loopActor('eow', 'event', OWL, hold(hold(pen(q), 40, 'stand'), 8, 'look'), seed)], moves: false })
  }
  if (has('fox')) {
    const q = { x: 176, y: 206 }
    const p = pen(q)
    hold(p, 144, 'stand'); line(p, { x: 120, y: 206 }, 1, 'walk'); hold(p, 64, 'look'); line(p, q, 1, 'walk')
    out.push({ actors: [loopActor('efx', 'event', FOX, p, seed, undefined, { x: 120, y: 206 })], moves: true })
  }
  if (has('geese')) out.push({ actors: vee('ege', 'event', seed, 360, 200, [25, 20, 30, 15, 35], -1), moves: true, transient: true })
  const visitor = events.find(e => e.startsWith('visitor:'))?.slice(8)
  const crab = (q: Pt, pose: Pose, prop?: Prop, bubble?: IconId): Actor => {
    const p = pen(q)
    hold(p, 48, pose, prop); hold(p, 16, pose === 'cheer' ? 'stand' : 'look', prop)
    const a = loopActor('evi', 'event', CRAB_FRAMES, p, seed)
    a.hat = 'hat_straw'
    a.hue = hash32(seed, visitor ?? '') % 360
    if (bubble) a.bubble = bubble
    return a
  }
  if (visitor === 'merchant') out.push({ actors: [crab({ x: 156, y: 206 }, 'stand', 'crate')], moves: false })
  if (visitor === 'neighbour') out.push({ actors: [crab({ x: 150, y: 206 }, 'stand', undefined, 'heart')], moves: false })
  if (visitor === 'musician') out.push({ actors: [crab({ x: 30, y: 100 }, 'cheer')], moves: false })
  if (visitor === 'pigeon') {
    const q = isBuilt('mailbox', owned) ? { x: 153, y: 190 } : { x: 160, y: 200 }
    out.push({ actors: [loopActor('evi', 'event', BIRD, hold(hold(pen(q), 40, 'stand'), 8, 'look'), seed)], moves: false })
  }
  return out
}

/** A group drawn in place: every actor holds the pose of its first leg at its first point, over the same loop. */
const inPlace = (g: Group): Group => ({
  ...g,
  moves: false,
  actors: g.actors.map(a => {
    const first = a.legs[0]
    const period = a.loop?.period ?? 0
    if (!first || !a.loop) return a
    return { ...a, legs: [{ t0: 0, beats: Math.max(1, Math.round((period * 1000) / BEAT)), from: first.from, to: first.from, pose: first.pose }] }
  }),
})

/**
 * Every animal, critter and event actor on the farm at a moment, as wall-clock loops. Only shipped builds bring
 * their animals. Motion thins them: under `full` at most six groups walk (a flock is one); under `calm` two, and
 * no particles; under `still` only those that stay put, drawn at their spots. Event actors are not counted.
 */
export const ambientActors = (
  seed: number, now: Ms, owned: number, sky: SkyStep, season: Season, weather: Weather, motion: Motion,
  events: readonly string[] = [],
): Actor[] => {
  const wet = isWet(weather, now)
  const life = [...animals(seed, now, owned, sky, season, wet), ...critters(seed, now, owned, sky, season, weather, wet),
    ...stars(seed, sky, wet, events.includes('meteors'))]
  const cap = motion === 'full' ? 6 : motion === 'calm' ? 2 : 0
  let walking = 0
  const kept: Group[] = []
  for (const g of life) {
    if (g.transient && motion !== 'full') continue
    if (!g.moves) { kept.push(g); continue }
    if (walking < cap) { walking++; kept.push(g); continue }
    if (!g.transient) kept.push(inPlace(g))
  }
  const ev = eventActors(seed, owned, events)
    .filter(g => !(g.transient && motion !== 'full'))
    .map(g => (g.moves && motion !== 'full' ? inPlace(g) : g))
  return [...kept, ...ev].flatMap(g => g.actors)
}

/** Where an idle crab is now, for a job that cuts in on its routine (so the new trip starts there, never jumps). */
export const idlePoint = (crab: Crab, plot: number, seed: number, now: Ms, ft: Ft, ctx: IdleCtx): Pt => {
  const legs = idleActor(crab, plot, seed, now, ft, ctx).legs
  let pt = home(plot)
  for (const leg of legs) {
    if (leg.t0 > ft) break
    const k = Math.min(leg.beats, Math.floor((ft - leg.t0) / BEAT))
    const len = Math.abs(leg.to.x - leg.from.x) + Math.abs(leg.to.y - leg.from.y)
    const d = leg.beats ? Math.round((len * k) / leg.beats) : len
    pt = len === 0 ? leg.to : {
      x: leg.from.x + Math.sign(leg.to.x - leg.from.x) * d, y: leg.from.y + Math.sign(leg.to.y - leg.from.y) * d,
    }
  }
  return pt
}

/** The plot area a crab may tend without travelling: its plot, its home beside it and the path between. */
export const plotArea = (plot: number): { x0: number; y0: number; x1: number; y1: number } => {
  const p = PLOTS[Math.min(Math.max(plot, 0), 5)] ?? { x: 57, y: 109 }
  return { x0: p.x - 8, y0: p.y - 1, x1: p.x + 30, y1: p.y + 16 }
}
