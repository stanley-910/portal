"""Resolve coordinates for cached stations the repository catalogues miss.

Downloads railway stations with coordinates from Wikidata (CC0) once into .cache/, matches them to
cache stations by name within the same country, picks between same-named stations by distance to
neighbouring stops, then drops any match implying an impossible train speed between consecutive
calls. Writes scripts/rail/station-coords.json, which stations.enrich applies after the catalogues.

    python3 scripts/rail/coords.py            # resolve and write station-coords.json
    python3 scripts/rail/stations.py          # apply it to the existing cache.json
"""
import csv
import difflib
import io
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'src/lib/transport/providers/rail-cache/cache.json'
OUT = Path(__file__).with_name('station-coords.json')
DOWNLOADS = ROOT / '.cache/rail-coords'
COUNTRIES = {'CN':'Q148','JP':'Q17','KR':'Q884','TH':'Q869','VN':'Q881','MY':'Q833','SG':'Q334','TW':'Q865','HK':'Q8646'}
LANGS = ('en','ja','ko','zh','zh-hans','zh-cn','th','vi','ms')
# Cache labels whose Wikidata name differs beyond spelling.
ALIASES = {('SG','WOODLANDS'):'Woodlands Train Checkpoint'}
MAX_KMH, MIN_KM = 380, 25
DIRECTIONS = {'dong':'east','nan':'south','bei':'north','xi':'west'}


def fetch(country, qid):
    path = DOWNLOADS / f'{country}.json'
    if path.exists():
        return json.loads(path.read_text())
    query = f'''SELECT ?s ?lat ?lng ?label WHERE {{
      ?s wdt:P31/wdt:P279* wd:Q55488; wdt:P17 wd:{qid};
         p:P625/psv:P625 [wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lng].
      FILTER NOT EXISTS {{ ?s wdt:P576 [] }}
      {{ ?s rdfs:label ?label }} UNION {{ ?s skos:altLabel ?label }}
      FILTER(LANG(?label) IN ({",".join(f'"{l}"' for l in LANGS)}))
    }}'''
    request = urllib.request.Request('https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': query}),
        headers={'Accept':'text/csv','User-Agent':'PortalRailCache/0.1 (https://github.com/stanley-910/portal; ahmet4kilic@gmail.com)'})
    print('fetching Wikidata stations for', country, file=sys.stderr)
    with urllib.request.urlopen(request, timeout=300) as response:
        rows = list(csv.DictReader(io.TextIOWrapper(response, encoding='utf-8')))
    data = [{'qid':r['s'].rsplit('/',1)[1],'lat':float(r['lat']),'lng':float(r['lng']),'label':r['label']} for r in rows]
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False))
    return data


def norm(name):
    name = unicodedata.normalize('NFKD', name.replace('Đ','D').replace('đ','d'))
    name = unicodedata.normalize('NFC', ''.join(c for c in name if not unicodedata.combining(c))).lower().strip()
    name = re.sub(r'^(?:ga\s+|สถานีรถไฟ|สถานี)', '', name)
    name = re.sub(r'\b(?:railway station|train station|rail station|station|halt|komuter|junction)\b', '', name)
    name = re.sub(r'(?:火车站|駅|站|역)(?=\s*(?:\(|$))', '', name)
    return re.sub(r'[^\w]', '', name)


def variants(names, country):
    """Tiers of normalized names, most specific first."""
    full = {norm(n) for n in names}
    bare = {norm(re.sub(r'\s*[\(（].*?[\)）]\s*', ' ', n)) for n in names} - full
    direction = set()
    if country == 'CN':
        for n in full | bare:
            m = re.fullmatch(r'([a-z]{3,}?)(dong|nan|bei|xi)', n)
            if m: direction.add(m[1] + DIRECTIONS[m[2]])
    return [t - {''} for t in (full, bare, direction)]


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 12742 * math.asin(math.sqrt(h))


def main():
    cache = json.loads(CACHE.read_text())
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    stations = cache['stations']
    known = {sid:(s['lat'],s['lng']) for sid,s in stations.items() if 'lat' in s and sid not in previous}
    missing = [sid for sid in stations if sid not in known]

    index = {}
    for country in {stations[sid]['country'] for sid in missing}:
        for row in fetch(country, COUNTRIES[country]):
            index.setdefault((country, norm(row['label'])), {})[row['qid']] = row

    edges = {}
    for trip in cache['trips']:
        stops = trip['stops']
        for a, b in zip(stops, stops[1:]):
            t1, t2 = a.get('departure', a.get('arrival')), b.get('arrival', b.get('departure'))
            if t1 is not None and t2 is not None and t2 - t1 >= 60 and a['station'] != b['station']:
                edges.setdefault(a['station'], {})[b['station']] = t2 - t1
                edges.setdefault(b['station'], {})[a['station']] = t2 - t1

    candidates, how = {}, {}
    for sid in missing:
        s = stations[sid]
        names = [s['name'], *s['aliases']] + ([ALIASES[(s['country'], s['name'])]] if (s['country'], s['name']) in ALIASES else [])
        tiers = variants(names, s['country'])
        for label, tier in zip(('name','name without qualifier','pinyin direction'), tiers):
            found = {q:r for n in tier for q,r in index.get((s['country'], n), {}).items()}
            if found:
                candidates[sid], how[sid] = list(found.values()), label
                break
        else:
            pool = [k[1] for k in index if k[0] == s['country']]
            for n in tiers[0]:
                if len(n) >= 6 and n.isascii():
                    close = difflib.get_close_matches(n, pool, n=2, cutoff=0.85)
                    if len(close) == 1 or (close and difflib.SequenceMatcher(None, n, close[0]).ratio() > difflib.SequenceMatcher(None, n, close[1]).ratio()):
                        candidates[sid], how[sid] = list(index[(s['country'], close[0])].values()), 'close spelling'
                        break

    # Same-named candidates far apart are settled by the nearest already-placed neighbouring stop.
    placed = dict(known)
    resolved = {}
    changed = True
    while changed:
        changed = False
        for sid, rows in candidates.items():
            if sid in resolved: continue
            spread = max(km((a['lat'],a['lng']), (b['lat'],b['lng'])) for a in rows for b in rows)
            anchors = [placed[n] for n in edges.get(sid, {}) if n in placed]
            if spread > 3 and not anchors: continue
            pick = min(rows, key=lambda r: min((km((r['lat'],r['lng']), a) for a in anchors), default=0))
            resolved[sid] = pick
            placed[sid] = (pick['lat'], pick['lng'])
            changed = True

    # Reject matches that make most of their consecutive calls faster than any train in the region.
    # A minority of fast edges comes from OCR rows that skip stops, not from a wrong station.
    rejected = set()
    while True:
        bad = {}
        for sid in resolved:
            if sid in rejected: continue
            near = [(other, dt) for other, dt in edges.get(sid, {}).items() if other not in rejected and other in placed]
            fast = sum(km(placed[sid], placed[o]) > MIN_KM and km(placed[sid], placed[o]) / (dt/3600) > MAX_KMH for o, dt in near)
            if fast and fast * 2 >= len(near):
                bad[sid] = fast / len(near)
        if not bad: break
        worst = max(bad, key=lambda k: (bad[k], how[k] == 'close spelling'))
        rejected.add(worst)
        placed.pop(worst)

    table = {sid:{'lat':round(r['lat'],5),'lng':round(r['lng'],5),'coordinateSource':f"https://www.wikidata.org/wiki/{r['qid']}",
                  'wikidataLabel':r['label'],'match':how[sid]}
             for sid, r in sorted(resolved.items()) if sid not in rejected}
    OUT.write_text(json.dumps(table, ensure_ascii=False, indent=2) + '\n')

    by = {}
    for sid in missing:
        c = stations[sid]['country']
        by.setdefault(c, [0, 0])[0] += sid in table
        by[c][1] += 1
    print(json.dumps({'resolved':len(table),'missing':len(missing),'byCountry':{c:f'{a}/{b}' for c,a,b in ((c,*v) for c,v in sorted(by.items()))},
                      'rejectedBySpeed':sorted(stations[s]['name'] for s in rejected),
                      'ambiguous':sorted(stations[s]['name'] for s in candidates if s not in resolved)}, ensure_ascii=False, indent=2))
    unmatched = sorted((stations[s]['country'], stations[s]['name']) for s in missing if s not in candidates)
    print('unmatched:', ', '.join(f'{c}:{n}' for c, n in unmatched), file=sys.stderr)


if __name__ == '__main__':
    main()
