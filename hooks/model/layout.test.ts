import { expect, test } from 'claude-code/testing'
import { SHIPPED_BUILDS } from '../contracts'
import type { JobKind, LandmarkId, Pt, UnlockId } from '../contracts'
import { LADDER } from './progress'
import {
  BUILD_ORDER, LAMP_POSTS, LANDMARKS, LANES, PADS, PLOTS, STANDS, YARD, home, isBuilt, lengthOf, resolve, route, rowSpot,
  segmentsOf, slotSpot, spot, stops,
} from './layout'

type Rect = readonly [number, number, number, number]
const hits = (a: Rect, b: Rect): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

// What already has a job on the map (design/game/padmap.py): the barn, the board, the pond, and each plot's own things.
const FIXED: Record<string, Rect> = {
  barn: [31, 30, 50, 45], board: [110, 5, 64, 43], pond: [26, 208, 48, 22],
  ...Object.fromEntries(PLOTS.flatMap((p, i) => [
    [`plot${i}`, [p.x, p.y, 30, 16]], [`crab${i}`, [p.x - 15, p.y - 6, 16, 18]],
    [`sign${i}`, [p.x, p.y + 18, 40, 8]], [`help${i}`, [p.x + 3, p.y - 8, 27, 8]],
  ])),
}
// A lane keeps 2 px either side clear: a pad must stand 3 px or more from its line.
const laneRect = ([a, b]: readonly [Pt, Pt]): Rect => [
  Math.min(a.x, b.x) - 2, Math.min(a.y, b.y) - 2, Math.abs(a.x - b.x) + 5, Math.abs(a.y - b.y) + 5,
]
// The overlaps the design means: the loft over the barn with the vane on it, the bench under the gazebo,
// the jetty and ducks on the pond, cow and sheep sharing the east paddock.
const ALLOWED = new Set(['hayloft/barn', 'hayloft/vane', 'green/bench', 'jetty/pond', 'ducks/pond', 'cow/sheep'])
const allowed = (a: string, b: string): boolean => ALLOWED.has(`${a}/${b}`) || ALLOWED.has(`${b}/${a}`)

const pads = (): [string, Rect][] => [
  ...(Object.entries(PADS) as [UnlockId, Rect][]),
  ...LAMP_POSTS.slice(1).map((r, i): [string, Rect] => [`lamps${i + 2}`, r]),
]

test('every pad is inside the world and clear of plots, signs, homes, the board, lanes and other pads', async () => {
  const problems: string[] = []
  const all = pads()
  for (const [id, r] of all) {
    if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > 180 || r[1] + r[3] > 250) problems.push(`${id} outside the world`)
    for (const [f, fr] of Object.entries(FIXED)) if (hits(r, fr) && !allowed(id, f)) problems.push(`${id} hits ${f}`)
    LANES.forEach((l, i) => { if (hits(r, laneRect(l))) problems.push(`${id} hits lane ${i}`) })
  }
  all.forEach(([a, ra], i) => all.slice(i + 1).forEach(([b, rb]) => {
    if (hits(ra, rb) && !allowed(a.replace(/\d+$/, ''), b.replace(/\d+$/, ''))) problems.push(`${a} hits ${b}`)
  }))
  expect(problems).toEqual([])
})

test('the build order is the ladder order', async () => {
  expect(LADDER.map(row => row.id)).toEqual([...BUILD_ORDER])
  expect(isBuilt('scarecrow', 0)).toBe(false)
  expect(isBuilt('scarecrow', 1)).toBe(true)
  expect(isBuilt('orchard', 12)).toBe(true)
  // Past the shipped builds nothing stands, however many are owned.
  expect(isBuilt('cow', 24)).toBe(false)
  expect(BUILD_ORDER.filter(id => isBuilt(id, 24)).length).toBe(SHIPPED_BUILDS)
})

// Every place a crab may be sent, for every plot and row.
const places = (): Pt[] => {
  const out: Pt[] = []
  for (const [, l] of Object.entries(LANDMARKS)) {
    if (typeof l !== 'function') { out.push(l); continue }
    for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) out.push(l(i, k))
  }
  for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) out.push(slotSpot(i, k))
  out.push(...Object.values(STANDS))
  return [...new Map(out.map(p => [`${p.x},${p.y}`, p])).values()]
}

const inPlot = (p: Pt): boolean => PLOTS.some(q => p.x >= q.x && p.x < q.x + 30 && p.y >= q.y + 2 && p.y < q.y + 16)

test('every pair of places is routed along straight whole-pixel legs that never cross a plot', async () => {
  const all = places()
  const problems: string[] = []
  for (const a of all) {
    for (const b of all) {
      const path = route(a, b)
      const first = path[0], last = path[path.length - 1]
      if (!first || !last || first.x !== a.x || first.y !== a.y || last.x !== b.x || last.y !== b.y) problems.push(`ends ${a.x},${a.y}>${b.x},${b.y}`)
      for (let i = 1; i < path.length; i++) {
        const p = path[i - 1] as Pt, q = path[i] as Pt
        if (p.x !== q.x && p.y !== q.y) problems.push(`diagonal ${p.x},${p.y}>${q.x},${q.y}`)
        if (![p.x, p.y, q.x, q.y].every(Number.isInteger)) problems.push('not whole px')
        const n = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
        for (let s = 0; s <= n; s++) {
          const c = { x: p.x + Math.sign(q.x - p.x) * s, y: p.y + Math.sign(q.y - p.y) * s }
          if (inPlot(c)) { problems.push(`through a plot at ${c.x},${c.y} on ${a.x},${a.y}>${b.x},${b.y}`); break }
        }
      }
    }
  }
  expect(problems.slice(0, 5)).toEqual([])
  // A route is as long either way.
  expect(lengthOf(route(home(0), YARD))).toBe(lengthOf(route(YARD, home(0))))
})

test('route lengths match the design', async () => {
  expect(lengthOf(route(home(0), spot('barnDoor', 0)))).toBe(47)
  // The design says 31; the Manhattan distance is 33, the least any route can be.
  expect(lengthOf(route(home(4), spot('pond', 4)))).toBe(33)
  // Shorter than the design's 125: the right-hand homes have their own lane straight up to the yard.
  expect(lengthOf(route(home(5), YARD))).toBe(115)
  expect(lengthOf(route(home(1), spot('mailbox', 1)))).toBe(137)
  expect(route(home(2), home(2))).toEqual([home(2)])
})

test('a route from a point part-way along a path starts there and never doubles back', async () => {
  const path = route(home(5), YARD)
  const mid = { x: 102, y: 150 }
  const rest = route(mid, YARD)
  expect(rest[0]).toEqual(mid)
  expect(lengthOf(rest)).toBe(lengthOf(path) - 39)
  // From a crab's row to its home and back.
  expect(route(rowSpot(0, 2), home(0))).toEqual([rowSpot(0, 2), { x: 50, y: 110 }, home(0)])
})

const KINDS: JobKind[] = [
  'inspect', 'scout', 'till', 'sow', 'pots', 'water', 'sprinkle', 'mill', 'deliver', 'pack', 'ship', 'post', 'lookout', 'hire',
  'trade', 'stake', 'almanac', 'bell', 'alarm', 'watch', 'blueprint', 'backfield', 'tinker', 'harvest', 'haul', 'compost',
  'arrive', 'leave', 'basket', 'muster',
]

test('every job resolves to a place on the paths, and upgrades take over as they are built', async () => {
  const known = new Set(places().map(p => `${p.x},${p.y}`))
  for (const kind of KINDS) {
    for (let owned = 0; owned <= 24; owned++) {
      for (let plot = 0; plot < 6; plot++) {
        for (const s of stops(kind, plot, owned)) expect(known.has(`${s.to.x},${s.to.y}`)).toBe(true)
        expect(resolve(kind, plot, owned)).toEqual(stops(kind, plot, owned)[0] as { land: LandmarkId; to: Pt })
      }
    }
  }
  expect(resolve('water', 0, 0).land).toBe('pond')
  expect(resolve('water', 0, 3).land).toBe('barrel')
  expect(resolve('water', 0, 9).land).toBe('well')
  expect(resolve('water', 4, 12).land).toBe('pond')
  expect(resolve('post', 1, 3).land).toBe('gate')
  expect(resolve('post', 1, 4).land).toBe('mailbox')
  expect(resolve('mill', 1, 11).land).toBe('windmill')
  expect(resolve('almanac', 0, 4).land).toBe('stump')
  expect(resolve('almanac', 0, 5).land).toBe('bench')
  expect(resolve('lookout', 0, 24).land).toBe('lookout')
  expect(resolve('scout', 3, 0).to).toEqual({ x: 147, y: 151 })
  expect(resolve('muster', 0, 2).to).toEqual(STANDS.coop)
  expect(stops('sow', 2, 0).map(s => s.land)).toEqual(['barnDoor', 'row'])
})

test('worn-path ids are stable stretches of path and shared by both directions', async () => {
  const there = segmentsOf(route(home(0), spot('barnDoor', 0)))
  const back = segmentsOf(route(spot('barnDoor', 0), home(0)))
  expect(there.length).toBeGreaterThan(1)
  expect([...back].sort()).toEqual([...there].sort())
  expect(segmentsOf([home(0)])).toEqual([])
})
