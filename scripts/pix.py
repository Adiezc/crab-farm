# A small pixel toolkit in the shape of clodfarm's Pix grid: set, rect, shaded oval, line, ink outline, blit, flip,
# and paint() from row strings with a palette. Colours are (r, g, b, a) tuples; None is transparent.


def hx(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


class Pix:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = [[None] * w for _ in range(h)]

    @staticmethod
    def of(rows):
        """From RGBA rows (alpha 0 is transparent)."""
        q = Pix(len(rows[0]), len(rows))
        q.p = [[c if c and c[3] else None for c in r] for r in rows]
        return q

    def copy(self):
        q = Pix(self.w, self.h)
        q.p = [r[:] for r in self.p]
        return q

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c:
            self.p[y][x] = c

    def clear(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y][x] = None

    def get(self, x, y):
        return self.p[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def erase(self, x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.clear(xx, yy)

    def oval(self, cx, cy, rx, ry, c):
        """A filled ellipse; `c` may be a function of (u, v) in -1..1 for clodfarm-style shading."""
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                u = (x + .5 - cx) / rx
                v = (y + .5 - cy) / ry
                if u * u + v * v <= 1:
                    self.set(x, y, c(u, v) if callable(c) else c)

    def line(self, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            self.set(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)

    def outline(self, c, corners=False):
        """Ink every empty pixel next to a drawn one (4-neighbours, or 8 with corners)."""
        ns = ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (-1, 1), (1, -1), (-1, -1)) if corners else ())
        q = [r[:] for r in self.p]
        for y in range(self.h):
            for x in range(self.w):
                if self.p[y][x] is None and any(self.get(x + dx, y + dy) not in (None, c) for dx, dy in ns):
                    q[y][x] = c
        self.p = q
        return self

    def blit(self, other, ox, oy):
        for y in range(other.h):
            for x in range(other.w):
                if other.p[y][x]:
                    self.set(ox + x, oy + y, other.p[y][x])
        return self

    def flipx(self):
        q = Pix(self.w, self.h)
        q.p = [r[::-1] for r in self.p]
        return q

    def recolor(self, m):
        q = self.copy()
        q.p = [[m.get(c, c) if c else None for c in r] for r in q.p]
        return q

    def crop(self, x, y, w, h):
        q = Pix(w, h)
        for yy in range(h):
            for xx in range(w):
                q.p[yy][xx] = self.get(x + xx, y + yy)
        return q

    def shift(self, dx, dy):
        q = Pix(self.w, self.h)
        q.blit(self, dx, dy)
        return q

    def colours(self):
        return {c for r in self.p for c in r if c}

    def rgba(self):
        return [[c if c else (0, 0, 0, 0) for c in r] for r in self.p]


def paint(rows, pal):
    """Rows of characters -> Pix; '.' and ' ' are transparent, every other character is looked up in `pal`."""
    rows = [r for r in rows]
    q = Pix(max(len(r) for r in rows), len(rows))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch not in '. ':
                q.p[y][x] = pal[ch]
    return q


def shade(base, hi, lo, k=0.6):
    """clodfarm's light-from-the-top-left shading for oval(): a highlight, a body and a shadow band."""
    return lambda u, v: hi if (u + v) < -k else lo if (u + v) > k else base


# A 3 × 5 font for labelling the contact sheet.
FONT = {
    'a': '010101111101101', 'b': '110101110101110', 'c': '011100100100011', 'd': '110101101101110',
    'e': '111100110100111', 'f': '111100110100100', 'g': '011100101101011', 'h': '101101111101101',
    'i': '111010010010111', 'j': '001001001101010', 'k': '101101110101101', 'l': '100100100100111',
    'm': '101111111101101', 'n': '110101101101101', 'o': '010101101101010', 'p': '110101110100100',
    'q': '010101101110011', 'r': '110101110101101', 's': '011100010001110', 't': '111010010010010',
    'u': '101101101101111', 'v': '101101101101010', 'w': '101101111111101', 'x': '101101010101101',
    'y': '101101010010010', 'z': '111001010100111', '0': '111101101101111', '1': '010110010010111',
    '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
    '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
    '_': '000000000000111', ' ': '000000000000000', '-': '000000111000000', '.': '000000000000010',
    '/': '001001010100100', '(': '010100100100010', ')': '010001001001010', 'x2': '',
}


def text(img, x, y, s, c):
    """Write `s` into an RGBA row image at (x, y) in the 3 × 5 font."""
    for ch in s.lower():
        g = FONT.get(ch, FONT[' '])
        for i, bit in enumerate(g):
            if bit == '1':
                yy, xx = y + i // 3, x + i % 3
                if 0 <= yy < len(img) and 0 <= xx < len(img[0]):
                    img[yy][xx] = c
        x += 4
    return x
