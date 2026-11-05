// The farm's places: where everything stands, the lanes the crabs walk, the build pads, and the routes between them.
// All in world px (180 × 250). Points are feet. Lanes are axis-aligned, so every step lands on a whole pixel.

import { SHIPPED_BUILDS } from '../contracts'
import type { JobKind, LandmarkId, Pt, ResolveFn, RouteFn, UnlockId } from '../contracts'

const pt = (x: number, y: number): Pt => ({ x, y })

// ---- plots and the places that belong to each ----

/** The six plots' top-left corners (art.ts LAYOUT.plots), each 30 × 16. */
export const PLOTS: readonly Pt[] = [pt(57, 109), pt(109, 109), pt(57, 143), pt(109, 143), pt(57, 177), pt(109, 177)]
export const PLOT_W = 30
export const PLOT_H = 16

const plotAt = (plot: number): Pt => PLOTS[Math.min(Math.max(Math.trunc(plot), 0), 5)] ?? pt(57, 109)
/** Each column of plots has its own north–south path on its left, through the homes. */
const columnX = (plot: number): number => (plotAt(plot).x === 57 ? 50 : 102)

/** Where a plot's crab rests: left of its plot, 1.2's spot. */
export const home = (plot: number): Pt => { const p = plotAt(plot); return pt(p.x - 7, p.y + 12) }
/** The crop row a crab works, k 0 to 2, along the plot's top edge. */
export const rowSpot = (plot: number, k: number): Pt => { const p = plotAt(plot); return pt(p.x + 6 + 9 * clampK(k), p.y + 1) }
/** A helper's place on top of the plot, k 0 to 2. */
export const slotSpot = (plot: number, k: number): Pt => { const p = plotAt(plot); return pt(p.x + 8 + 9 * clampK(k), p.y) }
/** Beside the plot's sign, where a crab hammers its stake. */
export const signSpot = (plot: number): Pt => { const p = plotAt(plot); return pt(columnX(plot), p.y + 25) }
/** On the east lane level with the plot: scouting the fence line. */
export const fenceSpot = (plot: number): Pt => pt(147, plotAt(plot).y + 8)
const clampK = (k: number): number => Math.min(Math.max(Math.trunc(k), 0), 2)

// ---- fixed landmarks ----

export const BARN_DOOR = pt(56, 80)
export const BARN_IN = pt(56, 76)
/** The crate stack's drop point (stack 87–106 × 59–78). */
export const YARD = pt(96, 80)
export const POND = pt(66, 206)
export const GATE = pt(156, 206)
const EAVES = [pt(40, 80), pt(72, 80)] as const

/** Every landmark's stand point; the ones that depend on the plot are functions of it. */
export const LANDMARKS: Readonly<Record<LandmarkId, Pt | ((plot: number, k?: number) => Pt)>> = {
  home, row: (plot, k) => rowSpot(plot, k ?? 1), fence: fenceSpot, sign: signSpot,
  barnDoor: BARN_DOOR, barnIn: BARN_IN,
  eave: plot => EAVES[plotAt(plot).x === 57 ? 0 : 1],
  yard: YARD, pond: POND, compost: pt(38, 190), lookout: pt(120, 80), stump: pt(40, 166), shade: pt(30, 100), gate: GATE,
  coop: pt(97, 50), barrel: pt(84, 78), mailbox: pt(152, 204), bench: pt(30, 96), well: pt(93, 99), jetty: pt(72, 214),
  windmill: pt(146, 99), orchard: pt(158, 124),
  // later builds (2.1): stand points on the network already, so their routes are ready
  paddock: pt(158, 176), market: pt(140, 206), greenhouse: pt(117, 206), cart: GATE, telescope: pt(158, 100),
  hayloft: BARN_DOOR, gazebo: pt(30, 100),
}

/** A landmark's stand point for a plot. */
export const spot = (land: LandmarkId, plot: number, k?: number): Pt => {
  const l = LANDMARKS[land]
  return typeof l === 'function' ? l(plot, k) : l
}

// ---- build pads ----

/** The ladder's order (progress.ts LADDER): build i stands once owned > i and i < SHIPPED_BUILDS. */
export const BUILD_ORDER: readonly UnlockId[] = [
  'scarecrow', 'coop', 'barrel', 'mailbox', 'bench', 'cat', 'flowers', 'hive', 'well', 'jetty', 'windmill', 'orchard',
  'cow', 'market', 'ducks', 'greenhouse', 'sheep', 'lamps', 'vane', 'pumpkins', 'cart', 'telescope', 'hayloft', 'green',
]
/** Whether a build is standing (and drawn, and routed to) with `owned` builds bought. */
export const isBuilt = (id: UnlockId, owned: number): boolean => {
  const i = BUILD_ORDER.indexOf(id)
  return i >= 0 && i < Math.min(owned, SHIPPED_BUILDS)
}

/**
 * Each build's rectangle [x, y, w, h], top-left. Moved from the spec where the referee test asked (see layout.test.ts):
 * mailbox 1 px west, orchard/cow/sheep 1 px east of the clearing lane, gazebo 1 px off the barn, cart 2 px off the
 * south lane, lamps (first post here, all four in LAMP_POSTS) off the column paths.
 */
export const PADS: Readonly<Record<UnlockId, readonly [number, number, number, number]>> = {
  scarecrow: [22, 104, 16, 22], coop: [88, 26, 22, 22], barrel: [81, 64, 6, 9], mailbox: [150, 190, 6, 10],
  bench: [23, 86, 14, 7], cat: [64, 75, 8, 5], flowers: [23, 136, 17, 24], hive: [122, 50, 8, 9], well: [86, 80, 14, 17],
  jetty: [66, 214, 14, 5], windmill: [138, 52, 16, 32], orchard: [161, 102, 15, 44], cow: [161, 150, 15, 52],
  market: [130, 209, 20, 18], ducks: [34, 213, 32, 12], greenhouse: [106, 209, 22, 18], sheep: [161, 150, 15, 52],
  lamps: [46, 84, 4, 14], vane: [53, 15, 7, 9], pumpkins: [82, 210, 22, 10], cart: [152, 210, 16, 12],
  telescope: [162, 80, 10, 14], hayloft: [31, 18, 50, 14], green: [20, 75, 18, 21],
}
export const LAMP_POSTS: readonly (readonly [number, number, number, number])[] = [
  [46, 84, 4, 14], [106, 84, 4, 14], [150, 84, 4, 14], [42, 192, 4, 14],
]
/** Where crabs gather for a build's ribbon-cutting: a point on the paths next to it. */
export const STANDS: Readonly<Record<UnlockId, Pt>> = {
  scarecrow: pt(30, 100), coop: pt(97, 50), barrel: pt(84, 78), mailbox: pt(152, 204), bench: pt(30, 96), cat: pt(64, 80),
  flowers: pt(50, 148), hive: pt(120, 80), well: pt(93, 99), jetty: pt(72, 214), windmill: pt(146, 99), orchard: pt(158, 124),
  cow: pt(158, 176), market: pt(140, 206), ducks: POND, greenhouse: pt(117, 206), sheep: pt(158, 176), lamps: pt(50, 100),
  vane: BARN_DOOR, pumpkins: pt(93, 206), cart: GATE, telescope: pt(158, 100), hayloft: BARN_DOOR, green: pt(30, 100),
}

// ---- lanes and spurs ----

type Seg = readonly [Pt, Pt]
/** The lanes of spec 3.1, with the west and centre lanes moved onto the two columns of homes (x 50 and 102). */
export const LANES: readonly Seg[] = [
  [pt(22, 100), pt(158, 100)],   // walkway
  [pt(50, 206), pt(156, 206)],   // south lane
  [pt(50, 100), pt(50, 206)],    // west lane, through the left homes
  [pt(102, 80), pt(102, 206)],   // centre lane, through the right homes, up to the yard
  [pt(147, 100), pt(147, 206)],  // east lane, the fence line
  [pt(56, 80), pt(56, 100)],     // barn spur
  [pt(158, 100), pt(158, 204)],  // clearing lane (east band, used once the orchard opens it)
]
/** Short legs from a lane to a landmark. Dead ends, so no route cuts through them. */
const SPURS: readonly Seg[] = [
  [pt(40, 80), pt(72, 80)],      // along the barn front: eaves and the door
  [BARN_DOOR, BARN_IN],
  [YARD, pt(108, 80)],           // yard to the centre lane, on to the coop path
  [pt(108, 80), pt(108, 50)], [pt(108, 50), pt(97, 50)],   // round the crate stack to the hen run
  [pt(120, 80), pt(120, 100)],   // lookout rock
  [pt(84, 78), pt(84, 100)],     // rain barrel, west of the well
  [pt(93, 99), pt(93, 100)],     // well pump
  [pt(30, 96), pt(30, 100)],     // bench
  [pt(146, 99), pt(146, 100)],   // windmill
  [pt(38, 190), pt(50, 190)],    // compost heap
  [pt(40, 166), pt(50, 166)],    // stump
  [pt(72, 206), pt(72, 214)],    // jetty
  [pt(152, 204), pt(152, 206)],  // mailbox
  // each plot's row line (its top edge) and helpers' line (just above), from its column path
  ...PLOTS.flatMap((p, i): Seg[] => [
    [pt(columnX(i), p.y + 1), pt(p.x + 24, p.y + 1)],
    [pt(columnX(i), p.y), pt(p.x + 26, p.y)],
  ]),
]
const SEGS: readonly Seg[] = [...LANES, ...SPURS]

// ---- the graph: every segment end and crossing is a node ----

const key = (p: Pt): string => `${p.x},${p.y}`
const onSeg = (p: Pt, [a, b]: Seg): boolean =>
  a.x === b.x ? p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
    : p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
const crossing = ([a, b]: Seg, [c, d]: Seg): Pt | undefined => {
  const isH1 = a.y === b.y, isH2 = c.y === d.y
  if (isH1 === isH2) return undefined
  const p = isH1 ? pt(c.x, a.y) : pt(a.x, c.y)
  return onSeg(p, [a, b]) && onSeg(p, [c, d]) ? p : undefined
}
const dist = (a: Pt, b: Pt): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

type Graph = { nodes: Map<string, Pt>; edges: Map<string, { to: string; len: number }[]>; segNodes: Pt[][] }

const build = (): Graph => {
  const segNodes: Pt[][] = SEGS.map(s => [s[0], s[1]])
  SEGS.forEach((s, i) => SEGS.forEach((t, j) => {
    if (i === j) return
    const c = crossing(s, t)
    if (c) segNodes[i]?.push(c)
    for (const end of t) if (onSeg(end, s)) segNodes[i]?.push(end)
  }))
  const nodes = new Map<string, Pt>()
  const edges = new Map<string, { to: string; len: number }[]>()
  const link = (a: Pt, b: Pt): void => {
    const ka = key(a), kb = key(b)
    if (ka === kb) return
    nodes.set(ka, a); nodes.set(kb, b)
    edges.set(ka, [...(edges.get(ka) ?? []), { to: kb, len: dist(a, b) }])
    edges.set(kb, [...(edges.get(kb) ?? []), { to: ka, len: dist(a, b) }])
  }
  const sorted = segNodes.map(ns => {
    const uniq = [...new Map(ns.map(n => [key(n), n])).values()]
    return uniq.sort((p, q) => p.x - q.x || p.y - q.y)
  })
  for (const ns of sorted) for (let k = 1; k < ns.length; k++) link(ns[k - 1] as Pt, ns[k] as Pt)
  return { nodes, edges, segNodes: sorted }
}
const GRAPH = build()

/** Where an outside point joins the network: itself if it lies on a path, else a straight leg to the nearest path. */
const joins = (p: Pt): { via?: Pt; nodes: Pt[] } => {
  if (GRAPH.nodes.has(key(p))) return { nodes: [p] }
  for (const ns of GRAPH.segNodes) {
    for (let k = 1; k < ns.length; k++) {
      const a = ns[k - 1] as Pt, b = ns[k] as Pt
      if (onSeg(p, [a, b])) return { nodes: [a, b] }
    }
  }
  // Off the paths (should not happen for anything the farm plans): drop straight onto the nearest lane.
  let best: { via: Pt; d: number } | undefined
  for (const [a, b] of LANES) {
    const foot = a.x === b.x
      ? (p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y) ? pt(a.x, p.y) : undefined)
      : (p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) ? pt(p.x, a.y) : undefined)
    if (foot && (!best || dist(p, foot) < best.d)) best = { via: foot, d: dist(p, foot) }
  }
  const via = best?.via ?? BARN_DOOR
  return { via, nodes: joins(via).nodes }
}

const shortest = (from: Pt, to: Pt): Pt[] => {
  const a = joins(from), b = joins(to)
  const startCost = new Map<string, number>()
  const head = a.via ?? from
  for (const n of a.nodes) startCost.set(key(n), dist(from, head) + dist(head, n))
  const ends = new Map<string, number>()
  const tail = b.via ?? to
  for (const n of b.nodes) ends.set(key(n), dist(n, tail) + dist(tail, to))
  // Both on the same stretch of path: walk straight along it.
  const shared = a.nodes.length === 2 && b.nodes.length === 2 && !a.via && !b.via &&
    key(a.nodes[0] as Pt) === key(b.nodes[0] as Pt) && key(a.nodes[1] as Pt) === key(b.nodes[1] as Pt)
  if (shared) return [from, to]
  // Dijkstra over about a hundred nodes.
  const cost = new Map(startCost)
  const prev = new Map<string, string>()
  const done = new Set<string>()
  let best: { k: string; c: number } | undefined
  for (;;) {
    let k: string | undefined, c = Infinity
    for (const [n, v] of cost) if (!done.has(n) && v < c) { k = n; c = v }
    if (k === undefined) break
    done.add(k)
    const end = ends.get(k)
    if (end !== undefined && (!best || c + end < best.c)) best = { k, c: c + end }
    if (best && c >= best.c) break
    for (const e of GRAPH.edges.get(k) ?? []) {
      const nc = c + e.len
      if (nc < (cost.get(e.to) ?? Infinity)) { cost.set(e.to, nc); prev.set(e.to, k) }
    }
  }
  if (!best) return [from, to]
  const mid: Pt[] = []
  for (let k: string | undefined = best.k; k !== undefined; k = prev.get(k)) {
    mid.unshift(GRAPH.nodes.get(k) as Pt)
  }
  return [from, ...(a.via ? [a.via] : []), ...mid, ...(b.via ? [b.via] : []), to]
}

/** Drops repeated points and the middle of straight runs: only the corners are left. */
const corners = (path: Pt[]): Pt[] => {
  const out: Pt[] = []
  for (const p of path) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    const before = out[out.length - 2]
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}

const CACHE = new Map<string, Pt[]>()
/** The shortest way along the paths, as corner points from `from` to `to`; every leg is straight and whole-pixel. */
export const route: RouteFn = (from, to) => {
  const a = pt(Math.round(from.x), Math.round(from.y)), b = pt(Math.round(to.x), Math.round(to.y))
  const k = `${key(a)}>${key(b)}`
  const hit = CACHE.get(k)
  if (hit) return hit.map(p => ({ ...p }))
  const path = a.x === b.x && a.y === b.y ? [a] : corners(shortest(a, b))
  if (CACHE.size > 4000) CACHE.clear()
  CACHE.set(k, path)
  return path.map(p => ({ ...p }))
}

/** A path's length in px. */
export const lengthOf = (path: readonly Pt[]): number =>
  path.reduce((n, p, i) => n + (i ? dist(path[i - 1] as Pt, p) : 0), 0)

/** The worn-path ids a walk covers: one per stretch of path between two nodes it travels along. */
export const segmentsOf = (path: Pt[]): string[] => {
  const ids: string[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Pt, b = path[i] as Pt
    for (const ns of GRAPH.segNodes) {
      for (let k = 1; k < ns.length; k++) {
        const p = ns[k - 1] as Pt, q = ns[k] as Pt
        if (onSeg(p, [a, b]) && onSeg(q, [a, b])) ids.push(`${key(p)}-${key(q)}`)
      }
    }
  }
  return [...new Set(ids)]
}

// ---- where a job goes ----

const has = (id: UnlockId, owned: number): boolean => isBuilt(id, owned)
const at = (land: LandmarkId, plot: number, k?: number): { land: LandmarkId; to: Pt } => ({ land, to: spot(land, plot, k) })

/** The nearest standing water for a plot: the pond, the rain barrel (#3) or the well (#9). */
const water = (plot: number, owned: number): { land: LandmarkId; to: Pt } => {
  const h = home(plot)
  const best = (['pond', 'barrel', 'well'] as const)
    .filter(l => l === 'pond' || has(l, owned))
    .map(l => ({ l, n: lengthOf(route(h, spot(l, plot))) }))
    .reduce((a, b) => (b.n < a.n ? b : a))
  return at(best.l, plot)
}

/**
 * Every stop of a job, in order: a fetch first where the spec chains one ("barnDoor → row"), then where the act holds.
 * Upgrades take the newest standing build of the chain (mailbox over gate, windmill over the barn's hand crank).
 */
export const stops = (kind: JobKind, plot: number, owned: number): { land: LandmarkId; to: Pt }[] => {
  switch (kind) {
    case 'inspect': case 'till': case 'sprinkle': return [at('row', plot, 1)]
    case 'scout': return [at('fence', plot)]
    case 'sow': return [at('barnDoor', plot), at('row', plot, 1)]
    case 'pots': return [at('eave', plot)]
    case 'water': return [water(plot, owned), at('row', plot, 1)]
    case 'mill': return [has('windmill', owned) ? at('windmill', plot) : at('barnDoor', plot)]
    case 'deliver': case 'hire': case 'bell': case 'alarm': return [at('barnDoor', plot)]
    case 'pack': return [at('row', plot, 2), at('yard', plot)]
    case 'ship': return [at('yard', plot), at('gate', plot)]
    case 'post': return [has('mailbox', owned) ? at('mailbox', plot) : at('gate', plot)]
    case 'lookout': return [at('lookout', plot)]
    case 'trade': case 'backfield': return [at('gate', plot)]
    case 'stake': case 'blueprint': return [at('sign', plot)]
    case 'almanac': return [has('bench', owned) ? at('bench', plot) : at('stump', plot)]
    case 'watch': return [at('stump', plot)]
    case 'tinker': return [at('barnDoor', plot), at('barnIn', plot)]
    case 'harvest': return [at('row', plot, 0)]
    case 'haul': return [at('yard', plot)]
    case 'compost': return [at('compost', plot), at('barnDoor', plot)]
    case 'arrive': return [at('home', plot)]
    case 'leave': return [at('barnDoor', plot), at('barnIn', plot)]
    case 'basket': return has('coop', owned) ? [at('coop', plot), at('barnDoor', plot)] : [at('barnDoor', plot)]
    case 'muster': return [muster(plot, owned)]
  }
}

/** The newest standing build's gathering point, for its ribbon-cutting. */
const muster = (plot: number, owned: number): { land: LandmarkId; to: Pt } => {
  const i = Math.min(owned, SHIPPED_BUILDS) - 1
  const id = BUILD_ORDER[i]
  return id ? { land: 'home', to: STANDS[id] } : at('home', plot)
}

/** Where a job goes: its first stop (the one the crab walks to from home). */
export const resolve: ResolveFn = (kind, plot, owned) => stops(kind, plot, owned)[0] ?? at('home', plot)
