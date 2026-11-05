# A dependency-free decoder for lossless WebP (VP8L, RFC 9649), enough to read the BG and FG that 1.2 ships, so
# the build can bake the terminal's downscaled farm from the very pixels the desktop shows.
import struct

DIST_MAP = [
    (0, 1), (1, 0), (1, 1), (-1, 1), (0, 2), (2, 0), (1, 2), (-1, 2), (2, 1), (-2, 1), (2, 2), (-2, 2), (0, 3), (3, 0),
    (1, 3), (-1, 3), (3, 1), (-3, 1), (2, 3), (-2, 3), (3, 2), (-3, 2), (0, 4), (4, 0), (1, 4), (-1, 4), (4, 1), (-4, 1),
    (3, 3), (-3, 3), (2, 4), (-2, 4), (4, 2), (-4, 2), (0, 5), (3, 4), (-3, 4), (4, 3), (-4, 3), (5, 0), (1, 5), (-1, 5),
    (5, 1), (-5, 1), (2, 5), (-2, 5), (5, 2), (-5, 2), (4, 4), (-4, 4), (3, 5), (-3, 5), (5, 3), (-5, 3), (0, 6), (6, 0),
    (1, 6), (-1, 6), (6, 1), (-6, 1), (2, 6), (-2, 6), (6, 2), (-6, 2), (4, 5), (-4, 5), (5, 4), (-5, 4), (3, 6), (-3, 6),
    (6, 3), (-6, 3), (0, 7), (7, 0), (1, 7), (-1, 7), (5, 5), (-5, 5), (7, 1), (-7, 1), (4, 6), (-4, 6), (6, 4), (-6, 4),
    (2, 7), (-2, 7), (7, 2), (-7, 2), (3, 7), (-3, 7), (7, 3), (-7, 3), (5, 6), (-5, 6), (6, 5), (-6, 5), (8, 0), (4, 7),
    (-4, 7), (7, 4), (-7, 4), (8, 1), (8, 2), (6, 6), (-6, 6), (8, 3), (5, 7), (-5, 7), (7, 5), (-7, 5), (8, 4), (6, 7),
    (-6, 7), (7, 6), (-7, 6), (8, 5), (7, 7), (-7, 7), (8, 6), (8, 7),
]
CL_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]


class Bits:
    def __init__(self, data):
        self.d = bytes(data) + bytes(8)
        self.pos = 0

    def peek(self, k):
        p = self.pos
        return (int.from_bytes(self.d[p >> 3:(p >> 3) + 4], 'little') >> (p & 7)) & ((1 << k) - 1)

    def read(self, k):
        v = self.peek(k)
        self.pos += k
        return v


class Code:
    """A canonical prefix code, decoded with one table lookup on the next `bits` bits of the stream."""

    def __init__(self, lengths):
        used = [(s, l) for s, l in enumerate(lengths) if l]
        self.single = used[0][0] if len(used) == 1 else (0 if not used else None)
        if self.single is not None:
            return
        mx = max(l for _, l in used)
        count = [0] * (mx + 1)
        for _, l in used:
            count[l] += 1
        code, nxt = 0, [0] * (mx + 2)
        for b in range(1, mx + 1):
            code = (code + count[b - 1]) << 1
            nxt[b] = code
        self.bits = mx
        self.table = [None] * (1 << mx)
        for s, l in used:
            c = nxt[l]
            nxt[l] += 1
            r = int(format(c, '0%db' % l)[::-1], 2)
            for f in range(1 << (mx - l)):
                self.table[r | (f << l)] = (s, l)

    def read(self, br):
        if self.single is not None:
            return self.single
        s, l = self.table[br.peek(self.bits)]
        br.pos += l
        return s


def read_code(br, size):
    if br.read(1):
        n = br.read(1) + 1
        first8 = br.read(1)
        lengths = [0] * size
        s0 = br.read(1 + 7 * first8)
        lengths[s0] = 1
        if n == 2:
            lengths[br.read(8)] = 1
        return Code(lengths)
    ncl = 4 + br.read(4)
    cl = [0] * 19
    for i in range(ncl):
        cl[CL_ORDER[i]] = br.read(3)
    clc = Code(cl)
    if br.read(1):
        nbits = 2 + 2 * br.read(3)
        max_sym = 2 + br.read(nbits)
    else:
        max_sym = size
    lengths = [0] * size
    sym, prev = 0, 8
    while sym < size:
        if max_sym == 0:
            break
        max_sym -= 1
        c = clc.read(br)
        if c < 16:
            lengths[sym] = c
            sym += 1
            if c:
                prev = c
        else:
            rep, val = ((3 + br.read(2), prev) if c == 16 else (3 + br.read(3), 0) if c == 17 else (11 + br.read(7), 0))
            for _ in range(rep):
                lengths[sym] = val
                sym += 1
    return Code(lengths)


def _prefix_value(br, p):
    if p < 4:
        return p + 1
    extra = (p - 2) >> 1
    return ((2 + (p & 1)) << extra) + br.read(extra) + 1


def decode_image(br, w, h, is_main):
    cache_bits = br.read(4) if br.read(1) else 0
    cache_size = (1 << cache_bits) if cache_bits else 0
    meta_bits, meta = 0, None
    groups_n = 1
    if is_main and br.read(1):
        meta_bits = br.read(3) + 2
        mw = -(-w // (1 << meta_bits))
        mh = -(-h // (1 << meta_bits))
        meta = decode_image(br, mw, mh, False)
        meta = [(p >> 8) & 0xffff for p in meta]
        groups_n = max(meta) + 1
        mw_ = mw
    groups = []
    for _ in range(groups_n):
        groups.append([read_code(br, 256 + 24 + cache_size), read_code(br, 256), read_code(br, 256),
                       read_code(br, 256), read_code(br, 40)])
    cache = [0] * cache_size
    shift = 32 - cache_bits
    out = [0] * (w * h)
    i, n = 0, w * h
    last_pos = -1

    def add(c):
        if cache_bits:
            cache[((0x1e35a7bd * c) & 0xffffffff) >> shift] = c

    while i < n:
        if meta is not None:
            x, y = i % w, i // w
            g = groups[meta[(y >> meta_bits) * mw_ + (x >> meta_bits)]]
        else:
            g = groups[0]
        s = g[0].read(br)
        if s < 256:
            r = g[1].read(br)
            b = g[2].read(br)
            a = g[3].read(br)
            c = (a << 24) | (r << 16) | (s << 8) | b
            out[i] = c
            add(c)
            i += 1
        elif s < 280:
            length = _prefix_value(br, s - 256)
            dcode = _prefix_value(br, g[4].read(br))
            if dcode > 120:
                dist = dcode - 120
            else:
                dx, dy = DIST_MAP[dcode - 1]
                dist = max(1, dx + dy * w)
            for _ in range(length):
                c = out[i - dist]
                out[i] = c
                add(c)
                i += 1
        else:
            c = cache[s - 280]
            out[i] = c
            add(c)
            i += 1
    return out


def _avg(a, b):
    return (((a ^ b) & 0xfefefefe) >> 1) + (a & b)


def _ch(c):
    return ((c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255)


def _pack(t):
    return (t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]


def _clamp(v):
    return 0 if v < 0 else 255 if v > 255 else v


def _predict(mode, L, T, TR, TL):
    if mode == 0:
        return 0xff000000
    if mode == 1:
        return L
    if mode == 2:
        return T
    if mode == 3:
        return TR
    if mode == 4:
        return TL
    if mode == 5:
        return _avg(_avg(L, TR), T)
    if mode == 6:
        return _avg(L, TL)
    if mode == 7:
        return _avg(L, T)
    if mode == 8:
        return _avg(TL, T)
    if mode == 9:
        return _avg(T, TR)
    if mode == 10:
        return _avg(_avg(L, TL), _avg(T, TR))
    l, t, tl = _ch(L), _ch(T), _ch(TL)
    if mode == 11:
        pl = sum(abs(t[k] - tl[k]) for k in range(4))
        pt = sum(abs(l[k] - tl[k]) for k in range(4))
        return L if pl < pt else T
    if mode == 12:
        return _pack(tuple(_clamp(l[k] + t[k] - tl[k]) for k in range(4)))
    a = _ch(_avg(L, T))
    return _pack(tuple(_clamp(a[k] + int((a[k] - tl[k]) / 2)) for k in range(4)))


def _add(a, b):
    return (((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00) | (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff)


def _s8(v):
    return v - 256 if v > 127 else v


def decode(data):
    """WebP (lossless) bytes -> (width, height, rows of RGBA tuples)."""
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    i, vp8l = 12, None
    while i < len(data):
        kind = data[i:i + 4]
        n, = struct.unpack('<I', data[i + 4:i + 8])
        if kind == b'VP8L':
            vp8l = data[i + 8:i + 8 + n]
        i += 8 + n + (n & 1)
    assert vp8l and vp8l[0] == 0x2f, 'only lossless WebP is supported'
    br = Bits(vp8l[1:])
    w = br.read(14) + 1
    h = br.read(14) + 1
    br.read(1)
    assert br.read(3) == 0
    xs = w
    transforms = []
    while br.read(1):
        t = br.read(2)
        if t in (0, 1):
            bits = br.read(3) + 2
            bw, bh = -(-xs // (1 << bits)), -(-h // (1 << bits))
            transforms.append((t, bits, bw, decode_image(br, bw, bh, False), xs))
        elif t == 2:
            transforms.append((2, xs))
        else:
            size = br.read(8) + 1
            table = decode_image(br, size, 1, False)
            for k in range(1, size):
                table[k] = _add(table[k], table[k - 1])
            wb = 3 if size <= 2 else 2 if size <= 4 else 1 if size <= 16 else 0
            transforms.append((3, wb, table, xs))
            xs = -(-xs // (1 << wb))
    px = decode_image(br, xs, h, True)
    for tr in reversed(transforms):
        if tr[0] == 0:
            _, bits, bw, img, tw = tr
            out = px
            for y in range(h):
                for x in range(tw):
                    k = y * tw + x
                    if y == 0:
                        p = 0xff000000 if x == 0 else out[k - 1]
                    elif x == 0:
                        p = out[k - tw]
                    else:
                        mode = (img[(y >> bits) * bw + (x >> bits)] >> 8) & 15
                        tr_ = out[k - tw + 1] if x < tw - 1 else out[y * tw]
                        p = _predict(mode, out[k - 1], out[k - tw], tr_, out[k - tw - 1])
                    out[k] = _add(out[k], p)
        elif tr[0] == 1:
            _, bits, bw, img, tw = tr
            for y in range(h):
                for x in range(tw):
                    k = y * tw + x
                    e = img[(y >> bits) * bw + (x >> bits)]
                    g2r, g2b, r2b = _s8(e & 255), _s8((e >> 8) & 255), _s8((e >> 16) & 255)
                    a, r, g, b = _ch(px[k])
                    r = (r + ((g2r * _s8(g)) >> 5)) & 255
                    b = (b + ((g2b * _s8(g)) >> 5)) & 255
                    b = (b + ((r2b * _s8(r)) >> 5)) & 255
                    px[k] = (a << 24) | (r << 16) | (g << 8) | b
        elif tr[0] == 2:
            for k, c in enumerate(px):
                g = (c >> 8) & 255
                px[k] = (c & 0xff00ff00) | ((((c >> 16) + g) & 255) << 16) | (((c & 255) + g) & 255)
        else:
            _, wb, table, tw = tr
            per = 1 << wb
            bpp = 8 >> wb
            pw = -(-tw // per)
            out = [0] * (tw * h)
            for y in range(h):
                for x in range(tw):
                    v = (px[y * pw + x // per] >> 8) & 255
                    k = (v >> ((x % per) * bpp)) & ((1 << bpp) - 1)
                    out[y * tw + x] = table[k] if k < len(table) else 0
            px = out
    rows = []
    for y in range(h):
        row = []
        for x in range(w):
            a, r, g, b = _ch(px[y * w + x])
            row.append((r, g, b, a) if a else (0, 0, 0, 0))
        rows.append(row)
    return w, h, rows
