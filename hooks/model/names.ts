// Every crab on the farm has a name, picked from the farm's seed, so the same crab answers to the same name in every
// session. The farmhand who minds the farm when there is no plan is keyed 'resident'; a step's crab by its step id.
// Pure.

import { hash32 } from './rng'

/** Short and friendly, ten letters at most so a sign or a hover card holds one; all in the farm's pixel font. */
export const CRAB_NAMES: readonly string[] = [
  'Pinchy', 'Clawdette', 'Sandy', 'Bubbles', "Cap'n Claw", 'Shelly', 'Snappy', 'Coral', 'Barnacle', 'Nibbles',
  'Scuttle', 'Clacky', 'Pebble', 'Kelp', 'Sunny', 'Biscuit', 'Pickles', 'Marbles', 'Tango', 'Sprocket', 'Ziggy',
  'Clementine', 'Sir Pinch', 'Lady Claw', 'Old Salt', 'Pippin', 'Noodle', 'Wobble', 'Tidbit', 'Clawdia', 'Hermit',
  'Crusty', 'Salty', 'Breezy', 'Driftwood', 'Clover', 'Tumble', 'Ripple', 'Puddles', 'Scamper', 'Sidestep', 'Nipper',
  'Mr Snips', 'Rusty', 'Paddles', 'Fiddler', 'Muffin', 'Kipper',
]

/** The key of the farmhand who works the farm when there is no plan. */
export const RESIDENT = 'resident'

const pick = (seed: number, key: string): number => hash32(seed, 'name', key) % CRAB_NAMES.length

/** A crab's name: the same for the same farm and key, in every session. */
export const crabName = (seed: number, key: string): string => CRAB_NAMES[pick(seed, key)] ?? 'Pinchy'

/**
 * Names for a plan's crabs, keyed by step id in plan order. Each is its own crab's name, as `crabName` picks it,
 * unless a crab earlier in the plan or the farmhand has it: then the next free one on the list. A plan only grows at
 * its end and keeps its ids, so a crab's name holds for as long as its step does.
 */
export const crabNames = (seed: number, keys: readonly string[]): string[] => {
  const taken = new Set([crabName(seed, RESIDENT)])
  return keys.map(key => {
    let i = pick(seed, key)
    for (let k = 0; k < CRAB_NAMES.length && taken.has(CRAB_NAMES[i] as string); k++) i = (i + 1) % CRAB_NAMES.length
    const name = CRAB_NAMES[i] ?? 'Pinchy'
    taken.add(name)
    return name
  })
}
