#!/usr/bin/env python3
"""Capture dated China stop-time samples or Japan reseller route-page evidence.

China consumes a previously obtained public 12306 search JSON response. Its search
host currently fails robots discovery; this script does not retry that host.
Neither source establishes complete inventory, recurring calendars or bookability.
"""
import argparse
import hashlib
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

spec = importlib.util.spec_from_file_location('capture_rail', Path(__file__).with_name('capture-rail.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def china_catalog(raw):
    payload = json.loads(raw)
    rows = payload.get('data', [])
    if payload.get('status') is not True or not rows:
        raise ValueError('No successful 12306 train catalogue')
    dates = {r['date'] for r in rows}
    if len(dates) != 1:
        raise ValueError('Catalogue dates differ')
    date = datetime.strptime(dates.pop(), '%Y%m%d').strftime('%Y-%m-%d')
    return date, rows


def china_stops(raw, date):
    payload = json.loads(raw)
    rows = payload.get('data', {}).get('data', [])
    if payload.get('status') is not True or payload.get('httpstatus') != 200 or len(rows) < 2:
        raise ValueError('No successful 12306 stop table')
    if any(r.get('start_train_date') != date.replace('-', '') for r in rows):
        raise ValueError('Train origin date differs from query')
    for row in rows:
        for key in ('arrive_time', 'start_time'):
            if not re.fullmatch(r'(?:(?:[01]\d|2[0-3]):[0-5]\d|----)', row[key]):
                raise ValueError('Unexpected time encoding')
        for key in ('arrive_day_diff', 'start_day_diff'):
            if int(row[key]) < 0:
                raise ValueError('Negative day offset')
    return rows


def japan_rows(raw):
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', raw.decode('utf-8'), re.S)
    if not match:
        raise ValueError('Public route-page data missing (possibly a challenge)')
    modules = json.loads(match[1])['props']['pageProps']['initialState']['modules']
    props = next(m['props'] for m in modules if m['name'] == 'TrainList')
    origin, destination = props['departureInfo']['clearName'], props['arrivalInfo']['clearName']
    rows = [r for r in props['todayRoutes'] if r['departName'] == origin and r['arrivalName'] == destination]
    if not rows:
        raise ValueError('No exact-endpoint dated rows')
    # This deliberately keeps evidence rows, not offers. Numeric trainNo values are
    # reseller identifiers, and zero fares must never become free train tickets.
    return {'originLabel': origin, 'destinationLabel': destination,
            'pageRowCount': len(props['todayRoutes']), 'matchedRowCount': len(rows),
            'dates': sorted({r['departTime'][:10] for r in rows}),
            'normalizedOffers': False, 'fareStatus': 'unverified; zero placeholders are not prices',
            'rows': rows}


def derived(cap, value, name):
    path = cap.directory / name
    base.atomic_json(path, value)
    cap.assets.append({'path': str(path.relative_to(base.ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                       'role': 'derived-evidence', 'bytes': path.stat().st_size})


def capture(source, directory, catalog=None):
    cap = base.Capture(directory / source)
    report = {'source': source, 'status': 'failed', 'assets': cap.assets, 'kind': 'dated-sample-evidence',
              'runtimeIntegrated': False, 'completeInventory': False,
              'reuse': 'Local review only; no redistribution licence inferred.'}
    try:
        if source == 'china-12306-sample':
            raw = catalog.read_bytes()
            date, rows = china_catalog(raw)
            path = cap.directory / 'observed-search.json'
            path.write_bytes(raw)
            cap.assets.append({'path': str(path.relative_to(base.ROOT)), 'sha256': hashlib.sha256(raw).hexdigest(),
                               'bytes': len(raw), 'role': 'imported-public-search-response',
                               'url': 'https://search.12306.cn/search/v1/train/search?' + urlencode({'keyword': 'G', 'date': date.replace('-', ''), 'type': 'wx_checi'}),
                               'importedAt': base.now(), 'retrievedAt': None,
                               'provenanceNote': 'Obtained via public mobile form endpoint; exact retrieval timestamp not recorded. Search robots later returned 502; no further search requests by this collector.'})
            cap.fetch('https://mobile.12306.cn/weixin/wxcore/initCC?type=xxqg', 'form.html', 'public-form')
            cap.fetch('https://mobile.12306.cn/weixin/resources/weixin/js/index_checi.js?version=2.00', 'form.js', 'public-form-code')
            report.update(queriedTravelDate=date, catalogueRows=len(rows), searchMayBeTruncated=len(rows) >= 200)
            seen, selected = set(), []
            # One train per directed endpoint pair, at most 24. Stable source order.
            for row in rows:
                pair = (row['from_station'], row['to_station'])
                if pair not in seen:
                    seen.add(pair)
                    selected.append(row)
                if len(selected) == 24:
                    break
            successes, failures = [], []
            for row in selected:
                query = urlencode({'train_no': row['train_no'], 'from_station_telecode': 'BBB',
                                   'to_station_telecode': 'BBB', 'depart_date': date})
                code = row['station_train_code']
                if not re.fullmatch(r'[A-Z]\d+', code):
                    raise ValueError('Unexpected train code')
                try:
                    body, asset = cap.fetch('https://mobile.12306.cn/weixin/wxcore/queryByTrainNo?' + query, code + '.json', 'dated-stop-times')
                    stops = china_stops(body, date)
                    if stops[0]['station_name'] != row['from_station'] or stops[-1]['station_name'] != row['to_station']:
                        raise ValueError('Stop-table endpoints differ from catalogue')
                    if len(stops) != int(row['total_num']):
                        raise ValueError('Stop-table length differs from catalogue')
                    successes.append({'train': code, 'from': row['from_station'], 'to': row['to_station'],
                                      'stops': len(stops), 'evidencePath': asset['path']})
                except Exception as error:
                    failures.append({'train': code, 'error': str(error)})
            report.update(trains=successes, failures=failures, selectedTrainCount=len(selected))
            if failures or not successes:
                raise ValueError(f'{len(failures)} sampled train queries failed')
        else:
            summaries, failures = [], []
            for city in ('niigata', 'sendai-miyagi', 'shin-hakodate-hokuto', 'kanazawa', 'nagano'):
                for route in (f'tokyo-to-{city}', f'{city}-to-tokyo'):
                    try:
                        raw, asset = cap.fetch(f'https://www.trip.com/trains/japan/route/{route}/', route + '.html', 'reseller-route-page')
                        evidence = japan_rows(raw)
                        evidence['sourcePath'] = asset['path']
                        derived(cap, evidence, route + '.rows.json')
                        summaries.append({k: v for k, v in evidence.items() if k != 'rows'})
                    except Exception as error:
                        failures.append({'route': route, 'error': str(error)})
                        # Stop after an access challenge; never cycle identities or bypass it.
                        if 'challenge' in str(error) or 'HTTP 403' in str(error):
                            break
                if failures and ('challenge' in failures[-1]['error'] or 'HTTP 403' in failures[-1]['error']):
                    break
            report.update(routes=summaries, failures=failures)
            if failures or len(summaries) != 10:
                raise ValueError(f'{len(summaries)}/10 route pages captured; {len(failures)} failures')
        report['status'] = 'captured'
    except Exception as error:
        report['error'] = str(error)
    base.atomic_json(cap.directory / 'manifest.json', report)
    print(f"{source}: {report['status']} ({len(cap.assets)} assets) {report.get('error', '')}", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=['china-12306-sample', 'japan-route-samples'], required=True)
    parser.add_argument('--catalog', type=Path, help='Previously captured keyword=G 12306 public search JSON')
    args = parser.parse_args()
    if args.source == 'china-12306-sample' and not args.catalog:
        parser.error('China requires --catalog; the search endpoint is not fetched automatically')
    run = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    directory = base.OUT / 'runs' / run
    result = capture(args.source, directory, args.catalog)
    manifest = json.loads((base.OUT / 'latest.json').read_text())
    merged = {s['source']: s for s in manifest['sources']}
    merged[result['source']] = result
    manifest.update(capturedAt=base.now(), sources=list(merged.values()))
    base.verify(manifest)
    base.atomic_json(directory / 'manifest.json', manifest)
    base.atomic_json(base.OUT / 'latest.json', manifest)
    base.atomic_json(base.OUT / 'report.json', manifest)
    if result['status'] != 'captured':
        raise SystemExit(2)


if __name__ == '__main__':
    main()
