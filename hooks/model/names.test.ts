import { expect, test } from 'claude-code/testing'
import { CRAB_NAMES, RESIDENT, crabName, crabNames } from './names'

test('there are four dozen names, each different, at most ten letters, in capitals and the farm font', async () => {
  expect(CRAB_NAMES.length).toBe(48)
  expect(new Set(CRAB_NAMES).size).toBe(CRAB_NAMES.length)
  for (const name of CRAB_NAMES) {
    expect(name.replace(/[^A-Za-z]/g, '').length).toBeLessThanOrEqual(10)
    expect(/^[A-Z][A-Za-z' ]*$/.test(name)).toBe(true)
  }
})

test('the farmhand keeps its name across sessions of the same farm', async () => {
  expect(crabName(12345, RESIDENT)).toBe(crabName(12345, RESIDENT))
  expect(CRAB_NAMES).toContain(crabName(12345, RESIDENT))
  // Other farms have other farmhands.
  const names = new Set(Array.from({ length: 40 }, (_, seed) => crabName(seed, RESIDENT)))
  expect(names.size).toBeGreaterThan(10)
})

test('a step crab is named by its step id, the same whenever the plan is drawn', async () => {
  expect(crabName(7, 'n:0:Rework the plots')).toBe(crabName(7, 'n:0:Rework the plots'))
  const a = crabNames(7, ['n:0:Read the source', 'n:0:Rework the plots'])
  const b = crabNames(7, ['n:0:Read the source', 'n:0:Rework the plots', 'n:0:Ship it'])
  expect(b.slice(0, 2)).toEqual(a)
})

test('no two crabs of a plan share a name, nor the farmhand\'s', async () => {
  for (let seed = 0; seed < 30; seed++) {
    const keys = Array.from({ length: 24 }, (_, k) => `n:0:step ${k}`)
    const names = crabNames(seed, keys)
    expect(new Set(names).size).toBe(24)
    expect(names).not.toContain(crabName(seed, RESIDENT))
  }
})
