// The farm's shared words: time, places, jobs, sprites, and the draw list every renderer reads.
// Every package codes against this file; it holds types and constants, and no logic beyond tiny helpers.

import type { Fx, Ft, JobKind, LandmarkId, Ms, Pt } from '../types'

// The state contract (types/index.d.ts) must stand alone, so the words it shares live there and are passed on here.
export type { Ft, JobKind, LandmarkId, Model, Ms, Pt, UnlockId } from '../types'

/** Every duration is a whole number of beats, so every move lands on a whole pixel. */
export const BEAT = 125
export const beat = (ms: number): number => Math.round(ms / BEAT) * BEAT

/** Builds whose art ships in this version; the ladder's later rows unlock when their art arrives. */
export const SHIPPED_BUILDS = 12

export type Motion = 'full' | 'calm' | 'still'
export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
export type Hemisphere = 'north' | 'south'

export type IconId = 'terminal' | 'scroll' | 'quill' | 'globe' | 'magnifier' | 'roster' | 'plan' | 'plug' | 'gear'
  | 'dots' | 'alert' | 'ask' | 'heart' | 'zzz' | 'book'

/** What a tool call becomes on the farm. */
export type ToolClass = { kind: JobKind; isOpen: boolean; note?: string; hue?: number; icon: IconId }

export type Pose = 'stand' | 'walk' | 'type' | 'think' | 'work' | 'carry' | 'sit' | 'sleep' | 'look' | 'cheer' | 'holdSign'
export type Prop = 'hoe' | 'can' | 'bucket' | 'magnifier' | 'sack' | 'crate' | 'letter' | 'basket' | 'book' | 'hammer'
  | 'lantern' | 'rod' | 'crank' | 'umbrella'

/** One straight move or one stay: from `t0` for `beats` beats, from one point to another in one pose. */
export type Leg = { t0: number; beats: number; from: Pt; to: Pt; pose: Pose; prop?: Prop; isOpen?: boolean }

/** A key of SPRITE_SIZES: the art package draws every one, the renderers place them by name. */
export type SpriteId = keyof typeof SPRITE_SIZES

/** Shortest route between two points along the lanes, as corner points from `from` to `to`. */
export type RouteFn = (from: Pt, to: Pt) => Pt[]
/** Where a job goes for a plot, given how many builds are owned: the first landmark of its chain that exists. */
export type ResolveFn = (kind: JobKind, plot: number, owned: number) => { land: LandmarkId; to: Pt }

export type Actor = {
  /** Short and unique within one picture: it prefixes the actor's CSS class names. */
  id: string
  kind: 'crab' | 'mini' | 'animal' | 'critter' | 'event'
  frames: Partial<Record<Pose, readonly [SpriteId, SpriteId]>>
  hat?: SpriteId
  /** A one-shot timeline, or one period of a loop. Times are farm or wall ms as `clock` says (loop legs from 0). */
  legs: Leg[]
  /** Seconds; absent for a one-shot. A loop's phase is (wall seconds + offset) mod period. */
  loop?: { period: number; offset: number }
  clock: 'farm' | 'wall'
  bubble?: IconId
  isAsking?: boolean
  /** Where it means to be, drawn there when motion is still. */
  still?: Pt
  /** Model colour for minis, MCP neighbour hue for traders. */
  hue?: number
}

/** A sprite drawn in place. `at` is its top-left corner in world px. */
export type Static = { sprite: SpriteId; at: Pt; opacity?: number; filter?: 'dry' | 'droop' | 'ghost'; flip?: boolean }

export type SkyStep = 'night' | 'predawn' | 'sunrise' | 'morning' | 'day' | 'golden' | 'sunset' | 'dusk'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Weather = { kind: 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'windy'; from: Ms; to: Ms } | null

export type Sign = { plot: number; text: string; isCurrent: boolean }
export type Board = { isWorking: boolean; isAsking: boolean; rows: [string, string][]; next?: { sprite: SpriteId; progress: number } }
/** A hover zone: a world rectangle [x, y, w, h] and the lines its card shows. */
export type Zone = { id: string; rect: readonly [number, number, number, number]; lines: string[] }

/** Everything one picture shows, built once and handed to each surface's renderer. */
export type DrawList = {
  now: Ms
  ft: Ft
  motion: Motion
  lod: number
  sky: SkyStep
  season: Season
  weather: Weather
  events: string[]
  statics: Static[]
  actors: Actor[]
  signs: Sign[]
  board: Board
  fx: Fx[]
  zones: Zone[]
  alt: string
}

/**
 * Every sprite the farm draws, with its size in world px (the art is drawn at twice that, HD).
 * Crabs are hatless; the hat is drawn over the head, HAT_DY (from art.ts) lifts it per pose.
 * Sprites stand on their bottom edge: an actor's feet are at its bottom centre.
 */
export const SPRITE_SIZES = {
  // the crab-Claude, 16 × 18
  crab_stand: [16, 18], crab_blink: [16, 18], crab_walk1: [16, 18], crab_walk2: [16, 18], crab_type: [16, 18],
  crab_sleep: [16, 18], crab_happy: [16, 18], crab_look: [16, 18], crab_armsup: [16, 18], crab_carry1: [16, 18],
  crab_carry2: [16, 18], crab_sit: [16, 18], crab_crouch: [16, 18], crab_reach: [16, 18],
  hat_straw: [16, 8], hat_beanie: [16, 8], hat_crown: [16, 8], hat_hood: [16, 8], scarf: [10, 4],
  // helpers, by model
  mini_haiku_0: [10, 8], mini_haiku_1: [10, 8], mini_haiku_carry: [10, 8],
  mini_sonnet_0: [10, 8], mini_sonnet_1: [10, 8], mini_sonnet_carry: [10, 8],
  mini_opus_0: [10, 8], mini_opus_1: [10, 8], mini_opus_carry: [10, 8],
  mini_fable_0: [10, 8], mini_fable_1: [10, 8], mini_fable_carry: [10, 8],
  laptop_0: [9, 7], laptop_1: [9, 7], laptop_2: [9, 7],
  // crops, 5 × 9
  crop_seed: [5, 9], crop_sprout: [5, 9], crop_grow_0: [5, 9], crop_grow_1: [5, 9], crop_grow_2: [5, 9],
  crop_ripe_0: [5, 9], crop_ripe_1: [5, 9], crop_ripe_2: [5, 9],
  // bubble icons, 8 × 8 (the bubble's frame is drawn in code)
  icon_terminal: [8, 8], icon_scroll: [8, 8], icon_quill: [8, 8], icon_globe: [8, 8], icon_magnifier: [8, 8],
  icon_roster: [8, 8], icon_plan: [8, 8], icon_plug: [8, 8], icon_gear: [8, 8], icon_dots: [8, 8],
  icon_alert: [8, 8], icon_ask: [8, 8], icon_heart: [8, 8], icon_zzz: [8, 8], icon_book: [8, 8],
  // held props; the _2 frames are the second half of a work cycle
  prop_hoe: [6, 10], prop_hoe_2: [8, 6], prop_can: [7, 6], prop_can_2: [8, 6], prop_bucket: [5, 5],
  prop_magnifier: [5, 5], prop_sack: [6, 7], prop_crate: [7, 6], prop_letter: [5, 4], prop_basket: [7, 6],
  prop_book: [5, 4], prop_hammer: [5, 5], prop_hammer_2: [5, 5], prop_lantern: [4, 6], prop_rod: [10, 12],
  prop_crank: [6, 6], prop_umbrella: [12, 8],
  // things on the ground
  crate: [7, 6], crate_full: [7, 6], crate_gold: [7, 6], coin_0: [5, 5], coin_1: [5, 5], coin_2: [5, 5], coin_3: [5, 5],
  basket_eggs: [7, 5], bale: [8, 6], compost_0: [12, 6], compost_1: [12, 8], compost_2: [12, 10],
  // effects
  dust_0: [6, 3], dust_1: [6, 3], splash_0: [6, 4], splash_1: [6, 4], drop: [2, 3], sparkle_0: [5, 5],
  sparkle_1: [5, 5], confetti_0: [8, 6], confetti_1: [8, 6], puddle: [8, 3], ripple: [8, 3],
  // animals and wildlife
  hen_0: [6, 6], hen_1: [6, 6], chick: [3, 3], cat_sleep: [8, 5], cat_sit: [6, 7], cat_walk_0: [8, 6], cat_walk_1: [8, 6],
  bird_0: [4, 3], bird_1: [4, 3], crow_0: [5, 4], crow_1: [5, 4], owl_0: [5, 6], owl_1: [5, 6], fox_0: [10, 6],
  fox_1: [10, 6], bee: [2, 2], butterfly_0: [3, 3], butterfly_1: [3, 3], fish_0: [4, 3], fish_1: [4, 3], frog: [3, 3],
  bat_0: [4, 2], bat_1: [4, 2],
  // weather
  cloud: [24, 10], leaf_0: [2, 2], leaf_1: [2, 2],
  // the first twelve builds, and what's built while they wait
  scarecrow: [16, 22], scarecrow_wave: [16, 22], coop: [22, 22], barrel: [6, 9], mailbox: [6, 10], mailbox_up: [6, 10],
  bench: [14, 7], flowers: [17, 24], hive: [8, 9], well: [14, 17], well_pump: [14, 17], jetty: [14, 5],
  windmill: [16, 32], blades: [22, 22], scaffold_0: [16, 16], scaffold_1: [16, 16], scaffold_2: [16, 16],
  snowman: [8, 10],
} as const satisfies Record<string, readonly [number, number]>

/** Terminal art: palette indices, row by row, 255 where nothing is drawn. */
export type TermLayer = { w: number; h: number; px: Uint8Array }

export const iconSprite = (icon: IconId): SpriteId => `icon_${icon}` as SpriteId
