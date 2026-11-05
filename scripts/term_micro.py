# Micro sprites painted by hand for the terminal, where a mode-downscale loses what makes them read: the crab's eyes,
# arms and legs, a helper's model-coloured band, a crop's stem and flower, a hen's comb, a laptop's screen. Every
# colour is one the HD art uses (art-src/palette.py), so it is already on the terminal palette.
#
# Each picture stands on its bottom row and is centred across, as the renderer places it by its feet. The crab keeps
# empty rows on top, as the world sprite does, and its arms never rise above its head: the renderer sits the hat on
# the highest drawn row.
from palette import BLUE, BODY, EARTH, FLOWER, GOLD, INK, LEAF, PINK, PURPLE, RED, SCREEN, STRAW, WHITE, WOOD

CLEAR = 255

LEGEND = {
    # the crab and the minis
    'L': BODY['lt'], 'B': BODY['mid'], 'd': BODY['dk'], 'j': BODY['deep'], 'E': BODY['eye'], 'o': INK,
    'm': BODY['mouth'], 'w': WOOD['plank'],
    # crops
    'S': LEAF['sprout'], 'l': LEAF['green'], 'G': LEAF['lime'], 'b': BODY['mid'], 'p': FLOWER['peach'],
    'c': FLOWER['cream'], 'e': EARTH['dk'],
    # the hen
    'W': WHITE, 'r': RED['bright'],
    # hats and coins
    'h': STRAW['lt'], 'H': STRAW['mid'], 'q': STRAW['edge'], 'R': RED['mid'], 'P': PINK['hi'], 'Y': GOLD['hi'],
    'y': GOLD['mid'], 'D': GOLD['dk'],
    # the laptop
    'x': SCREEN['bezel'], 'z': SCREEN['glass'], 't': SCREEN['text'], 'k': SCREEN['key2'],
}
BANDS = {'haiku': BLUE['hi'], 'sonnet': PURPLE['hi'], 'opus': GOLD['hi'], 'fable': PINK['hi']}
# The straw hat's band, light to dark, and each model's colours in the same order: anim.ts's MODEL_BAND.
HAT_BAND = (RED['hi'], RED['mid'], RED['dk'])
MODEL_BANDS = {'haiku': (BLUE['hi'], BLUE['mid'], BLUE['dk']), 'sonnet': (PURPLE['hi'], PURPLE['mid'], PURPLE['dk']),
               'opus': (GOLD['hi'], GOLD['mid'], GOLD['deep']), 'fable': (PINK['hi'], PINK['mid'], PINK['dk'])}


def legs(body, row):
    return body[:-1] + [row]


# ---- the crab, per scale: (empty rows on top, the body rows) ----

def crab3():
    """6 x 6 at s = 3: a lit head row, eyes two apart with the arms beside them, the body, two legs."""
    top = ['......', '......']
    stand = top + ['.LLLL.', 'dEBBEd', '.BBBB.', '.o..o.']
    up = top + ['dLLLLd', '.EBBE.', '.BBBB.', '.o..o.']
    low = top + ['......', '.LLLL.', 'dEBBEd', '.o..o.']
    return {
        'crab_stand': stand,
        'crab_blink': top + ['.LLLL.', 'djBBjd', '.BBBB.', '.o..o.'],
        'crab_walk1': legs(stand, 'o...o.'),
        'crab_walk2': legs(stand, '.o...o'),
        'crab_type': up,
        'crab_sleep': top + ['......', '.LLLL.', 'djBBjd', '.dddd.'],
        'crab_happy': top + ['.LLLL.', 'dEBBEd', '.BmmB.', '.o..o.'],
        'crab_look': top + ['.LLLL.', 'dBEBEd', '.BBBB.', '.o..o.'],
        'crab_armsup': up,
        'crab_carry1': legs(up, 'o...o.'),
        'crab_carry2': legs(up, '.o...o'),
        'crab_sit': top + ['......', '.LLLL.', 'dEBBEd', '.oddo.'],
        'crab_crouch': low,
        'crab_reach': up,
    }


def crab2():
    """8 x 9 at s = 2: eyes two rows tall, arms at the sides, the dark underside, four legs."""
    top = ['........'] * 3
    stand = top + ['.LLLLLL.', '.BEBBEB.', 'dBEBBEBd', 'dBBBBBBd', '.jjjjjj.', '.o.oo.o.']
    up = top + ['dLLLLLLd', 'dBBBBBBd', '.BEBBEB.', '.BEBBEB.', '.jjjjjj.', '.o.oo.o.']
    return {
        'crab_stand': stand,
        'crab_blink': top + ['.LLLLLL.', '.BBBBBB.', 'dBjBBjBd', 'dBBBBBBd', '.jjjjjj.', '.o.oo.o.'],
        'crab_walk1': legs(stand, '...o..o.'),
        'crab_walk2': legs(stand, '.o..o...'),
        'crab_type': up,
        'crab_sleep': top + ['........', '.LLLLLL.', '.BBBBBB.', 'dBjBBjBd', 'dBBBBBBd', '.jjjjjj.'],
        'crab_happy': top + ['.LLLLLL.', '.BEBBEB.', 'dBEBBEBd', 'dBBmmBBd', '.jjjjjj.', '.o.oo.o.'],
        'crab_look': top + ['.LLLLLL.', '.BBEBEB.', 'dBBEBEBd', 'dBBBBBBd', '.jjjjjj.', '.o.oo.o.'],
        'crab_armsup': up,
        'crab_carry1': legs(up, '...o..o.'),
        'crab_carry2': legs(up, '.o..o...'),
        'crab_sit': top + ['........', '.LLLLLL.', '.BEBBEB.', 'dBEBBEBd', 'dBBBBBBd', '.oojjoo.'],
        'crab_crouch': top + ['........', '.LLLLLL.', '.BEBBEB.', 'dBEBBEBd', 'dBBBBBBd', '.o.oo.o.'],
        'crab_reach': top + ['........', 'dLLLLLLd', 'dBEBBEBd', '.BEBBEB.', '.jjjjjj.', '.o.oo.o.'],
    }


def crab4():
    """5 x 5 at s = 4, a pixel wider than the world sprite so the eyes can stand apart."""
    top = ['.....', '.....']
    stand = top + ['.LLL.', 'dEBEd', '.o.o.']
    up = top + ['dLLLd', '.EBE.', '.o.o.']
    low = top + ['.....', '.LLL.', 'dEBEd']
    return {
        'crab_stand': stand,
        'crab_blink': top + ['.LLL.', 'djBjd', '.o.o.'],
        'crab_walk1': legs(stand, 'o..o.'),
        'crab_walk2': legs(stand, '.o..o'),
        'crab_type': up,
        'crab_sleep': top + ['.....', '.LLL.', 'djBjd'],
        'crab_happy': top + ['.LLL.', 'dEmEd', '.o.o.'],
        'crab_look': top + ['.LLL.', 'dBEBE', '.o.o.'],
        'crab_armsup': up,
        'crab_carry1': legs(up, 'o..o.'),
        'crab_carry2': legs(up, '.o..o'),
        'crab_sit': low,
        'crab_crouch': low,
        'crab_reach': up,
    }


# ---- the helpers: the band in the model's colour is what tells them apart ----

def minis(s):
    out = {}
    for model, band in BANDS.items():
        if s == 2:
            pics = {'0': ['.LLL.', '.MMM.', 'dEBEd', '.o.o.'], '1': ['.LLL.', 'dMMMd', '.EBE.', '.o.o.'],
                    'carry': ['.www.', 'dMMMd', '.EBE.', '.o.o.']}
        elif s == 3:
            pics = {'0': ['.MM.', 'dBBd', 'o..o'], '1': ['dMMd', '.BB.', 'o..o'], 'carry': ['.ww.', 'dMMd', 'o..o']}
        else:
            pics = {'0': ['MMM', 'dBd'], '1': ['MMM', 'BBB'], 'carry': ['www', 'MMM']}
        for k, rows in pics.items():
            out['mini_%s_%s' % (model, k)] = (rows, {'M': band})
    return out


# ---- crops: a stem with leaves, a bud while growing, a flower when ripe ----

def crops(s):
    if s == 2:
        return {
            'crop_seed': ['...', '...', '...', 'l.G', '.e.'],
            'crop_sprout': ['...', '...', '.S.', 'lS.', '.Sl'],
            'crop_grow_0': ['...', '.b.', '.S.', 'lSl', '.S.'],
            'crop_grow_1': ['...', '.b.', 'lS.', '.Sl', '.S.'],
            'crop_grow_2': ['...', '.b.', '.Sl', 'lS.', '.S.'],
            'crop_ripe_0': ['.p.', 'pcp', '.Sl', 'lS.', '.S.'],
            'crop_ripe_1': ['p.p', '.c.', 'pSp', 'lS.', '.Sl'],
            'crop_ripe_2': ['.p.', 'pcp', 'lS.', '.Sl', '.S.'],
        }
    return {
        'crop_seed': ['..', '..', 'eG'],
        'crop_sprout': ['..', 'l.', 'Sl'],
        'crop_grow_0': ['b.', 'Sl', 'S.'],
        'crop_grow_1': ['b.', 'S.', 'Sl'],
        'crop_grow_2': ['bl', 'S.', 'S.'],
        'crop_ripe_0': ['pc', 'Sl', 'S.'],
        'crop_ripe_1': ['cp', 'S.', 'Sl'],
        'crop_ripe_2': ['pp', 'Sl', 'S.'],
    }


# ---- the rest ----

def others(s):
    out = {}
    if s in (3, 4):
        out['hen_0'] = ['Wr', 'WW']
        out['hen_1'] = ['W.', 'Wr']
    if s == 3:
        out['laptop_0'] = ['xxx', 'xtz', 'kkk']
        out['laptop_1'] = ['xxx', 'xzt', 'kkk']
        out['laptop_2'] = ['xxx', 'xtt', 'kkk']
    if s == 4:
        out['laptop_0'] = ['xtz', 'kkk']
        out['laptop_1'] = ['xzt', 'kkk']
        out['laptop_2'] = ['xtt', 'kkk']
    return out


def hats(s):
    """The straw hat keeps its red band, and the spring crown its flowers, which are all that shows on the grass.
    At s = 4 they are five wide, as the crab is."""
    if s == 3:
        return {'hat_straw': ['.hRRh.', 'qHHHHq'], 'hat_crown': ['......', '......', 'PGYYGP']}
    if s == 4:
        return {'hat_straw': ['.hRh.', 'qHHHq'], 'hat_crown': ['.....', 'PGYGP']}
    return {}


def coins(s):
    """A coin turning: face, edge, face, edge; bright enough to see it float up off the grass."""
    if s == 2:
        return {}
    return {'coin_0': ['YY', 'yD'], 'coin_1': ['Y.', 'D.'], 'coin_2': ['YY', 'yD'], 'coin_3': ['.Y', '.D']}


def overrides(pal, ix):
    """{(sprite id, s): (w, h, palette indices)} for every hand-painted micro sprite."""
    out = {}
    for s, crabs in ((2, crab2()), (3, crab3()), (4, crab4())):
        pics = {k: (rows, {}) for k, rows in crabs.items()}
        pics.update(minis(s))
        pics.update({k: (rows, {}) for k, rows in crops(s).items()})
        pics.update({k: (rows, {}) for k, rows in others(s).items()})
        pics.update({k: (rows, {}) for k, rows in hats(s).items()})
        pics.update({k: (rows, {}) for k, rows in coins(s).items()})
        for k, (rows, extra) in pics.items():
            w, h = len(rows[0]), len(rows)
            if any(len(r) != w for r in rows):
                raise SystemExit('term_micro: %s at s = %d is not a rectangle' % (k, s))
            px = bytearray()
            for r in rows:
                for ch in r:
                    c = extra.get(ch) or LEGEND.get(ch)
                    px.append(CLEAR if ch == '.' else ix(c[:3]))
            out[(k, s)] = (w, h, bytes(px))
    return out
