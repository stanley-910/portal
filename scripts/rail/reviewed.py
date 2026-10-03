"""Small image-only grids transcribed and checked against rendered source pages.

Pinned hashes make these fixtures fail closed when the source edition changes.
"""
import json
from layout import ROOT


def extract(b, group, asset):
    fixtures=json.loads((ROOT/'scripts/rail/reviewed.json').read_text())
    fixture=fixtures.get(asset['sha256'])
    if fixture is None:return False
    sid=b.source(group,asset)
    for trip in fixture['trips']:
        stops=[]
        for name,hhmm,role in trip['stops']:
            country='HK' if name=='Hong Kong West Kowloon' else trip['country']
            st={'station':b.station(country,name)}
            t=int(hhmm[:2])*3600+int(hhmm[3:])*60
            if role in ('a','both'):st['arrival']=t
            if role in ('d','both'):st['departure']=t
            stops.append(st)
        b.add(sid,trip['number'],trip['country'],stops,trip['calendar'],{'page':trip['page'],'method':'visually-checked-transcription'},trip['operator'],notes=trip.get('notes',''))
    return True
