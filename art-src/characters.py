# What the crabs and their helpers use and leave behind: the helper minis (1.2's two frames and a new carry pose),
# the laptop and the crops (1.2's), the bubble icons, the props they hold, the things on the ground, and the little
# effects. 1.2's pixels are reused where they exist; everything else is drawn here at HD in clodfarm's palettes,
# with the same 1 px dark edges and 3-tone light from the top left.
from legacy import legacy_sprite
from palette import (BLUE, BODY, CREAM, EARTH, FLOWER, GOLD, INK, LEAF, PAPER, PINK, PURPLE, RED, SCREEN, SLATE,
                     STONE, STRAW, WATER, WHITE, WOOD)
from pix import Pix, paint, shade

MODELS = ('haiku', 'sonnet', 'opus', 'fable')


def canvas(art, w, h, pal=None, anchor='bottom'):
    """Paint rows (or take a Pix) into an exact w x h HD canvas: bottom-centred (feet), centred, or bottom-left."""
    p = paint(art, pal) if isinstance(art, list) else art
    if p.w > w or p.h > h:
        raise ValueError('art is %dx%d, canvas %dx%d' % (p.w, p.h, w, h))
    q = Pix(w, h)
    if anchor == 'bottom':
        q.blit(p, (w - p.w) // 2, h - p.h)
    elif anchor == 'centre':
        q.blit(p, (w - p.w) // 2, (h - p.h) // 2)
    else:
        q.blit(p, 0, h - p.h)
    return q


# ---- helpers: 1.2's minis, and a carry pose with a crate on the head ----

def mini_carry(m):
    """Arms up under a little crate, knees bent: the body sinks 2 rows onto 1.2's walking feet."""
    up, walk = legacy_sprite('mini_%s_1' % m), legacy_sprite('mini_%s_w' % m)
    q = Pix(20, 16)
    for y in range(1, 12):
        q.p[y + 2] = up.p[y][:]
    q.p[14] = walk.p[13][:]
    q.p[15] = walk.p[14][:]
    crate = paint([
        '.HHHHHHHHHH.',
        'HLllllllllpH',
        'HpppppppppdH',
        'HHHHHHHHHHHH',
        'HlpppppppppH',
        '.HHHHHHHHHH.',
    ], dict(H=WOOD['edge'], L=WOOD['light'], l=WOOD['light'], p=WOOD['plank'], d=WOOD['seam']))
    q.blit(crate, 4, 0)
    return q


# ---- bubble icons, 16 x 16, drawn to sit on the bubble's cream ----

ICON_PAL = dict(H=INK, w=PAPER['mid'], W=PAPER['hi'], d=PAPER['dk'], L=PAPER['line'], s=SLATE['mid'],
                S=SLATE['lt'], k=SLATE['dk'], r=RED['bright'], R=RED['pink'], e=SLATE['red'],
                b=WATER['mid'], B=WATER['lt'], l=WATER['hi'], D=WATER['deep'], g=LEAF['t3'], G=LEAF['t4'],
                n=LEAF['sprout'], y=GOLD['mid'], Y=GOLD['hi'], o=WOOD['plank'], O=WOOD['light'], u=WOOD['seam'],
                x=SCREEN['bezel'], z=SCREEN['glass'], t=SCREEN['text'], m=STONE['mid'], M=STONE['hi'],
                q=STONE['deep'], c=BODY['mid'], C=BODY['lt'], v=BLUE['mid'], p=PURPLE['mid'], a=PINK['mid'])

ICONS = {
    'terminal': [
        '................',
        '.xxxxxxxxxxxxxx.',
        '.xzzzzzzzzzzzzx.',
        '.xztzzzzzzzzzzx.',
        '.xzztzzzzzzzzzx.',
        '.xzzztzzzzzzzzx.',
        '.xzztzzzzzzzzzx.',
        '.xztzzzttttzzzx.',
        '.xzzzzzzzzzzzzx.',
        '.xxxxxxxxxxxxxx.',
        '......xxxx......',
        '......xxxx......',
        '....xxxxxxxx....',
        '................',
    ],
    'scroll': [
        '..HHHHHHHHHHH...',
        '.HWWWWWWWWWWdH..',
        '.HddddddddddHH..',
        '..HwwwwwwwwwH...',
        '..HwLLLLLLwwH...',
        '..HwwwwwwwwwH...',
        '..HwLLLLLwwwH...',
        '..HwwwwwwwwwH...',
        '..HwLLLLLLLwH...',
        '..HwwwwwwwwwH...',
        '..HwLLLLwwwwH...',
        '.HHHHHHHHHHHHH..',
        '.HWWWWWWWWWWdH..',
        '..HHHHHHHHHHH...',
    ],
    'quill': [
        '............HHH.',
        '...........HWWWH',
        '..........HWWwwH',
        '.........HWWwwH.',
        '........HWWwwdH.',
        '.......HWWwwdH..',
        '......HWWwwdH...',
        '.....HWWwwdH....',
        '.....HWwwdH.....',
        '....HWwddH......',
        '....HwddH.......',
        '...HkddH........',
        '...HkHH.........',
        '..HkH...........',
        '..HH............',
    ],
    'globe': [
        '.....HHHHHH.....',
        '...HHlllbbbbHH..',
        '..HllgGbbbbbbbH.',
        '..HlgGGgbbbgbbH.',
        '.HlbgGGggbbggbbH',
        '.HlbbgGgbbbgGbbH',
        '.HbbbbggbbbbgbbH',
        '.HbbbbbgGbbbbbDH',
        '.HbbbbbgGGgbbbDH',
        '.HbgbbbbgGgbbbDH',
        '..HggbbbbggbbDH.',
        '..HbbbbbbbbbDDH.',
        '...HHbbbbbDDHH..',
        '.....HHHHHH.....',
    ],
    'magnifier': [
        '....HHHHHH......',
        '...HyYYYYyH.....',
        '..HYlWWllllyH...',
        '..HYWlllllllH...',
        '.HYlWllllllByH..',
        '.HYllllllllByH..',
        '.HYlllllllBByH..',
        '..HylllllBByH...',
        '..HyylBBBBBuH...',
        '...HHyyyyyHuOH..',
        '.....HHHHH.HuOH.',
        '............HuOH',
        '.............HuH',
        '..............H.',
    ],
    'roster': [
        '......HHHH......',
        '.....HppppH.....',
        '..HHHHCccccHHHH.',
        '.HvvvHcHccHHaaaH',
        'HCcccHCccccHcccH',
        'HcHccHcccccHcHcH',
        'HCcccHHHHHHHcccH',
        'HcccccHcHcHccccH',
        '.HHHHH.H.H.HHHH.',
        '.H.H.H.....H.H.H',
    ],
    'plan': [
        '.....HHHHHH.....',
        '..HHHHyYYyHHHH..',
        '..HoHHHHHHHHoH..',
        '..HoWWWWWWWWoH..',
        '..HoWgWWWWWWoH..',
        '..HogWLLLLWWoH..',
        '..HoWWWWWWWWoH..',
        '..HoWgWWWWWWoH..',
        '..HogWLLLLLWoH..',
        '..HoWWWWWWWWoH..',
        '..HoWdWWWWWWoH..',
        '..HodWLLLWWWoH..',
        '..HuuuuuuuuuuH..',
        '..HHHHHHHHHHHH..',
    ],
    'plug': [
        '....HH...HH.....',
        '....HM...HM.....',
        '....Hm...Hm.....',
        '..HHHHHHHHHHH...',
        '..HSSSSSSSSskH..',
        '..HSsssssssskH..',
        '..HHsssssssskH..',
        '...HSssssssskH..',
        '....HSsssssskH..',
        '.....HHHkkHHH...',
        '.......HkkH.....',
        '.......HkkH.....',
        '........HkkH....',
        '.........HkkH...',
        '..........HH....',
    ],
    'gear': [
        '......HHHH......',
        '......HMmH......',
        '..HHH.HMmH.HHH..',
        '..HMmHHMmmHHmqH.',
        '..HHMMMMmmmmqHH.',
        '...HMMmmmmmmqH..',
        'HHHHMmmHHHmmqHHH',
        'HMMMMmH...HmqqqH',
        'HmmmmmH...HmqqqH',
        'HHHHmmmHHHmqqHHH',
        '...HmmmmmmmqqH..',
        '..HHmmmmmqqqqHH.',
        '..HmqHHmqqHHqqH.',
        '..HHH.HmqqH.HHH.',
        '......HmqqH.....',
        '......HHHH......',
    ],
    'dots': [
        '................',
        '.HHH..HHH..HHH..',
        'HSssHHSssHHSssH.',
        'HsssHHsssHHsssH.',
        'HsskHHsskHHsskH.',
        '.HHH..HHH..HHH..',
    ],
    'alert': [
        '......eeee......',
        '.....errrre.....',
        '.....eRrrre.....',
        '.....eRrrre.....',
        '.....eRrrre.....',
        '.....errrre.....',
        '......errre.....',
        '......errre.....',
        '.......ee.......',
        '................',
        '......eeee......',
        '.....eRrrre.....',
        '.....errrre.....',
        '......eeee......',
    ],
    'ask': [
        '.....kkkkk......',
        '...kkSSSSskk....',
        '..kSSkkkkksskk..',
        '..kSkk....kssk..',
        '..kkk.....kssk..',
        '.........kssk...',
        '.......kkssk....',
        '......kSssk.....',
        '......kssk......',
        '.......kk.......',
        '................',
        '......kkkk......',
        '......kSsk......',
        '.......kk.......',
    ],
    'heart': [
        '..eeee...eeee...',
        '.eRRrre.errrre..',
        'eRWRrrreerrrrre.',
        'eRRrrrrrrrrrrre.',
        'eRrrrrrrrrrrrre.',
        'errrrrrrrrrrrre.',
        '.errrrrrrrrrre..',
        '..errrrrrrrre...',
        '...errrrrrre....',
        '....errrrre.....',
        '.....errre......',
        '......ere.......',
        '.......e........',
    ],
    'zzz': [
        '........kkkkkkk.',
        '........kSSSSsk.',
        '...........ksk..',
        '..........ksk...',
        '.........kssk...',
        '.kkkkkk.kssssk..',
        '.kSSSsk.kkkkkk..',
        '....ksk.........',
        '...ksk..........',
        '..kssk..........',
        '.kssssk.........',
        '.kkkkkk.........',
    ],
    'book': [
        '...HHHHHHHHHH...',
        '..HvvvvvvvvvdH..',
        '..HvVVVVVVvvdH..',
        '..HvVyyyyVvvdH..',
        '..HvVVVVVVvvdH..',
        '..HvvvvvvvvvdH..',
        '..HvvvvvvvvvdH..',
        '..HvvvvvvvvvdH..',
        '..HvvvvvvvvvdH..',
        '..HvvvvvvvvvdH..',
        '..HvvvvvvvvvdH..',
        '..HdHWWWWWWWWH..',
        '..HHdHHHHHHHHH..',
        '...HHHHHHHHHHH..',
    ],
}


def icons():
    pal = dict(ICON_PAL, V=BLUE['hi'], d=BLUE['dk'])
    out = {}
    for k, rows in ICONS.items():
        out['icon_' + k] = canvas(rows, 16, 16, pal if k == 'book' else ICON_PAL, 'centre')
    return out


# ---- held props ----

WOODPAL = dict(H=WOOD['edge'], L=WOOD['light'], l=WOOD['light'], p=WOOD['plank'], d=WOOD['seam'], s=WOOD['dark'])
METAL = dict(S=STONE['hi'], s=STONE['lt'], m=STONE['mid'], q=STONE['dk'])


def props():
    P = {}
    hoe = dict(H=WOOD['edge'], w=WOOD['light'], d=WOOD['plank'], **METAL)
    P['prop_hoe'] = canvas([
        '......HHHHHH',
        '.....HSSSssH',
        '.....HssmmqH',
        '......HHwHH.',
        '......HwdH..',
        '.....HwdH...',
        '.....HwdH...',
        '....HwdH....',
        '....HwdH....',
        '...HwdH.....',
        '...HwdH.....',
        '..HwdH......',
        '..HwdH......',
        '.HwdH.......',
        '.HwdH.......',
        'HwdH........',
        'HwdH........',
        'HHH.........',
    ], 12, 20, hoe, 'left')
    P['prop_hoe_2'] = canvas([
        'HHH.............',
        'HwwHH...........',
        '.HddwwHH........',
        '..HHddwwHH......',
        '....HHddwwHH....',
        '......HHddwwHHH.',
        '........HHddHSH.',
        '..........HHHsH.',
        '...........HSsmH',
        '...........HssqH',
        '...........HmqqH',
        '............HHH.',
    ], 16, 12, hoe, 'left')
    can = dict(H=INK, B=BLUE['hi'], b=BLUE['mid'], d=BLUE['dk'], l=WATER['hi'], L=WATER['lt'])
    P['prop_can'] = canvas([
        '..HHHHHH......',
        '.HH....HH.....',
        '.H......H.....',
        'HHHHHHHHHH..HH',
        'HBBBBBBBbH.HbH',
        'HBbbbbbbbHHbH.',
        'HBbbbbbbbbbH..',
        'HBbbbbbbbHH...',
        'HBbbbbbbdH....',
        'HbbbbbbddH....',
        '.HHHHHHHH.....',
    ], 14, 12, can, 'left')
    P['prop_can_2'] = canvas([
        '..HHHH..........',
        '.H....HH........',
        'H.......H.......',
        'HHHHHHHH.H......',
        'HBBBBBBbHH......',
        'HBbbbbbbbbHH....',
        '.HBbbbbbbbbbHH..',
        '..HbbbbbbbbbdbHH',
        '...HdbbbbbddHHbH',
        '....HHHdddHH..HH',
        '.......HHH...L..',
        '............L..l',
    ], 16, 12, can, 'left')
    P['prop_bucket'] = canvas([
        '..HHHHHH..',
        '.H......H.',
        'HHHHHHHHHH',
        'HlLLLLLLlH',
        'HpLppLppdH',
        'HmmmmmmmqH',
        '.HpppppdH.',
        '.HpLppLdH.',
        '..HHHHHH..',
    ], 10, 10, dict(WOODPAL, l=WATER['hi'], L=WATER['lt'], m=STONE['lt'], q=STONE['mid']), 'left')
    mag = Pix(10, 10)
    mag.oval(6, 3.8, 3.6, 3.6, shade(GOLD['hi'], GOLD['mid'], GOLD['dk']))
    mag.oval(6, 3.8, 2.3, 2.3, shade(WHITE, WATER['hi'], WATER['lt']))
    mag.line(3, 6, 1, 8, WOOD['light'])
    mag.line(2, 6, 0, 8, WOOD['plank'])
    mag.outline(INK)
    P['prop_magnifier'] = canvas(mag.crop(0, 0, 10, 10), 10, 10, anchor='left')
    sack = dict(H=WOOD['edge'], s=CREAM['sand'], S=CREAM['dk'], d=CREAM['sand2'], t=WOOD['light'], T=STRAW['lt'],
                g=LEAF['sprout'])
    P['prop_sack'] = canvas([
        '...HHHHH....',
        '..HtTTtH....',
        '...HHtHH....',
        '..HHssHHH...',
        '.HsSSsssH...',
        'HsSssssssH..',
        'HsSsssgssdH.',
        'HsSssgggsdH.',
        'HssssggssdH.',
        'HssssssssdH.',
        'HsssssssddH.',
        '.HdddddddH..',
        '..HHHHHHH...',
    ], 12, 14, sack)
    P['prop_crate'] = crate(WOODPAL)
    P['prop_letter'] = canvas([
        'HHHHHHHHHH',
        'HWHwwwwHdH',
        'HwwHwwHwdH',
        'HwwwHHwwdH',
        'HwwwwrwwdH',
        'HwwwwwwwdH',
        'HHHHHHHHHH',
    ], 10, 8, dict(H=INK, W=PAPER['hi'], w=PAPER['mid'], d=PAPER['dk'], r=RED['mid']))
    P['prop_basket'] = basket(fruit=True)
    P['prop_book'] = canvas([
        'HHHH..HHHH',
        'HWWWHHWwwH',
        'HWLLWwLLwH',
        'HWWWWwwwwH',
        'HWLLWwLLwH',
        'HvvvvHvvvH',
        'HHHHHHHHHH',
    ], 10, 8, dict(H=INK, W=PAPER['hi'], w=PAPER['mid'], L=PAPER['line'], v=BLUE['mid']))
    ham = dict(H=WOOD['edge'], w=WOOD['light'], d=WOOD['plank'], **METAL)
    P['prop_hammer'] = canvas([
        '..HHHHHH..',
        '..HSSssH..',
        '..HssmqH..',
        '..HHHwHH..',
        '....HwH...',
        '...HwdH...',
        '...HwH....',
        '..HwdH....',
        '..HwH.....',
        '..HH......',
    ], 10, 10, ham, 'left')
    P['prop_hammer_2'] = canvas([
        '.......HHH',
        '.......HSH',
        'HHH....HsH',
        'HwwHHHHHsH',
        '.HHddwwHmH',
        '....HHHHqH',
        '.......HqH',
        '.......HHH',
    ], 10, 10, ham, 'left')
    P['prop_lantern'] = canvas([
        '...HH...',
        '..H..H..',
        '.HHHHHH.',
        '.HqmmqH.',
        'HqYWYyqH',
        'HqYYYyqH',
        'HqyYyyqH',
        'HqyyyyqH',
        '.HqmmqH.',
        '..HHHH..',
    ], 8, 12, dict(H=INK, q=STONE['deep'], m=STONE['mid'], Y=GOLD['hi'], y=GOLD['mid'], W=GOLD['pale']))
    rod = Pix(20, 24)
    rod.line(19, 1, 19, 19, PAPER['dk'])
    rod.line(2, 22, 18, 2, WOOD['light'])
    rod.line(1, 22, 17, 2, WOOD['plank'])
    rod.rect(0, 20, 3, 4, RED['mid'])
    rod.set(1, 20, RED['hi'])
    rod.rect(18, 19, 3, 2, RED['bright'])
    rod.rect(18, 21, 3, 1, WHITE)
    rod.outline(INK)
    rod.set(19, 0, INK)
    P['prop_rod'] = rod.crop(0, 0, 20, 24)
    crank = Pix(12, 12)
    crank.oval(5.5, 6.5, 4.5, 4.5, shade(STONE['hi'], STONE['lt'], STONE['mid']))
    crank.oval(5.5, 6.5, 2.2, 2.2, STONE['dk'])
    crank.rect(5, 6, 2, 2, STONE['hi'])
    crank.line(6, 6, 9, 3, STONE['mid'])
    crank.rect(9, 1, 2, 3, WOOD['light'])
    crank.set(10, 3, WOOD['plank'])
    crank.outline(INK)
    P['prop_crank'] = crank.crop(0, 0, 12, 12)
    P['prop_umbrella'] = canvas([
        '..........HHHH..........',
        '.......HHHrrwwHHH.......',
        '.....HHRrrrwwwwrrHH.....',
        '....HRRrrrwwwwwwrrrH....',
        '...HRrrrrwwwwwwwwrrrH...',
        '..HRrrrrwwwwwwwwwwrrrH..',
        '.HRrrrrwwwwwwwwwwwwrrdH.',
        'HHrrrrHwwwwwHwwwwwHrrdHH',
        'H.HHHH.HHHHHHHHHHH.HHH.H',
        '...........HoH..........',
        '...........HoH..........',
        '...........HoH..........',
        '...........HoH..........',
        '...........HoH..........',
        '.........HHHoH..........',
        '.........HoHH...........',
    ], 24, 16, dict(H=INK, R=RED['pink'], r=RED['bright'], d=RED['mid'], w=CREAM['hi'], o=WOOD['plank']))
    return P


def crate(pal):
    return canvas([
        'HHHHHHHHHHHHHH',
        'HLlllllllllldH',
        'HpppppppppppdH',
        'HHHHHHHHHHHHHH',
        'HLlllllllllldH',
        'HpppppppppppdH',
        'HHHHHHHHHHHHHH',
        'HLlllllllllldH',
        'HpppppppppppdH',
        'HdddddddddddsH',
        'HHHHHHHHHHHHHH',
    ], 14, 12, pal)


def basket(fruit=False, eggs=False):
    pal = dict(H=WOOD['edge'], w=STRAW['gold'], W=STRAW['lt'], d=STRAW['tan'], o=STRAW['ochre'], r=RED['bright'],
               R=RED['pink'], g=LEAF['t3'], G=LEAF['t4'], e=FLOWER['cream'], E=WHITE, f=CREAM['dk'])
    if eggs:
        return canvas([
            '...HHH.HHH....',
            '..HEeeHEeeH...',
            '.HHeefHeefHHH.',
            'HHHHHHHHHHHHHH',
            'HWwWwWwWwWwWdH',
            'HdwdwdwdwdwddH',
            '.HWwWwWwWwWdH.',
            '..HdddddddddH.',
            '...HHHHHHHHH..',
        ], 14, 10, pal)
    return canvas([
        '....HHHHHH....',
        '...HwH..HwH...',
        '..HHHHHHHHHH..',
        '.HrRrHGgHrRrH.',
        'HHHHHHHHHHHHHH',
        'HWwWwWwWwWwWdH',
        'HdwdwdwdwdwddH',
        '.HWwWwWwWwWdH.',
        '.HdwdwdwdwddH.',
        '..HddddddddH..',
        '...HHHHHHHH...',
    ], 14, 12, pal)


# ---- things on the ground ----

COINS = [
    [
        '...HHHH...',
        '.HHWYYYHH.',
        '.HWYYYYyH.',
        'HWYdYdYdyH',
        'HYYdYdYdyH',
        'HYYYdddyyH',
        'HYYYYdyyyH',
        '.HyYyyyoH.',
        '.HHyyyoHH.',
        '...HHHH...',
    ], [
        '...HHHH...',
        '..HWYYyH..',
        '.HWYYYyyH.',
        '.HYdYdyyH.',
        '.HYdYdyyH.',
        '.HYYddyyH.',
        '.HYYYdyyH.',
        '.HyYyyyoH.',
        '..HyyyoH..',
        '...HHHH...',
    ], [
        '....HH....',
        '...HWyH...',
        '...HWyH...',
        '...HYyH...',
        '...HYyH...',
        '...HYyH...',
        '...HYyH...',
        '...HYoH...',
        '...HYoH...',
        '....HH....',
    ],
]


def coins():
    """A gold coin stamped with a shell, spinning: face, turning, edge, turning back."""
    pal = dict(H=GOLD['deep'], W=GOLD['pale'], Y=GOLD['hi'], y=GOLD['mid'], o=GOLD['dk'], d=GOLD['dk'])
    c = [canvas(rows, 10, 10, pal) for rows in COINS]
    return {'coin_0': c[0], 'coin_1': c[1], 'coin_2': c[2], 'coin_3': c[1].flipx()}


def ground():
    G = {}
    G['crate'] = crate(WOODPAL)
    full = crate(WOODPAL).crop(0, 3, 14, 9)
    G['crate_full'] = canvas([
        '..HHH..HHH....',
        '.HrRrHHgGgHHH.',
        'HrrRrrHgGgHoOH',
    ], 14, 3, dict(H=INK, r=RED['bright'], R=RED['pink'], g=LEAF['t3'], G=LEAF['t5'], o=GOLD['mid'],
                   O=GOLD['hi']), 'bottom')
    G['crate_full'] = stack(G['crate_full'], full, 14, 12)
    gold = dict(H=GOLD['deep'], L=GOLD['pale'], l=GOLD['hi'], p=GOLD['mid'], d=GOLD['dk'], s=GOLD['deep'])
    G['crate_gold'] = crate(gold)
    G['crate_gold'].set(2, 1, WHITE)
    G['crate_gold'].set(3, 5, WHITE)
    G.update(coins())
    G['basket_eggs'] = basket(eggs=True)
    hay = dict(E=STRAW['dk'], D=STRAW['lt'], G=STRAW['gold'], H=STRAW['ochre'], F=STRAW['tan'])
    G['bale'] = canvas([
        '.E.E.E..E.E.E.E.',
        'EDEDEDEEDEDEDEDE',
        'EDDDDFDDDDDFDDDE',
        'EGGGGFFGGGGFFGGE',
        'EGGGGFFGGGGFFGGE',
        'EGGGGFFGGGGFFGGE',
        'EGGGGFFGGGGFFGGE',
        'EHHHGFFHHHGFFHHE',
        'EHHHHFFHHHHFFHHE',
        'EHHHHFFHHHHFFHHE',
        'EEEEEEEEEEEEEEEE',
    ], 16, 12, hay)
    for k, h in enumerate((12, 16, 20)):
        G['compost_%d' % k] = compost(k, h)
    return G


def stack(top, bottom, w, h):
    q = Pix(w, h)
    q.blit(bottom, (w - bottom.w) // 2, h - bottom.h)
    q.blit(top, (w - top.w) // 2, h - bottom.h - top.h + 1)
    return q


def compost(stage, h):
    """A slatted bin, its heap of peelings and earth growing over the rim."""
    q = Pix(24, h)
    heap = Pix(24, 10)
    hh = (3, 6, 9)[stage]
    heap.oval(12, 10, 10, hh, shade(EARTH['hi'], EARTH['mid'], EARTH['dk']))
    bits = [(5, 8, LEAF['t4']), (9, 6, RED['bright']), (14, 7, GOLD['hi']), (17, 9, LEAF['t3']), (11, 9, CREAM['hi']),
            (7, 5, LEAF['t3']), (15, 4, RED['pink']), (12, 3, LEAF['t4']), (10, 2, GOLD['mid']), (18, 6, CREAM['dk'])]
    for x, y, c in bits:
        if heap.get(x, y) is not None:
            heap.set(x, y, c)
    heap.outline(EARTH['deep'])
    q.blit(heap, 0, h - 16)
    bin_ = paint([
        'HHH.HHH.HHH.HHH.HHH.HHH.',
        'HpHHHpHHHpHHHpHHHpHHHpH.',
        'HLlllllllllllllllllllldH',
        'HpppppppppppppppppppppdH',
        'HHHHHHHHHHHHHHHHHHHHHHHH',
        'HLlllllllllllllllllllldH',
        'HdddddddddddddddddddddsH',
        'HHHHHHHHHHHHHHHHHHHHHHHH',
    ], WOODPAL)
    q.blit(bin_, 0, h - 8)
    return q


# ---- effects ----

def effects():
    E = {}
    dust = dict(a=CREAM['hi'], b=CREAM['dk'], c=CREAM['sand'])
    E['dust_0'] = canvas([
        '...aa.......',
        '..aaab..ab..',
        '.aaabbcabbc.',
        '..bbcc.bcc..',
    ], 12, 6, dust)
    E['dust_1'] = canvas([
        'a.........a.',
        '.ab.....ab..',
        '..b..a...b..',
        '.....bc.....',
    ], 12, 6, dust)
    wet = dict(H=WATER['deep'], l=WATER['lt'], W=WATER['hi'], m=WATER['mid'])
    E['splash_0'] = canvas([
        '.....W......',
        '..W..l..W...',
        '..l.HlH.l...',
        '.HlHlWlHlH..',
        'HlWlWWWlWlH.',
        '.HmlllllmH..',
        '..HHHHHHH...',
    ], 12, 8, wet)
    E['splash_1'] = canvas([
        'W..........W',
        '.l..W..W..l.',
        '..l......l..',
        '...H.HH.H...',
        '..HlHllHlH..',
        '..HmlllllmH.',
        '...HHHHHHH..',
    ], 12, 8, wet)
    E['drop'] = canvas([
        '.H..',
        '.lH.',
        'HllH',
        'HlWH',
        'HmlH',
        '.HH.',
    ], 4, 6, wet)
    star = dict(W=WHITE, Y=GOLD['pale'], y=GOLD['hi'], o=GOLD['mid'])
    E['sparkle_0'] = canvas([
        '....y.....',
        '....y.....',
        '...yYy....',
        '..yYWYy...',
        'yyYWWWYyy.',
        '..yYWYy...',
        '...yYy....',
        '....y.....',
        '....y.....',
    ], 10, 10, star, 'centre')
    E['sparkle_1'] = canvas([
        '..........',
        '.o.....o..',
        '..y...y...',
        '...yWy....',
        '....W.....',
        '...yWy....',
        '..y...y...',
        '.o.....o..',
        '..........',
    ], 10, 10, star, 'centre')
    conf = dict(r=RED['bright'], b=BLUE['hi'], y=GOLD['hi'], g=LEAF['t5'], p=PINK['hi'], v=PURPLE['hi'])
    E['confetti_0'] = canvas([
        '.r..........y...',
        '.r.....b........',
        '.......b....g...',
        '...y.......gg...',
        '...yy..p........',
        '..........v.....',
        '.g.....p..v...r.',
        'gg..b.........r.',
        '....bb....y.....',
        '..........yy....',
    ], 16, 12, conf, 'centre')
    E['confetti_1'] = canvas([
        '......r.........',
        '..b...rr....y...',
        '..b.........y...',
        '........g.......',
        '.y......gg...p..',
        '.yy..........p..',
        '.....v..........',
        '.....vv...b.....',
        '..r.......bb..g.',
        '..r...y.......g.',
    ], 16, 12, conf, 'centre')
    pud = Pix(16, 6)
    pud.oval(8, 3, 7.5, 2.6, shade(WATER['hi'], WATER['lt'], WATER['mid'], 0.9))
    pud.outline(WATER['deep'])
    E['puddle'] = pud.crop(0, 0, 16, 6)
    rip = Pix(16, 6)
    rip.oval(8, 3, 7.6, 2.7, WATER['hi'])
    for y in range(6):
        for x in range(16):
            u, v = (x + .5 - 8) / 6.0, (y + .5 - 3) / 1.6
            if u * u + v * v <= 1:
                rip.clear(x, y)
    E['ripple'] = rip
    return E


# ---- the module ----

def sprites():
    S = {}
    for m in MODELS:
        S['mini_%s_0' % m] = legacy_sprite('mini_%s_0' % m)
        S['mini_%s_1' % m] = legacy_sprite('mini_%s_1' % m)
        S['mini_%s_carry' % m] = mini_carry(m)
    for k in range(3):
        S['laptop_%d' % k] = legacy_sprite('laptop_%d' % k)
    S['crop_seed'] = legacy_sprite('crop_seed_1')
    S['crop_sprout'] = legacy_sprite('crop_sprout_1')
    for k in range(3):
        S['crop_grow_%d' % k] = legacy_sprite('crop_grow_%d' % k)
        S['crop_ripe_%d' % k] = legacy_sprite('crop_ripe_%d' % k)
    S.update(icons())
    S.update(props())
    S.update(ground())
    S.update(effects())
    return S
