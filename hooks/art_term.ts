// STUB until the art build (scripts/build_art.py) writes this file whole: the terminal's pixel farm art,
// as palette indices at three scales (one terminal pixel = s world pixels).
import type { SpriteId, TermLayer } from './contracts'

/** Index → 0xRRGGBB, in daylight; the renderer tints for the sky and the season. */
export const TERM_PALETTE: readonly number[] = [0x5f8f3a, 0x3b2416]

/** The meadow (bg) or the hedge in front (fg) at scale s. */
export const termLayer = (layer: 'bg' | 'fg', s: 2 | 3 | 4): TermLayer => {
  const w = Math.ceil(180 / s)
  const h = Math.ceil(250 / s)
  return { w, h, px: new Uint8Array(w * h).fill(layer === 'bg' ? 0 : 255) }
}

/** A sprite at scale s, or undefined where it has none. */
export const termSprite = (_id: SpriteId, _s: 2 | 3 | 4): TermLayer | undefined => undefined
