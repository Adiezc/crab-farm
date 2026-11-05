import { expect, test } from 'claude-code/testing'
import type { Actor, DrawList } from '../contracts'
import type { Bank, Crab, Job, Live, Step, Totals } from '../../types'
import { enqueue } from '../model/jobs'
import { PADS, home, resolve, route } from '../model/layout'
import { RESIDENT, crabName, crabNames } from '../model/names'
import { MODEL_BAND, MODEL_HUE, actorParts, modelOfHue, presentOf } from './anim'
import { NARROW_VIEW, termCamera } from './camera'
import { hoverSvg } from './overlay'
import { OWN_BASE, rasterFrame, termLines } from './raster'
import type { TermArt } from './raster'
import { sceneOf } from './scene'
import { TARGET, farmSvg } from './svg'
import { PROJECT_PLOT, projectName, projectSign } from './text'

// ---- fixtures: a farm at T0, built with the real model ----

const T0 = Date.UTC(2026, 10, 4, 14, 30)
const totals = (o: Partial<Totals> = {}): Totals => ({ coins: 0, harvests: 0, calls: 0, crates: 0, helpers: 0, golden: 0, trips: {}, ...o })
const bank = (o: Partial<Bank> = {}): Bank => ({ v: 2, seed: 12345, bornAt: T0 - 20 * 86_400_000, others: totals(), owned: 4, builtAt: {}, days: 9, syncedAt: 0, ...o })
const live = (o: Partial<Live> = {}): Live => ({
  rev: 1, turn: { isWorking: false, text: '', hadTools: false }, clock: { pausedMs: 0 },
  plan: { source: 'plan', rev: 1, steps: [], seats: [null, null, null, null, null, null] }, crabs: [], helpers: [], fx: [], tasks: 1, seq: 100,
  earn: { ...totals(), day: '2026-11-04', callsToday: 0, harvestsToday: 0, shown: 0 }, ...o,
})
const step = (name: string, status: Step['status']): Step => ({
  id: `n:0:${name}`, name, status, calls: status === 'pending' ? 0 : 6,
  ...(status !== 'pending' ? { startedAt: T0 - 9 * 60_000, lastAt: T0 - 20_000 } : {}),
  ...(status === 'completed' ? { doneAt: T0 - 3 * 60_000, paid: true as const } : {}),
})
const crabAt = (stepId: string, plot: number, ft: number): Crab => ({ stepId, plot, anchor: { ft, pt: home(plot) }, jobs: [], restSince: ft })

/** Three steps, the second in progress and watering at the well while the turn works; two helpers on its plot. */
const busy = (o: Partial<Live> = {}): Live => {
  const steps = [step('Read the source', 'completed'), step('Rework the plots', 'in_progress'), step('Ship it', 'pending')]
  const r = resolve('water', 1, 9)
  const job: Job = { n: 1, kind: 'water', t0: T0 - 3_000, to: r.to, land: r.land, isOpen: true, count: 1, tool: 'Bash', note: 'npm test' }
  const worker = enqueue(crabAt(steps[1]!.id, 1, T0 - 20_000), job, T0 - 3_000, home(1), route)
  return live({
    turn: { isWorking: true, text: 'go', hadTools: true, startedAt: T0 - 600_000 },
    plan: { source: 'plan', rev: 2, steps, seats: [steps[0]!.id, steps[1]!.id, steps[2]!.id, null, null, null] },
    crabs: [crabAt(steps[0]!.id, 0, T0 - 300_000), worker, crabAt(steps[2]!.id, 2, T0 - 300_000)],
    helpers: [0, 1].map(k => ({ id: `a${k}`, stepId: steps[1]!.id, plot: 1, slot: k, label: `explore ${k}`, model: 'sonnet' as const, since: T0 - 60_000, crates: 1 })),
    tasks: 2, ...o,
  })
}
const OPTS = { motion: 'full' as const, surface: 'desktop' as const, hemisphere: 'north' as const, tz: 'UTC' }
const scene = (l: Live, b: Bank = bank({ owned: 9 }), now = T0): DrawList => sceneOf(l, b, now, OPTS)
const crabs = (dl: DrawList): Actor[] => dl.actors.filter(a => a.kind === 'crab')

// ---- crab names ----

test('each crab\'s card opens with its name, and the same farm names it the same every time', async () => {
  const l = busy()
  const names = crabNames(12345, l.plan.steps.map(s => s.id))
  const dl = scene(l)
  const card = dl.zones.find(z => z.id === 'p1')
  expect(card?.lines[0]).toBe(`${names[1]?.toUpperCase()} · 2/3 REWORK THE PLOTS`)
  expect(scene(l, bank({ owned: 9 }), T0 + 60_000).zones.find(z => z.id === 'p1')?.lines[0]).toBe(card?.lines[0])
  // Another farm, other names.
  const other = sceneOf(l, bank({ owned: 9, seed: 999 }), T0, OPTS).zones.find(z => z.id === 'p1')?.lines[0]
  expect(other?.endsWith('· 2/3 REWORK THE PLOTS')).toBe(true)
})

test('with no plan the farmhand has a card with its name, the same in every session of the farm', async () => {
  const dl = scene(live(), bank())
  const card = dl.zones.find(z => z.id === 'r0')
  expect(card?.lines).toEqual([`${crabName(12345, RESIDENT).toUpperCase()} · THE FARMHAND`, 'WAITING FOR A PROMPT'])
  expect(scene(live({ rev: 9 }), bank({ syncedAt: T0 })).zones.find(z => z.id === 'r0')?.lines[0]).toBe(card?.lines[0])
  // Once there is a plan, the farmhand's card goes.
  expect(scene(busy()).zones.some(z => z.id === 'r0')).toBe(false)
})

test('the terminal\'s status line names the crab at work, shrinking the step before the name, and the name before the job', async () => {
  const dl = scene(busy())
  const name = crabNames(12345, busy().plan.steps.map(s => s.id))[1] as string
  const [, wide] = termLines(dl, 120)
  expect(wide?.startsWith(`▸ ${name} · Rework the plots · watering (Bash)`)).toBe(true)
  expect(wide?.endsWith('working')).toBe(true)
  // Room for the name, the job and ten letters of the step: the step's name shrinks.
  const [, mid] = termLines(dl, 43 + Array.from(name).length)
  expect(mid?.startsWith(`▸ ${name} · Rework th`)).toBe(true)
  expect(mid?.includes('…')).toBe(true)
  expect(mid?.includes('watering (Bash)')).toBe(true)
  // Less than that: the name goes, the job stays.
  const [, narrow] = termLines(dl, 40)
  expect(narrow?.includes(name)).toBe(false)
  expect(narrow?.includes('watering (Bash)')).toBe(true)
  expect(narrow?.endsWith('working')).toBe(true)
  // While Claude asks, the line names the tool once and says so at the end.
  const asking = busy()
  const [, ask] = termLines(scene({ ...asking, asking: { since: T0 - 4_000, tool: 'Bash' }, clock: { pausedMs: 0, pauseFrom: T0 - 4_000 } }), 120)
  expect(ask?.match(/needs your OK/g)?.length).toBe(1)
  expect(ask?.includes('Bash')).toBe(true)
  // The farmhand when there is no plan.
  const [, idle] = termLines(scene(live(), bank()), 80)
  expect(idle).toBe(`▸ ${crabName(12345, RESIDENT)} · your move`)
})

// ---- the project's sign ----

test('a project name is spelled as its words that fit, dashes and underscores as spaces', async () => {
  expect(projectName('crab-farm')).toBe('CRAB FARM')
  expect(projectName('my_api')).toBe('MY API')
  expect(projectName('billing-web-app')).toBe('BILLING')
  expect(projectName('supercalifragilistic')).toBe('SUPERCALI')
  expect(projectName('café.v2')).toBe('CAFE V2')
  expect(projectSign('')).toBe(undefined)
})

test('the project sign stands by the gate, inside the narrow crop, clear of the mailbox and the lanes', async () => {
  for (const name of ['api', 'crab-farm', 'supercalifragilistic']) {
    const s = projectSign(name)
    if (!s) throw new Error('no sign')
    expect(s.x).toBeGreaterThanOrEqual(NARROW_VIEW.x)
    expect(s.x + s.w).toBeLessThanOrEqual(NARROW_VIEW.x + NARROW_VIEW.w)
    expect(s.y + s.h + 3).toBeLessThanOrEqual(NARROW_VIEW.y + NARROW_VIEW.h)
    // Below the south lane (y 206), so walkers never cross it, and below the mailbox's pad.
    const [, my, , mh] = PADS.mailbox
    expect(s.y).toBeGreaterThan(206)
    expect(s.y).toBeGreaterThan(my + mh)
  }
})

test('the project\'s name is painted on the sign and its card, and nothing is drawn without one', async () => {
  const dl = scene(busy({ project: 'crab-farm' }))
  expect(dl.signs).toContainEqual({ plot: PROJECT_PLOT, text: 'crab-farm', isCurrent: false })
  expect(dl.zones.find(z => z.id === 'proj')?.lines).toEqual(['CRAB-FARM', 'THE PROJECT'])
  const { svg } = farmSvg(dl)
  const without = farmSvg(scene(busy())).svg
  expect(svg.length).toBeGreaterThan(without.length)
  expect(svg.includes('href="#gF"')).toBe(true)
  expect(scene(busy()).signs.some(s => s.plot === PROJECT_PLOT)).toBe(false)
  expect(hoverSvg(dl).includes('THE PROJECT')).toBe(true)
})

test('the terminal paints the project sign as a wooden block by the gate', async () => {
  const art: TermArt = {
    palette: [0x5f8f3a],
    layer: (layer, s) => {
      const w = Math.ceil(180 / s), h = Math.ceil(250 / s)
      return { w, h, px: new Uint8Array(w * h).fill(layer === 'bg' ? 0 : 255) }
    },
    sprite: () => undefined,
  }
  const cam = termCamera(90, 70)
  const sign = projectSign('crab-farm')
  if (!sign) throw new Error('no sign')
  const at = (dl: DrawList, wx: number, wy: number): number => {
    const { cells } = rasterFrame(dl, cam, art)
    const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
    const s = cam.s
    const col = Math.round(wx / s) - Math.round(cam.view.x / s)
    const py = Math.round(wy / s) - Math.round(cam.view.y / s)
    const k = ((py >> 1) * cam.cols + col) * 12 + ((py & 1) ? 8 : 4)
    return (bytes[k] ?? 0) | ((bytes[k + 1] ?? 0) << 8) | ((bytes[k + 2] ?? 0) << 16)
  }
  const wood = 0x9b6b3f
  const midX = sign.x + sign.w / 2
  expect(at(scene(busy({ project: 'crab-farm' })), midX, sign.y + 2)).toBe(wood)
  expect(at(scene(busy()), midX, sign.y + 2)).not.toBe(wood)
  expect(OWN_BASE).toBeLessThan(255)
})

// ---- the model's hat band ----

test('the crab the model drives wears its colour on its hat band; resting crabs and an unknown model do not', async () => {
  const working = crabs(scene(busy({ model: 'opus' })))
  const driven = working.filter(a => a.hue !== undefined)
  expect(driven.length).toBe(1)
  expect(driven[0]?.hue).toBe(MODEL_HUE.opus)
  expect(crabs(scene(busy())).some(a => a.hue !== undefined)).toBe(false)
  const stopped = busy({ model: 'opus' })
  stopped.turn = { ...stopped.turn, isWorking: false, outcome: 'aborted' }
  expect(crabs(scene(stopped)).some(a => a.hue !== undefined)).toBe(false)
})

test('a band is drawn in the model\'s colours inside every pose group, so it moves with the hat', async () => {
  for (const m of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    expect(modelOfHue(MODEL_HUE[m])).toBe(m)
    expect(modelOfHue(MODEL_HUE[m] + 360)).toBe(m)
  }
  const dl = scene(busy({ model: 'haiku' }))
  const crab = crabs(dl).find(a => a.hue !== undefined)
  if (!crab) throw new Error('no driven crab')
  const parts = actorParts(crab, dl.now, dl.ft, 'full', id => id)
  const bands = parts.svg.match(/<g class="mb">/g) ?? []
  const hats = parts.svg.match(/href="#hat_/g) ?? []
  expect(bands.length).toBe(hats.length)
  expect(parts.svg.includes(MODEL_BAND.haiku[1])).toBe(true)
  // The band sits on the hat: inside the group the hat is in, never on its own.
  expect(/href="#hat_[a-z]+"[^>]*\/><g class="mb">/.test(parts.svg)).toBe(true)
  const { svg } = farmSvg(dl)
  expect(svg.includes(MODEL_BAND.haiku[0])).toBe(true)
  expect(farmSvg(scene(busy())).svg.includes(MODEL_BAND.haiku[0])).toBe(false)
})

// ---- the picture ----

test('a busy farm with every extra stays under the size the governor aims for, at full detail', async () => {
  const dl = scene(busy({ model: 'fable', project: 'crab-farm' }), bank({ owned: 12, others: totals({ coins: 2_950, harvests: 230 }) }))
  const { svg, lod } = farmSvg(dl)
  expect(svg.length).toBeLessThanOrEqual(TARGET)
  expect(lod).toBe(0)
  expect(farmSvg(dl, { narrow: true }).svg.length).toBeLessThanOrEqual(TARGET)
})

test('the first level of detail drops critters that are out of sight just now', async () => {
  const flock: Actor = {
    id: 'af0', kind: 'critter', clock: 'wall', frames: { walk: ['bird_0', 'bird_1'], stand: ['bird_0', 'bird_0'] },
    loop: { period: 450, offset: 0 },
    legs: [{ t0: 0, beats: 40, from: { x: -20, y: 30 }, to: { x: 200, y: 30 }, pose: 'walk' }, { t0: 5_000, beats: 3560, from: { x: -20, y: 30 }, to: { x: -20, y: 30 }, pose: 'stand' }],
  }
  const dl = scene(busy())
  const away = { ...dl, actors: [flock], now: Math.ceil(T0 / 450_000) * 450_000 + 100_000 }
  expect(presentOf(flock, away.now, away.ft, 'full').pt.x).toBe(-20)
  const at0 = farmSvg({ ...away, lod: 0 }).svg
  const at1 = farmSvg({ ...away, lod: 1 }).svg
  const birds = (svg: string): number => (svg.match(/@keyframes [a-z]+\d+m\{/g) ?? []).length
  expect(birds(at0)).toBe(1)
  expect(birds(at1)).toBe(0)
  // While it crosses, it stays.
  const crossing = { ...away, now: Math.ceil(T0 / 450_000) * 450_000 + 2_000 }
  expect(birds(farmSvg({ ...crossing, lod: 1 }).svg)).toBe(1)
})

test('a sleeping crab\'s bubble comes down with its hat', async () => {
  const sleeper = (pose: 'sleep' | 'stand'): Actor => ({
    id: 'z', kind: 'crab', clock: 'farm', hat: 'hat_straw', bubble: 'zzz',
    frames: { stand: ['crab_stand', 'crab_stand'], sleep: ['crab_sleep', 'crab_sleep'] },
    legs: [{ t0: T0 - 1_000, beats: 80, from: { x: 50, y: 121 }, to: { x: 50, y: 121 }, pose }],
  })
  const lift = (pose: 'sleep' | 'stand'): number => {
    const dl = { ...scene(live(), bank()), actors: [sleeper(pose)] }
    const m = /<g transform="translate\(0 (-?\d+)\)">/.exec(farmSvg(dl).svg)
    return Number(m?.[1])
  }
  expect(lift('sleep')).toBeGreaterThan(lift('stand'))
})

test('a crab walking to an errand is drawn at the depth of its errand, in front of the mailbox it posts at', async () => {
  const walker: Actor = {
    id: 'w', kind: 'crab', clock: 'farm', hat: 'hat_straw', frames: { walk: ['crab_walk1', 'crab_walk2'], carry: ['crab_carry1', 'crab_carry2'] },
    legs: [
      { t0: T0 - 1_000, beats: 40, from: { x: 152, y: 170 }, to: { x: 152, y: 204 }, pose: 'walk' },
      { t0: T0 - 1_000 + 40 * 125, beats: 16, from: { x: 152, y: 204 }, to: { x: 152, y: 204 }, pose: 'carry', prop: 'letter', isOpen: true },
    ],
  }
  const base = scene(live(), bank())
  const dl = { ...base, actors: [walker], statics: [{ sprite: 'mailbox' as const, at: { x: 150, y: 190 } }] }
  const { svg } = farmSvg(dl)
  // The mailbox's symbol is used before the walker's mover group.
  const mailbox = svg.indexOf('<use href="#i0"')
  const crab = svg.indexOf('class="w0m"')
  expect(mailbox).toBeGreaterThan(0)
  expect(crab).toBeGreaterThan(mailbox)
})

test('by day a crab below a sign passes in front of it; after dark the signs are drawn over everything', async () => {
  const crab: Actor = {
    id: 's', kind: 'crab', clock: 'farm', hat: 'hat_straw', frames: { stand: ['crab_stand', 'crab_stand'] },
    legs: [{ t0: T0 - 1_000, beats: 80, from: { x: 70, y: 142 }, to: { x: 70, y: 142 }, pose: 'stand' }],
  }
  const day = { ...scene(busy()), actors: [crab] }
  const night = { ...day, sky: 'night' as const }
  const order = (dl: DrawList): number => {
    const { svg } = farmSvg(dl)
    return Math.sign(svg.indexOf('fill="#f6e7c1"') - svg.indexOf('transform="translate(140 284)"'))
  }
  expect(order(day)).toBe(-1)
  expect(order(night)).toBe(1)
})
