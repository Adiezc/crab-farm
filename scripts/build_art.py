#!/usr/bin/env python3
# Builds the farm's art: every module in art-src/ draws sprites at HD (2 px per world px), and this script packs them
# into one indexed PNG atlas for the SVG renderers (hooks/art.ts) and bakes palette-indexed pixels for the terminal
# (hooks/art_term.ts). Dependency-free; the same inputs give the same bytes, which `--check` relies on.
#
#   python3 scripts/build_art.py            write hooks/art.ts, hooks/art_term.ts, art-src/out/sizes.json,
#                                           docs/art-sheet.png
#   python3 scripts/build_art.py --check    regenerate in memory; fail if any of those files would change
#   python3 scripts/build_art.py --strict   fail if any sprite is missing (drawn as a magenta placeholder)
#   python3 scripts/build_art.py --skip M   leave art-src/M.py out (its sprites become placeholders)
#   python3 scripts/build_art.py --sheet P  also write a 4x review sheet of the sprites to P
import base64
import importlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
SRC = os.path.join(ROOT, 'art-src')
sys.path[:0] = [HERE, SRC]

import png  # noqa: E402
from legacy import raw as legacy_raw  # noqa: E402
from pix import Pix, text  # noqa: E402

HD = 2
OUT_ART = os.path.join(ROOT, 'hooks', 'art.ts')
OUT_TERM = os.path.join(ROOT, 'hooks', 'art_term.ts')
OUT_SIZES = os.path.join(SRC, 'out', 'sizes.json')
OUT_SHEET = os.path.join(ROOT, 'docs', 'art-sheet.png')
MAGENTA = (255, 0, 255, 255)
MAGENTA_DK = (120, 0, 120, 255)


# ---- the catalogue ----

def catalogue():
    """SPRITE_SIZES from hooks/contracts.ts, in its order: [(id, (w, h))] in world px."""
    with open(os.path.join(ROOT, 'hooks', 'contracts.ts')) as f:
        src = f.read()
    m = re.search(r'export const SPRITE_SIZES = \{(.*?)\} as const', src, re.S)
    if not m:
        raise SystemExit('build_art: SPRITE_SIZES not found in hooks/contracts.ts')
    body = re.sub(r'//[^\n]*', '', m.group(1))
    return [(k, (int(w), int(h))) for k, w, h in re.findall(r'(\w+):\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', body)]


# ---- the art modules ----

def modules(skip=()):
    names = sorted(f[:-3] for f in os.listdir(SRC)
                   if f.endswith('.py') and f != 'palette.py' and not f.startswith('_'))
    return [n for n in names if n not in skip]


def collect(cat, skip=()):
    """Import every art module and merge its sprites. Returns (sprites, hat_dy, notes); a name drawn twice stops."""
    sizes = dict(cat)
    got, owner, hat_dy, notes = {}, {}, {}, []
    for name in modules(skip):
        mod = importlib.import_module(name)
        if not hasattr(mod, 'sprites'):
            notes.append('%s.py has no sprites(); skipped' % name)
            continue
        for k, p in mod.sprites().items():
            if k in owner:
                raise SystemExit('build_art: %s is drawn by both %s.py and %s.py' % (k, owner[k], name))
            owner[k] = name
            if k not in sizes:
                notes.append('%s.py draws %s, which is not in SPRITE_SIZES; left out' % (name, k))
                continue
            w, h = sizes[k]
            if (p.w, p.h) != (w * HD, h * HD):
                notes.append('%s.py draws %s at %dx%d, the catalogue says %dx%d HD; placeholder used'
                             % (name, k, p.w, p.h, w * HD, h * HD))
                continue
            got[k] = p
        hat_dy.update(getattr(mod, 'HAT_DY', {}))
    return got, owner, hat_dy, notes


def placeholder(w, h):
    """A loud magenta box with a dark cross, so a missing sprite is obvious in any picture."""
    p = Pix(w, h)
    p.rect(0, 0, w, h, MAGENTA)
    for i in range(max(w, h)):
        p.set(i * w // max(w, h), i * h // max(w, h), MAGENTA_DK)
        p.set(w - 1 - i * w // max(w, h), i * h // max(w, h), MAGENTA_DK)
    return p


# ---- the atlas ----

def key_of(p):
    return tuple(tuple(r) for r in p.p)


def pack(cat, art):
    """Shelf-pack every distinct sprite (identical pictures share one cell), cells 1 px apart. Tries a few widths and
    keeps the one whose PNG is smallest. Returns (png bytes, (w, h), {id: (x, y, w, h)})."""
    cells, where = [], {}
    for k, _ in cat:
        kk = key_of(art[k])
        if kk not in where:
            where[kk] = len(cells)
            cells.append(art[k])
    order = sorted(range(len(cells)), key=lambda i: (-cells[i].h, -cells[i].w, i))
    area = sum((c.w + 1) * (c.h + 1) for c in cells)
    widest = max(c.w for c in cells)
    best = None
    for width in sorted({max(widest, int((area * f) ** 0.5)) for f in (0.6, 0.8, 1.0, 1.3, 1.7, 2.2)}):
        pos, x, y, row = {}, 0, 0, 0
        for i in order:
            c = cells[i]
            if x + c.w > width:
                x, y, row = 0, y + row + 1, 0
            pos[i] = (x, y)
            x += c.w + 1
            row = max(row, c.h)
        h = y + row
        img = Pix(width, h)
        for i, (x, y) in pos.items():
            img.blit(cells[i], x, y)
        data = png.encode(img.rgba())
        if best is None or len(data) < len(best[0]):
            best = (data, (width, h), pos)
    data, size, pos = best
    sym = {}
    for k, _ in cat:
        i = where[key_of(art[k])]
        sym[k] = (pos[i][0], pos[i][1], cells[i].w, cells[i].h)
    return data, size, sym


def uri(kind, data):
    return 'data:image/%s;base64,%s' % (kind, base64.b64encode(data).decode())


# ---- hooks/art.ts ----

def art_ts(cat, atlas_uri, atlas_size, sym, hat_dy):
    L = legacy_raw()
    head = L['header'].rstrip('\n').split('\n')
    head = [ln for ln in head if not ln.startswith('// Do not edit')]
    out = head + [
        '// The atlas (ATLAS, SYMBOLS, HAT_DY) is packed from art-src/: 1.2\'s sprites, poses recombined from their pixels,',
        '// and new sprites drawn in clodfarm\'s palettes and style. Generated by scripts/build_art.py: do not edit by hand;',
        '// see CREDITS.md.',
        "import type { Pose, SpriteId } from './contracts'",
        '',
        'export const WORLD = %s as const' % L['WORLD'],
        'export const LAYOUT = %s as const' % L['LAYOUT'],
        '',
        'export const BG = %s' % json.dumps(L['BG']),
        'export const FG = %s' % json.dumps(L['FG']),
        '',
        '// 1.2\'s sprites as one image each, kept until the renderers move to the atlas.',
        'export const SPRITES: Record<string, string> = {',
    ]
    out += ['%s: %s,' % (json.dumps(k), json.dumps(v)) for k, v in L['SPRITES']]
    out += ['}', '', 'export const ICONS: Record<string, string> = {']
    out += ['%s: %s,' % (json.dumps(k), json.dumps(v)) for k, v in L['ICONS']]
    out += [
        '}',
        '',
        '/** Every sprite in one indexed PNG at HD (2 px per world px), cells 1 px apart. */',
        "export const ATLAS = '%s'" % atlas_uri,
        'export const ATLAS_SIZE = { w: %d, h: %d } as const' % atlas_size,
        '/** Where each sprite sits in the atlas: [x, y, w, h] in atlas px. Identical pictures share a cell. */',
        'export const SYMBOLS: Readonly<Record<SpriteId, readonly [number, number, number, number]>> = {',
    ]
    line = ''
    for k, _ in cat:
        part = '%s: [%d, %d, %d, %d],' % ((k,) + sym[k])
        if len(line) + len(part) + 1 > 118:
            out.append(line.rstrip())
            line = ''
        line += '  ' + part if not line else ' ' + part
    if line:
        out.append(line.rstrip())
    out += ['}']
    dy = ', '.join('%s: %s' % (k, _num(v)) for k, v in sorted(hat_dy.items()) if v)
    out += [
        '/** How far the hat moves down (world px) from where it sits on a standing crab, per pose. */',
        'export const HAT_DY: Readonly<Partial<Record<Pose, number>>> = { %s }' % dy if dy else
        'export const HAT_DY: Readonly<Partial<Record<Pose, number>>> = {}',
        '',
    ]
    return '\n'.join(out)


def _num(v):
    return ('%d' % v) if float(v).is_integer() else ('%g' % v)


# ---- hooks/art_term.ts ----

def term_bake(cat, art):
    """STUB: the terminal art, until the baker lands."""
    src = open(OUT_TERM).read()
    return {'source': src, 'palette': [0, 0]}


# ---- the contact sheet ----

SHEET_BG = (113, 146, 60, 255)


def sheet(cat, art, missing, scale=2, width=1280):
    """Every sprite at `scale` HD px per pixel (4x world at the default), labelled, on the meadow's mid green."""
    pad = 10
    places, x, y, row = [], pad, pad, 0
    for k, _ in cat:
        p = art[k]
        w = max(p.w * scale, len(k) * 4)
        if x + w > width - pad:
            x, y, row = pad, y + row + pad, 0
        places.append((k, p, x, y))
        x += w + pad
        row = max(row, p.h * scale + 8)
    h = y + row + pad
    img = [[SHEET_BG] * width for _ in range(h)]
    for k, p, x, y in places:
        for yy in range(p.h):
            for xx in range(p.w):
                c = p.p[yy][xx]
                if c:
                    for a in range(scale):
                        r = img[y + yy * scale + a]
                        for b in range(scale):
                            r[x + xx * scale + b] = c
        text(img, x, y + p.h * scale + 2, k, (120, 0, 120, 255) if k in missing else (24, 32, 16, 255))
    return png.encode(img)


# ---- main ----

def build(skip=(), strict=False, quiet=False):
    cat = catalogue()
    art, owner, hat_dy, notes = collect(cat, skip)
    missing = [k for k, _ in cat if k not in art]
    for k, (w, h) in cat:
        if k not in art:
            art[k] = placeholder(w * HD, h * HD)
    data, size, sym = pack(cat, art)
    atlas_uri = uri('png', data)
    files = {}
    files[OUT_ART] = art_ts(cat, atlas_uri, size, sym, hat_dy).encode()
    t = term_bake(cat, art)
    files[OUT_TERM] = t['source'].encode()
    sizes = {
        'atlasChars': len(atlas_uri), 'atlasSize': list(size), 'cells': len({sym[k][:2] for k, _ in cat}),
        'bgChars': len(legacy_raw()['BG']), 'fgChars': len(legacy_raw()['FG']),
        'termChars': len(t['source']), 'termPalette': len(t['palette']),
        'missing': missing,
        'sprites': {k: {'w': w, 'h': h, 'opaque': sum(1 for r in art[k].p for c in r if c)} for k, (w, h) in cat},
    }
    files[OUT_SIZES] = (json.dumps(sizes, indent=1, sort_keys=True) + '\n').encode()
    files[OUT_SHEET] = sheet(cat, art, set(missing))
    if not quiet:
        for n in notes:
            print('note:', n)
        if missing:
            print('placeholders (%d): %s' % (len(missing), ' '.join(missing)))
        print('atlas %dx%d, %d cells, %d chars; art_term.ts %d chars, palette %d'
              % (size[0], size[1], sizes['cells'], len(atlas_uri), len(t['source']), len(t['palette'])))
    if strict and missing:
        raise SystemExit('build_art: %d sprites missing' % len(missing))
    return files, art, sym


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def main(argv):
    check = '--check' in argv
    strict = '--strict' in argv
    skip = [argv[i + 1] for i, a in enumerate(argv) if a == '--skip' and i + 1 < len(argv)]
    review = [argv[i + 1] for i, a in enumerate(argv) if a == '--sheet' and i + 1 < len(argv)]
    files, art, _ = build(skip, strict)
    if check:
        stale = []
        for path, data in files.items():
            try:
                with open(path, 'rb') as f:
                    if f.read() != data:
                        stale.append(path)
            except FileNotFoundError:
                stale.append(path)
        if stale:
            raise SystemExit('build_art --check: out of date: %s' % ', '.join(os.path.relpath(p, ROOT) for p in stale))
        print('build_art --check: up to date')
        return
    for path, data in files.items():
        write_atomic(path, data)
    for path in review:
        cat = catalogue()
        write_atomic(path, sheet(cat, art, set(), scale=4, width=1800))


if __name__ == '__main__':
    main(sys.argv[1:])
