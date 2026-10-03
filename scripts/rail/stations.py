"""Attach coordinates from repository station catalogues, then from the resolved Wikidata table.

Run directly to re-apply coordinates to the existing cache.json without a full rebuild.
"""
import json
import math
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT/'src/lib/transport/providers/rail-cache/cache.json'
COORDS = Path(__file__).with_name('station-coords.json')


def normalize(name):
    name=unicodedata.normalize('NFKD',name)
    name=''.join(c for c in name if not unicodedata.combining(c)).lower()
    name=re.sub(r'\b(?:railway station|train station|station)\b','',name)
    return re.sub(r'[^\w]','',name)


ALIASES={
 'Guangzhounan':'Guangzhou South','Shenzhenbei':'Shenzhen North','Beijingxi':'Beijing West',
 'Hangzhoudong':'Hangzhou East','Shanghai Hongqiao':'上海虹桥','Zhaogingdong':'Zhaoqingdong',
 'Hà Nội':'Hanoi railway station','Sài Gòn':'Saigon railway station',
 'KL SENTRAL':'Kuala Lumpur Sentral','Bangkok (Krung Thep Aphiwat)':'Krung Thep Aphiwat Central Terminal',
 'JOHOR BAHARU SENTRAL':'JB Sentral','BANDAR TASIK SELATAN':'Bandar Tasek Selatan',
}


def enrich(stations):
    known=[]
    known.extend(h for h in json.loads((ROOT/'src/lib/transport/hubs/surface-hubs.json').read_text()) if h['mode']=='train')
    for country,path,field in [('CN','china-rail/seed.json','stations'),('TW','tdx/seed.json','stations'),('KR','korea-tago/train-stations.json',None)]:
        data=json.loads((ROOT/'src/lib/transport/providers'/path).read_text())
        for row in (data[field] if field else data).values():known.append({'country':country,**row})
    # Propagate GTFS coordinates to matching published-table labels.
    resolved=json.loads(COORDS.read_text()) if COORDS.exists() else {}
    known.extend({**s,'source':s.get('coordinateSource','Downloaded KTMB GTFS')} for sid,s in list(stations.items()) if 'lat' in s and sid not in resolved)
    index={}
    for row in known:
        for name in [row.get('name'),row.get('nameLocal'),row.get('telecode'),*row.get('aliases',[])]:
            if name:index.setdefault((row['country'],normalize(name)),row)
    for sid,s in stations.items():
        names=[s['name'],*s['aliases']]
        names += [v for k,v in ALIASES.items() if any(normalize(n)==normalize(k) for n in names)]
        row=next((index[(s['country'],normalize(n))] for n in names if (s['country'],normalize(n)) in index),None)
        if row:
            s.update(lat=row['lat'],lng=row['lng'],coordinateSource=row.get('source','existing station catalogue'))
            for n in [row['name'],row.get('nameLocal'),*names]:
                if n and n!=s['name'] and n not in s['aliases']:s['aliases'].append(n)
    # Wikidata matches from coords.py fill what the catalogues miss; catalogues win.
    for sid,s in stations.items():
        if 'lat' not in s and sid in resolved:
            row = resolved[sid]
            lat, lng = row.get('lat'), row.get('lng')
            if not (isinstance(lat, (int, float)) and isinstance(lng, (int, float))
                    and math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError(f'Invalid station coordinates: {sid}')
            s.update(lat=lat,lng=lng,coordinateSource=row['coordinateSource'])


if __name__=='__main__':
    cache=json.loads(CACHE.read_text())
    # Reapplication fills gaps without deleting previously saved coordinates.
    enrich(cache['stations'])
    CACHE.write_text(json.dumps(cache,ensure_ascii=False,separators=(',',':'))+'\n')
    print(sum('lat' in s for s in cache['stations'].values()),'of',len(cache['stations']),'stations have coordinates')
