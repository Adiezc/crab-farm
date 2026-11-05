# A small, dependency-free PNG codec: enough to read the sprites baked into 1.2 and to write indexed atlases.
# Pixels are lists of rows of (r, g, b, a) tuples. Output is deterministic for a given zlib build.
import struct
import zlib

SIG = b'\x89PNG\r\n\x1a\n'


def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def decode(data):
    """PNG bytes -> (width, height, rows of RGBA tuples). Handles 8-bit and indexed, non-interlaced."""
    assert data[:8] == SIG, 'not a PNG'
    i, idat, plte, trns = 8, b'', None, None
    w = h = bd = ct = 0
    while i < len(data):
        n, = struct.unpack('>I', data[i:i + 4])
        kind, body = data[i + 4:i + 8], data[i + 8:i + 8 + n]
        i += 12 + n
        if kind == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', body)
            assert il == 0, 'interlaced PNG'
        elif kind == b'PLTE':
            plte = [tuple(body[j:j + 3]) for j in range(0, len(body), 3)]
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IDAT':
            idat += body
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    assert bd == 8 or ct == 3, 'unsupported bit depth'
    raw = zlib.decompress(idat)
    stride = (w * ch * bd + 7) // 8
    bpp = max(1, ch * bd // 8)
    prev = bytearray(stride)
    p = 0
    lines = []
    for _ in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            up = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + up) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + up) >> 1)) & 255
            elif f == 4:
                line[x] = (line[x] + _paeth(a, up, c)) & 255
        lines.append(line)
        prev = line
    px = []
    for line in lines:
        row = []
        for x in range(w):
            if ct == 3:
                k = (line[(x * bd) // 8] >> (8 - bd - (x * bd) % 8)) & ((1 << bd) - 1)
                a = trns[k] if trns and k < len(trns) else 255
                row.append((*plte[k], a) if a else (0, 0, 0, 0))
            else:
                v = line[x * ch:(x + 1) * ch]
                if ct == 6:
                    row.append(tuple(v) if v[3] else (0, 0, 0, 0))
                elif ct == 2:
                    row.append((v[0], v[1], v[2], 255))
                elif ct == 0:
                    row.append((v[0], v[0], v[0], 255))
                else:
                    row.append((v[0], v[0], v[0], v[1]) if v[1] else (0, 0, 0, 0))
        px.append(row)
    return w, h, px


def _filter(rows, bpp, f):
    out = bytearray()
    prev = bytes(len(rows[0]))
    for r in rows:
        out.append(f)
        for x in range(len(r)):
            a = r[x - bpp] if x >= bpp else 0
            up = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            pred = (0, a, up, (a + up) >> 1, _paeth(a, up, c))[f]
            out.append((r[x] - pred) & 255)
        prev = r
    return bytes(out)


def _deflate(raw):
    best = None
    for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED):
        for mem in (8, 9):
            z = zlib.compressobj(9, zlib.DEFLATED, 15, mem, strategy)
            d = z.compress(raw) + z.flush()
            if best is None or len(d) < len(best):
                best = d
    return best


def encode(px, palette=None):
    """RGBA rows -> PNG bytes: indexed when it has at most 256 colours (transparent first), else RGBA.
    `palette` fixes the colour order (a list of RGBA tuples) so related images share one."""
    h, w = len(px), len(px[0])
    cols = list(palette) if palette else []
    if not palette:
        seen = set()
        for row in px:
            for c in row:
                c = c if c[3] else (0, 0, 0, 0)
                if c not in seen:
                    seen.add(c)
                    cols.append(c)
        cols.sort(key=lambda c: (c[3] == 255,))
    if len(cols) <= 256:
        idx = {c: i for i, c in enumerate(cols)}
        bits = 1 if len(cols) <= 2 else 2 if len(cols) <= 4 else 4 if len(cols) <= 16 else 8
        rows = []
        for row in px:
            vals = [idx[c if c[3] else (0, 0, 0, 0)] for c in row]
            per = 8 // bits
            b = bytearray()
            for i in range(0, w, per):
                v = 0
                for k in range(per):
                    v = (v << bits) | (vals[i + k] if i + k < w else 0)
                b.append(v)
            rows.append(bytes(b))
        ihdr = struct.pack('>IIBBBBB', w, h, bits, 3, 0, 0, 0)
        ntr = sum(1 for c in cols if c[3] < 255)
        idat = min((_deflate(_filter(rows, 1, f)) for f in (0, 1, 2)), key=len)
        return (SIG + _chunk(b'IHDR', ihdr) + _chunk(b'PLTE', b''.join(bytes(c[:3]) for c in cols))
                + (_chunk(b'tRNS', bytes(c[3] for c in cols[:ntr])) if ntr else b'')
                + _chunk(b'IDAT', idat) + _chunk(b'IEND', b''))
    rows = [bytes(v for c in row for v in c) for row in px]
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = min((_deflate(_filter(rows, 4, f)) for f in (0, 4)), key=len)
    return SIG + _chunk(b'IHDR', ihdr) + _chunk(b'IDAT', idat) + _chunk(b'IEND', b'')
