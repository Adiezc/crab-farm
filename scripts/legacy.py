# The art 1.2 shipped, read back from art-src/legacy/legacy.json (a snapshot of 1.2's hooks/art.ts): its sprites and
# icons as Pix grids, and its meadow (BG) and hedge (FG) as RGBA rows. New art is drawn from these pixels.
import base64
import json
import os

import png
import webp
from pix import Pix

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, '..', 'art-src', 'legacy', 'legacy.json')

_cache = {}


def raw():
    """The snapshot as stored: header, WORLD, LAYOUT, BG, FG, and SPRITES and ICONS as [name, data URI] pairs."""
    if 'raw' not in _cache:
        with open(PATH) as f:
            _cache['raw'] = json.load(f)
    return _cache['raw']


def _bytes(uri):
    return base64.b64decode(uri.split(',', 1)[1])


def _uris():
    if 'uris' not in _cache:
        d = raw()
        _cache['uris'] = dict(d['SPRITES'] + d['ICONS'])
    return _cache['uris']


def names():
    """Every key of 1.2's SPRITES and ICONS, in their order."""
    d = raw()
    return [k for k, _ in d['SPRITES']] + [k for k, _ in d['ICONS']]


def legacy_sprite(name):
    """One of 1.2's sprites or icons ('claude_stand', 'mini_haiku_0', 'laptop_1', 'crop_ripe_2', 'heart') as a Pix.
    Each call returns a fresh copy, so callers may draw on it."""
    if name not in _cache:
        uri = _uris().get(name)
        if uri is None:
            raise KeyError('no 1.2 sprite or icon named %r' % name)
        _cache[name] = Pix.of(png.decode(_bytes(uri))[2])
    return _cache[name].copy()


def legacy_layer(layer):
    """1.2's BG or FG ('bg' | 'fg') decoded: (w, h, rows of RGBA tuples)."""
    key = 'layer_' + layer
    if key not in _cache:
        _cache[key] = webp.decode(_bytes(raw()[layer.upper()]))
    return _cache[key]
