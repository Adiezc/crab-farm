# The crab-Claude, hatless in every pose, and the hats and scarf it wears over them. Every pose is recombined from
# the pixels 1.2 baked from clodfarm (claude_stand, _walk1, _walk2, _type, _sleep, _happy, _blink): the body, eyes,
# blush, arms and legs are clodfarm's, moved; only the raised arms and the folded feet are drawn here, in its colours.
#
# HD layout of the standing crab (32 x 36): head top (ink) row 14, body rows 15..28 between ink columns 4 and 27,
# shading row 29, underside row 30, four legs rows 31..34; side arms rows 20..25 in columns 0..4 and 27..31.
from legacy import legacy_sprite
from palette import BODY, CREAM, GOLD, INK, LEAF, PINK, RED, STRAW, WHITE, FLOWER
from pix import Pix, paint

W, H = 32, 36
TOP = 14            # the head's top ink row when standing
ARM = (20, 25)      # rows of the side arms when standing
HAT_COLOURS = {STRAW['edge'], STRAW['hi'], STRAW['lt'], STRAW['mid'], RED['hi'], RED['mid'], RED['dk']}

# How far (world px) the hat moves down from where it sits on a standing crab, per pose. The work pose's two frames
# (reach, crouch) dip the body 2 HD px, sitting 4, sleeping 4.
HAT_DY = {'work': 1, 'sit': 2, 'sleep': 2}


# ---- taking 1.2's crab apart ----

def dehat(src, top):
    """1.2's crab without its straw hat: the hat's pixels go, the body is extended up to row top+1 from its first
    whole row, `top` becomes the head's ink line with rounded corners, and the top row catches the light."""
    p = src.copy()
    for y in range(p.h):
        for x in range(p.w):
            if p.p[y][x] in HAT_COLOURS:
                p.p[y][x] = None
    ref = next(y for y in range(top + 1, p.h)
               if all(c not in HAT_COLOURS for c in src.p[y]) and sum(1 for c in src.p[y] if c) > 20)
    for y in range(top + 1, ref):
        p.p[y] = p.p[ref][:]
    xs = [x for x in range(p.w) if p.p[top + 1][x] not in (None, INK)]
    a, b = min(xs) - 1, max(xs) + 1
    for x in range(p.w):
        p.p[top][x] = INK if a < x < b else None
    row = p.p[top + 1]
    for x in range(a + 1, b):
        if row[x] == BODY['mid']:
            row[x] = BODY['lt']
    return p


def arm_block(p, side, top):
    """The side arm (5 columns, the outer 4 plus the joint column) of rows top..top+5."""
    return p.crop(0 if side < 0 else 27, top, 5, 6)


def drop_arms(p, top):
    """Take both side arms off (rows top..top+5) and close the body's sides with ink."""
    q = p.copy()
    for y in range(top, top + 6):
        for x in (0, 1, 2, 3, 28, 29, 30, 31):
            q.p[y][x] = None
        if q.p[y][4] is not None:
            q.p[y][4] = INK
        if q.p[y][27] is not None:
            q.p[y][27] = INK
    return q


def move_arms(p, top, to):
    """Move both side arms from rows top.. to rows to.."""
    left, right = arm_block(p, -1, top), arm_block(p, 1, top)
    q = drop_arms(p, top)
    q.blit(left, 0, to)
    q.blit(right, 27, to)
    return q


def shift_rows(p, y0, y1, dy):
    """Rows y0..y1 moved down by dy onto an empty sprite."""
    q = Pix(p.w, p.h)
    for y in range(y0, y1 + 1):
        if 0 <= y + dy < p.h:
            q.p[y + dy] = p.p[y][:]
    return q


def move_eyes(p, dx, dy=0, rows=range(16, 24)):
    q = p.copy()
    eyes = [(x, y, p.p[y][x]) for y in rows for x in range(8, 24)
            if p.p[y][x] in (BODY['eye'], BODY['glint'], BODY['pupil'])]
    for x, y, _ in eyes:
        q.p[y][x] = BODY['mid']
    for x, y, c in eyes:
        q.p[y + dy][x + dx] = c
    return q


# ---- new parts, drawn in the body's palette ----

PAL = dict(H=INK, N=BODY['hi'], I=BODY['lt'], J=BODY['mid'], K=BODY['dk'], Q=BODY['deep'])

# A raised arm, left side (columns 0..4); the hand clears a straw brim (rows 9..14) and the joint meets the shoulder.
ARM_UP = [
    '.HH..',   # 4
    'HNIH.',
    'HIIH.',
    'HIIH.',
    'HIIH.',
    'HIIH.',
    'HIIH.',   # 10
    'HIIH.',
    'HIIH.',
    'HIIH.',
    'HIIH.',
    'HIIH.',   # 15
    'HIIH.',
    'HIIJJ',
    'HIIJJ',
    'HIIJJ',
    '.HHHH',   # 20
]

# Holding a load on the head: the arm goes up and the hand turns in under the load's corner.
ARM_HOLD = [
    '.HHHHHH..',  # 3
    'HNIIIIIH.',
    'HIIJJJJH.',
    'HIIHHHH..',
    'HIIH.....',
    'HIIH.....',
    'HIIH.....',
    'HIIH.....',  # 10
    'HIIH.....',
    'HIIH.....',
    'HIIH.....',
    'HIIH.....',
    'HIIH.....',  # 15
    'HIIH.....',
    'HIIJJ....',
    'HIIJJ....',
    'HIIJJ....',
    '.HHHH....',  # 20
]


def mirror(rows):
    """The right arm: the left one flipped, its light side turned to shadow."""
    return [r[::-1].replace('I', 'K').replace('N', 'J') for r in rows]


def with_arms(p, rows, top):
    """Side arms off, these arms on (left given, right mirrored), starting at row `top`."""
    q = drop_arms(p, ARM[0])
    left = paint(rows, PAL)
    right = paint(mirror(rows), PAL)
    q.blit(left, 0, top)
    q.blit(right, W - right.w, top)
    return q


def legs_of(body, legs):
    """The body of one pose over the legs of another (rows 31..35)."""
    q = body.copy()
    for y in range(31, H):
        q.p[y] = legs.p[y][:]
    return q


def bent(p):
    """The body dipped 2 rows on shortened legs: the knees bend, the feet stay on the ground."""
    q = shift_rows(p, 0, 30, 2)
    q.p[33] = p.p[31][:]
    q.p[34] = p.p[34][:]
    return q


def sitting(p):
    """Sat down: the body sinks 4 rows and the feet poke out in front under it."""
    q = shift_rows(p, 0, 30, 4)
    foot = paint(['.HHHH.', 'HQQQQH', 'HQQQKH', '.HHHH.'], PAL)
    q.p[34] = [INK if c is not None else None for c in q.p[34]]
    q.blit(foot, 4, 32)
    q.blit(foot.flipx(), 22, 32)
    return q


# ---- hats, scarf ----

def hat_of(src):
    """The straw hat lifted off 1.2's crab, brim shadow and all (rows 0..15)."""
    p = Pix(32, 16)
    for y in range(16):
        for x in range(32):
            if src.p[y][x] in HAT_COLOURS:
                p.p[y][x] = src.p[y][x]
    return p


def beanie():
    return paint([
        '................................',
        '................................',
        '..............HHHH..............',
        '.............HwWwwH.............',
        '.............HwwwcH.............',
        '..........HHHHHccHHHH...........',
        '........HHaAaaaaaaaabbHH........',
        '.......HaAAaaaaaaaaaabbbH.......',
        '......HaAaaaaaaaaaaaaabbbH......',
        '.....HaaaaaaaaaaaaaaaaabbbH.....',
        '.....HaaaaaaaaaaaaaaaaaabbH.....',
        '....HHHHHHHHHHHHHHHHHHHHHHHH....',
        '....HwcWcwcWcwcWcwcWcwcWcwcH....',
        '....HwcwcwcwcwcwcwcwcwcwcwcH....',
        '....HcdcdcdcdcdcdcdcdcdcdcdH....',
        '.....HHHHHHHHHHHHHHHHHHHHHH.....',
    ], dict(H=INK, a=RED['bright'], A=RED['pink'], b=RED['mid'], w=CREAM['hi'], W=WHITE, c=CREAM['dk'],
            d=CREAM['sand']))


def crown():
    """A ring of leaves on the head, with daisies, a pink rose and a buttercup at the front."""
    return paint([
        '................................',
        '................................',
        '................................',
        '................................',
        '................................',
        '................................',
        '................................',
        '..........HH...........HH.......',
        '....HH...HwWH...HHH...HpPH......',
        '...HyYH..HWoWH.HpPpH.HpPPpH.....',
        '..HyYYyHHgWWgHHpPPPpHgpPpgHHH...',
        '..HyyyyHgGgggGgHpPpHgGgpHgGgGH..',
        '...HyyHgGggHGggGgHHgGggGHgggGgH.',
        '...HgggGgHHgggGggGgggGHgggGggH..',
        '....HHgggHH.HHgggHHgggHHHggHH...',
        '......HHH.....HHH..HHH...HH.....',
    ], dict(H=LEAF['ink'], g=LEAF['t3'], G=LEAF['t4'], y=GOLD['mid'], Y=GOLD['hi'], p=PINK['mid'],
            P=PINK['hi'], w=CREAM['dk'], W=WHITE, o=GOLD['hi']))


def hood():
    """A yellow rain hat, the sou'wester kind: a round crown and a brim that dips at the sides."""
    return paint([
        '................................',
        '................................',
        '................................',
        '...........HHHHHHHHHH...........',
        '.........HHaAAaaaaaaaHH.........',
        '........HaAAaaaaaaaaabbH........',
        '.......HaAAaaaaaaaaaaabbH.......',
        '.......HaAaaaaaaaaaaaabbH.......',
        '......HaaaaaaaaaaaaaaaabbH......',
        '......HcccccccccccccccccdH......',
        '....HHHHHHHHHHHHHHHHHHHHHHHH....',
        '..HHaAaaaaaaaaaaaaaaaaaaaabbHH..',
        '.HaaaaaaaaaaaaaaaaaaaaaaaaaabbH.',
        'HabbHHHHHHHHHHHHHHHHHHHHHHHHbbbH',
        'HbbH........................HbbH',
        '.HH..........................HH.',
    ], dict(H=GOLD['deep'], a=GOLD['hi'], A=GOLD['pale'], b=GOLD['mid'], c=GOLD['dk'], d=GOLD['deep']))


def scarf():
    return paint([
        '.HHHHHHHHHHHHHHHHHH.',
        'HaAaaAaaAaaAaaAaaAbH',
        'HwwwwwwwwwwwwwwwwwcH',
        'HbbbbbbbbbbbbbbbbbbH',
        '.HHHHHHHHHHHHaAbHHH.',
        '............HwwcH...',
        '............HbbbH...',
        '............HcHcH...',
    ], dict(H=INK, a=RED['bright'], A=RED['pink'], b=RED['mid'], w=CREAM['hi'], c=CREAM['dk']))


# ---- the module ----

def sprites():
    c = {k: legacy_sprite('claude_' + k) for k in ('stand', 'blink', 'walk1', 'walk2', 'type', 'happy', 'sleep')}
    S = {}
    stand = dehat(c['stand'], TOP)
    S['crab_stand'] = stand
    S['crab_blink'] = dehat(c['blink'], TOP)
    S['crab_walk1'] = dehat(c['walk1'], TOP)
    S['crab_walk2'] = dehat(c['walk2'], TOP)
    S['crab_happy'] = dehat(c['happy'], TOP)
    S['crab_sleep'] = dehat(c['sleep'], TOP + 4)

    # Typing: arms up at the keys, eyes down on the screen.
    S['crab_type'] = move_eyes(move_arms(stand, ARM[0], ARM[0] - 4), 0, 1)
    # Looking: the eyes go to the side it faces.
    S['crab_look'] = move_eyes(stand, 2)
    # Cheering or holding up a sign: both arms high, mouth open.
    S['crab_armsup'] = with_arms(S['crab_happy'], ARM_UP, 4)
    # Carrying a load on the head, walking.
    hold = with_arms(stand, ARM_HOLD, 3)
    S['crab_carry1'] = legs_of(hold, S['crab_walk1'])
    S['crab_carry2'] = legs_of(hold, S['crab_walk2'])
    # Sitting (fishing, resting).
    S['crab_sit'] = sitting(stand)
    # Working: knees bent; crouch has the arms down at the ground, reach has them up at the shoulders.
    S['crab_crouch'] = bent(move_arms(stand, ARM[0], ARM[0] + 3))
    S['crab_reach'] = bent(move_arms(stand, ARM[0], ARM[0] - 3))

    S['hat_straw'] = hat_of(c['stand'])
    S['hat_beanie'] = beanie()
    S['hat_crown'] = crown()
    S['hat_hood'] = hood()
    S['scarf'] = scarf()
    return S
