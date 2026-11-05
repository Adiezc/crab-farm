import { expect, test } from 'claude-code/testing'
import {
  LADDER, addTotals, basketValue, bankOf, earnCall, earnHarvest, earnHelper, emptyEarn, emptyTotals, fold, ledgerKey,
  lifetimeOf, mergeLedger, migrate, nextBuild, owned, shippedOwned, uptoOf, writeLedger,
} from './progress'
import type { Ledger, StoreFarm } from './progress'
import { mulberry32 } from './rng'
import type { Earn, Step } from '../../types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = new Date(2026, 0, 5, 9).getTime()   // a Monday, 09:00 local

const step = (over: Partial<Step> = {}): Step => ({ id: 'n:0:write tests', name: 'write tests', status: 'completed', calls: 3, ...over })
const calls = (earn: Earn, n: number, now: number): Earn => {
  let e = earn
  for (let i = 0; i < n; i++) e = earnCall(e, now)
  return e
}

test('the ladder has 24 builds costing 19,240 coins, built the moment they are paid for', async () => {
  expect(LADDER.length).toBe(24)
  expect(LADDER.reduce((n, row) => n + row.cost, 0)).toBe(19_240)
  expect(new Set(LADDER.map(row => row.id)).size).toBe(24)
  expect(owned(0)).toBe(0)
  expect(owned(9)).toBe(0)
  expect(owned(10)).toBe(1)
  expect(owned(39)).toBe(1)
  expect(owned(40)).toBe(2)
  expect(owned(2190)).toBe(11)
  expect(owned(19_239)).toBe(23)
  expect(owned(19_240)).toBe(24)
  expect(owned(1e9)).toBe(24)
})

test('only the shipped builds are counted as drawn or shown as the next one', async () => {
  expect(shippedOwned(1e9)).toBe(12)
  expect(shippedOwned(450)).toBe(6)
  expect(nextBuild(0)).toEqual({ index: 0, id: 'scarecrow', cost: 10, progress: 0 })
  expect(nextBuild(25)).toEqual({ index: 1, id: 'coop', cost: 30, progress: 0.5 })
  expect(nextBuild(2190)?.id).toBe('orchard')
  expect(nextBuild(2790)).toBeUndefined()
  expect(nextBuild(1e9)).toBeUndefined()
})

test('tool calls pay 1 each for the first 100 of a day, then 1 per 4, and a new day starts again', async () => {
  const e100 = calls(emptyEarn(T0), 100, T0)
  expect(e100.coins).toBe(100)
  const e200 = calls(e100, 100, T0 + HOUR)
  expect(e200.coins).toBe(125)
  expect(e200.calls).toBe(200)
  expect(e200.callsToday).toBe(200)
  const next = earnCall(e200, T0 + DAY)
  expect(next.callsToday).toBe(1)
  expect(next.coins).toBe(126)
  expect(next.day).not.toBe(e200.day)
})

test('a finished step pays 10 once, needs some work, and pays 5 after 60 in a day', async () => {
  const e = emptyEarn(T0)
  const paid = earnHarvest(e, step(), T0)
  expect(paid.coins).toBe(10)
  expect(paid.earn.harvests).toBe(1)
  // Already paid, or no call and under a minute: nothing, and the very same earn back.
  expect(earnHarvest(e, step({ paid: true }), T0).earn).toBe(e)
  expect(earnHarvest(e, step({ calls: 0, startedAt: T0 - 30_000, doneAt: T0 }), T0)).toEqual({ earn: e, coins: 0 })
  expect(earnHarvest(e, step({ calls: 0, startedAt: T0 - 60_000, doneAt: T0 }), T0).coins).toBe(10)
  // A prompt step pays only if it used a tool.
  expect(earnHarvest(e, step({ id: 'p:t1', calls: 0, startedAt: T0 - 600_000 }), T0).coins).toBe(0)
  expect(earnHarvest(e, step({ id: 'p:t1', calls: 2 }), T0).coins).toBe(10)
  let day = e
  const coins: number[] = []
  for (let i = 0; i < 62; i++) {
    const r = earnHarvest(day, step({ id: `n:${i}:s` }), T0)
    day = r.earn
    coins.push(r.coins)
  }
  expect(coins.slice(0, 60).every(c => c === 10)).toBe(true)
  expect(coins.slice(60)).toEqual([5, 5])
  expect(earnHarvest(day, step({ id: 'n:99:s' }), T0 + DAY).coins).toBe(10)
})

test('a finished helper pays 2 and brings its crates', async () => {
  const e = earnHelper(emptyEarn(T0), 3)
  expect(e.coins).toBe(2)
  expect(e.helpers).toBe(1)
  expect(e.crates).toBe(3)
})

test('the dawn basket is 5 plus what the animals made, for at most 3 days', async () => {
  expect(basketValue(0, 1)).toBe(5)
  expect(basketValue(2, 1)).toBe(9)          // the hens
  expect(basketValue(8, 1)).toBe(12)         // hens and bees
  expect(basketValue(8, 3)).toBe(26)
  expect(basketValue(8, 30)).toBe(26)        // absence pays at most 3 days
  expect(basketValue(24, 1)).toBe(5 + 4 + 3 + 3 + 6 + 2 + 5)
})

// The pacing model (research/pacing2.py): 6-hour workdays, 5-day weeks, a month of 130 hours.
const pace = (perDay: { calls: number; steps: number; helpers: number }, checkpoints: number[]): number[] => {
  let earn = emptyEarn(T0)
  let baskets = 0
  const out: number[] = []
  const last = Math.max(...checkpoints)
  for (let hour = 0; hour < last; hour++) {
    const d = Math.floor(hour / 6)
    const h = hour % 6
    const now = T0 + d * DAY + h * HOUR
    if (h === 0) baskets += basketValue(owned(earn.coins + baskets), 1)
    const share = (n: number): number => Math.floor((n * (h + 1)) / 6) - Math.floor((n * h) / 6)
    earn = calls(earn, share(perDay.calls), now)
    for (let i = 0; i < share(perDay.steps); i++) earn = earnHarvest(earn, step({ id: `n:${hour}:${i}` }), now).earn
    for (let i = 0; i < share(perDay.helpers); i++) earn = earnHelper(earn, 1)
    if (checkpoints.includes(hour + 1)) out.push(owned(earn.coins + baskets))
  }
  return out
}

test('builds arrive at the pace of pacing2 for light, typical and heavy days, within one build', async () => {
  const at = [1, 6, 30, 130, 390]
  const profiles = [
    { perDay: { calls: 50, steps: 5, helpers: 0 }, want: [1, 3, 6, 11, 17] },
    { perDay: { calls: 150, steps: 15, helpers: 5 }, want: [2, 4, 9, 16, 23] },
    { perDay: { calls: 300, steps: 30, helpers: 15 }, want: [2, 6, 11, 19, 24] },
  ]
  for (const { perDay, want } of profiles) {
    const got = pace(perDay, at)
    got.forEach((n, i) => expect(Math.abs(n - (want[i] ?? 0))).toBeLessThanOrEqual(1))
  }
})

test('a 1.2 farmer with 31 harvests starts with 310 coins and 5 builds', async () => {
  const farm = migrate(31, 7, T0)
  const life = lifetimeOf(farm, [], {}, emptyTotals())
  expect(life.coins).toBe(310)
  expect(life.harvests).toBe(31)
  const bank = bankOf(farm, life, T0)
  expect(bank.owned).toBe(5)
  // One ceremony: every build of the gift is dated the same moment.
  expect(new Set(Object.values(bank.builtAt)).size).toBe(1)
  expect(Object.keys(bank.builtAt).length).toBe(5)
})

test('the 1.2 gift stops at 2,190 coins, and a missing or odd harvest gives nothing', async () => {
  const big = lifetimeOf(migrate(5000, 1, T0), [], {}, emptyTotals())
  expect(big.coins).toBe(2190)
  expect(owned(big.coins)).toBe(11)
  expect(lifetimeOf(migrate(undefined, 1, T0), [], {}, emptyTotals()).coins).toBe(0)
  expect(lifetimeOf(migrate('31', 1, T0), [], {}, emptyTotals()).coins).toBe(0)
  expect(lifetimeOf(migrate(-4, 1, T0), [], {}, emptyTotals()).coins).toBe(0)
})

const coins = (n: number): Earn => ({ ...emptyEarn(T0), coins: n, calls: n, callsToday: n })

test('a closed ledger is folded once, and folding again changes nothing', async () => {
  const farm = migrate(0, 1, T0)
  const led: Ledger = { v: 2, sid: 'a', at: T0, closedAt: T0, totals: { ...emptyTotals(), coins: 40 }, days: ['2026-01-05'] }
  const open: Ledger = { v: 2, sid: 'b', at: T0, totals: { ...emptyTotals(), coins: 7 }, days: ['2026-01-05'] }
  const before = lifetimeOf(farm, [led, open], {}, emptyTotals()).coins
  const once = fold(farm, [led, open], {}, T0 + HOUR)
  expect(once.farm.folded).toEqual(['led:a'])
  expect(once.farm.days).toBe(1)
  expect(once.deletable).toEqual([])
  expect(lifetimeOf(once.farm, [led, open], {}, emptyTotals()).coins).toBe(before)
  const twice = fold(once.farm, [led, open], {}, T0 + 2 * HOUR)
  expect(twice.farm).toBe(once.farm)
  expect(twice.deletable).toEqual(['led:a'])
  // An open ledger nobody wrote for two days is folded too; a basket after a week.
  const later = fold(once.farm, [open], { 'b:2026-01-05': 9 }, T0 + 9 * DAY)
  expect(later.farm.folded).toEqual(['led:a', 'led:b', 'b:2026-01-05'])
  expect(lifetimeOf(later.farm, [open], { 'b:2026-01-05': 9 }, emptyTotals()).coins).toBe(56)
})

test('a session coming back to a folded ledger starts a new one and never loses or repeats a coin', async () => {
  const first = writeLedger([], [], 's', coins(30), T0)
  expect(first && ledgerKey(first)).toBe('led:s')
  if (!first) return
  // Idle for three days: another session folds it.
  const farm = fold(migrate(0, 1, T0), [first], {}, T0 + 3 * DAY).farm
  const next = writeLedger([first], farm.folded, 's', coins(45), T0 + 3 * DAY)
  expect(next?.gen).toBe(T0 + 3 * DAY)
  expect(next?.totals.coins).toBe(15)
  if (!next) return
  expect(lifetimeOf(farm, [first, next], {}, emptyTotals()).coins).toBe(45)
  expect(uptoOf(next).coins).toBe(45)
  // A restarted session (earnings from zero) never writes less over what it had: it starts a new ledger.
  const restart = writeLedger([first], [], 's', coins(4), T0 + HOUR)
  expect(restart?.gen).toBeGreaterThan(0)
  expect(lifetimeOf(migrate(0, 1, T0), [first, ...(restart ? [restart] : [])], {}, emptyTotals()).coins).toBe(34)
  // Nothing new: no write.
  expect(writeLedger([first], [], 's', coins(30), T0 + HOUR)).toBeUndefined()
})

// ---- the fold under racing sessions, with the store as a shared map ----

type Sim = {
  sid: string; earn: Earn; lastWrite?: number; deficit: number
  read?: { ledgers: Ledger[]; baskets: Record<string, number>; now: number }
  fresh?: StoreFarm
  sweep?: string[]
  closed?: boolean
}

const runSim = (seed: number, ticks: number): void => {
  const r = mulberry32(seed)
  const store = new Map<string, unknown>()
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  store.set('farm2', migrate(3, 1, T0))
  const credited = new Map<string, number>()       // last written coins per ledger key
  let basketCoins = 0
  let lastLife = 0
  let now = T0
  let n = 0
  const sessions: Sim[] = []
  const ledgers = (): Ledger[] => [...store.entries()].filter(([k]) => k.startsWith('led:')).map(([, v]) => copy(v as Ledger))
  const baskets = (): Record<string, number> =>
    Object.fromEntries([...store.entries()].filter(([k]) => k.startsWith('b:')).map(([k, v]) => [k, v as number]))
  const farm = (): StoreFarm => copy(store.get('farm2') as StoreFarm)
  const flush = (s: Sim, isClosed: boolean): void => {
    const mine = ledgers().filter(l => l.sid === s.sid)
    const l = writeLedger(mine, farm().folded, s.sid, s.earn, now, isClosed)
    if (l) {
      store.set(ledgerKey(l), copy(l))
      credited.set(ledgerKey(l), l.totals.coins)
      const total = [...credited.entries()].filter(([k]) => k.startsWith(`led:${s.sid}`)).reduce((a, [, c]) => a + c, 0)
      // Every coin is credited, never twice; only a ledger left unwritten so long that it may have been folded and
      // swept can drop the few coins earned since its last write.
      const deficit = s.earn.coins - total
      expect(deficit).toBeGreaterThanOrEqual(0)
      if (s.lastWrite !== undefined && now - s.lastWrite <= 48 * HOUR) expect(deficit).toBe(s.deficit)
      s.deficit = deficit
    }
    s.lastWrite = now
  }
  for (let t = 0; t < ticks; t++) {
    now += Math.floor(r() * r() * 30 * HOUR)
    while (sessions.filter(s => !s.closed).length < 2 || (sessions.filter(s => !s.closed).length < 3 && r() < 0.05)) {
      sessions.push({ sid: `s${n++}`, earn: emptyEarn(now), deficit: 0 })
    }
    const live = sessions.filter(s => !s.closed || s.read || s.fresh || s.sweep)
    const s = live[Math.floor(r() * live.length)]
    if (!s) continue
    const roll = r()
    const midWrite = sessions.some(o => o.fresh)
    if (s.fresh) {
      // Phase one ends: the fold is re-run over the farm read a moment ago (a write in between is lost, as in a race).
      const result = fold(s.fresh, s.read?.ledgers ?? [], s.read?.baskets ?? {}, s.read?.now ?? now)
      store.set('farm2', copy(result.farm))
      s.sweep = result.deletable
      s.fresh = undefined
      s.read = undefined
    } else if (s.read) {
      s.fresh = farm()
    } else if (s.sweep && !midWrite) {
      // Phase two, later: remove what the store still lists as folded.
      const folded = new Set(farm().folded)
      for (const key of s.sweep) if (folded.has(key)) store.delete(key)
      s.sweep = undefined
    } else if (s.closed) {
      s.sweep = undefined
    } else if (roll < 0.45) {
      s.earn = { ...s.earn, coins: s.earn.coins + 1 + Math.floor(r() * 20), calls: s.earn.calls + 1, callsToday: s.earn.callsToday + 1 }
    } else if (roll < 0.7) {
      flush(s, false)
    } else if (roll < 0.8) {
      flush(s, true)
      s.closed = true
    } else if (roll < 0.9) {
      s.read = { ledgers: ledgers(), baskets: baskets(), now }
    } else if (roll < 0.95) {
      const key = `b:${new Date(now).toISOString().slice(0, 10)}`
      if (!store.has(key)) { store.set(key, 5); basketCoins += 5 }
    } else {
      s.closed = true   // crashed: never closes its ledger
    }
    const f = farm()
    const want = 30 + basketCoins + [...credited.values()].reduce((a, c) => a + c, 0)
    const life = lifetimeOf(f, ledgers(), baskets(), emptyTotals()).coins
    expect(life).toBe(want)
    expect(life).toBeGreaterThanOrEqual(lastLife)
    lastLife = life
    // Folding the store as it stands is idempotent.
    const once = fold(f, ledgers(), baskets(), now).farm
    expect(fold(once, ledgers(), baskets(), now).farm).toBe(once)
  }
}

test('the fold is idempotent and loses or repeats nothing while 2 or 3 sessions race over the store', async () => {
  for (let seed = 1; seed <= 12; seed++) runSim(seed, 300)
})

test('no earning or fold ever lowers lifetime coins', async () => {
  let e = emptyEarn(T0)
  let last = 0
  const r = mulberry32(5)
  for (let i = 0; i < 2000; i++) {
    const now = T0 + i * 20 * 60_000
    const x = r()
    e = x < 0.8 ? earnCall(e, now) : x < 0.95 ? earnHarvest(e, step({ id: `n:${i}:x` }), now).earn : earnHelper(e, 1)
    expect(e.coins).toBeGreaterThanOrEqual(last)
    last = e.coins
  }
  expect(addTotals(emptyTotals(), e).coins).toBe(e.coins)
})

test('finished steps pay most: a heavy day earns under 5 times a light one, and its steps out-earn its calls', async () => {
  const day = (callsN: number, steps: number, helpers: number): { all: number; calls: number } => {
    const byCalls = calls(emptyEarn(T0), callsN, T0)
    let e = byCalls
    for (let i = 0; i < steps; i++) e = earnHarvest(e, step({ id: `n:${i}:s` }), T0).earn
    for (let i = 0; i < helpers; i++) e = earnHelper(e, 1)
    return { all: e.coins, calls: byCalls.coins }
  }
  const light = day(50, 5, 0)
  const heavy = day(300, 30, 15)
  expect(light.all).toBe(100)
  expect(heavy.all).toBe(480)
  expect(heavy.all / light.all).toBeLessThan(5)
  expect(heavy.all - heavy.calls).toBeGreaterThan(heavy.calls)
})

test('only the shipped builds are dated, so a later version can still cut their ribbons', async () => {
  const bank = bankOf(migrate(0, 1, T0), { ...emptyTotals(), coins: 19_240 }, T0)
  expect(bank.owned).toBe(24)
  expect(Object.keys(bank.builtAt)).toEqual(LADDER.slice(0, 12).map(row => row.id))
  // Dates already stored are kept, never moved later.
  const farm = { ...migrate(0, 1, T0), builtAt: { scarecrow: T0 - DAY } }
  expect(bankOf(farm, { ...emptyTotals(), coins: 40 }, T0).builtAt).toEqual({ scarecrow: T0 - DAY, coop: T0 })
})

test('past 500 folded ids the oldest are forgotten, but never one whose key is still in the store', async () => {
  const old = Array.from({ length: 500 }, (_, i) => `led:old${i}`)
  const farm = { ...migrate(0, 1, T0), folded: old }
  const still: Ledger = { v: 2, sid: 'old0', at: T0, closedAt: T0, totals: { ...emptyTotals(), coins: 5 }, days: [] }
  const fresh: Ledger = { v: 2, sid: 'new', at: T0, closedAt: T0, totals: { ...emptyTotals(), coins: 7 }, days: [] }
  const { farm: next } = fold(farm, [still, fresh], {}, T0 + HOUR)
  expect(next.folded.length).toBe(500)
  expect(next.folded).toContain('led:old0')
  expect(next.folded).not.toContain('led:old1')
  expect(next.folded[next.folded.length - 1]).toBe('led:new')
  // The key still there is not counted again.
  expect(lifetimeOf(next, [still, fresh], {}, emptyTotals()).coins).toBe(7)
})

test('a ledger key is never written lower than the store holds, and a quiet session writes none', async () => {
  const stored: Ledger = { v: 2, sid: 'q', at: T0, totals: { ...emptyTotals(), coins: 30, calls: 30 }, days: ['2026-01-05'] }
  const lower: Ledger = { ...stored, at: T0 + HOUR, totals: { ...emptyTotals(), coins: 12, calls: 40 }, days: ['2026-01-06'] }
  const merged = mergeLedger(stored, lower)
  expect(merged.totals.coins).toBe(30)
  expect(merged.totals.calls).toBe(40)
  expect(merged.days).toEqual(['2026-01-05', '2026-01-06'])
  expect(merged.at).toBe(T0 + HOUR)
  const higher: Ledger = { ...stored, at: T0 + HOUR, totals: { ...emptyTotals(), coins: 31, calls: 31 } }
  expect(mergeLedger(stored, higher)).toBe(higher)
  expect(mergeLedger(undefined, higher)).toBe(higher)
  expect(writeLedger([], [], 'q', emptyEarn(T0), T0, true)).toBeUndefined()
})

test('a count that slips back (a helper\'s crates recounted) is not taken for a restart, so nothing counts twice', async () => {
  const e = { ...coins(30), crates: 3 }
  const first = writeLedger([], [], 'c', e, T0)
  if (!first) throw new Error('no ledger')
  const next = writeLedger([first], [], 'c', { ...coins(32), crates: 2 }, T0 + HOUR)
  expect(next?.gen).toBeUndefined()
  expect(next?.totals.coins).toBe(32)
  expect(next?.totals.crates).toBe(3)
  // Coins back near zero is a restart: a new ledger, the old one kept whole.
  const restart = writeLedger([first], [], 'c', coins(2), T0 + HOUR)
  expect(restart?.gen).toBeGreaterThan(0)
  expect(lifetimeOf(migrate(0, 1, T0), [first, ...(restart ? [restart] : [])], {}, emptyTotals()).coins).toBe(32)
})
