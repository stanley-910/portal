"""Coordinate-aware adapters for the downloaded timetable editions."""
import re
from datetime import date,timedelta
from layout import pages, lines, ROOT, second_words


def cx(w):return (w['x0']+w['x1'])/2

def token_time(w,compact=False):
    text=w['text'].strip('|,;[]()')
    match=re.fullmatch(r'(\d{1,2}):(\d{2})(?:[+*%].*)?',text)
    if not match and compact:
        match=re.fullmatch(r'(\d{1,2})(\d{2})',text)
    if match and int(match[1])<24 and int(match[2])<60:
        return int(match[1])*3600+int(match[2])*60
    return None


def extract(b,group,a):
    from reviewed import extract as reviewed
    if reviewed(b,group,a):return
    sid=b.source(group,a)
    pgs=pages(ROOT/a['path'])
    before=len(b.trips)
    for p in pgs:
        count=len(b.trips)
        if group=='thsr':thsr(b,sid,p,a)
        elif group=='ktmb-published':ktmb(b,sid,p,a)
        elif group=='mtr':mtr(b,sid,p,a)
        elif group=='jr-central':jr(b,sid,p,a)
        elif group=='jr-kyushu':kyushu(b,sid,p,a)
        if len(b.trips)==count:
            b.review.append({'source':sid,'locator':{'page':p['page']},'reason':'No complete validated schedule on this page; layout retained in local OCR cache'})
    if len(b.trips)==before:
        print('REVIEW PDF',a['path'],flush=True)


def thsr(b,sid,p,a):
    known='Nangang Taipei Banqiao Taoyuan Hsinchu Miaoli Taichung Changhua Yunlin Chiayi Tainan Zuoying'.split()
    rows=lines(p);header=next(((y,ws) for y,ws in rows if sum(w['text'] in known for w in ws)==12),None)
    if not header:return
    columns=sorted([(cx(w),w['text']) for w in header[1] if w['text'] in known])
    lower=columns[0][0]-12
    base='Effective From' in a.get('label','')
    if base:
        cal={'kind':'published','start':'2026-02-02','excludeDates':[f'2026-10-{i:02}' for i in [*range(8,13),*range(23,28)]]}
        # Weekday dots align with the Chinese weekday header above English labels.
        daywords=[w for w in p['words'] if w['text'] in list('一二三四五六日') and w['x0']<lower]
        daycols=sorted([(cx(w),i) for w in daywords for i,c in enumerate('日一二三四五六') if w['text']==c])
        if len(daycols)!=7:raise ValueError('THSR weekday header changed')
    else:
        start,end=(23,27) if 'Retrocession' in a.get('label','') else (8,12)
        cal={'kind':'dated','dates':[f'2026-10-{i:02}' for i in range(start,end+1)]}
    for y,ws in rows:
        if y<=header[0]:continue
        nums=[w for w in ws if w['x0']<lower and re.fullmatch(r'\d{3,4}',w['text'])]
        times=[w for w in ws if token_time(w) is not None and w['x0']>lower]
        if len(nums)!=1 or len(times)<2:continue
        calendar=dict(cal)
        if base:
            dots=[w for w in ws if '●' in w['text'] and w['x0']<lower]
            calendar['days']=sorted({min(daycols,key=lambda c:abs(c[0]-cx(w)))[1] for w in dots}) if dots else list(range(7))
        else:
            restriction=''.join(w['text'] for w in ws if nums[0]['x1']<w['x0']<lower)
            if restriction:
                matches=list(re.finditer(r'10/(\d{1,2})(?:[~～-]10/(\d{1,2}))?',restriction))
                if not matches:
                    b.review.append({'source':sid,'number':nums[0]['text'],'reason':'Unparsed holiday running-day restriction','text':restriction});continue
                dates={f'2026-10-{i:02}' for m in matches for i in range(int(m[1]),int(m[2] or m[1])+1)}
                calendar['dates']=sorted(set(cal['dates'])&dates)
        stops=[{'station':b.station('TW',min(columns,key=lambda c:abs(c[0]-cx(w)))[1]),'arrival':token_time(w),'departure':token_time(w)} for w in times]
        b.add(sid,nums[0]['text'],'TW',stops,calendar,{'page':p['page'],'y':round(y,2)},'Taiwan High Speed Rail')


def ktmb_calendar(a,p):
    doc=int(re.search(r'document-(\d+)',a['path'])[1])
    start={1:'2026-04-27',2:'2026-07-06',3:'2026-09-26',4:'2026-10-03',5:'2026-05-01',6:'2026-07-04',7:'2026-07-24',8:'2026-08-08',9:'2026-06-01',10:'2026-04-18',11:'2026-10-01',12:'2026-10-02',13:'2026-08-01'}[doc]
    cal={'kind':'typical','start':start}
    if doc==3:cal={'kind':'dated','dates':['2026-09-26','2026-09-27','2026-10-03','2026-10-04']}
    elif doc==4:cal={'kind':'dated','dates':['2026-10-03']}
    elif doc in (1,2):cal.update(kind='published',days=[1,2,3,4,5])
    elif doc in (5,6):cal.update(kind='published',days=[0,6])
    if doc==6:cal['excludeDates']=['2026-09-26','2026-09-27','2026-10-03','2026-10-04']
    if doc==5:cal['excludeDates']=['2026-10-03']
    # April ETS edition is superseded by June, not an additional current service.
    if doc==10:cal['end']='2026-05-31'
    if doc==13 and p['page']<3:cal['end']='2026-09-30'
    if doc==13 and p['page']==3:cal.update(kind='published',days=list(range(7)))
    return cal


def ktmb(b,sid,p,a):
    rows=lines(p,tolerance=2.5)
    compact=a['path'].endswith('document-13.pdf') and p['page']==3
    headers=[]
    for y,ws in rows:
        text=' '.join(w['text'] for w in ws).upper()
        if ('TREN' in text or 'STATION' in text or 'STESEN' in text) and any(re.fullmatch(r'(?:[A-Z]{1,3})?\d{2,4}',w['text']) for w in ws):
            headers.append((y,ws))
    for hi,(y,ws) in enumerate(headers):
        end=headers[hi+1][0]-2 if hi+1<len(headers) else p['height']
        cols=[w for w in ws if re.fullmatch(r'(?:[A-Z]{1,3})?\d{2,4}',w['text']) and w['text']!='2026']
        if not cols:continue
        # Separate side-by-side tables by station headings.
        boundaries=[w['x0'] for w in ws if w['text'] in ('STESEN','STESEN/STATION','STATION')]
        boundaries=sorted(set(boundaries))
        starts=[0]+[x-70 for x in boundaries if x>cols[0]['x1']+10]
        for gi,left in enumerate(starts):
            right=starts[gi+1] if gi+1<len(starts) else p['width']
            columns=[w for w in cols if left<cx(w)<right]
            if not columns:continue
            first=min(w['x0'] for w in columns)
            runs={w['text']:[] for w in columns}
            for ry,rws in rows:
                if not y+3<ry<end:continue
                label=' '.join(w['text'] for w in rws if left<=w['x0']<first-8 and re.fullmatch(r"[A-Z][A-Z'/()-]*",w['text']))
                label=re.sub(r'^(?:ERT |SH |TREN KE SELATAN )','',label)
                times=[w for w in rws if first-5<w['x0']<right and token_time(w,compact) is not None]
                if not label or not times or any(x in label for x in ['Legend','Petunjuk','Service','Perkhidmatan','UPDATE']):continue
                station=b.station('SG' if label=='WOODLANDS' else 'MY',label)
                for w in times:
                    col=min(columns,key=lambda c:abs(cx(c)-cx(w)))
                    if abs(cx(col)-cx(w))>max(12,(right-first)/len(columns)*.48):continue
                    runs[col['text']].append({'station':station,'arrival':token_time(w,compact),'departure':token_time(w,compact)})
            for num,stops in runs.items():
                b.add(sid,num,'MY',stops,ktmb_calendar(a,p),{'page':p['page'],'headerY':round(y,2)},'KTMB',notes='Published PDF timetable; confirm operating date')


def mtr(b,sid,p,a):
    rows=lines(p,tolerance=3)
    corroboration=None
    def accepted(w):
        nonlocal corroboration
        if w.get('confidence',100)>=65:return True
        if corroboration is None:corroboration=second_words(ROOT/a['path'],p)
        return any(token_time(v)==token_time(w) and abs(cx(v)-cx(w))<8 and abs((v['top']+v['bottom']-w['top']-w['bottom'])/2)<5 for v in corroboration)
    doc=int(re.search(r'document-(\d+)',a['path'])[1])
    # Captured index distinguishes the October 11 revision. Old PDFs start July 1.
    cal={'kind':'typical','start':'2026-10-11'} if doc in (2,4) else {'kind':'typical','start':'2026-07-01','end':'2026-10-10'}
    if doc==5:cal={'kind':'typical','notes':'Sleeper operating days must be confirmed'}
    short=doc in (1,2)
    if short:
        names=['Hong Kong West Kowloon','Futian','Shenzhenbei','Guangmingcheng','Humen','Nanshabei','Dongguannan','Changping','Dongguan','Guangzhouxintang','Guangzhounan','Guangzhoudong']
        # English station row is visually verified; reverse pages have reverse column layout.
        candidates=[(y,ws) for y,ws in rows if sum(n in ' '.join(w['text'] for w in ws) for n in names[1:])>=6]
        if not candidates:return
        hy,hws=candidates[0]
        cols=[]
        for n in names[1:]:
            match=next((w for w in hws if n.lower() in w['text'].lower()),None)
            if match:cols.append((cx(match),n))
        if any('Hong' in w['text'] for w in hws):
            hk=[w for w in hws if w['text'] in ['Hong','Kong','West','Kowloon']]
            if hk:cols.append(((min(w['x0'] for w in hk)+max(w['x1'] for w in hk))/2,names[0]))
        cols.sort()
    for y,ws in rows:
        nums=[w for w in ws if w['x0']<p['width']*.13 and re.fullmatch(r'[GD]\d{1,4}(?:/\d{1,4})?',w['text'])]
        if len(nums)!=1:continue
        tw=[w for w in ws if token_time(w) is not None and w['x0']>p['width']*.13]
        if not short:
            # Long-haul merged cells put the train number between heading and time rows.
            departure=[w for w in tw if w['x0']<p['width']*.21]
            nearby=[(ry,rws) for ry,rws in rows if y-35<ry<y+40 and sum(token_time(w) is not None for w in rws)>=2]
            if nearby:
                _,tws=min(nearby,key=lambda r:abs(r[0]-y));tw=[w for w in tws if token_time(w) is not None and w['x0']>p['width']*.13]
            headers=[(ry,rws) for ry,rws in rows if y-90<ry<y and sum(bool(re.fullmatch(r'[A-Z][a-zA-Z-]{3,}\*?[|}]?',w['text'])) for w in rws if w['x0']>p['width']*.21)>=2]
            if not headers:continue
            _,hws=headers[-1]
            cols=[(cx(w),w['text'].strip('*|}')) for w in hws if w['x0']>p['width']*.21 and re.fullmatch(r'[A-Z][a-zA-Z-]{3,}\*?[|}]?',w['text']) and w['text'] not in ('Departure','Arrival','Intermediate','Destination','Train')]
            if not cols:continue
            tw=departure+[w for w in tw if w['x0']>=p['width']*.21]
            cols.append((p['width']*.17,'Hong Kong West Kowloon'))
            if p['page']>=4:
                cols=[c for c in cols if c[0]<p['width']*.82]
                cols.append((p['width']*.89,'Hong Kong West Kowloon'))
                # Return tables name the origin in a banner above the grid.
                cols=[c for c in cols if c[0]!=p['width']*.17]
                origin=None
                known_origins=['Beijingxi','Changshanan','Chengdudong','Chongqingxi','Fuzhou','Kunmingnan','Meizhouxi','Nanningdong','Shanghai Hongqiao','Shantou','Shanwei','Tianjinxi','Wuhan','Xiamen',"Xi'anbei",'Zhangjiajiexi','Zhanjiangxi','Zhaoqingdong']
                for ry,rws in rows:
                    if ry>=y:break
                    if any(w['text']=='From' for w in rws):origin=None
                    banner=' '.join(w['text'] for w in rws if w['bottom']-w['top']>15).replace('Chonggingxi','Chongqingxi').replace('Xi’anbei',"Xi'anbei")
                    for name in known_origins:
                        if name in banner:origin=name
                if origin:cols.append((p['width']*.17,origin))
        if len(tw)<2:continue
        stops=[];bad=False
        for w in tw:
            x,name=min(cols,key=lambda c:abs(c[0]-cx(w)))
            if abs(x-cx(w))>p['width']*.04 or not accepted(w):
                bad=True;break
            t=token_time(w)
            stops.append({'station':b.station('HK' if name=='Hong Kong West Kowloon' else 'CN',name),'arrival':t,'departure':t})
        if bad:
            b.review.append({'source':sid,'number':nums[0]['text'],'locator':{'page':p['page'],'y':round(y,2)},'reason':'OCR confidence or station-column alignment below threshold'});continue
        b.add(sid,nums[0]['text'],'HK',stops,cal,{'page':p['page'],'y':round(y,2)},'MTR / China Railway',notes='OCR timetable; operating-day confirmation required')



# Station spellings checked against the bilingual headings, not fuzzy city matching.
JR_NAMES = '''Tokyo|Shinagawa|Shin-Yokohama|Odawara|Atami|Mishima|Shin-Fuji|Shizuoka|Kakegawa|Hamamatsu|Toyohashi|Mikawa-Anjo|Nagoya|Gifu-Hashima|Maibara|Kyoto|Shin-Osaka|Shin-Kobe|Nishi-Akashi|Himeji|Aioi|Okayama|Shin-Kurashiki|Fukuyama|Shin-Onomichi|Mihara|Higashihiroshima|Hiroshima|Shin-Iwakuni|Tokuyama|Shin-Yamaguchi|Asa|Shin-Shimonoseki|Kokura|Hakata|Shin-Tosu|Kurume|Chikugo-Funagoya|Shin-Omuta|Shin-Tamana|Kumamoto|Shin-Yatsushiro|Shin-Minamata|Izumi|Sendai|Kagoshima-Chuo|Akama|Beppu|Fukuma|Hakata|Hyugashi|Kadogawa|Kamegawa|Kashii|Kitsuki|Kozaki|Kurosaki|Miyazaki|Moji|Mojiko|Nakatsu|Nobeoka|Oita|Orio|Ozai|Sadowara|Saiki|Takanabe|Tobata|Togo|Tsukumi|Tsuno|Tsurusaki|Unoshima|Usa|Usuki|Yahata|Yukuhashi|Tosu|Shin-Tosu|Yoshinogari-koen|Saga|Hizen-Yamaguchi|Kohoku|Takeo-onsen|Ureshino-onsen|Shin-Omura|Isahaya|Nagasaki|Arita|Haiki|Sasebo|Huis Ten Bosch|Yufuin|Hita|Amagase|Bungo-Mori|Bungo-Nakamura|Yunohira|Mukainoharu|Oita|Beppu|Shin-Suizenji|Suizenji|Higo-Ozu|Aso|Miyaji|Bungo-Taketa|Miemachi|Ogata|Tamana|Omuta|Hainuzuka|Setaka|Nogata|Nakazuru|Nakagawa|Keisen|Shin-Iizuka|Iizuka|Hayato|Kirishima-Jingu|Kokubu|Miyakonojo|Nishi-Miyakonojo|Kiyotake|Minami-Miyazaki|Miyazaki Airport|Nango|Obi|Aburatsu|Kitago|Tano|Sakanoue|Ibusuki|Kiire|Kagoshima|Misumi|Uto|Oda|Kohoku|Hizen-Hama|Tara|Konagai|Minami-Miyazaki|Tayoshi|Aoshima|Nichinan'''.split('|')


def station_label(words):
    text=' '.join(w['text'] for w in words)
    text=re.sub(r'([A-Za-z])（([it])',r'\1\2（',text)
    import unicodedata
    text=''.join(c for c in unicodedata.normalize('NFKD',text) if not unicodedata.combining(c))
    text=text.replace('Shin-lwakuni','Shin-Iwakuni').replace('Shhin-Tosu','Shin-Tosu').replace('Hydgashi','Hyugashi').replace('Ōita','Oita').replace('Kagoshima-chūō','Kagoshima-Chuo').replace('Kagoshima-chuo','Kagoshima-Chuo')
    for name in sorted(set(JR_NAMES),key=len,reverse=True):
        if re.search(r'(?<![A-Za-z-])'+re.escape(name)+r'(?![A-Za-z-])',text,re.I):
            return 'Sendai (Kagoshima)' if name=='Sendai' else name
    return None


def jr(b,sid,p,a):
    rows=lines(p,tolerance=1.6);W,H=p['width'],p['height']
    candidates=[(y,ws) for y,ws in rows if y<H*.26 and sum(bool(re.fullmatch(r'\d{1,3}',w['text'])) for w in ws)>12]
    if not candidates:return
    hy,hws=max(candidates,key=lambda r:sum(w['text'].isdigit() for w in r[1]))
    columns=[w for w in hws if W*.085<cx(w)<W*.88 and re.fullmatch(r'\d{1,3}',w['text'])]
    stationrows=[]
    for y,ws in rows:
        name=station_label([w for w in ws if w['x0']>W*.88])
        if name and hy+30<y<H*.84:stationrows.append((y,name))
    for col in columns:
        stops=[]
        for y,name in stationrows:
            times=[w for w in p['words'] if abs((w['top']+w['bottom'])/2-y)<2 and abs(cx(w)-cx(col))<W*.009 and token_time(w,True) is not None and w.get('confidence',100)>=70]
            if len(times)!=1:continue
            t=token_time(times[0],True);station=b.station('JP',name)
            if stops and stops[-1]['station']==station:stops[-1]['departure']=t
            else:stops.append({'station':station,'arrival':t,'departure':t})
        b.add(sid,col['text'],'JP',stops,{'kind':'typical','start':'2026-03-14'},
              {'page':p['page'],'columnX':round(cx(col),2)},'JR Shinkansen',notes='OCR basic timetable; additional trains excluded; operating days require confirmation')


def kyushu(b,sid,p,a):
    if p['page']==1:return # Cover/index, not timetable.
    if p['page']>=13:
        kyushu_named(b,sid,p,a)
        return
    rows=lines(p,tolerance=1.8)
    # Each timetable band begins with Train Name, followed by the service number line.
    headings=[y for y,ws in rows if 'Train' in ' '.join(w['text'] for w in ws) and 'Name' in ' '.join(w['text'] for w in ws)]
    for hi,hy in enumerate(headings):
        end=headings[hi+1]-25 if hi+1<len(headings) else p['height']-20
        number_rows=[(y,ws) for y,ws in rows if hy+3<y<hy+24 and sum(bool(re.fullmatch(r'\d{1,3}',w['text'])) for w in ws)>=2]
        if not number_rows:continue
        ny,nws=max(number_rows,key=lambda r:sum(w['text'].isdigit() for w in r[1]))
        cols=[w for w in nws if 110<cx(w)<725 and re.fullmatch(r'\d{1,3}',w['text'])]
        for ci,col in enumerate(cols):
            stops=[]
            # Multiple side-by-side groups have their own station-label block.
            for y,ws in rows:
                if not ny+20<y<end:continue
                times=[w for w in ws if abs(cx(w)-cx(col))<10 and token_time(w) is not None and w.get('confidence',100)>=70]
                if len(times)!=1:continue
                # Choose nearest recognized label to the left, excluding other train columns.
                names=[]
                for start in (0,280,380,410,540,620,680):
                    if start>=col['x0']-15:continue
                    labelwords=[w for w in ws if start<=w['x0']<min(start+110,col['x0']-10)]
                    name=station_label(labelwords)
                    if name:names.append((start,name))
                if not names:continue
                name=max(names)[1];station=b.station('JP',name);t=token_time(times[0])
                if stops and stops[-1]['station']==station:stops[-1]['departure']=t
                else:stops.append({'station':station,'arrival':t,'departure':t})
            b.add(sid,col['text'],'JP',stops,{'kind':'typical','start':'2026-03-14','end':'2027-02-28'},
                  {'page':p['page'],'headerY':round(ny,2),'columnX':round(cx(col),2)},'JR Kyushu',notes='Major-trains timetable; operating-day footnotes require confirmation')


def kyushu_named(b,sid,p,a):
    rows=lines(p,tolerance=1.8)
    headings=[y for y,ws in rows if 'Train' in ' '.join(w['text'] for w in ws) and 'Name' in ' '.join(w['text'] for w in ws)]
    for hi,hy in enumerate(headings):
        end=headings[hi+1]-40 if hi+1<len(headings) else 560
        timewords=[w for w in p['words'] if hy+24<w['top']<end and token_time(w) is not None]
        columns=[]
        for w in sorted(timewords,key=cx):
            if not columns or abs(cx(w)-columns[-1])>9:columns.append(cx(w))
        for x in columns:
            stops=[]
            for y,ws in rows:
                if not hy+24<y<end:continue
                tw=[w for w in ws if abs(cx(w)-x)<9 and token_time(w) is not None]
                if len(tw)!=1:continue
                labelwords=[w for w in ws if x-130<w['x0']<tw[0]['x0']-5 and token_time(w) is None]
                name=station_label(labelwords)
                if name:stops.append({'station':b.station('JP',name),'arrival':token_time(tw[0]),'departure':token_time(tw[0])})
            b.add(sid,'','JP',stops,{'kind':'typical','start':'2026-03-14','end':'2027-02-28'},
                  {'page':p['page'],'columnX':round(x,2),'headerY':round(hy,2)},'JR Kyushu',notes='Tourist-train timetable; service-specific operating dates require confirmation')
