"""Offline PDF layout extraction. OCR only when the PDF has no usable text."""
import csv
import hashlib
import io
import json
import subprocess
from pathlib import Path
from PIL import ImageDraw
import pdfplumber
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/rail-layout'


def pages(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    target = CACHE / (digest + '-v2.json')
    if target.exists():
        return json.loads(target.read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    result = []
    with pdfplumber.open(path) as pdf:
        renderer = None
        for i, page in enumerate(pdf.pages):
            words = page.extract_words(x_tolerance=1, y_tolerance=2)
            bad = sum('(cid:' in w['text'] or any(ord(c)<32 for c in w['text']) for w in words)
            ocr = len(words) < 10 or bad > len(words)*.1
            if ocr:
                if renderer is None:
                    renderer = pdfium.PdfDocument(str(path))
                png = CACHE / f'{digest}-{i}-v2.png'
                scale = 5 if page.width < 1000 else 3
                im = renderer[i].render(scale=scale).to_pil().convert('RGB')
                draw = ImageDraw.Draw(im)
                # Remove vector table rules before OCR, not text paths.
                for edge in page.lines:
                    if (edge['width'] < 1 and edge['height'] > 15) or (edge['height'] < 1 and edge['width'] > 15):
                        draw.line((edge['x0']*scale,edge['top']*scale,edge['x1']*scale,edge['bottom']*scale),fill='white',width=max(2,round((edge['linewidth']+.3)*scale)))
                im.save(png)
                proc = subprocess.run(['tesseract', str(png), 'stdout', '-l', 'eng', '--psm', '6', 'tsv'],
                                      capture_output=True, text=True, check=True)
                words = []
                for w in csv.DictReader(io.StringIO(proc.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
                    if not w['text'].strip() or float(w['conf']) < 0:
                        continue
                    x, y, width, height = (float(w[k])/scale for k in ('left','top','width','height'))
                    words.append({'text':w['text'], 'x0':x, 'x1':x+width, 'top':y, 'bottom':y+height, 'confidence':float(w['conf'])})
            result.append({'page':i+1, 'width':page.width, 'height':page.height, 'ocr':ocr, 'words':words})
    target.write_text(json.dumps(result, ensure_ascii=False))
    return result


def lines(page, tolerance=2):
    rows = []
    for word in sorted(page['words'], key=lambda w:((w['top']+w['bottom'])/2,w['x0'])):
        center = (word['top']+word['bottom'])/2
        if not rows or abs(center-rows[-1][0]) > tolerance:
            rows.append([center, [word]])
        else:
            rows[-1][1].append(word)
    return [(y, sorted(ws,key=lambda w:w['x0'])) for y,ws in rows]


if __name__ == '__main__':
    import concurrent.futures
    manifest=json.loads((ROOT/'data/rail-capture/report.json').read_text())
    paths=[ROOT/a['path'] for s in manifest['sources'] for a in s['assets'] if a['path'].endswith('.pdf')]
    def run(path):
        p=pages(path)
        print(f'{path.parent.name}/{path.name}: {len(p)} pages, {sum(x["ocr"] for x in p)} OCR',flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        list(pool.map(run,paths))


def second_words(path, page):
    """Independent sparse-text OCR pass for low-confidence numeric cells."""
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    target=CACHE/f'{digest}-{page["page"]-1}-sparse.json'
    if target.exists():return json.loads(target.read_text())
    png=CACHE/f'{digest}-{page["page"]-1}-v2.png'
    scale=5 if page['width']<1000 else 3
    run=subprocess.run(['tesseract',str(png),'stdout','-l','eng','--psm','11','tsv'],capture_output=True,text=True,check=True)
    words=[]
    for w in csv.DictReader(io.StringIO(run.stdout),delimiter='\t',quoting=csv.QUOTE_NONE):
        if not w['text'].strip() or float(w['conf'])<0:continue
        x,y,width,height=(float(w[k])/scale for k in ('left','top','width','height'))
        words.append({'text':w['text'],'x0':x,'x1':x+width,'top':y,'bottom':y+height,'confidence':float(w['conf'])})
    target.write_text(json.dumps(words,ensure_ascii=False))
    return words
