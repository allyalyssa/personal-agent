"""Build nutrition/sf_stores.json: grocery stores and farmers markets in San Francisco from OpenStreetMap.

The app asks the live map servers first and falls back to this file when they are busy.
Uses Nominatim search at one request a second, as its usage policy asks.

  python scripts/build_stores.py [nutrition/sf_stores.json]
"""
import json
import sys
import time
import urllib.parse
import urllib.request

VIEWBOX = '-122.52,37.84,-122.35,37.70'
TERMS = ['supermarket', 'grocery', 'greengrocer', 'convenience', 'deli', 'butcher', 'health food', 'farmers market',
         'Safeway', "Trader Joe's", 'Whole Foods', 'Lucky', 'Foods Co', 'Grocery Outlet', 'Target', 'Sprouts', 'Smart & Final', 'Rainbow Grocery']
KINDS = {'supermarket', 'greengrocer', 'convenience', 'butcher', 'health_food', 'deli', 'marketplace', 'department_store', 'general', 'farm'}
HEADERS = {'User-Agent': 'Handled hackathon demo (store snapshot)'}


def search(term, exclude):
    q = urllib.parse.urlencode({'q': term, 'viewbox': VIEWBOX, 'bounded': 1, 'format': 'jsonv2', 'limit': 50, 'exclude_place_ids': ','.join(exclude)})
    with urllib.request.urlopen(urllib.request.Request(f'https://nominatim.openstreetmap.org/search?{q}', headers=HEADERS), timeout=30) as r:
        return json.load(r)


def main(out):
    places = {}
    for term in TERMS:
        seen = []
        while True:
            time.sleep(1.1)
            batch = search(term, seen)
            new = [p for p in batch if str(p['place_id']) not in seen]
            if not new:
                break
            seen += [str(p['place_id']) for p in new]
            for p in new:
                kind = 'supermarket' if p['type'] == 'department_store' else p['type']
                if p['type'] in KINDS and p.get('name'):
                    places[(p['osm_type'], p['osm_id'])] = {'name': p['name'], 'kind': kind, 'lat': round(float(p['lat']), 6), 'lon': round(float(p['lon']), 6)}
            if len(batch) < 50:
                break
        print(f'{term}: {len(places)} places so far')
    with open(out, 'w', encoding='utf8') as f:
        json.dump({
            'source': 'OpenStreetMap via Nominatim search',
            'source_url': 'https://www.openstreetmap.org/',
            'license': 'ODbL 1.0',
            'checked': time.strftime('%Y-%m-%d'),
            'places': sorted(places.values(), key=lambda p: (p['name'], p['lat'])),
        }, f, ensure_ascii=False, indent=0)
    print(f'{len(places)} places written to {out}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'nutrition/sf_stores.json')
