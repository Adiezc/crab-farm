# The colours every new sprite is drawn in: clodfarm's palettes as they appear in the baked art (the meadow `G`,
# `bodyPalHD`, the straw hat, the minis' bands, the barn, hay, stone and water of the BG). Nothing else is used.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from pix import hx  # noqa: E402

# ink: the crab's outline, and a deeper one for small critters
INK = hx('#4a1f12')
INK2 = hx('#2d1a10')
NIGHT = hx('#231815')
WHITE = hx('#ffffff')

# the crab (bodyPalHD)
BODY = dict(hi=hx('#f7c3a3'), lt=hx('#ec9670'), mid=hx('#d97757'), dk=hx('#b95d3f'), deep=hx('#8a3a21'),
            blush=hx('#f3ab98'), eye=NIGHT, glint=WHITE, pupil=hx('#4a3a36'), mouth=hx('#c8505a'))

# straw (the hat), and hay
STRAW = dict(edge=hx('#524537'), hi=hx('#fffaa5'), lt=hx('#f0cf7a'), mid=hx('#c5a44f'), dk=hx('#7a5a1a'),
             gold=hx('#e0b64e'), tan=hx('#a8782a'), ochre=hx('#c7973a'))
# reds: the hat band, barn and roof
RED = dict(hi=hx('#ee6759'), mid=hx('#c0392b'), dk=hx('#8d0600'), barn=hx('#a8432f'), barn2=hx('#b34a33'),
           barn3=hx('#8e3624'), deep=hx('#7a2c1f'), roof=hx('#6a3024'), roof2=hx('#4a2019'), bright=hx('#e0513c'),
           pink=hx('#f7a296'))
CREAM = dict(hi=hx('#f3ead8'), mid=hx('#efe4cf'), dk=hx('#d6c8ad'), sand=hx('#c8b27a'), sand2=hx('#8e7a4c'))
# wood (fence, signs, crates)
WOOD = dict(edge=hx('#3b2416'), plank=hx('#9b6b3f'), seam=hx('#7d532f'), light=hx('#c08a55'), dark=hx('#57391f'),
            soil=hx('#6b4a2e'), deep=hx('#3f2915'))
STONE = dict(hi=hx('#8d8783'), lt=hx('#6f6f78'), mid=hx('#55555e'), dk=hx('#45454e'), deep=hx('#34343c'),
             warm=hx('#6f6a66'))
WATER = dict(deep=hx('#2a5a8a'), mid=hx('#3f7fb8'), lt=hx('#5b9ed0'), hi=hx('#9fd0ee'))
# the meadow and the trees (G)
LEAF = dict(ink=hx('#1c3519'), t1=hx('#28501f'), t2=hx('#346a27'), t3=hx('#468a31'), t4=hx('#63a93f'),
            t5=hx('#8cc65a'), g0=hx('#4a6524'), g2=hx('#648436'), g4=hx('#80a246'), sprout=hx('#3f8f35'),
            lime=hx('#a6e27a'), green=hx('#6fcf5b'))
# the minis' bands (clodfarm's hat colours)
BLUE = dict(hi=hx('#64a6ff'), mid=hx('#3b7dd8'), dk=hx('#1557b2'))
PURPLE = dict(hi=hx('#a474e0'), mid=hx('#7b4bb7'), dk=hx('#552591'))
GOLD = dict(hi=hx('#fbcb46'), mid=hx('#d2a21d'), dk=hx('#ac7c00'), pale=hx('#fff4c2'), deep=hx('#6b4a07'))
PINK = dict(hi=hx('#ff98c8'), mid=hx('#e06f9f'), dk=hx('#ba4979'))
# the laptop and terminal
SCREEN = dict(bezel=hx('#1b1f2a'), glass=hx('#22303c'), text=hx('#7cfc9a'), key=hx('#c3cad6'), key2=hx('#9aa3b2'),
              key3=hx('#6b7383'))
# small flowers of the meadow
FLOWER = dict(lilac=hx('#c99bf0'), peach=hx('#e8845f'), cream=hx('#fff1cf'))
# feathers and fur
FEATHER = dict(hi=hx('#ffffff'), mid=hx('#f7f3ea'), dk=hx('#d8d2c4'), comb=hx('#e0513c'), beak=hx('#f5c542'),
               beak2=hx('#d2a21d'))
FOX = dict(hi=hx('#f0a050'), mid=hx('#d9772e'), dk=hx('#a8501e'), tip=hx('#f7f3ea'))
CAT = dict(hi=hx('#a8a4a0'), mid=hx('#8d8783'), dk=hx('#6f6a66'), stripe=hx('#55555e'))
# the bubble icons' slate, as 1.2 drew zzz, dots and ask, and the alert's dark red
SLATE = dict(hi=hx('#7d8db0'), lt=hx('#5b6b8f'), mid=hx('#3c4a6b'), dk=hx('#26304a'), red=hx('#6b1a10'))
# paper, eggs and the compost heap
PAPER = dict(hi=hx('#fbfaf5'), mid=hx('#efe4cf'), dk=hx('#d6c8ad'), line=hx('#a89878'))
EARTH = dict(hi=hx('#8a6a44'), mid=hx('#6b4a2e'), dk=hx('#4a3220'), deep=hx('#33220f'))
