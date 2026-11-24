#!/usr/bin/env python3
"""Write cards-fallback.json from optcgapi.com.

The deck builder ships this file so a phone that cannot reach optcgapi.com
still opens a current card list. Regenerate it when the live card pool changes
and commit the result:

    python3 scripts/build-card-fallback.py

The shape matches the slim objects stored in localStorage under optcg_cards_v2.
Saved decks are not part of this file.
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

API = 'https://optcgapi.com/api/'
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'cards-fallback.json'


def fetch(path):
    req = urllib.request.Request(
        API + path,
        headers={'User-Agent': 'optcg-deck-builder-fallback', 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        if res.status != 200:
            raise SystemExit('GET %s responded %s' % (path, res.status))
        return json.loads(res.read().decode('utf-8'))


def as_num(value):
    if value is None or value == '' or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float('inf'), float('-inf')):
        return None
    if number == int(number):
        return int(number)
    return number


def slim(card):
    image = card.get('card_image')
    return {
        'id': card.get('card_set_id'),
        'name': card.get('card_name') or '',
        'text': card.get('card_text') or '',
        'set': card.get('set_name') or '',
        'setId': card.get('set_id') or '',
        'rarity': card.get('rarity') or '',
        'color': card.get('card_color') or '',
        'type': card.get('card_type') or '',
        'life': card.get('life'),
        'cost': as_num(card.get('card_cost')),
        'power': as_num(card.get('card_power')),
        'subs': card.get('sub_types') or '',
        'counter': as_num(card.get('counter_amount')),
        'attr': card.get('attribute') or '',
        'img': image if isinstance(image, str) else '',
        'mp': as_num(card.get('market_price')),
        'ip': as_num(card.get('inventory_price')),
    }


def prefer(current, candidate, card_id):
    if current is None:
        return candidate
    current_base = current.get('card_image_id') == card_id
    candidate_base = candidate.get('card_image_id') == card_id
    if candidate_base and not current_base:
        return candidate
    return current


def sort_key(card_id):
    return [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', card_id)]


def main():
    set_cards = fetch('allSetCards/')
    st_cards = fetch('allSTCards/')
    if not isinstance(set_cards, list) or not isinstance(st_cards, list):
        raise SystemExit('Card API did not return lists')
    chosen = {}
    for card in set_cards + st_cards:
        if not isinstance(card, dict):
            continue
        card_id = card.get('card_set_id')
        if not card_id:
            continue
        chosen[card_id] = prefer(chosen.get(card_id), card, card_id)
    slim_cards = [slim(chosen[card_id]) for card_id in sorted(chosen, key=sort_key)]
    payload = {
        't': int(time.time() * 1000),
        'source': 'optcgapi.com',
        'd': slim_cards,
    }
    text = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text, encoding='utf-8')
    missing = sum(1 for card in slim_cards if not card['img'])
    print('wrote %s cards=%s bytes=%s missing_img=%s' % (OUT.name, len(slim_cards), len(text.encode('utf-8')), missing))


if __name__ == '__main__':
    try:
        main()
    except Exception as err:
        print(err, file=sys.stderr)
        raise
