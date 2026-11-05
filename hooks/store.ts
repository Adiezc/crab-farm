// The farm kept across sessions in $.store: boot folds old ledgers into farm2, flush writes this session's ledger,
// sync reads everyone else's. The store has no compare-and-set and may be shared by several sessions at once, so
// every set comes right after a fresh read of its key and builds on what is there, and every key is written by one
// session or merged, so a lost race costs nothing (spec 2.3, R6).

import type { EngineInterface } from 'claude-code'
import type { Ms } from './contracts'
import type { Bank, Earn, Totals } from '../types'
import { hash32 } from './model/rng'
import {
  basketValue, bankOf, daysBetween, daysOf, emptyTotals, fold, latestLedger, ledgerKey, lifetimeOf, mergeFarm,
  mergeLedger, migrate, subTotals, uptoOf, writeLedger,
} from './model/progress'
import type { Ledger, StoreFarm } from './model/progress'

/** All the store code needs of `$`: a plugin's `$` fits, and so does a test's store in memory. */
export type StoreDollar = Pick<EngineInterface, 'store'>

const FARM = 'farm2'
const HARVEST = 'harvest'
/** Folded keys are removed only when a later read still lists them, this long after: a racing write lands in ms. */
const DELETE_AFTER = 60_000

// Module memory is only a cache: a reload loses it, and the store alone is the truth.
let pending: { keys: string[]; at: Ms } | undefined
const written = new Map<string, Ledger>()   // this process's last ledger write, by session id

type Snap = { farm?: StoreFarm; ledgers: Ledger[]; baskets: Record<string, number>; harvest: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isTotals = (v: unknown): v is Totals =>
  isObj(v) && ['coins', 'harvests', 'calls', 'crates', 'helpers', 'golden'].every(k => isNum(v[k])) && isObj(v.trips)
const isFarm = (v: unknown): v is StoreFarm =>
  isObj(v) && v.v === 2 && isNum(v.seed) && isNum(v.bornAt) && isNum(v.legacy) && isTotals(v.base) && isNum(v.days)
  && Array.isArray(v.recentDays) && Array.isArray(v.folded) && isObj(v.builtAt)
const isLedger = (v: unknown): v is Ledger =>
  isObj(v) && v.v === 2 && typeof v.sid === 'string' && isNum(v.at) && isTotals(v.totals) && Array.isArray(v.days)
  && (v.closedAt === undefined || isNum(v.closedAt)) && (v.gen === undefined || isNum(v.gen))
  && (v.from === undefined || isTotals(v.from))

/** Everything the farm keeps, read key by key. Values of an unknown shape are left out. */
const snapshot = async ($: StoreDollar): Promise<Snap> => {
  const snap: Snap = { ledgers: [], baskets: {}, harvest: undefined }
  for (const key of await $.store.keys()) {
    if (key === FARM) {
      const v = await $.store.get(key)
      if (isFarm(v)) snap.farm = v
    } else if (key === HARVEST) {
      snap.harvest = await $.store.get(key)
    } else if (key.startsWith('led:')) {
      const v = await $.store.get(key)
      if (isLedger(v) && ledgerKey(v) === key) snap.ledgers.push(v)
    } else if (key.startsWith('b:')) {
      const v = await $.store.get(key)
      if (isNum(v)) snap.baskets[key] = v
    }
  }
  return snap
}

/** Reads farm2 again and writes what `make` builds on it, only when that differs. The fold is idempotent, so re-running it on a newer farm merges. */
const writeFarm = async ($: StoreDollar, make: (stored: StoreFarm | undefined) => StoreFarm): Promise<StoreFarm> => {
  const raw = await $.store.get(FARM)
  const stored = isFarm(raw) ? raw : undefined
  const next = make(stored)
  if (!stored || JSON.stringify(stored) !== JSON.stringify(next)) await $.store.set(FARM, next)
  return next
}

/** This session's ledger as this process last wrote it, or else as the store has it. */
const myLedger = (snap: Snap, sid: string): Ledger | undefined => {
  const stored = latestLedger(snap.ledgers.filter(l => l.sid === sid))
  const mem = written.get(sid)
  if (!mem) return stored
  if (!stored || (mem.gen ?? 0) > (stored.gen ?? 0) || ((mem.gen ?? 0) === (stored.gen ?? 0) && mem.at >= stored.at)) return mem
  return stored
}

/** The bank from a snapshot: others = everything stored less what this session's ledgers hold of its own earnings. */
const bankFrom = (snap: Snap, farm: StoreFarm, sid: string, now: Ms): Bank => {
  const mine = myLedger(snap, sid)
  const key = mine ? ledgerKey(mine) : undefined
  const ledgers = [...snap.ledgers.filter(l => ledgerKey(l) !== key), ...(mine && key && !farm.folded.includes(key) ? [mine] : [])]
  const all = lifetimeOf(farm, ledgers, snap.baskets, emptyTotals())
  const upto = mine ? uptoOf(mine) : emptyTotals()
  const bank = bankOf(farm, subTotals(all, upto), now, upto)
  const dates = Object.keys(snap.baskets).map(k => k.slice(2)).sort()
  const basketDay = dates[dates.length - 1]
  return { ...bank, days: daysOf(farm, ledgers), ...(basketDay ? { basketDay } : {}) }
}

/** farm2 with the build dates the bank has and it lacks; the same farm when there are none. */
const withBuilt = (farm: StoreFarm, bank: Bank): StoreFarm =>
  Object.keys(bank.builtAt).some(id => !(id in farm.builtAt)) ? mergeFarm(farm, { ...farm, builtAt: bank.builtAt }) : farm

/** Removes keys folded at an earlier pass that farm2, read again now, still lists as folded. */
const sweep = async ($: StoreDollar, now: Ms): Promise<void> => {
  if (!pending || now - pending.at < DELETE_AFTER) return
  const { keys } = pending
  pending = undefined
  const raw = await $.store.get(FARM)
  if (!isFarm(raw)) return
  const folded = new Set(raw.folded)
  for (const key of keys) if (folded.has(key)) await $.store.delete(key)
}

const seedOf = (sid: string, now: Ms): number => hash32('crab-farm', sid, now)

/**
 * At session start: make farm2 if there is none (migrating 1.2's harvest; a farm2 another session made wins), fold
 * closed and stale ledgers and week-old baskets into it, date the builds standing, and return the bank.
 */
export async function boot($: StoreDollar, sid: string, now: Ms): Promise<Bank> {
  const snap = await snapshot($)
  const made = snap.farm ?? migrate(snap.harvest, seedOf(sid, now), now)
  // Keys an earlier pass already folded: a later sync removes them if farm2 still lists them then.
  const { deletable } = fold(made, snap.ledgers, snap.baskets, now)
  const farm = await writeFarm($, stored => {
    const folded = fold(stored ? mergeFarm(stored, made) : made, snap.ledgers, snap.baskets, now).farm
    return withBuilt(folded, bankFrom(snap, folded, sid, now))
  })
  if (deletable.length) pending = { keys: deletable, at: now }
  return bankFrom(snap, farm, sid, now)
}

/**
 * Writes this session's ledger from its earnings (only when they changed), and keeps 1.2's `harvest` key at least
 * the lifetime harvest count, so going back to 1.2 loses nothing. `isClosed` at session end: the next boot folds it.
 */
export async function flush($: StoreDollar, sid: string, earn: Earn, now: Ms, isClosed = false): Promise<void> {
  const snap = await snapshot($)
  const mine = snap.ledgers.filter(l => l.sid === sid)
  // A ledger this process wrote that the store no longer holds was folded and swept: its coins are in the base, and
  // knowing what it held lets the next one count on from there.
  let folded = snap.farm?.folded ?? []
  const mem = written.get(sid)
  if (mem && !mine.some(l => ledgerKey(l) === ledgerKey(mem))) {
    mine.push(mem)
    if (!folded.includes(ledgerKey(mem))) folded = [...folded, ledgerKey(mem)]
  }
  let ledgers = snap.ledgers
  const next = writeLedger(mine, folded, sid, earn, now, isClosed)
  if (next) {
    const key = ledgerKey(next)
    const raw = await $.store.get(key)
    const merged = mergeLedger(isLedger(raw) ? raw : undefined, next)
    await $.store.set(key, merged)
    written.set(sid, merged)
    ledgers = [...snap.ledgers.filter(l => ledgerKey(l) !== key), merged]
  }
  if (!snap.farm) return
  const harvests = lifetimeOf(snap.farm, ledgers, snap.baskets, emptyTotals()).harvests
  const old = await $.store.get(HARVEST)
  if (harvests > (isNum(old) ? old : 0)) await $.store.set(HARVEST, harvests)
}

/** Reads everyone's ledgers into a fresh bank; also removes keys folded long enough ago and dates new builds. */
export async function sync($: StoreDollar, sid: string, now: Ms): Promise<Bank> {
  const snap = await snapshot($)
  const farm = snap.farm ?? await writeFarm($, stored => stored ?? migrate(snap.harvest, seedOf(sid, now), now))
  await sweep($, now)
  const bank = bankFrom(snap, farm, sid, now)
  if (withBuilt(farm, bank) !== farm) await writeFarm($, stored => withBuilt(stored ?? farm, bank))
  return bank
}

/**
 * Today's dawn basket: its coins the first time any session takes it, 0 once taken. It lives under its own key, so
 * lifetime counts it once whichever sessions saw it. The caller shows the coins landing, does not add them to `earn`,
 * and syncs to see them in the bank.
 */
export async function dawnBasket($: StoreDollar, date: string, ownedCount: number, now: Ms): Promise<number> {
  void now
  const key = `b:${date}`
  if ((await $.store.get(key)) !== undefined) return 0
  const raw = await $.store.get(FARM)
  const earlier = [...await $.store.keys(), ...(isFarm(raw) ? raw.folded : [])]
    .filter(k => k.startsWith('b:') && k < key).map(k => k.slice(2)).sort()
  const last = earlier[earlier.length - 1]
  const coins = basketValue(ownedCount, last ? daysBetween(last, date) : 1)
  if ((await $.store.get(key)) !== undefined) return 0
  await $.store.set(key, coins)
  return coins
}
