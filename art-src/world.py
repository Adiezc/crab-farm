# The farm's animals, wildlife and weather, and its first twelve builds, drawn new in the look of the world 1.2 baked
# from clodfarm: 2 px per world px, dark inked outlines, soft three-tone shading lit from the top left, and only
# clodfarm's colours. Animals face right (the renderer mirrors one walking left). Everything stands on its bottom edge.
from palette import (INK2, NIGHT, WHITE, STRAW, RED, CREAM, WOOD, STONE, WATER, LEAF, BLUE, GOLD, PINK, FLOWER,
                     FEATHER, FOX, CAT, PURPLE)
from pix import Pix, paint, hx

# Colours that are this module's own: the cool shade of snow and cloud.
SNOW = dict(hi=WHITE, mid=hx('#eef2f6'), lo=hx('#c9d6e3'), edge=hx('#7f93a8'))


def soft(hi, mid, lo, k=.5):
    """clodfarm's light from the top left for oval(): a highlight cap, the body, a shadow band low and to the right."""
    return lambda u, v: hi if u * .6 + v < -k else lo if u * .35 + v > k else mid


def ink(p, c=INK2):
    return p.outline(c)


def rot90(p):
    """A square Pix turned a quarter clockwise about its centre (exact, so the blades stay symmetric)."""
    q = Pix(p.h, p.w)
    for y in range(p.h):
        for x in range(p.w):
            q.p[x][p.h - 1 - y] = p.p[y][x]
    return q


def shingles(p, x0, y0, x1, y1, inside, base=RED['roof'], line=RED['roof2'], hi=RED['deep']):
    """The barn's roof: rows of shingles 3 px tall with staggered joints, over the pixels `inside(x, y)` allows."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            if not inside(x, y):
                continue
            r = (y - y0) % 3
            c = line if r == 2 else hi if r == 0 and (x + (y - y0) // 3 * 2) % 5 == 0 else base
            if r != 2 and (x + ((y - y0) // 3) * 3) % 6 == 0:
                c = line
            p.set(x, y, c)


# ---------------------------------------------------------------- animals

def hen(peck):
    p = Pix(12, 12)
    fe = soft(FEATHER['hi'], FEATHER['mid'], FEATHER['dk'])
    p.oval(2.7, 4.6, 1.7, 2.3, fe)                       # the tail, cocked up at the back
    p.oval(5.6, 6.8, 4.2, 2.8, fe)                       # the body
    headx, heady = (8.6, 3.4) if not peck else (9.3, 6.6)
    p.oval(headx, heady, 1.9, 1.9, fe)                    # the head, down to the ground when it pecks
    ink(p)
    cx, cy = int(headx), int(heady)
    if not peck:
        p.set(cx, cy - 2, FEATHER['comb']); p.set(cx - 1, cy - 2, FEATHER['comb']); p.set(cx, cy - 3, FEATHER['comb'])
        p.set(cx + 1, cy, NIGHT)
        p.set(cx + 2, cy, FEATHER['beak']); p.set(cx + 3, cy, FEATHER['beak2'])
        p.set(cx + 1, cy + 1, FEATHER['comb'])
    else:
        p.set(cx, cy - 2, FEATHER['comb']); p.set(cx + 1, cy - 2, FEATHER['comb'])
        p.set(cx + 1, cy - 1, NIGHT)
        p.set(cx + 2, cy + 1, FEATHER['beak']); p.set(cx + 2, cy + 2, FEATHER['beak2'])
    p.set(4, 6, FEATHER['dk']); p.set(5, 7, FEATHER['dk']); p.set(6, 7, FEATHER['dk'])   # the wing
    for x in (5, 7):
        p.set(x, 10, FEATHER['beak2']); p.set(x, 11, FEATHER['beak2'])
    return p


def chick():
    p = Pix(6, 6)
    p.oval(2.8, 2.9, 2.3, 2.0, soft(GOLD['pale'], GOLD['hi'], GOLD['mid']))
    ink(p, GOLD['deep'])
    p.set(3, 2, NIGHT)
    p.set(5, 3, FOX['mid'])
    p.set(2, 5, FOX['dk']); p.set(4, 5, FOX['dk'])
    return p


def cat_sleep():
    p = Pix(16, 10)
    fur = soft(CAT['hi'], CAT['mid'], CAT['dk'])
    p.oval(6.4, 6.4, 5.8, 2.6, fur)                       # curled body
    p.oval(12.0, 5.8, 2.5, 2.3, fur)                      # head resting on the paws
    for x, y in ((10, 2), (10, 1), (11, 2), (13, 2), (14, 2), (14, 1)):
        p.set(x, y, CAT['mid'])                           # two ears with a notch between
    ink(p)
    p.set(10, 1, CAT['dk']); p.set(14, 1, CAT['dk'])
    for x in (3, 6):                                      # tabby stripes
        p.set(x, 4, CAT['stripe']); p.set(x, 5, CAT['stripe']); p.set(x + 1, 4, CAT['stripe'])
    p.set(11, 5, NIGHT); p.set(13, 5, NIGHT)              # eyes shut
    p.set(12, 6, RED['pink'])
    p.set(14, 7, FEATHER['mid']); p.set(13, 7, FEATHER['mid'])
    for x in range(2, 11):                                # the tail wrapped round the front
        p.set(x, 8, CAT['stripe'] if x % 3 == 0 else CAT['dk'])
    for x in range(3, 10):
        p.set(x, 7, CAT['mid'])
    p.set(11, 8, CAT['hi'])
    return p


def cat_sit():
    p = Pix(12, 14)
    fur = soft(CAT['hi'], CAT['mid'], CAT['dk'])
    p.oval(5.4, 9.6, 3.8, 3.8, fur)                       # haunches
    p.oval(6.2, 4.8, 3.2, 2.9, fur)                       # head
    for x, y in ((3, 1), (3, 2), (4, 2), (9, 1), (9, 2), (8, 2)):
        p.set(x, y, CAT['mid'])
    p.rect(1, 11, 2, 2, CAT['mid'])                       # tail on the ground
    ink(p)
    p.set(3, 1, RED['pink']); p.set(9, 1, RED['pink'])
    p.set(5, 4, LEAF['lime']); p.set(8, 4, LEAF['lime'])   # green eyes
    p.set(5, 5, NIGHT); p.set(8, 5, NIGHT)
    p.set(6, 6, RED['pink']); p.set(7, 6, RED['pink'])
    p.rect(6, 8, 2, 3, FEATHER['mid'])                    # white chest
    p.set(4, 3, CAT['stripe']); p.set(6, 2, CAT['stripe']); p.set(7, 2, CAT['stripe'])
    p.set(3, 9, CAT['stripe']); p.set(3, 10, CAT['stripe']); p.set(2, 8, CAT['stripe'])
    p.set(5, 12, FEATHER['mid']); p.set(8, 12, FEATHER['mid'])
    return p


def cat_walk(f):
    p = Pix(16, 12)
    fur = soft(CAT['hi'], CAT['mid'], CAT['dk'])
    p.oval(7.0, 6.2, 5.0, 2.4, fur)                       # body
    p.oval(12.4, 4.4, 2.6, 2.4, fur)                      # head
    p.set(11, 1, CAT['mid']); p.set(11, 2, CAT['mid']); p.set(14, 1, CAT['mid']); p.set(14, 2, CAT['mid'])
    for x, y in ((2, 5), (1, 4), (1, 3), (1, 2), (2, 1)):  # tail up
        p.set(x, y, CAT['mid'])
    legs = ((3, 9), (5, 8), (9, 8), (11, 9)) if f == 0 else ((4, 8), (5, 9), (9, 9), (10, 8))
    for x, top in legs:
        p.rect(x, top, 1, 11 - top, CAT['dk'])
    ink(p)
    for x, top in legs:
        p.set(x, 10, FEATHER['mid'])
    p.set(13, 4, NIGHT); p.set(15, 5, RED['pink'])
    for x in (5, 8):
        p.set(x, 4, CAT['stripe']); p.set(x, 5, CAT['stripe'])
    p.set(12, 2, CAT['stripe'])
    return p


BIRD = dict(o=INK2, b=WOOD['dark'], l=WOOD['light'])


def bird(f):
    """A small bird of the flock, seen from below as it crosses: wings up, then level."""
    return paint([
        'o......o',
        'oo....oo',
        '.oo..oo.',
        '..obbo..',
        '...ll...',
        '........',
    ] if f == 0 else [
        '........',
        '........',
        '.oooooo.',
        'oo.bb.oo',
        '...ll...',
        '........',
    ], BIRD)


CROW = dict(o=NIGHT, k=STONE['deep'], s=STONE['dk'], e=WHITE, b=STONE['lt'], l=STONE['dk'])


def crow(f):
    rows = [
        '..........',
        '.....okko.',
        '....okkekb',
        'ok.okkkko.',
        'okkksskko.',
        '.okkssko..',
        '...l.l....',
        '...l.l....',
    ] if f == 0 else [
        '..........',
        '.....okko.',
        'o..okkkekb',
        'ok.oksskko',
        'oksskskko.',
        '.okkkkko..',
        '..l...l...',
        '..........',
    ]
    return paint(rows, CROW)


OWL = dict(o=INK2, b=WOOD['plank'], d=WOOD['seam'], l=WOOD['light'], c=CREAM['mid'], y=GOLD['hi'], k=NIGHT,
           n=FOX['mid'], t=WOOD['dark'])


def owl(f):
    eyes = ['occyykyyco', 'occkyyykco'] if f == 0 else ['occcccccco', 'ockkcckkco']
    return paint([
        '.o......o.',
        '.toooooot.',
        'obbbbbbbbo',
        eyes[0],
        eyes[1],
        'obccnnccbo',
        'obllbblldo',
        'obldbbldbo',
        'obllddlldo',
        '.obddddbo.',
        '..okookko.',
        '..........',
    ], OWL)


def fox(f):
    p = Pix(20, 12)
    fur = soft(FOX['hi'], FOX['mid'], FOX['dk'])
    p.oval(9.4, 6.0, 5.6, 2.5, fur)                       # body
    p.oval(3.0, 5.6, 3.6, 2.1, fur)                       # brush of a tail
    p.oval(15.6, 4.8, 2.5, 2.2, fur)                      # head
    p.rect(17, 5, 2, 2, FOX['mid'])                       # snout
    for x, y in ((14, 1), (14, 2), (15, 2), (17, 1), (17, 2), (16, 2)):
        p.set(x, y, FOX['mid'])                           # ears
    legs = ((6, 8), (8, 8), (12, 8), (14, 8)) if f == 0 else ((5, 9), (9, 8), (11, 8), (14, 9))
    for x, top in legs:
        p.rect(x, top, 1, 11 - top, NIGHT)
    ink(p)
    p.set(14, 1, NIGHT); p.set(17, 1, NIGHT)              # dark ear tips
    p.set(16, 4, NIGHT); p.set(19, 5, NIGHT)              # eye, nose
    p.rect(16, 6, 3, 1, FOX['tip']); p.set(13, 7, FOX['tip']); p.set(12, 8, FOX['tip'])
    p.rect(0, 5, 2, 2, FOX['tip']); p.set(1, 4, FOX['tip'])  # white tail tip
    return p


def bee():
    return paint([
        '.ww.',
        '.ww.',
        'ykyk',
        'kyky',
    ], dict(w=WATER['hi'], y=GOLD['hi'], k=NIGHT))


BUTTER = dict(h=PINK['hi'], p=PINK['mid'], d=PINK['dk'], b=WOOD['dark'])


def butterfly(f):
    """Seen from above: wings open, then closed up over its back."""
    return paint([
        'hh..hh',
        'hpbbph',
        '.pbbp.',
        'dpbbpd',
        '.d..d.',
        '......',
    ] if f == 0 else [
        '......',
        '.h..h.',
        '.pbbp.',
        '..bb..',
        '.dbbd.',
        '......',
    ], BUTTER)


FISH = dict(o=INK2, b=WATER['mid'], B=WATER['deep'], s=STONE['hi'], w=CREAM['hi'], k=NIGHT)


def fish(f):
    """A silver fish leaping from the pond: nose up, then nose down."""
    return paint([
        '.....oo.',
        '...oobko',
        'o.obbbwo',
        'ooBsswo.',
        'o.oooo..',
        '........',
    ] if f == 0 else [
        '........',
        'o.oooo..',
        'ooBbbbo.',
        'o.osswko',
        '...oswwo',
        '.....oo.',
    ], FISH)


def frog():
    """A frog sitting at the water's edge, side on: the eye high on its head, the hind leg folded."""
    return paint([
        '...oo.',
        '..owko',
        '.ogggo',
        'oglggo',
        'ogllgo',
        'oogooo',
    ], dict(o=LEAF['ink'], w=WHITE, k=NIGHT, g=LEAF['t3'], l=LEAF['t5']))


BAT = dict(k=NIGHT, d=PURPLE['dk'])


def bat(f):
    return paint([
        'k......k',
        'dk.kk.kd',
        '.dkkkkd.',
        '...kk...',
    ] if f == 0 else [
        '...kk...',
        '.dkkkkd.',
        'dk....kd',
        'k......k',
    ], BAT)


# ---------------------------------------------------------------- weather

def cloud():
    p = Pix(48, 20)
    c = soft(SNOW['hi'], SNOW['mid'], SNOW['lo'], .35)
    for cx, cy, rx, ry in ((14, 12, 8, 5.5), (24, 9, 9, 7.5), (34, 11, 8, 6), (41, 14, 5, 3.6), (7, 15, 5, 3.2),
                           (20, 14, 9, 4.5), (30, 14, 9, 4.5)):
        p.oval(cx, cy, rx, ry, c)
    for x in range(48):
        for y in range(17, 20):
            p.clear(x, y)
    for x in range(48):
        if p.get(x, 16):
            p.set(x, 16, SNOW['lo'])
    return ink(p, SNOW['edge'])


def leaf(f):
    return paint([
        '..dm',
        '.mmd',
        'mmd.',
        's...',
    ] if f == 0 else [
        's...',
        'hmm.',
        '.mmd',
        '..d.',
    ], dict(m=FOX['mid'], d=FOX['dk'], h=FOX['hi'], s=WOOD['dark']))


# ---------------------------------------------------------------- builds

def straw_tuft(p, x0, y0, w, h, across=True):
    """A bundle of straw: stalks in rows (or columns) of two golds, ragged at the end away from the body."""
    for i in range(h if across else w):
        n = (w if across else h) - (1 if i % 3 == 1 else 0)
        c = STRAW['gold'] if i % 2 == 0 else STRAW['lt']
        for k in range(n):
            if across:
                p.set(x0 + (w - n) + k if x0 < 16 else x0 + k, y0 + i, c)
            else:
                p.set(x0 + i, y0 + k, c)


def scarecrow(wave):
    p = Pix(32, 44)
    p.rect(15, 28, 2, 16, WOOD['plank']); p.rect(15, 28, 1, 16, WOOD['light'])    # the post
    shirt = soft(BLUE['hi'], BLUE['mid'], BLUE['dk'], .45)
    p.oval(16, 25, 6.5, 7.5, shirt)                       # the shirt, stuffed
    p.rect(9, 19, 14, 9, BLUE['mid'])
    p.rect(5, 18, 6, 4, BLUE['mid']); p.rect(5, 18, 6, 1, BLUE['hi'])             # left sleeve on the beam
    straw_tuft(p, 1, 18, 4, 4)
    if not wave:
        p.rect(21, 18, 6, 4, BLUE['mid']); p.rect(21, 18, 6, 1, BLUE['hi'])
        straw_tuft(p, 27, 18, 4, 4)
    else:
        for i in range(7):                                # the right sleeve raised to wave
            p.rect(21 + i // 2, 18 - i, 4, 3, BLUE['mid'])
        straw_tuft(p, 24, 7, 4, 5, across=False)
    p.rect(9, 19, 1, 9, BLUE['hi'])
    for x in range(11, 22):                               # straw at the hem
        p.set(x, 32, STRAW['gold'] if x % 2 else STRAW['lt'])
        if x % 3 == 0:
            p.set(x, 33, STRAW['gold'])
    # the sack head
    p.oval(16, 12.5, 5.3, 4.8, soft(CREAM['dk'], CREAM['sand'], CREAM['sand2'], .55))
    # the hat
    p.rect(6, 8, 20, 2, STRAW['lt']); p.rect(7, 9, 18, 1, STRAW['mid'])
    p.oval(16, 6, 5, 4.5, soft(STRAW['hi'], STRAW['lt'], STRAW['mid']))
    ink(p)
    p.rect(11, 7, 10, 1, RED['mid'])                      # hat band
    p.set(11, 7, RED['dk']); p.set(20, 7, RED['dk'])
    # face: button eyes and a stitched smile
    p.set(14, 12, NIGHT); p.set(18, 12, NIGHT)
    for x in range(14, 19):
        p.set(x, 15, WOOD['dark'] if x % 2 == 0 else CREAM['sand2'])
    p.set(13, 14, WOOD['dark']); p.set(19, 14, WOOD['dark'])
    # a patch and the rope belt
    p.rect(17, 23, 3, 3, RED['barn2']); p.set(17, 23, RED['hi'])
    p.set(16, 23, NIGHT); p.set(16, 25, NIGHT)
    p.rect(10, 29, 12, 1, CREAM['sand2'])
    p.set(16, 18, WOOD['dark']); p.set(15, 19, WOOD['dark']); p.set(17, 19, WOOD['dark'])    # collar
    return p


def coop():
    p = Pix(44, 44)
    # stilts
    for x in (7, 35):
        p.rect(x, 33, 2, 9, WOOD['dark']); p.rect(x, 33, 1, 9, WOOD['plank'])
    # walls: clapboard
    for y in range(18, 34):
        for x in range(5, 39):
            c = WOOD['seam'] if (y - 18) % 3 == 2 else WOOD['light'] if (y - 18) % 3 == 0 else WOOD['plank']
            p.set(x, y, c)
    p.rect(5, 18, 2, 16, CREAM['mid']); p.rect(37, 18, 2, 16, CREAM['dk'])   # corner trim
    # roof: a gable of the barn's shingles
    inside = lambda x, y: abs(x - 21.5) <= (y - 1) * 1.25 + 1
    shingles(p, 1, 2, 43, 19, inside)
    for y in range(2, 19):                                # cream trim along both slopes
        half = (y - 1) * 1.25 + 1
        for x in (int(21.5 - half), int(21.5 - half) + 1, int(21.5 + half), int(21.5 + half) - 1):
            if 0 <= x < 44 and inside(x, y):
                p.set(x, y, CREAM['hi'] if x < 22 else CREAM['dk'])
    p.rect(1, 18, 42, 1, CREAM['dk'])
    # a louvred vent in the gable
    p.rect(19, 8, 6, 5, CREAM['hi'])
    for y in (9, 11):
        p.rect(20, y, 4, 1, WOOD['deep'])
    # the hen door with a ramp
    p.rect(18, 24, 8, 10, CREAM['hi']); p.rect(19, 25, 6, 9, NIGHT)
    p.rect(19, 25, 6, 1, WOOD['deep'])
    p.set(18, 24, WOOD['light']); p.set(25, 24, WOOD['light'])
    for y in range(34, 44):
        for x in range(19, 25):
            p.set(x, y, WOOD['light'] if (y - 34) % 3 == 0 else WOOD['plank'])
    # windows on the nest boxes: straw in one, an egg in the other
    p.rect(9, 22, 6, 5, CREAM['hi']); p.rect(10, 23, 4, 3, NIGHT)
    p.set(10, 25, STRAW['gold']); p.set(13, 25, STRAW['gold'])
    p.rect(30, 22, 5, 5, CREAM['hi']); p.rect(31, 23, 3, 3, NIGHT); p.set(32, 25, FEATHER['mid'])
    return ink(p)


def barrel():
    p = Pix(12, 18)
    for y in range(2, 17):
        hw = 4.6 if y in (2, 3, 15, 16) else 5.2
        for x in range(12):
            d = x + .5 - 6
            if abs(d) <= hw:
                c = WOOD['light'] if d < -2.6 else WOOD['dark'] if d > 2.6 else WOOD['plank']
                if x in (4, 8) and c == WOOD['plank']:
                    c = WOOD['seam']
                p.set(x, y, c)
    for y in (5, 13):
        for x in range(12):
            if p.get(x, y):
                p.set(x, y, STONE['hi'] if x < 4 else STONE['mid'] if x < 9 else STONE['dk'])
    p.oval(6, 2.5, 4.6, 1.6, WOOD['dark'])
    p.oval(6, 2.6, 3.4, 1.0, WATER['mid'])
    p.set(4, 2, WATER['hi'])
    return ink(p)


def mailbox(up):
    p = Pix(12, 20)
    p.rect(5, 12, 2, 8, WOOD['plank']); p.rect(5, 12, 1, 8, WOOD['light'])
    p.rect(3, 12, 6, 1, WOOD['dark'])
    p.rect(1, 6, 10, 6, BLUE['mid'])
    p.rect(2, 5, 8, 1, BLUE['hi']); p.rect(1, 6, 10, 1, BLUE['hi'])
    p.rect(1, 11, 10, 1, BLUE['dk'])
    p.rect(9, 6, 2, 6, BLUE['dk']); p.set(9, 5, BLUE['mid'])
    if up:
        p.rect(2, 1, 1, 6, STONE['mid'])
        p.rect(3, 1, 3, 2, RED['bright']); p.set(3, 1, RED['hi'])
    else:
        p.rect(2, 8, 4, 2, RED['bright']); p.set(2, 8, RED['hi'])
    ink(p)
    p.set(10, 8, GOLD['hi'])
    return p


def bench():
    p = Pix(28, 14)
    for x in (3, 23):
        p.rect(x, 1, 2, 7, WOOD['dark'])
    for y in (2, 5):
        p.rect(1, y, 26, 2, WOOD['plank']); p.rect(1, y, 26, 1, WOOD['light'])
    p.rect(1, 8, 26, 2, WOOD['light']); p.rect(1, 10, 26, 1, WOOD['seam'])
    for x in (3, 23):
        p.rect(x, 11, 2, 3, WOOD['dark'])
    ink(p)
    for x in range(1, 27):
        if x % 7 == 3:
            p.set(x, 8, WOOD['seam'])
    return p


def flowers():
    p = Pix(34, 48)
    # a raised bed: a plank frame round dark soil
    p.rect(1, 1, 32, 46, WOOD['plank'])
    p.rect(1, 1, 32, 1, WOOD['light']); p.rect(1, 1, 1, 46, WOOD['light'])
    p.rect(3, 3, 28, 42, WOOD['soil'])
    p.rect(3, 3, 28, 1, WOOD['deep'])
    for y in range(9, 45, 9):
        p.set(1, y, WOOD['seam']); p.set(32, y, WOOD['seam'])
    # clumps of leaves, nearly hiding the soil; tall hollyhocks at the back
    leaf_ = soft(LEAF['t4'], LEAF['t3'], LEAF['t2'], .4)
    clumps = [(8, 10, 4.8, 3.6), (18, 9, 5, 3.8), (27, 11, 4.4, 3.6), (7, 20, 4.4, 3.8), (16, 19, 5.2, 4),
              (26, 21, 4.6, 3.8), (9, 30, 5, 3.8), (20, 29, 5, 4), (28, 31, 3.8, 3.4), (8, 40, 4.6, 3.4),
              (18, 39, 5.4, 3.6), (27, 40, 4.4, 3.4)]
    for x, y, rx, ry in clumps:
        p.oval(x, y, rx, ry, leaf_)
    inner = Pix(34, 48)
    inner.p = [[c if c in (LEAF['t4'], LEAF['t3'], LEAF['t2']) else None for c in r] for r in p.p]
    edge = inner.copy().outline(LEAF['ink'])
    for y in range(48):
        for x in range(34):
            if edge.p[y][x] == LEAF['ink'] and p.p[y][x] == WOOD['soil']:
                p.p[y][x] = LEAF['t1']
    # blooms in drifts of one colour: a plus of petals, lighter on top, with a dark heart
    blooms = [(PINK['hi'], PINK['mid'], PINK['dk']), (FLOWER['lilac'], PURPLE['hi'], PURPLE['mid']),
              (FLOWER['cream'], FLOWER['peach'], FOX['dk']), (GOLD['pale'], GOLD['hi'], GOLD['dk']),
              (WHITE, FEATHER['mid'], GOLD['mid']), (RED['pink'], RED['hi'], RED['dk'])]
    drifts = [(8, 10, 0), (18, 9, 3), (27, 11, 1), (7, 20, 4), (16, 19, 5), (26, 21, 2), (9, 30, 1), (20, 29, 0),
              (28, 31, 4), (8, 40, 3), (18, 39, 2), (27, 40, 5)]
    for cx, cy, k in drifts:
        lt, mid, dk = blooms[k]
        for dx, dy in ((-3, -2), (0, -3), (3, -1), (-1, 0), (2, 2), (-3, 2)):
            x, y = cx + dx, cy + dy
            p.set(x, y - 1, lt); p.set(x - 1, y, mid); p.set(x + 1, y, mid); p.set(x, y + 1, mid); p.set(x, y, dk)
    for x in (5, 16, 26):                                 # hollyhock spires at the back
        p.rect(x, 3, 1, 5, LEAF['t2'])
        for y in (3, 5):
            p.set(x - 1, y, RED['hi']); p.set(x + 1, y, RED['hi']); p.set(x, y - 1, RED['pink'])
    return ink(p)


def hive():
    p = Pix(16, 18)
    p.rect(1, 13, 14, 2, WOOD['plank']); p.rect(1, 13, 14, 1, WOOD['light'])
    p.rect(2, 15, 2, 3, WOOD['dark']); p.rect(12, 15, 2, 3, WOOD['dark'])
    for y in range(1, 13):
        for x in range(16):
            u = (x + .5 - 8) / 6.6
            v = (y + .5 - 12.5) / 11.5
            if u * u + v * v <= 1:
                band = (y % 2 == 0)
                c = STRAW['lt'] if u * .6 + v < -.75 else STRAW['tan'] if u > .45 else STRAW['gold']
                if band:
                    c = STRAW['ochre'] if c != STRAW['tan'] else STRAW['dk']
                p.set(x, y, c)
    p.set(5, 3, STRAW['hi']); p.set(4, 5, STRAW['hi'])
    p.rect(6, 10, 4, 3, NIGHT); p.rect(7, 9, 2, 1, NIGHT)
    return ink(p)


def well(pump):
    p = Pix(28, 34)
    # posts standing on the stone ring
    for x in (3, 22):
        p.rect(x, 8, 2, 19, WOOD['plank']); p.rect(x, 8, 1, 19, WOOD['light'])
    # the stone ring: the wall, its rim, the water inside
    for y in range(22, 33):
        for x in range(1, 27):
            u = (x + .5 - 14) / 12.6
            top = (y + .5 - 25) / 3.4
            bot = (y + .5 - 29) / 3.4
            if (u * u + top * top <= 1) or (y >= 25 and u * u + bot * bot <= 1) or (25 <= y <= 29 and abs(u) <= 1):
                brick = (x + (3 if (y // 3) % 2 else 0)) % 6 == 0 or y % 3 == 0
                c = STONE['dk'] if brick else STONE['mid']
                if y >= 30:
                    c = STONE['deep'] if brick else STONE['dk']
                p.set(x, y, c)
    p.oval(14, 25, 12.6, 3.2, soft(STONE['hi'], STONE['lt'], STONE['mid'], .6))
    p.oval(14, 25.2, 9.4, 2.0, WATER['deep'])
    p.set(10, 25, WATER['mid']); p.set(11, 25, WATER['mid'])
    # the roof
    inside = lambda x, y: abs(x - 13.5) <= y * 1.55 + 1
    shingles(p, 0, 0, 28, 9, inside)
    for y in range(0, 9):
        half = y * 1.55 + 1
        for x in (int(13.5 - half), int(13.5 + half)):
            if inside(x, y):
                p.set(x, y, CREAM['hi'] if x < 14 else CREAM['dk'])
    p.rect(1, 8, 26, 1, CREAM['dk'])
    # the windlass, its rope and bucket, and the crank on the right
    p.rect(5, 12, 17, 2, WOOD['light']); p.rect(5, 13, 17, 1, WOOD['seam'])
    drop = 17 if not pump else 20
    p.rect(13, 14, 1, drop - 14, CREAM['dk'])
    p.rect(11, drop, 5, 4, WOOD['plank']); p.rect(11, drop, 5, 1, STONE['lt']); p.rect(11, drop + 3, 5, 1, WOOD['dark'])
    p.rect(24, 12, 2, 1, STONE['lt'])
    if not pump:
        p.rect(25, 8, 1, 5, STONE['mid']); p.set(26, 8, WOOD['light'])
    else:
        p.rect(25, 12, 1, 5, STONE['mid']); p.set(26, 16, WOOD['light'])
    return ink(p)


def jetty():
    p = Pix(28, 10)
    for x in (2, 11):                                     # piles standing in the pond
        p.rect(x, 6, 2, 3, WOOD['deep'])
    p.rect(1, 1, 26, 5, WOOD['plank'])
    for x in range(1, 27):                                # boards laid across, light at the top
        if x % 3 == 0:
            p.rect(x, 1, 1, 4, WOOD['seam'])
    p.rect(1, 1, 26, 1, WOOD['light'])
    p.rect(1, 5, 26, 1, WOOD['dark'])
    p.rect(1, 0, 3, 3, WOOD['dark']); p.rect(1, 0, 3, 1, WOOD['light'])   # a mooring post at the far end
    ink(p)
    for x in (1, 4, 10, 13):                              # where the piles meet the water
        p.set(x, 9, WATER['hi'])
    return p


def windmill():
    p = Pix(32, 64)
    for y in range(14, 60):                               # a whitewashed tower, wider at the foot
        half = 8 + 5 * (y - 14) / 46
        for x in range(32):
            d = x + .5 - 16
            if abs(d) <= half:
                k = d / half
                c = CREAM['hi'] if k < -.45 else CREAM['dk'] if k > .45 else CREAM['mid']
                if (y - 14) % 7 == 6:
                    c = CREAM['dk'] if c != CREAM['dk'] else CREAM['sand']
                p.set(x, y, c)
    for y in range(58, 63):                               # a stone footing
        for x in range(3, 29):
            p.set(x, y, STONE['dk'] if (y == 60 or (x + (2 if y > 60 else 0)) % 5 == 0) else STONE['mid'])
    p.rect(3, 58, 26, 1, STONE['lt'])
    # door and windows
    p.rect(13, 49, 6, 9, WOOD['plank']); p.rect(14, 48, 4, 1, WOOD['plank'])
    p.rect(15, 49, 1, 9, WOOD['seam']); p.rect(13, 49, 1, 9, WOOD['light']); p.set(17, 53, GOLD['hi'])
    p.rect(14, 31, 4, 5, NIGHT); p.rect(14, 31, 4, 1, WOOD['dark']); p.rect(13, 36, 6, 1, CREAM['dk'])
    p.rect(15, 22, 2, 3, NIGHT)
    # a wooden stage round the tower on braces, where the miller would reef the sails
    p.rect(2, 38, 28, 3, WOOD['plank']); p.rect(2, 38, 28, 1, WOOD['light']); p.rect(2, 40, 28, 1, WOOD['dark'])
    for x in range(3, 30, 4):
        p.rect(x, 35, 1, 3, WOOD['plank'])
    p.rect(2, 35, 28, 1, WOOD['light'])
    for x0, dx in ((4, 1), (27, -1)):
        for k in range(4):
            p.set(x0 + dx * k, 41 + k, WOOD['dark'])
    # the cap: a dome shingled like the barn's roof, a cream band, the blades' axle in front
    cap = Pix(32, 64)
    cap.oval(16, 15, 10.5, 13, soft(RED['barn3'], RED['roof'], RED['roof2'], .5))
    cap.erase(0, 15, 32, 49)
    for y in range(3, 13):
        for x in range(32):
            if cap.get(x, y) and y % 3 == 1 and cap.get(x, y) != RED['barn3']:
                cap.set(x, y, RED['roof2'])
            elif cap.get(x, y) == RED['roof'] and y % 3 != 1 and (x + (y // 3) * 3) % 6 == 0:
                cap.set(x, y, RED['roof2'])
    cap.rect(5, 13, 22, 2, CREAM['dk']); cap.rect(5, 13, 22, 1, CREAM['hi'])
    cap.rect(15, 0, 2, 3, WOOD['dark'])
    p.blit(cap, 0, 0)
    ink(p)
    p.oval(16, 10, 2.2, 2.2, WOOD['dark'])
    return p


def blades():
    arm = Pix(44, 44)
    arm.rect(24, 21, 19, 2, WOOD['dark']); arm.rect(24, 21, 19, 1, WOOD['plank'])
    arm.rect(27, 23, 15, 6, CREAM['mid']); arm.rect(27, 23, 15, 1, CREAM['hi'])
    for x in range(27, 42, 3):
        arm.rect(x, 23, 1, 6, WOOD['plank'])
    arm.rect(27, 26, 15, 1, WOOD['plank'])
    arm.rect(27, 28, 15, 1, CREAM['dk'])
    p = Pix(44, 44)
    a = arm
    for _ in range(4):
        p.blit(a, 0, 0)
        a = rot90(a)
    p.oval(22, 22, 4, 4, soft(WOOD['light'], WOOD['plank'], WOOD['dark'], .4))
    ink(p)
    p.rect(21, 21, 2, 2, STONE['mid']); p.set(21, 21, STONE['hi'])
    return p


def scaffold(stage):
    """A ghost of the next build, drawn at 35% and stretched to its pad: heavy strokes, so they survive the squeeze."""
    p = Pix(32, 32)
    top = 9 if stage else 13
    for x in (1, 14, 28):                                 # posts
        p.rect(x, top, 3, 31 - top, WOOD['plank']); p.rect(x, top, 1, 31 - top, WOOD['light'])
    if stage >= 1:
        p.rect(1, 9, 30, 3, WOOD['plank']); p.rect(1, 9, 30, 1, WOOD['light'])       # top beam
        p.rect(1, 20, 30, 2, WOOD['plank'])
        for a, b in (((4, 12), (13, 20)), ((17, 20), (27, 12))):                    # braces
            p.line(a[0], a[1], b[0], b[1], WOOD['seam']); p.line(a[0] + 1, a[1], b[0] + 1, b[1], WOOD['seam'])
    if stage >= 2:
        for i in range(2):                                # rafters and a ridge post
            p.line(1, 9 - i, 15, 1 - i if i == 0 else 1, WOOD['plank'])
            p.line(30, 9 - i, 16, 1 - i if i == 0 else 1, WOOD['plank'])
        p.line(2, 9, 15, 2, WOOD['light']); p.line(29, 9, 16, 2, WOOD['seam'])
        p.rect(15, 2, 2, 7, WOOD['plank'])
    p.rect(1, 30, 30, 1, WOOD['dark'])                    # the sill on the ground
    return ink(p)


def snowman():
    p = Pix(16, 20)
    snow = soft(SNOW['hi'], SNOW['mid'], SNOW['lo'], .4)
    p.oval(8, 14.6, 6.2, 4.8, snow)
    p.oval(8, 6.4, 4.2, 3.9, snow)
    ink(p, SNOW['edge'])
    p.line(1, 9, 3, 11, WOOD['dark']); p.set(0, 8, WOOD['dark'])
    p.line(14, 11, 15, 9, WOOD['dark'])
    p.set(6, 5, NIGHT); p.set(9, 5, NIGHT)
    p.set(8, 7, FOX['mid']); p.set(9, 7, FOX['mid']); p.set(10, 7, FOX['dk'])
    p.rect(4, 9, 8, 2, RED['mid']); p.rect(4, 9, 8, 1, RED['hi']); p.rect(9, 11, 2, 3, RED['mid'])
    for y in (13, 16):
        p.set(8, y, NIGHT)
    return p


def sprites():
    return {
        'hen_0': hen(False), 'hen_1': hen(True), 'chick': chick(),
        'cat_sleep': cat_sleep(), 'cat_sit': cat_sit(), 'cat_walk_0': cat_walk(0), 'cat_walk_1': cat_walk(1),
        'bird_0': bird(0), 'bird_1': bird(1), 'crow_0': crow(0), 'crow_1': crow(1), 'owl_0': owl(0), 'owl_1': owl(1),
        'fox_0': fox(0), 'fox_1': fox(1), 'bee': bee(), 'butterfly_0': butterfly(0), 'butterfly_1': butterfly(1),
        'fish_0': fish(0), 'fish_1': fish(1), 'frog': frog(), 'bat_0': bat(0), 'bat_1': bat(1),
        'cloud': cloud(), 'leaf_0': leaf(0), 'leaf_1': leaf(1),
        'scarecrow': scarecrow(False), 'scarecrow_wave': scarecrow(True), 'coop': coop(), 'barrel': barrel(),
        'mailbox': mailbox(False), 'mailbox_up': mailbox(True), 'bench': bench(), 'flowers': flowers(), 'hive': hive(),
        'well': well(False), 'well_pump': well(True), 'jetty': jetty(), 'windmill': windmill(), 'blades': blades(),
        'scaffold_0': scaffold(0), 'scaffold_1': scaffold(1), 'scaffold_2': scaffold(2), 'snowman': snowman(),
    }
