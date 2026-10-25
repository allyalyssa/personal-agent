"""Build nutrition/sf_restaurants.json: restaurants and cafes in San Francisco with cuisine and website, from OpenStreetMap.

Uses Nominatim search at one request a second, as its usage policy asks.

  python scripts/build_restaurants.py [nutrition/sf_restaurants.json]
"""
import json
import sys
import time
import urllib.parse
import urllib.request

VIEWBOX = '-122.52,37.84,-122.35,37.70'
TERMS = ['restaurant', 'cafe', 'fast food', 'thai', 'chinese', 'mexican', 'taqueria', 'burrito', 'italian', 'pizza', 'japanese', 'sushi', 'ramen',
         'indian', 'vietnamese', 'pho', 'korean', 'burger', 'american', 'sandwich', 'salad', 'mediterranean', 'greek', 'middle eastern', 'falafel',
         'french', 'ethiopian', 'caribbean', 'spanish', 'german', 'filipino', 'hawaiian', 'cajun', 'peruvian', 'salvadoran', 'seafood', 'vegan',
         'vegetarian', 'noodle', 'dim sum', 'bbq', 'breakfast', 'brunch', 'diner', 'bakery']
KINDS = {'restaurant', 'fast_food', 'cafe'}
PAGES = 4
HEADERS = {'User-Agent': 'Handled hackathon demo (restaurant snapshot)'}


def search(term, exclude):
    q = urllib.parse.urlencode({'q': term, 'viewbox': VIEWBOX, 'bounded': 1, 'format': 'jsonv2', 'extratags': 1, 'limit': 50, 'exclude_place_ids': ','.join(exclude)})
    with urllib.request.urlopen(urllib.request.Request(f'https://nominatim.openstreetmap.org/search?{q}', headers=HEADERS), timeout=30) as r:
        return json.load(r)


def main(out):
    places = {}
    for term in TERMS:
        seen = []
        for _ in range(PAGES):
            time.sleep(1.1)
            batch = search(term, seen)
            new = [p for p in batch if str(p['place_id']) not in seen]
            if not new:
                break
            seen += [str(p['place_id']) for p in new]
            for p in new:
                tags = p.get('extratags') or {}
                if p['type'] in KINDS and p.get('name') and tags.get('cuisine'):
                    places[(p['osm_type'], p['osm_id'])] = {
                        'name': p['name'],
                        'kind': p['type'],
                        'cuisine': tags['cuisine'],
                        'website': tags.get('website') or tags.get('contact:website'),
                        'lat': round(float(p['lat']), 6),
                        'lon': round(float(p['lon']), 6),
                    }
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
    main(sys.argv[1] if len(sys.argv) > 1 else 'nutrition/sf_restaurants.json')
