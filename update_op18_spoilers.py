# Pull revealed OP18 cards into custom-cards.js.
#
#   python update_op18_spoilers.py
#
# DotGG does not have OP18 yet (see update_missing_cards.py). This uses the
# OPlayTCG card API for English names, stats, and effect text, then applies
# corrections checked against the OPDeckGuide spoiler page, Tier One's
# Japanese list, and the card images themselves.
#
# Not emitted:
#   OP18-080 — Tier One's number for the Spandam leader. The card is OP18-079.
#   OP18-105 — Tier One's number for Doberman. The card is OP18-106.
import json, os, re, urllib.request, datetime

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(OUT_DIR, 'op18')
os.makedirs(IMG_DIR, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126'}
API = 'https://oplaytcg.com/api/cards/'

# Printed numbers confirmed on the card images / English spoilers.
WANTED = '''
OP18-001 OP18-003 OP18-010 OP18-011 OP18-013 OP18-015 OP18-016 OP18-017 OP18-018
OP18-021 OP18-022 OP18-024 OP18-025 OP18-028 OP18-029 OP18-031 OP18-032
OP18-034 OP18-036 OP18-041 OP18-044 OP18-046 OP18-047 OP18-048 OP18-051
OP18-052 OP18-055 OP18-056 OP18-060 OP18-061 OP18-063 OP18-064 OP18-065
OP18-066 OP18-069 OP18-070 OP18-075 OP18-076 OP18-077 OP18-078 OP18-079
OP18-084 OP18-085 OP18-086 OP18-088 OP18-089 OP18-091 OP18-092 OP18-093
OP18-100 OP18-101 OP18-103 OP18-106 OP18-108 OP18-110 OP18-111 OP18-112
OP18-113 OP18-119
'''.split()

RARITY = {
    'Leader': 'L', 'Common': 'C', 'Uncommon': 'UC', 'Rare': 'R',
    'Super Rare': 'SR', 'Secret Rare': 'SEC',
}
TYPE = {'LEADER': 'Leader', 'CHARACTER': 'Character', 'EVENT': 'Event', 'STAGE': 'Stage'}

# Printed frame order. OPlay lists the two colours the other way around on these leaders.
COLOR_OVERRIDES = {
    'OP18-001': 'Red Blue',
    'OP18-060': 'Purple Black',
    # Tier One's base printing said Black; the frame and the other English sources are purple.
    'OP18-065': 'Purple',
    # Secret-rare frame art throws off pixel sampling. Tier One and OPlay both say Black.
    'OP18-119': 'Black',
}
# OPlay left Chopper's attribute blank. The Japanese list gives 打 (Strike).
ATTR_OVERRIDES = {'OP18-010': 'Strike', 'OP18-065': ''}
NAME_OVERRIDES = {'OP18-011': 'Nefertari Vivi'}  # printed name; OPlay has "Nefeltari"
# English text for these is an unofficial translation of the Japanese reveal.
UNOFFICIAL = {'OP18-018', 'OP18-070', 'OP18-088', 'OP18-103', 'OP18-110'}

def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

def fix_text(cid, effect, trigger):
    effect = (effect or '').replace('×', 'x').strip()
    trigger = (trigger or '').replace('×', 'x').strip()
    if cid == 'OP18-048':
        # OPlay has a broken "with from your hand". OPDeckGuide has the real sentence.
        effect = effect.replace(
            'Play up to 1 Character card with a type including "Baroque Works" and a cost of 5 or less with from your hand.',
            'Play up to 1 Character card with a cost of 5 or less with a type including "Baroque Works" from your hand.',
        )
    elif cid == 'OP18-061':
        effect = effect.replace('{Water Seven} types cards', '{Water Seven} type cards')
    elif cid == 'OP18-064':
        # The card's effect badges are [On Play] and [On K.O.]. OPlay also inserts [Your Turn].
        effect = effect.replace('[Your Turn] ', '')
    elif cid == 'OP18-075':
        # Same effect as OPDeckGuide, in the app's usual line breaks. OPlay's wording
        # ("Draw one card", "characters", "lower") is not how the card is phrased.
        effect = (
            '[On Play] Draw 1 card, add up to 1 DON!! card from your DON!! deck and rest it.\n'
            '[Activate: Main] DON!! −2, you may rest this Stage: Set up to 1 of your {Straw Hat Crew} '
            'type Characters with a power of 7000 or less as active.'
        )
    if trigger:
        if not trigger.startswith('[Trigger]'):
            trigger = '[Trigger] ' + trigger
        if trigger not in effect:
            effect = (effect + '\n' if effect else '') + trigger
    return effect

cards = {}
failed = []
for cid in WANTED:
    try:
        o = get_json(API + cid)
    except Exception as e:
        failed.append((cid, str(e)))
        continue
    colors = COLOR_OVERRIDES.get(cid) or ' '.join(o.get('colors') or [])
    attr = ATTR_OVERRIDES[cid] if cid in ATTR_OVERRIDES else (o.get('attribute') or '')
    if attr in ('?', '？', 'None'):
        attr = ''
    traits = [t.get('name') or '' for t in (o.get('traits') or [])]
    cards[cid] = {
        'id': cid,
        'name': NAME_OVERRIDES.get(cid, o.get('name') or cid),
        'text': fix_text(cid, o.get('effect'), o.get('trigger')),
        'set': 'The Dominance of God',
        'setId': 'OP-18',
        'rarity': RARITY.get(o.get('rarity') or '', o.get('rarity') or 'C'),
        'color': colors,
        'type': TYPE.get(o.get('type') or '', (o.get('type') or 'Character').title()),
        'life': str(o['life']) if o.get('life') is not None else None,
        'cost': o.get('cost'),
        'power': o.get('power'),
        'subs': ' '.join(t for t in traits if t),
        'counter': o.get('counter'),
        'attr': attr,
        'img': 'op18/' + cid + '.webp',
    }
    if cid in UNOFFICIAL:
        cards[cid]['unofficial'] = True
    printing = (o.get('printings') or [{}])[0]
    url = printing.get('imageFull') or printing.get('image')
    dest = os.path.join(IMG_DIR, cid + '.webp')
    if url and not (os.path.exists(dest) and os.path.getsize(dest) > 5000):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r, open(dest, 'wb') as f:
                f.write(r.read())
        except Exception as e:
            failed.append((cid, 'image ' + str(e)))
            cards[cid]['img'] = url
    elif not url:
        failed.append((cid, 'no image'))

print('parsed', len(cards), 'failed', failed)

def load_existing(path):
    if not os.path.exists(path):
        return []
    text = open(path, encoding='utf-8').read()
    m = re.search(r'concat\((\[.*\])\)\s*;', text, re.S)
    return json.loads(m.group(1)) if m else []

path = os.path.join(OUT_DIR, 'custom-cards.js')
fresh = cards
merged, seen = [], set()
for old in load_existing(path):
    if old['id'].startswith('OP18-'):
        if old['id'] in fresh and old['id'] not in seen:
            merged.append(fresh[old['id']]); seen.add(old['id'])
    else:
        merged.append(old); seen.add(old['id'])
for c in sorted(fresh.values(), key=lambda c: c['id']):
    if c['id'] not in seen:
        merged.append(c); seen.add(c['id'])

today = datetime.date.today().isoformat()
with open(path, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated cards missing from optcgapi (source: dotgg.gg for OP17 and EB05; '
            'OPlayTCG + spoiler cross-check for OP18, %s)\n' % today)
    f.write('window.CUSTOM_CARDS = (window.CUSTOM_CARDS || []).concat(')
    json.dump(merged, f, ensure_ascii=False, indent=1)
    f.write(');\n')
print('wrote', path, 'with', len(merged), 'cards')
leaders = [(c['id'], c['name'], c['color'], c['life']) for c in merged if c['id'].startswith('OP18-') and c['type'] == 'Leader']
print('op18 leaders', leaders)
blank = [c['id'] for c in fresh.values() if not c['color'] or (c['type'] != 'Leader' and c['cost'] is None) or not c['name']]
print('incomplete', blank or 'none')
