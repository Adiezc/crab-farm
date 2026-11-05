import { expect, test } from 'claude-code/testing'
import { boot, dawnBasket, flush, sync } from './store'
import type { StoreDollar } from './store'
import { emptyEarn } from './model/progress'
import type { Ledger, StoreFarm } from './model/progress'
import type { Earn } from '../types'

// A test's `$` has no store noun, and the host refuses `$.store` to a test's own hooks, so the kit's `mock.store`
// answers only the plugin's hooks (the engine test covers that path once register.tsx calls these). Here the store is
// one in memory with the same rules: values kept as JSON text, read back as copies, keys in the order first set.
const memoryStore = (entries: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]))
  const sets: string[] = []
  const read = (key: string): unknown => {
    const text = data.get(key)
    return text === undefined ? undefined : JSON.parse(text)
  }
  const $: StoreDollar = {
    store: {
      get: async key => read(key),
      set: async (key, value) => { sets.push(key); data.set(key, JSON.stringify(value)) },
      delete: async key => { data.delete(key) },
      keys: async () => [...data.keys()],
    },
  }
  return { $, sets, read, put: (key: string, value: unknown) => data.set(key, JSON.stringify(value)), has: (key: string) => data.has(key) }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = new Date(2026, 0, 5, 9).getTime()   // a Monday, 09:00 local
const earned = (coins: number, harvests = 0): Earn =>
  ({ ...emptyEarn(T0), coins, harvests, calls: coins, callsToday: coins })

test('the first boot makes farm2 once, and a second session uses the same farm', async () => {
  const s = memoryStore()
  const a = await boot(s.$, 'st-a1', T0)
  const farm = s.read('farm2') as StoreFarm
  expect(farm.v).toBe(2)
  expect(a.seed).toBe(farm.seed)
  expect(a.others.coins).toBe(0)
  expect(a.owned).toBe(0)
  const b = await boot(s.$, 'st-a2', T0 + HOUR)
  expect(b.seed).toBe(farm.seed)
  expect(b.bornAt).toBe(T0)
  expect(s.sets.filter(k => k === 'farm2').length).toBe(1)
})

test('a 1.2 store with 31 harvests boots with 310 coins and 5 builds, all dated at once', async () => {
  const s = memoryStore({ harvest: 31 })
  const bank = await boot(s.$, 'st-b1', T0)
  expect(bank.others.coins).toBe(310)
  expect(bank.owned).toBe(5)
  const farm = s.read('farm2') as StoreFarm
  expect(farm.legacy).toBe(31)
  expect(Object.values(farm.builtAt)).toEqual([T0, T0, T0, T0, T0])
  expect(s.read('harvest')).toBe(31)
})

test('a flush from one session shows up in the other session at its next sync', async () => {
  const s = memoryStore()
  await boot(s.$, 'st-c1', T0)
  await boot(s.$, 'st-c2', T0)
  await flush(s.$, 'st-c2', earned(50, 2), T0 + HOUR)
  const one = await sync(s.$, 'st-c1', T0 + HOUR)
  expect(one.others.coins).toBe(50)
  expect(one.owned).toBe(2)   // 10 + 30: the scarecrow and the coop
  // The session's own ledger is not in its `others`: its live earnings already count it.
  const two = await sync(s.$, 'st-c2', T0 + HOUR)
  expect(two.others.coins).toBe(0)
  expect(two.owned).toBe(2)
  expect(s.read('harvest')).toBe(2)
  // An unchanged flush writes nothing.
  const writes = s.sets.length
  await flush(s.$, 'st-c2', earned(50, 2), T0 + 2 * HOUR)
  expect(s.sets.length).toBe(writes)
})

test('a session that earned nothing leaves no ledger behind', async () => {
  const s = memoryStore()
  await boot(s.$, 'st-z1', T0)
  await flush(s.$, 'st-z1', emptyEarn(T0), T0 + HOUR)
  await flush(s.$, 'st-z1', emptyEarn(T0), T0 + HOUR, true)
  expect(s.has('led:st-z1')).toBe(false)
})

test('the session-end flush closes the ledger, the next boot folds it, and a later sync sweeps it', async () => {
  const s = memoryStore({ harvest: 3 })
  await boot(s.$, 'st-d1', T0)
  await flush(s.$, 'st-d1', earned(40, 1), T0 + HOUR, true)
  expect((s.read('led:st-d1') as Ledger).closedAt).toBe(T0 + HOUR)
  const b = await boot(s.$, 'st-d2', T0 + 2 * HOUR)
  expect(b.others.coins).toBe(70)
  expect((s.read('farm2') as StoreFarm).folded).toEqual(['led:st-d1'])
  // Folded but still there: the key goes only at a later pass that still sees it folded.
  expect(s.has('led:st-d1')).toBe(true)
  await boot(s.$, 'st-d3', T0 + 3 * HOUR)
  expect((await sync(s.$, 'st-d3', T0 + 3 * HOUR)).others.coins).toBe(70)
  expect(s.has('led:st-d1')).toBe(true)                 // not yet: a minute must pass
  const later = await sync(s.$, 'st-d3', T0 + 3 * HOUR + 5 * 60_000)
  expect(s.has('led:st-d1')).toBe(false)
  expect(later.others.coins).toBe(70)
  expect(later.days).toBe(1)
  // 1.2's harvest key never goes down: 3 old harvests plus 1 new.
  expect(s.read('harvest')).toBe(4)
})

test('a farm2 written back from a lost race costs nothing, and its ledger is not swept until folded again', async () => {
  const s = memoryStore()
  await boot(s.$, 'st-r1', T0)
  await flush(s.$, 'st-r1', earned(40, 1), T0 + HOUR, true)
  const stale = s.read('farm2')
  await boot(s.$, 'st-r2', T0 + 2 * HOUR)
  expect((s.read('farm2') as StoreFarm).folded).toEqual(['led:st-r1'])
  // A session that read farm2 before that fold writes it back after: the fold is lost, the ledger still counts.
  s.put('farm2', stale)
  expect((await sync(s.$, 'st-r2', T0 + 2 * HOUR)).others.coins).toBe(40)
  await boot(s.$, 'st-r3', T0 + 3 * HOUR)
  await sync(s.$, 'st-r3', T0 + 3 * HOUR + 5 * 60_000)
  expect(s.has('led:st-r1')).toBe(true)
  expect((s.read('farm2') as StoreFarm).base.coins).toBe(40)
  await boot(s.$, 'st-r4', T0 + 4 * HOUR)
  const bank = await sync(s.$, 'st-r4', T0 + 4 * HOUR + 5 * 60_000)
  expect(s.has('led:st-r1')).toBe(false)
  expect(bank.others.coins).toBe(40)
})

test('the dawn basket is taken once a day, whichever session takes it', async () => {
  const s = memoryStore()
  await boot(s.$, 'st-e1', T0)
  await boot(s.$, 'st-e2', T0)
  expect(await dawnBasket(s.$, '2026-01-05', 2, T0)).toBe(9)
  expect(await dawnBasket(s.$, '2026-01-05', 2, T0 + HOUR)).toBe(0)
  // Two days on: the hens laid for both.
  expect(await dawnBasket(s.$, '2026-01-07', 2, T0 + 2 * DAY)).toBe(13)
  const bank = await sync(s.$, 'st-e2', T0 + 2 * DAY)
  expect(bank.others.coins).toBe(22)
  expect(bank.basketDay).toBe('2026-01-07')
})

test('a month away costs nothing: the same builds stand, and the basket pays three days at most', async () => {
  const s = memoryStore()
  await boot(s.$, 'st-f1', T0)
  expect(await dawnBasket(s.$, '2026-01-05', 3, T0)).toBe(9)
  await flush(s.$, 'st-f1', earned(100, 3), T0 + HOUR, true)
  const before = await boot(s.$, 'st-f2', T0 + 2 * HOUR)
  const after = await boot(s.$, 'st-f3', T0 + 30 * DAY)
  expect(after.others.coins).toBe(before.others.coins)
  expect(after.owned).toBe(before.owned)
  expect(after.builtAt).toEqual(before.builtAt)
  expect(await dawnBasket(s.$, '2026-02-04', after.owned, T0 + 30 * DAY)).toBe(5 + 4 * 3)
})
