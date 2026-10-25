# Pull cards that optcgapi.com doesn't carry yet from DotGG's public card API,
# download their images, and emit custom-cards.js for the app.
#
#   python update_missing_cards.py
#
# DotGG carries full official data (cost, power, counter, subtypes, attribute,
# colour), so it is the preferred source for any set optcgapi hasn't indexed.
# Add a set to SET_PREFIXES when it releases ahead of optcgapi; remove it once
# optcgapi picks it up (the app prefers API data by id, so leaving it is
# harmless, just dead weight).
#
# For a set so new that even DotGG lacks it, update_op17_spoilers.py scrapes
# card images off a spoiler site as a stopgap — but it has no stats and its
# card numbering proved unreliable, so prefer this script whenever DotGG has data.
import json, os, re, urllib.request, collections, datetime
from html import unescape

# OP18 is not on DotGG yet; update_op18_spoilers.py fills that in and this
# script keeps those cards when it rewrites custom-cards.js.
SET_PREFIXES = ['OP17', 'EB05']

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126'}
SET_NAMES = {
    'OP17': "The World's Strongest Warriors",
    'EB05': 'ONE PIECE Heroines Edition vol.2',
}

req = urllib.request.Request('https://api.dotgg.gg/cgfw/getcards?game=onepiece&mode=indexed', headers=UA)
d = json.load(urllib.request.urlopen(req, timeout=60))
idx = {n: i for i, n in enumerate(d['names'])}

def g(row, key):
    v = row[idx[key]]
    return v if v not in ('', None) else None

def num(v):
    return int(v) if v is not None and str(v).strip().isdigit() else None

def clean(s):
    # DotGG embeds <br> in effect text; the app renders text as plain (pre-wrap).
    # <Wisdom> / <Special> are attribute icons, not markup — keep the word.
    s = re.sub(r'<(Strike|Slash|Ranged|Wisdom|Special)>', r'\1', s)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    return unescape(s).strip()

cards = {}
for r in d['data']:
    cid = str(r[idx['id']])
    if not any(cid.startswith(p + '-') for p in SET_PREFIXES): continue
    if not re.fullmatch(r'[A-Z0-9]+-\d+', cid): continue   # skip _p1 alt printings
    if cid in cards: continue
    base = cid.split('-')[0]
    text = clean(g(r, 'Effect') or '')
    trig = clean(g(r, 'Trigger') or '')
    # DotGG's Trigger column already includes the [Trigger] keyword. Don't add a second one.
    if trig and trig not in text:
        if not trig.startswith('[Trigger]'): trig = '[Trigger] ' + trig
        text += ('\n' if text else '') + trig
    cards[cid] = {
        'id': cid,
        'name': g(r, 'name') or cid,
        'text': text,
        'set': SET_NAMES.get(base, base),
        'setId': base[:2] + '-' + base[2:] if base[:2] in ('OP', 'EB', 'ST') else base,
        'rarity': g(r, 'rarity') or 'C',
        # DotGG delimits dual colours and subtypes with "/"; optcgapi uses spaces
        'color': (g(r, 'Color') or '').replace('/', ' '),
        'type': (g(r, 'cardType') or 'CHARACTER').title(),
        'life': g(r, 'Life'),
        'cost': num(g(r, 'Cost')),
        'power': num(g(r, 'Power')),
        'subs': (g(r, 'Type') or '').replace('/', ' '),
        'counter': num(g(r, 'Counter')),
        'attr': g(r, 'Attribute') or '',
        'img': base.lower() + '/' + cid + '.webp',
    }

print('parsed', len(cards), 'cards:', dict(collections.Counter(c['setId'] for c in cards.values())))

failed = []
for cid, c in sorted(cards.items()):
    img_dir = os.path.join(OUT_DIR, cid.split('-')[0].lower())
    os.makedirs(img_dir, exist_ok=True)
    dest = os.path.join(img_dir, cid + '.webp')
    if os.path.exists(dest) and os.path.getsize(dest) > 5000: continue
    try:
        rq = urllib.request.Request('https://static.dotgg.gg/onepiece/card/' + cid + '.webp', headers=UA)
        with urllib.request.urlopen(rq, timeout=40) as resp, open(dest, 'wb') as f:
            f.write(resp.read())
    except Exception as e:
        failed.append((cid, str(e)))
        c['img'] = 'https://static.dotgg.gg/onepiece/card/' + cid + '.webp'
print('images done,', len(failed), 'failed:', failed[:5])

def load_existing(path):
    if not os.path.exists(path): return []
    text = open(path, encoding='utf-8').read()
    m = re.search(r'concat\((\[.*\])\)\s*;', text, re.S)
    return json.loads(m.group(1)) if m else []

path = os.path.join(OUT_DIR, 'custom-cards.js')
prefixes = tuple(p + '-' for p in SET_PREFIXES)
fresh = {c['id']: c for c in cards.values()}
merged, seen = [], set()
for old in load_existing(path):
    if old['id'].startswith(prefixes):
        if old['id'] in fresh and old['id'] not in seen:
            merged.append(fresh[old['id']]); seen.add(old['id'])
    else:
        merged.append(old); seen.add(old['id'])
for c in sorted(fresh.values(), key=lambda c: c['id']):
    if c['id'] not in seen:
        merged.append(c); seen.add(c['id'])

with open(path, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated cards missing from optcgapi (source: dotgg.gg, %s)\n'
            % datetime.date.today().isoformat())
    f.write('// Sets refreshed from DotGG: %s. Other ids already in this file are kept.\n'
            % ', '.join(SET_PREFIXES))
    f.write('window.CUSTOM_CARDS = (window.CUSTOM_CARDS || []).concat(')
    json.dump(merged, f, ensure_ascii=False, indent=1)
    f.write(');\n')
out = merged
print('wrote', path, 'with', len(out), 'cards')
print('leaders:', [(c['id'], c['name'], c['color']) for c in out if c['type'] == 'Leader'])
miss = [c['id'] for c in out if not c['color'] or (c['cost'] is None and c['type'] != 'Leader')]
print('incomplete entries:', miss or 'none')
