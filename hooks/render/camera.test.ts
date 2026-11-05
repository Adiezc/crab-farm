import { expect, test } from 'claude-code/testing'
import { NARROW_VIEW, desktopWidth, isNarrow, termCamera } from './camera'

test('the desktop farm is a multiple of 90 css px wide, from 270 to 720, and 250/180 as tall', async () => {
  for (let cols = 0; cols <= 200; cols++) {
    const { w, h } = desktopWidth(cols)
    expect(w % 90).toBe(0)
    expect(w >= 270 && w <= 720).toBe(true)
    expect(h).toBe((w * 250) / 180)
  }
  expect(desktopWidth(10).w).toBe(270)
  expect(desktopWidth(46).w).toBe(360)
  expect(desktopWidth(80).w).toBe(630)
  expect(desktopWidth(300).w).toBe(720)
})

test('the narrow panel crops to the play area below 36 columns', async () => {
  expect(isNarrow(35)).toBe(true)
  expect(isNarrow(36)).toBe(false)
  const v = NARROW_VIEW
  expect([v.x * 2, v.y * 2, v.w * 2, v.h * 2]).toEqual([44, 40, 272, 432])
})

const cam = (c: number, r: number) => {
  const k = termCamera(c, r)
  return [k.s, k.cols, k.rows, k.textRows]
}

test('the terminal camera takes the largest region that fits, finer scales first', async () => {
  expect(cam(90, 70)).toEqual([2, 90, 63, 2])    // the whole world at s = 2
  expect(cam(60, 45)).toEqual([3, 60, 42, 2])    // the whole world at s = 3
  expect(cam(46, 37)).toEqual([3, 46, 35, 2])    // the play area at s = 3, exactly
  expect(cam(40, 30)).toEqual([3, 40, 28, 2])    // the field at s = 3, widened to the pane
  expect(cam(30, 20)).toEqual([4, 30, 18, 2])    // the field at s = 4
  expect(cam(56, 30)).toEqual([2, 56, 28, 2])    // the field at s = 2
  expect(cam(200, 120)).toEqual([2, 90, 63, 2])  // never wider than the world
})

test('a short pane keeps one text row, and tiny panes still get a camera', async () => {
  expect(termCamera(60, 17).textRows).toBe(1)
  expect(termCamera(60, 18).textRows).toBe(2)
  expect(cam(0, 0)).toEqual([4, 1, 1, 1])
  expect(cam(12, 4)).toEqual([4, 12, 3, 1])
})

test('the view fills the pane at its scale, on whole terminal pixels, inside the world where it can be', async () => {
  for (let c = 1; c <= 130; c += 3) {
    for (let r = 1; r <= 90; r += 4) {
      const k = termCamera(c, r)
      expect(k.cols <= Math.max(1, c) && k.rows <= Math.max(1, r - k.textRows)).toBe(true)
      expect(k.view.w).toBe(k.cols * k.s)
      expect(k.view.h).toBe(k.rows * 2 * k.s)
      expect(k.view.x % k.s + k.view.y % k.s).toBe(0)
      expect(k.view.x >= 0 && k.view.y >= 0).toBe(true)
      // Past the world's edge only when the view is wider than the world (s = 2 and 4 round up).
      expect(k.view.x + k.view.w <= 180 || k.view.x === 0).toBe(true)
      expect(k.view.y + k.view.h <= 250 || k.view.y === 0).toBe(true)
    }
  }
})

test('the field is in view whatever the scale', async () => {
  for (const [c, r] of [[30, 20], [40, 30], [56, 30], [60, 45], [90, 70]] as const) {
    const { view } = termCamera(c, r)
    expect(view.x <= 60 && view.x + view.w >= 130).toBe(true)
    expect(view.y <= 110 && view.y + view.h >= 190).toBe(true)
  }
})
