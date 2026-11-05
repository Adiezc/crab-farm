// How big the farm is drawn on each surface: the desktop's width in css px, the narrow panel's crop, and the
// terminal's camera (which part of the world, at how many world px per terminal pixel). Pure.

type Rect = { x: number; y: number; w: number; h: number }
export type TermCamera = { s: 2 | 3 | 4; view: Rect; cols: number; rows: number; textRows: number }

const WORLD_W = 180
const WORLD_H = 250

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * The desktop picture's size in css px. A multiple of 90 is a whole number of device px per world px at DPR 2;
 * 8 px per cell is an estimate (spike S1 measures it).
 */
export function desktopWidth(bodyColumns: number): { w: number; h: number } {
  // A width the host did not report draws at the size the narrow panel's markup has (spec 7.4).
  const w = Number.isFinite(bodyColumns) ? clamp(Math.floor((bodyColumns * 8 - 8) / 90) * 90, 270, 720) : 360
  return { w, h: (w * 250) / 180 }
}

/** VS Code's narrow panel crops to the play area below 36 columns. */
export function isNarrow(bodyColumns: number): boolean {
  return bodyColumns < 36
}

/** The narrow crop in world px (x 22–158, y 20–236); the SVG's viewBox is this times two. */
export const NARROW_VIEW: Rect = { x: 22, y: 20, w: 136, h: 216 }

// Regions, most to least context. The camera keeps the largest one that fits the pane.
const REGIONS: readonly Rect[] = [
  { x: 0, y: 0, w: 180, h: 250 },   // the whole world
  { x: 22, y: 20, w: 136, h: 210 }, // the play area
  { x: 40, y: 96, w: 112, h: 112 }, // the field
]

/** A region's size in cells at scale s: one cell is s world px wide and 2s tall (two pixels, top and bottom). */
const cellsOf = (r: Rect, s: number): { cols: number; rows: number } =>
  ({ cols: Math.ceil(r.w / s), rows: Math.ceil(Math.ceil(r.h / s) / 2) })

const cache = new Map<string, TermCamera>()

/**
 * The terminal camera for a pane of bodyColumns × bodyRows cells. Takes the largest region that fits at s = 2 or 3
 * (finer first), else at s = 4; then widens the view to fill the pane at that scale, centred on the region and
 * clamped to the world. One or two rows are kept for text.
 */
export function termCamera(bodyColumns: number, bodyRows: number): TermCamera {
  const key = `${bodyColumns}x${bodyRows}`
  const hit = cache.get(key)
  if (hit) return hit
  // A size the host could not measure counts as the smallest pane.
  const whole = (v: number): number => (Number.isFinite(v) ? Math.floor(v) : 0)
  const textRows = whole(bodyRows) >= 18 ? 2 : 1
  const availCols = Math.max(1, whole(bodyColumns))
  const availRows = Math.max(1, whole(bodyRows) - textRows)
  const fits = (r: Rect, s: number): boolean => {
    const c = cellsOf(r, s)
    return c.cols <= availCols && c.rows <= availRows
  }
  let pick: { r: Rect; s: 2 | 3 | 4 } | undefined
  for (const r of REGIONS) {
    if (fits(r, 2)) { pick = { r, s: 2 }; break }
    if (fits(r, 3)) { pick = { r, s: 3 }; break }
  }
  if (!pick) pick = { r: REGIONS.find((r) => fits(r, 4)) ?? REGIONS[2]!, s: 4 }
  const { r, s } = pick
  const full = cellsOf(REGIONS[0]!, s)
  const cols = Math.min(availCols, full.cols, 512)
  const rows = Math.min(availRows, full.rows, 256)
  const w = cols * s
  const h = rows * 2 * s
  // Snap to whole terminal pixels so the view indexes the pre-scaled layers directly.
  const place = (centre: number, size: number, world: number): number =>
    size >= world ? 0 : Math.round(clamp(centre - size / 2, 0, world - size) / s) * s
  const x = Math.min(place(r.x + r.w / 2, w, WORLD_W), Math.max(0, Math.floor((WORLD_W - w) / s) * s))
  const y = Math.min(place(r.y + r.h / 2, h, WORLD_H), Math.max(0, Math.floor((WORLD_H - h) / s) * s))
  const cam: TermCamera = { s, view: { x, y, w, h }, cols, rows, textRows }
  if (cache.size >= 64) cache.clear()
  cache.set(key, cam)
  return cam
}
