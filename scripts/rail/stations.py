"""Attach coordinates only from already checked repository station catalogues."""
import json
import re
import unicodedata
from layout import ROOT


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
    known.extend({'source':'Downloaded KTMB GTFS',**s} for s in list(stations.values()) if 'lat' in s)
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
