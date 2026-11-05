// Coins, the ladder of builds, and the farm kept across sessions (spec section 6 and 2.3).
// Nothing is ever spent: builds are a pure function of lifetime coins, so no two sessions can race over a balance.
// Pure: time comes in as `now`, never from the clock.

import { SHIPPED_BUILDS } from '../contracts'
import type { Ms, UnlockId } from '../contracts'
import type { Bank, Earn, Step, Totals } from '../../types'

// ---- the store's shapes (spec 2.3) ----

/** `farm2` in the store: who the farm is, and everything already folded into its base. */
export type StoreFarm = {
  v: 2
  seed: number
  bornAt: Ms
  /** 1.2's harvest count when this farm was made: its gift. */
  legacy: number
  base: Totals
  days: number
  /** At most 60, to keep from counting a day twice. */
  recentDays: string[]
  /** Store keys already added into base (the last 500). */
  folded: string[]
  builtAt: Partial<Record<UnlockId, Ms>>
  snowmanYear?: number
}

/**
 * One session's earnings, `led:<sid>` (or `led:<sid>~<gen>`). Only that session writes it.
 * A session that comes back to a ledger already folded (closed, or idle past a day) starts a new one, `gen`,
 * and `from` says how much of its running earnings the earlier ones already hold.
 */
export type Ledger = {
  v: 2
  sid: string
  at: Ms
  closedAt?: Ms
  totals: Totals
  days: string[]
  gen?: number
  from?: Totals
}

// ---- the ladder (spec 6.4) ----

export const LADDER: readonly { id: UnlockId; name: string; cost: number; produce?: number }[] = [
  { id: 'scarecrow', name: 'Scarecrow', cost: 10 },
  { id: 'coop', name: 'Hen coop', cost: 30, produce: 4 },
  { id: 'barrel', name: 'Rain barrel', cost: 50 },
  { id: 'mailbox', name: 'Mailbox', cost: 80 },
  { id: 'bench', name: 'Bench', cost: 120 },
  { id: 'cat', name: 'Cat', cost: 160 },
  { id: 'flowers', name: 'Flower border', cost: 210 },
  { id: 'hive', name: 'Beehive', cost: 270, produce: 3 },
  { id: 'well', name: 'Well with pump', cost: 340 },
  { id: 'jetty', name: 'Fishing jetty', cost: 420 },
  { id: 'windmill', name: 'Windmill', cost: 500 },
  { id: 'orchard', name: 'Orchard', cost: 600, produce: 3 },
  { id: 'cow', name: 'Cow', cost: 700, produce: 6 },
  { id: 'market', name: 'Market stall', cost: 800 },
  { id: 'ducks', name: 'Ducks', cost: 900, produce: 2 },
  { id: 'greenhouse', name: 'Greenhouse', cost: 1000 },
  { id: 'sheep', name: 'Sheep', cost: 1100, produce: 5 },
  { id: 'lamps', name: 'Lamp posts', cost: 1250 },
  { id: 'vane', name: 'Weather vane', cost: 1400 },
  { id: 'pumpkins', name: 'Pumpkin patch', cost: 1550 },
  { id: 'cart', name: 'Pony and cart', cost: 1700 },
  { id: 'telescope', name: 'Telescope', cost: 1850 },
  { id: 'hayloft', name: 'Hayloft', cost: 2000 },
  { id: 'green', name: 'Festival green', cost: 2200 },
]

/** Coins needed for the first k builds, k = 0..24. */
const CUM: readonly number[] = LADDER.reduce<number[]>((acc, row) => [...acc, (acc[acc.length - 1] ?? 0) + row.cost], [0])

/** How many builds stand for this many lifetime coins, out of all 24. */
export const owned = (lifetime: number): number => {
  let k = 0
  while (k < LADDER.length && (CUM[k + 1] ?? Infinity) <= lifetime) k++
  return k
}

/** Builds that stand and are drawn in this version. */
export const shippedOwned = (lifetime: number): number => Math.min(owned(lifetime), SHIPPED_BUILDS)

/** The build being saved for and how far along it is (0 to 1); none once the shipped builds all stand. */
export const nextBuild = (lifetime: number): { index: number; id: UnlockId; cost: number; progress: number } | undefined => {
  const index = owned(lifetime)
  const row = LADDER[index]
  if (index >= SHIPPED_BUILDS || !row) return undefined
  const progress = Math.min(Math.max((lifetime - (CUM[index] ?? 0)) / row.cost, 0), 1)
  return { index, id: row.id, cost: row.cost, progress }
}

// ---- days ----

const DAY = 86_400_000
const pad = (n: number): string => String(n).padStart(2, '0')

/** The local date of a moment, YYYY-MM-DD. */
export const dayOf = (now: Ms): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole days from one date to a later one (negative when earlier). */
export const daysBetween = (from: string, to: string): number => {
  const ms = (s: string): number => {
    const [y = 0, m = 1, d = 1] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((ms(to) - ms(from)) / DAY)
}

/** The date whose dawn basket waits, once it is 05:00 local; none before. */
export const basketDate = (now: Ms): string | undefined => (new Date(now).getHours() >= 5 ? dayOf(now) : undefined)

// ---- totals ----

export const emptyTotals = (): Totals => ({ coins: 0, harvests: 0, calls: 0, crates: 0, helpers: 0, golden: 0, trips: {} })

export const emptyEarn = (now: Ms): Earn => ({ ...emptyTotals(), day: dayOf(now), callsToday: 0, harvestsToday: 0, shown: 0 })

const COUNTERS = ['coins', 'harvests', 'calls', 'crates', 'helpers', 'golden'] as const

/** Only the Totals fields of a value that may carry more (an Earn). */
export const totalsOf = (t: Totals): Totals => ({
  coins: t.coins, harvests: t.harvests, calls: t.calls, crates: t.crates, helpers: t.helpers, golden: t.golden, trips: { ...t.trips },
})

export const addTotals = (a: Totals, b: Totals): Totals => {
  const trips = { ...a.trips }
  for (const [k, n] of Object.entries(b.trips)) trips[k] = (trips[k] ?? 0) + n
  return {
    coins: a.coins + b.coins, harvests: a.harvests + b.harvests, calls: a.calls + b.calls,
    crates: a.crates + b.crates, helpers: a.helpers + b.helpers, golden: a.golden + b.golden, trips,
  }
}

/** a less b, never below zero in any field. */
export const subTotals = (a: Totals, b: Totals): Totals => {
  const out = totalsOf(a)
  for (const k of COUNTERS) out[k] = Math.max(0, a[k] - b[k])
  for (const [k, n] of Object.entries(b.trips)) {
    const left = Math.max(0, (out.trips[k] ?? 0) - n)
    if (left > 0) out.trips[k] = left
    else delete out.trips[k]
  }
  return out
}

/** The larger of a and b in every field: two copies of one ledger made one without lowering either. */
export const maxTotals = (a: Totals, b: Totals): Totals => {
  const out = totalsOf(a)
  for (const k of COUNTERS) out[k] = Math.max(a[k], b[k])
  for (const [k, n] of Object.entries(b.trips)) out.trips[k] = Math.max(out.trips[k] ?? 0, n)
  return out
}

/** Every counter of a is at least b's. */
const covers = (a: Totals, b: Totals): boolean => COUNTERS.every(k => a[k] >= b[k])

const sameTotals = (a: Totals, b: Totals): boolean => JSON.stringify(totalsOf(a)) === JSON.stringify(totalsOf(b))

const isZero = (t: Totals): boolean => COUNTERS.every(k => t[k] === 0) && Object.keys(t.trips).length === 0

/**
 * Whether a session's earnings carry on from what its ledger holds. A session restarted from zero has fewer coins or
 * calls; any other count that slips back (a helper's crates recounted) is not taken for a restart, which would count
 * the whole session twice.
 */
const carriesOn = (earn: Totals, upto: Totals): boolean => earn.coins >= upto.coins && earn.calls >= upto.calls

// ---- earning (spec 6.2) ----

const CALLS_FULL = 100        // calls a session-day paying 1 each
const CALLS_EVERY = 4         // then 1 coin per 4 calls
const HARVEST = 10
const HARVESTS_FULL = 60      // harvests a day paying 10 each, then 5
const HARVEST_SOFT = 5
const MIN_STEP_MS = 60_000
const HELPER = 2

/** A new local day starts the day's counts again. */
const rollover = (earn: Earn, now: Ms): Earn => {
  const day = dayOf(now)
  return day === earn.day ? earn : { ...earn, day, callsToday: 0, harvestsToday: 0 }
}

/** A main-loop tool call: 1 coin for each of the first 100 in a session-day, then 1 per 4. */
export const earnCall = (earn: Earn, now: Ms): Earn => {
  const e = rollover(earn, now)
  const n = e.callsToday + 1
  const coin = n <= CALLS_FULL || (n - CALLS_FULL) % CALLS_EVERY === 0 ? 1 : 0
  return { ...e, calls: e.calls + 1, callsToday: n, coins: e.coins + coin }
}

/** Whether a finished step pays: once, and only if it saw work (a call, or a minute in progress; a prompt needs a call). */
const pays = (step: Step, now: Ms): boolean => {
  if (step.paid) return false
  if (step.calls >= 1) return true
  if (step.id.startsWith('p:')) return false
  return step.startedAt !== undefined && (step.doneAt ?? now) - step.startedAt >= MIN_STEP_MS
}

/** A finished step: 10 coins, 5 after 60 in a day. The caller marks the step `paid`. Same earn when it pays nothing. */
export const earnHarvest = (earn: Earn, step: Step, now: Ms): { earn: Earn; coins: number } => {
  if (!pays(step, now)) return { earn, coins: 0 }
  const e = rollover(earn, now)
  const k = e.harvestsToday + 1
  const coins = k > HARVESTS_FULL ? HARVEST_SOFT : HARVEST
  return { earn: { ...e, harvests: e.harvests + 1, harvestsToday: k, coins: e.coins + coins }, coins }
}

/** A helper that finished with an answer: 2 coins and its crates. */
export const earnHelper = (earn: Earn, crates: number): Earn =>
  ({ ...earn, coins: earn.coins + HELPER, helpers: earn.helpers + 1, crates: earn.crates + Math.max(0, Math.round(crates)) })

/** The dawn basket: 5, plus what the animals made each day since the last one, at most 3 days. */
export const basketValue = (ownedCount: number, daysSince: number): number => {
  const days = Math.min(Math.max(Math.floor(daysSince), 1), 3)
  const produce = LADDER.slice(0, Math.max(0, ownedCount)).reduce((n, row) => n + (row.produce ?? 0), 0)
  return 5 + produce * days
}

// ---- the farm across sessions ----

const GIFT_PER = 10
const GIFT_CAP = 219          // old harvests that count: 2,190 coins, the first 11 builds
const FOLD_STALE = 48 * 3_600_000   // a ledger nobody wrote for this long is folded even unclosed
const LEDGER_FRESH = 24 * 3_600_000 // its owner keeps writing it only this long after the last write
const BASKET_KEEP = 7         // days a basket stays its own key before it is folded
const FOLDED_KEEP = 500
const DAYS_KEEP = 60

export const ledgerKey = (l: Pick<Ledger, 'sid' | 'gen'>): string => (l.gen ? `led:${l.sid}~${l.gen}` : `led:${l.sid}`)
const basketKey = (key: string): string => (key.startsWith('b:') ? key : `b:${key}`)

/** What a ledger's owner had earned in all when it was written. */
export const uptoOf = (l: Ledger): Totals => addTotals(l.from ?? emptyTotals(), l.totals)

/** 1.2's gift: 10 coins per old harvest, capped; every old harvest still counts as a harvest. */
const giftOf = (legacy: number): Totals =>
  ({ ...emptyTotals(), coins: GIFT_PER * Math.min(Math.max(legacy, 0), GIFT_CAP), harvests: Math.max(legacy, 0) })

/** Everything the farm has earned: the gift, the base, every ledger and basket not yet folded, and `mine`. */
export const lifetimeOf = (farm: StoreFarm, ledgers: Ledger[], baskets: Record<string, number>, mine: Totals): Totals => {
  const folded = new Set(farm.folded)
  let t = addTotals(giftOf(farm.legacy), farm.base)
  for (const l of ledgers) if (!folded.has(ledgerKey(l))) t = addTotals(t, l.totals)
  for (const [k, v] of Object.entries(baskets)) if (!folded.has(basketKey(k))) t = { ...t, coins: t.coins + v }
  return addTotals(t, totalsOf(mine))
}

/** Days farmed: the folded count plus any day in an unfolded ledger it has not seen. */
export const daysOf = (farm: StoreFarm, ledgers: Ledger[]): number => {
  const folded = new Set(farm.folded)
  const seen = new Set(farm.recentDays)
  let days = farm.days
  for (const l of ledgers) {
    if (folded.has(ledgerKey(l))) continue
    for (const d of l.days) if (!seen.has(d)) { seen.add(d); days++ }
  }
  return days
}

const keepLatestDays = (days: string[]): string[] => [...new Set(days)].sort().slice(-DAYS_KEEP)

/**
 * Phase one of the fold: add every closed or stale ledger and every week-old basket into the base, and list its key
 * as folded. Phase two is `deletable`: keys this farm had already folded, which a later pass may remove from the
 * store. Folding the same input twice changes nothing; a key lost from `folded` by a racing write still counts once.
 */
export const fold = (farm: StoreFarm, ledgers: Ledger[], baskets: Record<string, number>, now: Ms): { farm: StoreFarm; deletable: string[] } => {
  const before = new Set(farm.folded)
  const deletable: string[] = []
  let base = farm.base
  let days = farm.days
  const folded = [...farm.folded]
  const has = new Set(farm.folded)
  let recent = [...farm.recentDays]
  const seen = new Set(recent)
  for (const l of ledgers) {
    const key = ledgerKey(l)
    if (before.has(key)) { if (!deletable.includes(key)) deletable.push(key); continue }
    if (has.has(key) || (l.closedAt === undefined && now - l.at <= FOLD_STALE)) continue
    base = addTotals(base, l.totals)
    folded.push(key)
    has.add(key)
    for (const d of l.days) if (!seen.has(d)) { seen.add(d); recent.push(d); days++ }
  }
  const today = dayOf(now)
  for (const [k, v] of Object.entries(baskets)) {
    const key = basketKey(k)
    if (before.has(key)) { if (!deletable.includes(key)) deletable.push(key); continue }
    if (has.has(key) || daysBetween(key.slice(2), today) <= BASKET_KEEP) continue
    base = { ...base, coins: base.coins + v }
    folded.push(key)
    has.add(key)
  }
  if (folded.length === farm.folded.length) return { farm, deletable }
  recent = keepLatestDays(recent)
  // Past the cap the oldest ids go first, but never one whose key is still in the store: forgetting it would count it again.
  const present = new Set([...ledgers.map(ledgerKey), ...Object.keys(baskets).map(basketKey)])
  let spare = folded.length - FOLDED_KEEP
  const kept: string[] = []
  for (const key of folded) {
    if (spare > 0 && !present.has(key)) spare--
    else kept.push(key)
  }
  return { farm: { ...farm, base, days, recentDays: recent, folded: kept }, deletable }
}

/**
 * Two copies of farm2 made one. The stored copy keeps its base, days and folded list whole (they only make sense
 * together; whatever its fold missed is still in the store and folds again); build dates take the earliest.
 */
export const mergeFarm = (stored: StoreFarm, mine: StoreFarm): StoreFarm => {
  const builtAt: Partial<Record<UnlockId, Ms>> = { ...stored.builtAt }
  for (const [id, at] of Object.entries(mine.builtAt) as [UnlockId, Ms][]) {
    const old = builtAt[id]
    builtAt[id] = old === undefined ? at : Math.min(old, at)
  }
  const snow = Math.max(stored.snowmanYear ?? 0, mine.snowmanYear ?? 0)
  return { ...stored, builtAt, ...(snow ? { snowmanYear: snow } : {}) }
}

/** A farm2 made fresh: from 1.2's harvest count when there is one, else from nothing. */
export const migrate = (legacyHarvest: unknown, seed: number, now: Ms): StoreFarm => {
  const n = typeof legacyHarvest === 'number' && Number.isFinite(legacyHarvest) ? Math.max(0, Math.floor(legacyHarvest)) : 0
  return { v: 2, seed: seed >>> 0, bornAt: now, legacy: n, base: emptyTotals(), days: 0, recentDays: [], folded: [], builtAt: {} }
}

/** A farm with nothing yet, for before the store is read. */
export const emptyBank = (now: Ms, seed: number): Bank =>
  ({ v: 2, seed: seed >>> 0, bornAt: now, others: emptyTotals(), owned: 0, builtAt: {}, days: 0, syncedAt: now })

/**
 * The bank as of a read: `others` is everything but this session's live earnings, and `mine`, when given, is what of
 * this session the store already holds (it counts toward the builds standing). `owned` counts all 24 rows; each
 * standing build that ships in this version gets its date, so a later version can still hold a ribbon-cutting for the rest.
 */
export const bankOf = (farm: StoreFarm, others: Totals, now: Ms, mine?: Totals): Bank => {
  const count = owned(others.coins + (mine?.coins ?? 0))
  const builtAt: Partial<Record<UnlockId, Ms>> = { ...farm.builtAt }
  for (const row of LADDER.slice(0, Math.min(count, SHIPPED_BUILDS))) builtAt[row.id] ??= now
  return {
    v: 2, seed: farm.seed, bornAt: farm.bornAt, others, owned: count, builtAt, days: farm.days,
    ...(farm.snowmanYear !== undefined ? { snowmanYear: farm.snowmanYear } : {}), syncedAt: now,
  }
}

// ---- this session's ledger ----

/** The latest of one session's ledgers, by generation. */
export const latestLedger = (mine: Ledger[]): Ledger | undefined =>
  mine.reduce<Ledger | undefined>((best, l) => (!best || (l.gen ?? 0) > (best.gen ?? 0) ? l : best), undefined)

const genOfKey = (key: string, sid: string): number | undefined => {
  if (key === `led:${sid}`) return 0
  const prefix = `led:${sid}~`
  if (!key.startsWith(prefix)) return undefined
  const n = Number(key.slice(prefix.length))
  return Number.isFinite(n) ? n : undefined
}

/**
 * This session's ledger as it should be written now, or undefined when the store already says the same.
 * `mine` are the session's ledgers as just read; `folded` is farm2's list. The ledger in use is kept while it is open,
 * unfolded, written within a day and carried on by `earn`; otherwise a new generation starts, so a folded ledger is never
 * written again (its coins would be lost) and a restarted session never writes less than it had (they would be lowered).
 */
export const writeLedger = (mine: Ledger[], folded: readonly string[], sid: string, earn: Totals, now: Ms, isClosed = false): Ledger | undefined => {
  const cur = latestLedger(mine)
  const gens = [...mine.map(l => l.gen ?? 0), ...folded.map(k => genOfKey(k, sid)).filter((g): g is number => g !== undefined)]
  const top = gens.length ? Math.max(...gens) : undefined
  const day = (earn as Partial<Earn>).day
  const active = ((earn as Partial<Earn>).callsToday ?? 0) + ((earn as Partial<Earn>).harvestsToday ?? 0) > 0
  const withDay = (days: string[]): string[] => (active && day && !days.includes(day) ? [...days, day] : days)
  if (cur && (cur.gen ?? 0) === top && cur.closedAt === undefined && !folded.includes(ledgerKey(cur))
    && now - cur.at < LEDGER_FRESH && carriesOn(earn, uptoOf(cur))) {
    const totals = maxTotals(subTotals(earn, cur.from ?? emptyTotals()), cur.totals)
    const days = withDay(cur.days)
    if (!isClosed && sameTotals(totals, cur.totals) && days.length === cur.days.length) return undefined
    return { ...cur, at: now, totals, days, ...(isClosed ? { closedAt: now } : {}) }
  }
  // Nothing earned since the last write: leave it be (a stale ledger is folded as it stands).
  if (cur && (cur.gen ?? 0) === top && sameTotals(earn, uptoOf(cur))) return undefined
  // A session that never earned anything leaves no key behind.
  if (top === undefined && isZero(earn)) return undefined
  // A new generation: what of `earn` the earlier ones already hold.
  const from = cur && (cur.gen ?? 0) === top
    ? (carriesOn(earn, uptoOf(cur)) ? uptoOf(cur) : emptyTotals())   // same run, or a restarted one that began at zero
    : top !== undefined ? totalsOf(earn) : emptyTotals()           // the last one is gone from the store: count from here
  const gen = top === undefined ? 0 : Math.max(top + 1, now)
  const totals = subTotals(earn, from)
  return { v: 2, sid, at: now, totals, days: withDay([]), ...(gen ? { gen, from } : {}), ...(isClosed ? { closedAt: now } : {}) }
}

/**
 * The ledger to set, given what its key holds right now: the larger of the two in every count, days joined. Only one
 * session writes a key, so this is normally `next` itself; it keeps a second process on the same session id from
 * ever lowering what the store holds.
 */
export const mergeLedger = (stored: Ledger | undefined, next: Ledger): Ledger => {
  if (!stored || ledgerKey(stored) !== ledgerKey(next)) return next
  if (covers(next.totals, stored.totals) && stored.days.every(d => next.days.includes(d))) return next
  const closedAt = next.closedAt ?? stored.closedAt
  return {
    ...next, totals: maxTotals(stored.totals, next.totals), days: [...new Set([...stored.days, ...next.days])].sort(),
    ...(closedAt !== undefined ? { closedAt } : {}),
  }
}
