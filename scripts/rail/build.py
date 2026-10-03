"""Offline normalization of the pinned rail capture; never downloads anything."""
import argparse
import csv
import hashlib
import io
import json
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, time
from pathlib import Path
import openpyxl
from bs4 import BeautifulSoup
from layout import pages, lines

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src/lib/transport/providers/rail-cache'
TZ = {'CN': '+08:00', 'HK': '+08:00', 'TW': '+08:00', 'JP': '+09:00', 'KR': '+09:00', 'MY': '+08:00', 'TH': '+07:00', 'VN': '+07:00'}


def write_json(path, data, compact=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(data,ensure_ascii=False,**({'separators':(',',':')} if compact else {'indent':2}))+'\n')
    temp.replace(path)


def key(name):
    return re.sub(r'[^\w]+', '-', unicodedata.normalize('NFKC', str(name)).strip().lower()).strip('-')


def clock(value):
    if isinstance(value, time):
        return value.hour*3600+value.minute*60+value.second
    m = re.fullmatch(r'(\d{1,2}):(\d{2})(?::(\d{2}))?', str(value).strip())
    if m and int(m[1]) < 48 and int(m[2]) < 60:
        return int(m[1])*3600+int(m[2])*60+int(m[3] or 0)
    return None


def unfold(stops):
    """Only a large backwards jump is midnight; small inversions are errors."""
    last, day = -1, 0
    for stop in stops:
        for field in ('arrival', 'departure'):
            t = stop.get(field)
            if t is None:
                continue
            value = t + day*86400
            if value < last:
                if last-value < 12*3600:
                    raise ValueError('Non-monotonic timetable (not a midnight crossing)')
                day += 1
                value += 86400
            stop[field] = value
            last = value
    return stops


class Builder:
    def __init__(self):
        self.stations, self.sources, self.trips, self.review = {}, {}, [], []
        self.documents = []
        self.fares = []

    def station(self, country, name, local=None, code=None, coords=None):
        sid = country + ':' + key(code or local or name)
        value = self.stations.setdefault(sid, {'name':name, 'country':country, 'aliases':[]})
        for alias in (name, local, code):
            if alias and alias != value['name'] and alias not in value['aliases']:
                value['aliases'].append(alias)
        if coords:
            value['lat'],value['lng'] = coords
        return sid

    def source(self, group, asset):
        sid = group + ':' + asset['sha256'][:16]
        self.sources[sid] = {k:asset[k] for k in ('url','path','sha256','retrievedAt','label') if k in asset}
        self.sources[sid]['group'] = group
        return sid

    def add(self, source, number, country, stops, calendar=None, locator=None, operator=None, explicit=False, notes=''):
        if len(stops)<2:
            return
        try:
            if not explicit:
                stops = unfold(stops)
            merged=[]
            for stop in stops:
                if merged and merged[-1]['station']==stop['station']:
                    if 'arrival' in stop and 'arrival' not in merged[-1]:merged[-1]['arrival']=stop['arrival']
                    if 'departure' in stop:merged[-1]['departure']=stop['departure']
                else:merged.append(stop)
            stops=merged
            if len(stops)<2:raise ValueError('Fewer than two distinct stops')
            previous = -1
            for stop in stops:
                for f in ('arrival','departure'):
                    t = stop.get(f)
                    if t is not None:
                        if not isinstance(t,int) or t<previous or t>7*86400:
                            raise ValueError('Invalid stop time or order')
                        previous=t
            first=stops[0].get('departure',stops[0].get('arrival'))
            last=stops[-1].get('arrival',stops[-1].get('departure'))
            if last<=first:
                raise ValueError('Nonpositive journey duration')
            if country=='JP' and last-first>12*3600:
                raise ValueError('Implausible duration in daytime Japan timetable')
            trip={'source':source,'number':str(number),'country':country,'offset':TZ[country],
                  'calendar':calendar or {'kind':'typical'}, 'stops':stops}
            if locator:trip['locator']=locator
            if operator:trip['operator']=operator
            if notes:trip['notes']=notes
            identity=json.dumps(trip,sort_keys=True,ensure_ascii=False)
            trip['id']=hashlib.sha256(identity.encode()).hexdigest()[:20]
            self.trips.append(trip)
        except ValueError as e:
            self.review.append({'source':source,'number':str(number),'locator':locator,'reason':str(e),'stops':stops})

    def structured(self, group, assets, report):
        thai_rules={}
        if group=='thailand':
            rules_asset=next(a for a in assets if a['role']=='service-rules')
            self.source(group,rules_asset)
            body=(ROOT/rules_asset['path']).read_text().split('const i18n')[0]
            thai_rules={number:(text,kind) for number,text,kind in re.findall(r"'(\d+)':\s*\{\s*text:.*?en:\s*'([^']*)'.*?type:\s*'([^']*)'",body)}
        for a in assets:
            path=ROOT/a['path']; sid=self.source(group,a)
            if group=='china-12306-sample' and a['role']=='dated-stop-times':
                rows=json.loads(path.read_text())['data']['data'];stops=[]
                for r in rows:
                    st={'station':self.station('CN',r['station_name'],code=r['station_telecode'])}
                    for f,k,d in [('arrival','arrive_time','arrive_day_diff'),('departure','start_time','start_day_diff')]:
                        t=clock(r[k])
                        if t is not None:st[f]=t+int(r[d])*86400
                    stops.append(st)
                self.add(sid,rows[0]['station_train_code'],'CN',stops,{'kind':'dated','dates':[report['queriedTravelDate']]},explicit=True,operator='China Railway')
            elif group=='japan-route-samples' and a['role']=='derived-evidence':
                data=json.loads(path.read_text())
                raw_asset=next(x for x in assets if x['path']==data['sourcePath'])
                sid=self.source(group,raw_asset)
                for i,r in enumerate(data['rows']):
                    if r['changes']!='Direct':
                        self.review.append({'source':sid,'locator':i,'reason':'Transfer itinerary; individual segments unavailable'})
                        continue
                    dep=datetime.fromisoformat(r['departTime']); arr=datetime.fromisoformat(r['arrivalTime'])
                    origin=dep.replace(hour=0,minute=0,second=0)
                    stops=[{'station':self.station('JP',r['departName']),'departure':int((dep-origin).total_seconds())},
                           {'station':self.station('JP',r['arrivalName']),'arrival':int((arr-origin).total_seconds())}]
                    self.add(sid,r.get('trainNumber') or '', 'JP',stops,{'kind':'dated','dates':[dep.date().isoformat()]},locator={'row':i},explicit=True,
                             operator=' / '.join(sorted({t['carrierInfoDto']['name'] for t in r['trainList']})),notes='Reseller dated schedule; public train number and price unavailable')
            elif group=='ktmb' and a['role']=='feed':
                with zipfile.ZipFile(path) as z:
                    def table(n):return list(csv.DictReader(io.StringIO(z.read(n).decode('utf-8-sig')))) if n in z.namelist() else []
                    stations={r['stop_id']:self.station('MY',r['stop_name'],code='ktmb-'+r['stop_id'],coords=(float(r['stop_lat']),float(r['stop_lon']))) for r in table('stops.txt')}
                    calendars={r['service_id']:r for r in table('calendar.txt')}
                    exceptions=defaultdict(list)
                    for r in table('calendar_dates.txt'):exceptions[r['service_id']].append(r)
                    times=defaultdict(list)
                    for r in table('stop_times.txt'):times[r['trip_id']].append(r)
                    routes={r['route_id']:r for r in table('routes.txt')}
                    date=lambda v:datetime.strptime(v,'%Y%m%d').date().isoformat()
                    for trip in table('trips.txt'):
                        if routes[trip['route_id']]['route_type'] not in ('2','100','101','102','103','106','109'):
                            continue
                        cal=calendars.get(trip['service_id']); ex=exceptions[trip['service_id']]
                        calendar={'kind':'dated','dates':[date(e['date']) for e in ex if e['exception_type']=='1']}
                        if cal:
                            calendar={'kind':'published','start':date(cal['start_date']),'end':date(cal['end_date']),
                                      'days':[i for i,d in enumerate(['sunday','monday','tuesday','wednesday','thursday','friday','saturday']) if cal[d]=='1'],
                                      'includeDates':calendar['dates'],'excludeDates':[date(e['date']) for e in ex if e['exception_type']=='2']}
                        stops=[]
                        for r in sorted(times[trip['trip_id']],key=lambda r:int(r['stop_sequence'])):
                            st={'station':stations[r['stop_id']]}
                            if r.get('pickup_type')!='1' and clock(r['departure_time']) is not None:st['departure']=clock(r['departure_time'])
                            if r.get('drop_off_type')!='1' and clock(r['arrival_time']) is not None:st['arrival']=clock(r['arrival_time'])
                            if len(st)>1:stops.append(st)
                        self.add(sid,trip.get('trip_short_name') or trip['trip_id'],'MY',stops,calendar,operator='KTMB',explicit=True)
            elif group=='vietnam' and a['role']=='index':
                soup=BeautifulSoup(path.read_text(),'html.parser')
                for grid in (1,2):
                    table=soup.find('table',id=f'ctl00_ContentPlaceHolderMain_GridView{grid}')
                    rows=[[c.get_text(' ',strip=True) for c in r.find_all(['th','td'],recursive=False)] for r in table.find_all('tr')]
                    for col,number in enumerate(rows[0][2:],2):
                        stops=[]
                        for r in rows[1:]:
                            if len(r)<=col:continue
                            match=re.fullmatch(r'(\d\d:\d\d)(?:\s*\(ngày \+(\d+)\))?',r[col])
                            if match:
                                t=clock(match[1])+int(match[2] or 0)*86400
                                stops.append({'station':self.station('VN',r[0]),'arrival':t,'departure':t})
                        self.add(sid,number,'VN',stops,explicit=True,operator='Vietnam Railways',locator={'grid':grid})
            elif group=='thailand' and a['role'] in ('index','timetable'):
                soup=BeautifulSoup(path.read_text(),'html.parser');tables=soup.select('table')
                def rows(t):return [[c.get_text(' ',strip=True) for c in r.find_all(['th','td'],recursive=False)] for r in t.find_all('tr')]
                stationrows=rows(tables[1]);data=rows(tables[2])
                if stationrows and len(stationrows[0])==1:stationrows=stationrows[1:]
                if len(data)!=len(stationrows)+1:raise ValueError('Thai station/time alignment differs')
                for col,number in enumerate(data[0]):
                    if not number.isdigit():continue
                    stops=[]
                    for label,row in zip(stationrows,data[1:]):
                        if col>=len(row) or not label:continue
                        t=clock(row[col])
                        if t is None:continue
                        station=self.station('TH',label[0]);field='arrival' if 'Arr' in ' '.join(label[1:]) else 'departure'
                        if stops and stops[-1]['station']==station:stops[-1][field]=t
                        else:stops.append({'station':station,field:t})
                    calendar={'kind':'typical'}
                    rule=thai_rules.get(number)
                    if rule:
                        label,kind=rule
                        if label=='Cancelled' or number in ('173','174'):
                            self.review.append({'source':sid,'number':number,'reason':'Cancelled service or conflicting Thai/English restart date','rule':label})
                            continue
                        if kind=='weekday':calendar['days']=[1,2,3,4,5]
                        if kind=='weekend':calendar['days']=[0,6]
                        calendar['notes']=label + ('; source type disagrees with Everyday label; weekday subset only' if label=='Everyday' and kind=='weekday' else '')
                    self.add(sid,number,'TH',stops,calendar,operator='State Railway of Thailand',notes='Operating-day and holiday rules require confirmation; published classic table')

    def korea(self, group, a):
        sid=self.source(group,a);w=openpyxl.load_workbook(ROOT/a['path'],data_only=True)
        start='2026-10-01' if group=='korail' else '2026-09-01'
        def calendar(note):
            note=str(note or '').strip()
            cal={'kind':'typical','start':start,'notes':note}
            if note=='매일':cal.update(kind='published',days=list(range(7)))
            elif note and re.fullmatch('[월화수목금토일 ,]+',note):
                cal.update(kind='published',days=sorted({{'일':0,'월':1,'화':2,'수':3,'목':4,'금':5,'토':6}[c] for c in note if c not in ' ,'}))
            return cal
        for sheet in w:
            if sheet.title=='보는방법':continue
            rows=list(sheet.values)
            # KTX sheets: train rows, station columns; two directions side by side.
            horizontal=any('편성' in r for r in rows[:15])
            if horizontal:
                for ridx,row in enumerate(rows):
                    for col,value in enumerate(row):
                        if value!='열차번호':continue
                        end=next((i for i in range(col+2,len(row)) if str(row[i] or '').startswith('비고')),len(row))
                        stations={i:self.station('KR',str(rows[ridx+2][i] or row[i]),local=str(row[i])) for i in range(col+2,end) if row[i]}
                        for j in range(ridx+3,len(rows)):
                            r=rows[j]
                            if not isinstance(r[col],(int,float)):continue
                            stops=[{'station':st,'arrival':clock(r[i]),'departure':clock(r[i])} for i,st in stations.items() if clock(r[i]) not in (None,0)]
                            self.add(sid,int(r[col]),'KR',stops,calendar(r[end] if end<len(r) else ''),{'sheet':sheet.title,'row':j+1,'column':col+1},str(r[col+1] or 'Korail'))
            else:
                # Conventional sheets: station rows, train columns.
                headers=[i for i,r in enumerate(rows) if r[0]=='열차번호']
                for hidx,h in enumerate(headers):
                    end=next((i for i in range(h+1,len(rows)) if rows[i][0]=='종착역'),headers[hidx+1] if hidx+1<len(headers) else len(rows))
                    for c,number in enumerate(rows[h][1:],1):
                        if not isinstance(number,(int,float)):continue
                        stops=[];note=''
                        for j in range(h+1,end):
                            r=rows[j];label=str(r[0] or '')
                            if '비고' in label:note=str(r[c] or '');continue
                            t=clock(r[c])
                            if t in (None,0) or not label:continue
                            station=self.station('KR',label,local=label)
                            if stops and stops[-1]['station']==station:stops[-1]['departure']=t
                            else:stops.append({'station':station,'arrival':t,'departure':t})
                        self.add(sid,int(number),'KR',stops,calendar(note),{'sheet':sheet.title,'column':c+1,'headerRow':h+1},str(rows[h-1][c] or 'Korail'))

    def build(self):
        manifest=json.loads((ROOT/'data/rail-capture/report.json').read_text())
        for report in manifest['sources']:
            group=report['source'];before=len(self.trips)
            for a in report['assets']:
                p=ROOT/a['path']
                if hashlib.sha256(p.read_bytes()).hexdigest()!=a['sha256']:raise ValueError(f'Hash mismatch: {p}')
            self.structured(group,report['assets'],report)
            for a in report['assets']:
                p=ROOT/a['path'];n=len(self.trips)
                if group in ('korail','sr') and p.suffix=='.xlsx':self.korea(group,a)
                if p.suffix=='.pdf' and a['role']=='timetable':self.pdf(group,a)
                if a['role']=='published-fares':self.fare(group,a)
                if a['role'] in ('timetable','published-fares','feed','dated-stop-times','derived-evidence') or (group in ('vietnam','thailand') and a['role']=='index'):
                    self.documents.append({'group':group,'path':a['path'],'sha256':a['sha256'],'role':a['role'],'newTrips':len(self.trips)-n})
            print(group,len(self.trips)-before,'trips',flush=True)
        # Exact duplicate services from multiple source copies stay traceable via source refs.
        dedup={}
        for t in self.trips:
            sig=json.dumps({k:t[k] for k in ('number','country','calendar','stops')},sort_keys=True)
            if sig in dedup:
                dedup[sig].setdefault('alsoSources',[]).append(t['source'])
            else:dedup[sig]=t
        self.trips=list(dedup.values())
        # Same service in the older SR-hosted workbook ends when its matching
        # October Korail revision begins. Retain historical data and provenance.
        newer={json.dumps([t['number'],t['stops'][0]['station'],t['stops'][-1]['station']],sort_keys=True) for t in self.trips if self.sources[t['source']]['group']=='korail'}
        for t in self.trips:
            if self.sources[t['source']]['group']=='sr' and json.dumps([t['number'],t['stops'][0]['station'],t['stops'][-1]['station']],sort_keys=True) in newer:
                t['calendar']['end']='2026-09-30'
        used={s['station'] for t in self.trips for s in t['stops']}
        self.stations={k:v for k,v in self.stations.items() if k in used}
        from stations import enrich
        enrich(self.stations)
        for doc in self.documents:
            doc['cachedTrips']=sum(self.sources[t['source']]['path']==doc['path'] for t in self.trips)
            doc.pop('newTrips',None)
        OUT.mkdir(parents=True,exist_ok=True)
        cache={'version':1,'captureManifestSha256':hashlib.sha256((ROOT/'data/rail-capture/report.json').read_bytes()).hexdigest(),
               'stations':self.stations,'sources':self.sources,'trips':self.trips}
        write_json(OUT/'cache.json',cache,compact=True)
        review=ROOT/'data/rail-cache';review.mkdir(parents=True,exist_ok=True)
        write_json(review/'review.json',self.review)
        write_json(review/'fares.json',self.fares,compact=True)
        summary={'tripCount':len(self.trips),'stopCount':sum(len(t['stops']) for t in self.trips),'stationCount':len(self.stations),
                 'bySource':dict(Counter(self.sources[t['source']]['group'] for t in self.trips)),
                 'reviewCount':len(self.review),'documents':self.documents}
        write_json(review/'report.json',summary)
        print(json.dumps({k:v for k,v in summary.items() if k!='documents'},ensure_ascii=False,indent=2))

    def pdf(self,group,a):
        from pdf_tables import extract
        extract(self,group,a)

    def fare(self,group,a):
        # Fares do not contain departures. Preserve table cells with axes, never fabricate trips.
        p=ROOT/a['path'];sid=self.source(group,a)
        tables=[]
        if p.suffix=='.pdf':
            tables=[{'page':pg['page'],'ocr':pg['ocr'],'lines':[' '.join(w['text'] for w in ws) for _,ws in lines(pg)]} for pg in pages(p)]
        elif p.suffix in ('.xlsx','.xls'):
            if p.suffix=='.xlsx':
                w=openpyxl.load_workbook(p,data_only=True)
                tables=[{'sheet':s.title,'rows':[[str(v) if isinstance(v,(time,datetime)) else v for v in row] for row in s.values]} for s in w]
            else:
                import xlrd
                w=xlrd.open_workbook(p)
                tables=[{'sheet':s.name,'rows':[s.row_values(i) for i in range(s.nrows)]} for s in w.sheets()]
        else:
            soup=BeautifulSoup(p.read_text(),'html.parser')
            tables=[{'rows':[[c.get_text(' ',strip=True) for c in r.find_all(['th','td'],recursive=False)] for r in t.find_all('tr')]} for t in soup.select('table')]
        self.fares.append({'source':sid,'status':'published-fare-table-not-live-quote','tables':tables})


if __name__=='__main__':
    Builder().build()
