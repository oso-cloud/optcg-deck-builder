# Pull new starter-deck cards that optcgapi.com doesn't carry yet from DotGG's
# public card API, download images, and emit custom-cards-st.js for the app.
# Usage: python update_st_starters.py
# Edit SET_PREFIXES when future decks need adding; once optcgapi picks a set up,
# its entries here are ignored automatically (the app prefers API data by id).
import json, os, re, urllib.request, collections, datetime

SET_PREFIXES = ['ST31', 'ST32', 'ST33', 'ST34', 'ST35', 'ST36']
SET_NAMES = {}  # optional pretty names per prefix, e.g. {'ST31': 'Starter Deck 31: ...'}

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(OUT_DIR, 'st')
os.makedirs(IMG_DIR, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126'}

req = urllib.request.Request('https://api.dotgg.gg/cgfw/getcards?game=onepiece&mode=indexed', headers=UA)
d = json.load(urllib.request.urlopen(req, timeout=60))
idx = {n: i for i, n in enumerate(d['names'])}

def g(row, key):
    v = row[idx[key]]
    return v if v not in ('', None) else None

cards = {}
for r in d['data']:
    cid = str(r[idx['id']])
    if not any(cid.startswith(p + '-') for p in SET_PREFIXES): continue
    if cid in cards: continue  # skip alt printings
    base = cid.split('-')[0]
    ctype = (g(r, 'cardType') or 'CHARACTER').title()  # LEADER -> Leader
    text = g(r, 'Effect') or ''
    trig = g(r, 'Trigger')
    if trig: text += (' ' if text else '') + '[Trigger] ' + trig
    color = (g(r, 'Color') or '').replace('/', ' ')
    subs = (g(r, 'Type') or '').replace('/', ' ')
    cards[cid] = {
        'id': cid, 'name': g(r, 'name') or cid, 'text': text,
        'set': SET_NAMES.get(base, 'Starter Deck ' + base[2:] + ' (new)'),
        'setId': base[:2] + '-' + base[2:],
        'rarity': g(r, 'rarity') or 'C', 'color': color,
        'type': ctype,
        'life': g(r, 'Life'),
        'cost': int(g(r, 'Cost')) if g(r, 'Cost') and str(g(r, 'Cost')).isdigit() else None,
        'power': int(g(r, 'Power')) if g(r, 'Power') and str(g(r, 'Power')).isdigit() else None,
        'subs': subs,
        'counter': int(g(r, 'Counter')) if g(r, 'Counter') and str(g(r, 'Counter')).isdigit() else None,
        'attr': g(r, 'Attribute') or '',
        'img': 'st/' + cid + '.webp',
    }

print('parsed', len(cards), 'cards:', collections.Counter(c['setId'] for c in cards.values()))

failed = []
for cid, c in cards.items():
    dest = os.path.join(IMG_DIR, cid + '.webp')
    if os.path.exists(dest) and os.path.getsize(dest) > 5000: continue
    try:
        req = urllib.request.Request('https://static.dotgg.gg/onepiece/card/' + cid + '.webp', headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r, open(dest, 'wb') as f:
            f.write(r.read())
    except Exception as e:
        failed.append((cid, str(e)))
        c['img'] = 'https://static.dotgg.gg/onepiece/card/' + cid + '.webp'
print('images done,', len(failed), 'failed:', failed[:5])

out = sorted(cards.values(), key=lambda c: c['id'])
path = os.path.join(OUT_DIR, 'custom-cards-st.js')
with open(path, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated new starter-deck cards (source: dotgg.gg, %s)\n' % datetime.date.today().isoformat())
    f.write('window.CUSTOM_CARDS = (window.CUSTOM_CARDS || []).concat(')
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write(');\n')
print('wrote', path)
print('leaders:', [(c['id'], c['name'], c['color']) for c in out if c['type'] == 'Leader'])
