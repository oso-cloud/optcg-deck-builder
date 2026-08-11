# Refresh OP17 spoiler cards: scrape opdeckguide.com's cards-list page,
# download images, detect card colors from frame pixels, emit custom-cards.js
# Usage: python update_op17_spoilers.py            (fetches the page itself)
#        python update_op17_spoilers.py page.html  (use a saved copy)
import re, sys, os, json, urllib.request, urllib.parse, collections
from PIL import Image

OUT_DIR = os.path.dirname(os.path.abspath(__file__))   # app folder
IMG_DIR = os.path.join(OUT_DIR, 'op17')
BASE = 'https://opdeckguide.com'
PAGE = BASE + '/cards-list/OP17/'
os.makedirs(IMG_DIR, exist_ok=True)

BASE_RARITIES = {'Leader Card': 'L', 'Common': 'C', 'Uncommon': 'UC', 'Rare': 'R',
                 'Super Rare': 'SR', 'Secret Rare': 'SEC', 'Unknown': 'C'}
# Special printings. Used only when a card number has no base printing revealed yet,
# so cards whose sole reveal is a TR/SP/manga still make it into the app.
FALLBACK_RARITIES = {'Treasure Rare': 'TR', 'SP': 'SP', 'SPR': 'SP', 'Gold': 'SP',
                     'Full Art': 'SR', 'Manga': 'SR', 'PIRATE CREW SUPER ALT MANGA': 'SR'}
SKIP_RARITIES = {'DON!!'}   # not deck cards

if len(sys.argv) > 1:
    html = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
else:
    req = urllib.request.Request(PAGE, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126'})
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', errors='ignore')
arts = re.findall(r'<article class="leak-card".*?</article>', html, re.S)

def effect_text(a):
    lines = []
    for p in re.findall(r'<p class="leak-effect-line".*?</p>', a, re.S):
        # keyword badge images -> [Keyword]
        p = re.sub(r'<img[^>]*class="keyword-badge"[^>]*alt="([^"]+)"[^>]*>', r'[\1]', p)
        p = re.sub(r'<[^>]+>', '', p)
        p = re.sub(r'\s+', ' ', p).strip()
        if p: lines.append(p)
    return ' '.join(lines)

cards = {}
# Pass 1 takes normal printings; pass 2 fills gaps from special printings only.
for allow_fallback in (False, True):
  for a in arts:
    code_m = re.search(r'leak-card-code[^>]*>([^<]+)', a)
    rar_m = re.search(r'leak-card-rarity[^>]*>([^<]+)', a)
    name_m = re.search(r'<h3[^>]*>([^<]+)</h3>', a)
    img_m = re.search(r'data-full="([^"]+)"', a) or re.search(r'<img[^>]*src="(/Cards/[^"]+)"', a)
    if not (code_m and img_m): continue
    code = code_m.group(1).strip().upper()
    rar = (rar_m.group(1).strip() if rar_m else 'Unknown')
    if rar in SKIP_RARITIES: continue
    table = FALLBACK_RARITIES if allow_fallback else BASE_RARITIES
    if rar not in table: continue
    if not re.fullmatch(r'OP17-\d{3}', code): continue
    if code in cards: continue                     # first (base) printing wins
    cards[code] = {
        'id': code,
        'name': (name_m.group(1).strip() if name_m else code),
        'rarity': table[rar],
        'isLeader': rar == 'Leader Card',
        'text': effect_text(a),
        'imgUrl': urllib.parse.urljoin(BASE, urllib.parse.quote(img_m.group(1))),
    }

print(f'parsed {len(cards)} base cards')

# ---- download images ----
opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126'),
                     ('Referer', BASE + '/cards-list/OP17/')]
failed = []
for code, c in cards.items():
    ext = os.path.splitext(urllib.parse.urlparse(c['imgUrl']).path)[1].lower() or '.jpg'
    dest = os.path.join(IMG_DIR, code + ext)
    c['img'] = 'op17/' + code + ext
    if os.path.exists(dest) and os.path.getsize(dest) > 5000: continue
    try:
        with opener.open(c['imgUrl'], timeout=30) as r, open(dest, 'wb') as f:
            f.write(r.read())
    except Exception as e:
        failed.append((code, str(e)))
        c['img'] = c['imgUrl']  # fall back to hotlink
print(f'downloaded images, {len(failed)} failed: {failed[:5]}')

# ---- color detection from frame pixels ----
# hue buckets (degrees) for the six OPTCG colors
def classify_hsv(h, s, v):
    if v < 50 and s < 70: return 'Black'
    if v < 70 or s < 60: return None        # too dark/washed to trust hue
    if h < 12 or h >= 325: return 'Red'
    if 12 <= h < 40: return None            # orange/skin -> ignore
    if 40 <= h < 72: return 'Yellow'
    if 72 <= h < 170: return 'Green'
    if 170 <= h < 250: return 'Blue'
    if 250 <= h < 325: return 'Purple'
    return None

def top_color(votes):
    if not votes: return None
    mc = votes.most_common()
    # Black only wins if clearly dominant (dark text/shadows pollute it)
    if mc[0][0] == 'Black':
        if mc[0][1] > sum(votes.values()) * 0.60 or len(mc) == 1: return 'Black'
        return mc[1][0]
    return mc[0][0]

def detect_colors(path, is_leader):
    try:
        im = Image.open(path).convert('RGB')
    except Exception:
        return []
    w, h = im.size
    hsv = im.convert('HSV')
    votes_l, votes_r = collections.Counter(), collections.Counter()
    # sample the bottom frame band (color banner) and side frame edges
    regions = [
        (0.04, 0.90, 0.96, 0.985),   # bottom band
        (0.015, 0.25, 0.06, 0.85),   # left frame edge
        (0.94, 0.25, 0.985, 0.85),   # right frame edge
    ] if is_leader else [
        (0.04, 0.90, 0.96, 0.985),
    ]
    for (x0, y0, x1, y1) in regions:
        for px in range(int(w*x0), int(w*x1), 3):
            for py in range(int(h*y0), int(h*y1), 3):
                H, S, V = hsv.getpixel((px, py))
                col = classify_hsv(H * 360 // 255, S, V)
                if col:
                    (votes_l if px < w/2 else votes_r)[col] += 1
    cl, cr = top_color(votes_l), top_color(votes_r)
    if not cl and not cr: return []
    if cl and cr and cl != cr: return [cl, cr]   # split frame = dual color
    return [cl or cr]

for code, c in sorted(cards.items()):
    p = os.path.join(IMG_DIR, os.path.basename(c['img']))
    c['colors'] = detect_colors(p, c['isLeader']) if os.path.exists(p) else []

# sanity print
for code in ['OP17-001', 'OP17-022']:
    if code in cards: print(code, cards[code]['name'], '->', cards[code]['colors'])

# ---- emit custom-cards.js in the app's slim card format ----
out = []
for code, c in sorted(cards.items()):
    out.append({
        'id': c['id'], 'name': c['name'], 'text': c['text'],
        'set': 'The World’s Strongest Warriors (spoilers)', 'setId': 'OP-17',
        'rarity': c['rarity'], 'color': ' '.join(c['colors']),
        'type': 'Leader' if c['isLeader'] else 'Character',
        'life': None, 'cost': None, 'power': None,
        'subs': '', 'counter': None, 'attr': '', 'img': c['img'],
        'spoiler': True,
    })

# crude type guess: pure [Main]/[Counter] effects with no character keywords -> Event
for o in out:
    if o['type'] == 'Leader': continue
    t = o['text']
    if re.match(r'^\[(Main|Counter)\]', t) and '[On Play]' not in t and '[When Attacking]' not in t and '[Blocker]' not in t and '[Rush]' not in t and '[On K.O.]' not in t and '[Activate: Main]' not in t:
        o['type'] = 'Event'

path = os.path.join(OUT_DIR, 'custom-cards.js')
with open(path, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated OP17 spoiler cards (source: opdeckguide.com, ' )
    f.write(__import__('datetime').date.today().isoformat() + ')\n')
    f.write('window.CUSTOM_CARDS = (window.CUSTOM_CARDS || []).concat(')
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write(');\n')
print('wrote', path, 'with', len(out), 'cards')
print('color coverage:', sum(1 for o in out if o['color']), '/', len(out))
print('types:', collections.Counter(o['type'] for o in out))
