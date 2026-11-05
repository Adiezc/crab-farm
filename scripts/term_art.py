# The terminal's pixel farm, baked from the very pixels the desktop draws: 1.2's meadow and hedge and every sprite of
# the atlas, put on one small palette and mode-downscaled to 2, 3 and 4 world px per terminal pixel. Where a downscale
# loses what makes a micro sprite read (the crab's eyes and legs, a hen, a crop, an icon), term_micro.py paints it by
# hand. The result is deflated and base64'd into hooks/art_term.ts, which inflates it once, on first use.
# Dependency-free and deterministic: build_art.py's --check compares the bytes.
import base64
import re
import zlib

import legacy
import term_micro

SCALES = (2, 3, 4)
HD = 2
CLEAR = 255
# The renderer keeps the indices from 244 up for its own colours (raster.ts OWN_BASE); stay well under.
MAX_PALETTE = 200
# Free colours for the meadow and the hedge, on top of every colour the sprites use.
SCENERY_COLOURS = 40


# ---- colour ----

def dist(a, b):
    """A cheap perceptual distance: green counts most, red least."""
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db


def nearest(c, pal):
    best, bi = None, 0
    for i, p in enumerate(pal):
        d = dist(c, p)
        if best is None or d < best:
            best, bi = d, i
    return bi


# ---- the layers at HD ----

def hd_layers():
    """1.2's meadow (360 x 500) and its hedge placed where it stands, on a clear canvas of the same size."""
    w, h, bg = legacy.legacy_layer('bg')
    fw, fh, fg = legacy.legacy_layer('fg')
    fg_y = int(re.search(r'fgY:\s*(\d+)', legacy.raw()['WORLD']).group(1)) * HD
    top = [[None] * w for _ in range(h)]
    for y in range(fh):
        if 0 <= fg_y + y < h:
            top[fg_y + y] = [c[:3] if c[3] >= 128 else None for c in fg[y]]
    return (w, h, [[c[:3] for c in r] for r in bg]), (w, h, top)


# ---- the palette ----

def palette(bg, fg, art):
    """Every colour the sprites use, plus SCENERY_COLOURS more for the meadow and the hedge, picked by a weighted
    k-means over their pixels in which the sprites' colours are fixed centres. Each free colour is snapped to a real
    colour of the art, so nothing on the farm is a colour the artist didn't draw."""
    fixed = []
    seen = set()
    for k in art:
        for r in art[k].p:
            for c in r:
                if c and c[:3] not in seen:
                    seen.add(c[:3])
                    fixed.append(c[:3])
    fixed.sort()
    hist = {}
    for _, _, rows in (bg, fg):
        for r in rows:
            for c in r:
                if c is not None:
                    hist[c] = hist.get(c, 0) + 1
    pts = sorted(hist.items())
    # Farthest-point start: the colour the fixed set serves worst, by weight.
    free = []
    near = [min(dist(c, f) for f in fixed) for c, _ in pts]
    for _ in range(SCENERY_COLOURS):
        i = max(range(len(pts)), key=lambda j: (near[j] * pts[j][1], -j))
        if near[i] == 0:
            break
        free.append(pts[i][0])
        for j, (c, _) in enumerate(pts):
            near[j] = min(near[j], dist(c, pts[i][0]))
    nf = len(fixed)
    for _ in range(8):
        centres = fixed + free
        sums = [[0, 0, 0, 0] for _ in free]
        for c, n in pts:
            i = nearest(c, centres)
            if i >= nf:
                s = sums[i - nf]
                s[0] += c[0] * n
                s[1] += c[1] * n
                s[2] += c[2] * n
                s[3] += n
        free = [(s[0] / s[3], s[1] / s[3], s[2] / s[3]) if s[3] else f for s, f in zip(sums, free)]
    # Snap each free centre to the heaviest real colour among those nearest it.
    centres = fixed + free
    members = {}
    for c, n in pts:
        i = nearest(c, centres)
        if i >= nf:
            members.setdefault(i, []).append((c, n))
    snapped = []
    for i in range(nf, len(centres)):
        ms = members.get(i)
        if not ms:
            continue
        cen = centres[i]
        c = min(ms, key=lambda m: (dist(m[0], cen) / (1 + m[1]) ** 0.5, m[0]))[0]
        if c not in snapped and c not in seen:
            snapped.append(c)
    pal = fixed + sorted(snapped)
    # The meadow's commonest colour goes first: the renderer paints index 0 wherever the meadow has no pixel.
    ix = indexer(pal)
    use = {}
    for c, n in pts:
        i = ix(c)
        use[i] = use.get(i, 0) + n
    first = max(sorted(use), key=lambda i: use[i])
    pal = [pal[first]] + pal[:first] + pal[first + 1:]
    if len(pal) > MAX_PALETTE:
        raise SystemExit('term_art: %d colours, the terminal takes %d' % (len(pal), MAX_PALETTE))
    return pal


def indexer(pal):
    """Colour -> palette index, remembered: the meadow has a few hundred colours and many thousand pixels."""
    memo = {}

    def at(c):
        if c is None:
            return CLEAR
        i = memo.get(c)
        if i is None:
            i = memo[c] = nearest(c, pal)
        return i
    return at


# ---- the downscale ----

def mode_down(grid, gw, gh, k, ow, oh, ox, oy, pal, cover):
    """Mode-downscale an index grid by k: output pixel (x, y) reads grid pixels [ox + x k, ox + (x + 1) k) across and
    likewise down (outside the grid counts as clear). A pixel is drawn when at least `cover` of its block is; its
    colour is the commonest drawn index, ties going to the one nearest the block's mean."""
    out = bytearray(ow * oh)
    area = k * k
    for y in range(oh):
        for x in range(ow):
            counts = {}
            n = 0
            sr = sg = sb = 0
            for yy in range(oy + y * k, oy + (y + 1) * k):
                if yy < 0 or yy >= gh:
                    continue
                row = grid[yy]
                for xx in range(ox + x * k, ox + (x + 1) * k):
                    if xx < 0 or xx >= gw:
                        continue
                    v = row[xx]
                    if v == CLEAR:
                        continue
                    counts[v] = counts.get(v, 0) + 1
                    c = pal[v]
                    sr += c[0]
                    sg += c[1]
                    sb += c[2]
                    n += 1
            if n == 0 or n < cover * area:
                out[y * ow + x] = CLEAR
                continue
            mean = (sr / n, sg / n, sb / n)
            top = max(counts.values())
            out[y * ow + x] = min((v for v, m in counts.items() if m == top), key=lambda v: (dist(pal[v], mean), v))
    return out


def layer_at(grid, w, h, s, pal, cover):
    """A layer's terminal pixels at scale s: ceil(world / s) each way, from the top-left."""
    ow, oh = -(-w // (HD * s)), -(-h // (HD * s))
    return ow, oh, mode_down(grid, w, h, HD * s, ow, oh, 0, 0, pal, cover)


def sprite_at(grid, w, h, s, pal):
    """A sprite at scale s: ceil(world / s) each way, standing on its bottom edge and centred across, as the renderer
    places it by its feet. Thin things (legs, stalks, handles) survive: a third of a block drawn draws it."""
    k = HD * s
    ow, oh = -(-w // k), -(-h // k)
    ox = -((ow * k - w) // 2)
    oy = h - oh * k
    return ow, oh, mode_down(grid, w, h, k, ow, oh, ox, oy, pal, 1 / 3)


# ---- the bake ----

def bake(cat, art):
    """Returns {'palette': [(r, g, b)], 'layers': {(name, s): (w, h, bytes)}, 'sprites': {(id, s): (w, h, bytes)}}."""
    bg, fg = hd_layers()
    pal = palette(bg, fg, art)
    ix = indexer(pal)
    layers = {}
    for name, (w, h, rows) in (('bg', bg), ('fg', fg)):
        grid = [[ix(c) for c in r] for r in rows]
        for s in SCALES:
            # The meadow is solid; the hedge's edge is drawn where half a block is hedge.
            layers[(name, s)] = layer_at(grid, w, h, s, pal, 0 if name == 'bg' else 0.5)
    sprites = {}
    grids = {}
    for k, _ in cat:
        p = art[k]
        key = tuple(tuple(r) for r in p.p)
        if key not in grids:
            grids[key] = [[ix(c[:3]) if c else CLEAR for c in r] for r in p.p]
        for s in SCALES:
            sprites[(k, s)] = sprite_at(grids[key], p.w, p.h, s, pal)
    for (k, s), rows in term_micro.overrides(pal, ix).items():
        if (k, s) in sprites:
            sprites[(k, s)] = rows
    return {'palette': pal, 'layers': layers, 'sprites': sprites}


def blob(cat, baked):
    """Every layer and sprite as [w, h, w x h indices], layers first (bg then fg at 2, 3, 4), then each sprite in the
    catalogue's order at 2, 3, 4. Deflated raw (no zlib header), as the module's inflate reads it."""
    out = bytearray()
    for s in SCALES:
        for name in ('bg', 'fg'):
            w, h, px = baked['layers'][(name, s)]
            out += bytes((w, h)) + bytes(px)
    for k, _ in cat:
        for s in SCALES:
            w, h, px = baked['sprites'][(k, s)]
            out += bytes((w, h)) + bytes(px)
    best = None
    for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED):
        for mem in (8, 9):
            z = zlib.compressobj(9, zlib.DEFLATED, -15, mem, strategy)
            d = z.compress(bytes(out)) + z.flush()
            if best is None or len(d) < len(best):
                best = d
    return len(out), best


# ---- hooks/art_term.ts ----

TS_HEAD = '''\
// The terminal's pixel farm art, generated by scripts/build_art.py (scripts/term_art.py) from 1.2's meadow and hedge
// and the atlas's sprites: do not edit by hand. Every picture is palette indices, row by row, 255 where nothing is
// drawn, at three scales (one terminal pixel = s world px), mode-downscaled from HD with a few micro sprites painted
// by hand (scripts/term_micro.py). They travel deflated and base64'd, and are inflated once, on first use.
import type { Model, SpriteId, TermLayer } from './contracts'
'''

TS_BODY = '''\

// ---- reading it back ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 to bytes, written out: atob may not exist in every runtime. */
function unbase64(s: string): Uint8Array {
  const val = new Uint8Array(128)
  for (let i = 0; i < 64; i++) val[B64.charCodeAt(i)] = i
  const n = s.replace(/=+$/, '').length
  const out = new Uint8Array((n * 3) >> 2)
  let o = 0
  for (let i = 0; i < n; i += 4) {
    const v = (val[s.charCodeAt(i)]! << 18) | (val[s.charCodeAt(i + 1)]! << 12) |
      ((i + 2 < n ? val[s.charCodeAt(i + 2)]! : 0) << 6) | (i + 3 < n ? val[s.charCodeAt(i + 3)]! : 0)
    if (o < out.length) out[o++] = v >> 16
    if (o < out.length) out[o++] = (v >> 8) & 255
    if (o < out.length) out[o++] = v & 255
  }
  return out
}

// Raw deflate (RFC 1951), after Mark Adler's puff: canonical codes decoded a bit at a time, which is plenty for one
// small blob read once.
type Huff = { count: Uint16Array; symbol: Uint16Array }

function huff(lengths: ArrayLike<number>, n: number): Huff {
  const count = new Uint16Array(16)
  const symbol = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const len = lengths[i]!
    count[len] = count[len]! + 1
  }
  const offs = new Uint16Array(16)
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len]! + count[len]!
  for (let i = 0; i < n; i++) {
    const len = lengths[i]!
    if (len) {
      symbol[offs[len]!] = i
      offs[len] = offs[len]! + 1
    }
  }
  return { count, symbol }
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function inflate(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let o = 0
  let pos = 0
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++, pos++) v |= ((src[pos >> 3]! >> (pos & 7)) & 1) << i
    return v
  }
  const decode = (h: Huff): number => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const c = h.count[len]!
      if (code - c < first) return h.symbol[index + code - first]!
      index += c
      first = (first + c) << 1
      code <<= 1
    }
    throw new Error('art_term: bad code')
  }
  let fixed: [Huff, Huff] | undefined
  for (let last = 0; !last;) {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      pos = (pos + 7) & ~7
      const len = bits(16)
      pos += 16
      out.set(src.subarray(pos >> 3, (pos >> 3) + len), o)
      o += len
      pos += len * 8
      continue
    }
    let lit: Huff
    let dist: Huff
    if (type === 1) {
      if (!fixed) {
        const l = new Uint8Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288)
        fixed = [huff(l, 288), huff(new Uint8Array(30).fill(5), 30)]
      }
      [lit, dist] = fixed
    } else {
      const nlen = bits(5) + 257
      const ndist = bits(5) + 1
      const ncode = bits(4) + 4
      const lengths = new Uint8Array(320)
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]!] = bits(3)
      const lencode = huff(lengths, 19)
      lengths.fill(0)
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(lencode)
        if (sym < 16) { lengths[i++] = sym; continue }
        const prev = sym === 16 ? lengths[i - 1]! : 0
        const rep = sym === 16 ? 3 + bits(2) : sym === 17 ? 3 + bits(3) : 11 + bits(7)
        for (let r = 0; r < rep; r++) lengths[i++] = prev
      }
      lit = huff(lengths.subarray(0, nlen), nlen)
      dist = huff(lengths.subarray(nlen, nlen + ndist), ndist)
    }
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) { out[o++] = sym; continue }
      if (sym === 256) break
      const len = LBASE[sym - 257]! + bits(LEXT[sym - 257]!)
      const d = decode(dist)
      const back = DBASE[d]! + bits(DEXT[d]!)
      for (let i = 0; i < len; i++, o++) out[o] = out[o - back]!
    }
  }
  return out
}

// ---- the pictures, decoded once ----

let pictures: Map<string, TermLayer> | undefined

function all(): Map<string, TermLayer> {
  if (pictures) return pictures
  const raw = inflate(unbase64(DATA), SIZE)
  const m = new Map<string, TermLayer>()
  let at = 0
  const take = (key: string): void => {
    const w = raw[at]!
    const h = raw[at + 1]!
    if (w && h) m.set(key, { w, h, px: raw.subarray(at + 2, at + 2 + w * h) })
    at += 2 + w * h
  }
  for (const s of [2, 3, 4]) for (const layer of ['bg', 'fg']) take(`${layer}${s}`)
  for (const id of IDS.split(' ')) for (const s of [2, 3, 4]) take(`${id}@${s}`)
  pictures = m
  return m
}

/** The meadow (bg) or the hedge in front (fg) at scale s: the whole world, ceil(180 / s) x ceil(250 / s). */
export const termLayer = (layer: 'bg' | 'fg', s: 2 | 3 | 4): TermLayer => {
  const l = all().get(`${layer}${s}`)
  if (l) return l
  const w = Math.ceil(180 / s)
  const h = Math.ceil(250 / s)
  return { w, h, px: new Uint8Array(w * h).fill(layer === 'bg' ? 0 : 255) }
}

/** A sprite at scale s, standing on its bottom edge and centred across, or undefined where it has none. */
export const termSprite = (id: SpriteId, s: 2 | 3 | 4): TermLayer | undefined => all().get(`${id}@${s}`)
'''


def wrap(s, width=116):
    return [s[i:i + width] for i in range(0, len(s), width)]


def ts_source(cat, baked):
    size, data = blob(cat, baked)
    b64 = base64.b64encode(data).decode()
    pal = baked['palette']
    out = [TS_HEAD]
    out.append('/** Index -> 0xRRGGBB, in daylight; the renderer tints for the sky and the season. */')
    out.append('export const TERM_PALETTE: readonly number[] = [')
    line = ''
    for c in pal:
        part = '0x%02x%02x%02x,' % c
        if len(line) + len(part) + 1 > 118:
            out.append(line)
            line = ''
        line += '  ' + part if not line else ' ' + part
    if line:
        out.append(line)
    out.append(']')
    out.append('')
    ix = indexer(pal)
    bands = [('hat', term_micro.HAT_BAND)] + list(term_micro.MODEL_BANDS.items())
    out.append('/**')
    out.append(" * Palette indices of the straw hat's red band (light, mid, dark) and of each model's band, in the same order:")
    out.append(" * swap one for the other to dress the working crab's hat in the colour of the model driving it.")
    out.append(' */')
    out.append("export const TERM_BANDS: Readonly<Record<'hat' | Model, readonly [number, number, number]>> = {")
    out.append('  ' + ', '.join('%s: [%s]' % (k, ', '.join(str(ix(c[:3])) for c in v)) for k, v in bands) + ',')
    out.append('}')
    out.append('')
    out.append('// The sprites in the order the data holds them (SPRITE_SIZES\'s, when this was built).')
    out.append('const IDS =')
    chunks, line = [], ''
    for k, _ in cat:
        if line and len(line) + len(k) + 1 > 110:
            chunks.append(line)
            line = ''
        line += (' ' if line else '') + k
    chunks.append(line)
    chunks = [c + ' ' if i < len(chunks) - 1 else c for i, c in enumerate(chunks)]
    for i, ch in enumerate(chunks):
        out.append("  '%s'%s" % (ch, ' +' if i < len(chunks) - 1 else ''))
    out.append('const SIZE = %d' % size)
    out.append('const DATA =')
    chunks = wrap(b64, 112)
    for i, ch in enumerate(chunks):
        out.append("  '%s'%s" % (ch, ' +' if i < len(chunks) - 1 else ''))
    src = '\n'.join(out) + '\n' + TS_BODY
    return src
