#!/usr/bin/env python3
"""Capture public operator downloads, without changing runtime seeds.

python3 scripts/capture-rail.py [--only mtr,thsr,korail,sr,jr-central,jr-kyushu,ktmb,vietnam,thailand]
python3 scripts/capture-rail.py --check
Requires curl; PDF text extraction additionally uses Poppler's pdftotext.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import re
import subprocess
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/rail-capture"
VERSION = "rail-source-capture/1"
UA = "PortalRailResearch/1.0"
PAGES = {
    "mtr": "https://www.highspeed.mtr.com.hk/en/common/timetable.inc.html",
    "thsr": "https://en.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c",
    "jr-central": "https://global.jr-central.co.jp/en/info/timetable/",
    "jr-kyushu": "https://www.jrkyushu.co.jp/english/train/700series.html",
    "korail": "https://www.korail.com/com/userBoard.do?mode=list&schBcid=ticketTable",
    "sr": "https://etk.srail.kr/cms/archive.do?pageId=TK0402050000",
    "ktmb": "https://api.data.gov.my/gtfs-static/ktmb",
    "vietnam": "https://giotaugiave.dsvn.vn/",
    "thailand": "https://ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line=1&trip=1",
    "ktmb-published": "https://www.ktmb.com.my/TrainTime.html",
    "mtr-fares": "https://www.highspeed.mtr.com.hk/en/ticket/fare.html",
    "korail-fares": "https://www.korail.com/com/userBoard.do?mode=list&schBcid=ticketTable",
    "sr-fares": "https://etk.srail.kr/cms/archive.do?pageId=TK0402050000",
    "smartex-fares": "https://smart-ex.jp/en/product/plan/service/",
    "thsr-fares": "https://en.thsrc.com.tw/ArticleContent/4c3efc1d-e6df-4bfd-97b4-52e89f79ee5c",
}


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


class Links(HTMLParser):
    """Read visible anchors only; never resurrect commented-out old downloads."""
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.active = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.active = {**dict(attrs), "text": ""}

    def handle_data(self, data):
        if self.active is not None:
            self.active["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.active is not None:
            self.active["text"] = " ".join(self.active["text"].split())
            self.links.append(self.active)
            self.active = None


def discover(source, body, url):
    """Yield source-provided labels and URLs, not inferred service calendars."""
    if source in ("korail", "korail-fares"):
        rows = json.loads(body)["boardList"]
        # Current KTX and conventional timetables; skip older revisions of each.
        prefixes = ["KTX 시간표", "일반열차 시간표"] if source == "korail" else ["KTX 운임표", "일반열차(ITX"]
        for prefix in prefixes:
            candidates = [r for r in rows if r["bdTitle"].startswith(prefix)]
            if not candidates:
                raise ValueError(f"Missing Korail board category: {prefix}")
            row = max(candidates, key=lambda r: r["bdIdx"])
            for file in row["fileId"]:
                if not re.fullmatch(r"jfile/[\w/.-]+\.xlsx?", file):
                    raise ValueError("Unexpected Korail attachment path")
                yield row["bdTitle"], urljoin(url, "/file/cubedata/COMMON/" + file)
        return
    anchors = Links(body).links
    if source == "sr":
        dated = []
        for a in anchors:
            date = re.search(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})", a["text"])
            match = re.search(r"downloadAttach\('([^']+)',\s*'([^']+)'\)", a.get("onclick", ""))
            if date and match:
                dated.append((tuple(map(int, date.groups())), a["text"], match.groups()))
        if not dated:
            raise ValueError("SR dated timetable attachment missing")
        _, label, (page_id, attachment) = max(dated)
        yield label, f"https://www.srail.or.kr/cms/attach/download.do?pageId={page_id}&atchNo={attachment}"
        return
    for a in anchors:
        href = a.get("href", "")
        if source in ("mtr", "mtr-fares") and href.endswith(".pdf"):
            yield a.get("title") or a["text"] or href, urljoin(url, href)
        elif source == "thsr" and "/Attachment/Download" in href:
            yield a.get("title") or a["text"], urljoin(url, href)
        elif source == "jr-central" and re.search(r"shinkansen_.*\.pdf$", href):
            yield a["text"], urljoin(url, href)
        elif source == "jr-kyushu" and re.search(r"timetable[^/]*\.pdf$", href):
            yield a["text"], urljoin(url, href)
        elif source == "ktmb-published" and a.get("data-dl", "").endswith(".pdf"):
            # Published passenger timetables only; historical commented links are ignored.
            if "/2026/" in a["data-dl"]:
                yield a["text"], urljoin(url, a["data-dl"])
        elif source == "smartex-fares" and re.search(r"service_fares_.*\.pdf$", href):
            yield a["text"], urljoin(url, href)
        elif source == "sr-fares" and "운임표 다운로드" in a["text"]:
            match = re.search(r"downloadAttach\('([^']+)',\s*'([^']+)'\)", a.get("onclick", ""))
            if match:
                yield a["text"], f"https://www.srail.or.kr/cms/attach/download.do?pageId={match[1]}&atchNo={match[2]}"


def workbook_cells(raw):
    """Lossless cell evidence, not interpreted train rows. Retain time number formats."""
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        def xml(name):
            return ET.fromstring(z.read(name))
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            strings = ["".join(si.itertext()) for si in xml("xl/sharedStrings.xml").findall("s:si", ns)]
        targets = {r.get("Id"): r.get("Target") for r in xml("xl/_rels/workbook.xml.rels")}
        styles = xml("xl/styles.xml")
        formats = {f.get("numFmtId"): f.get("formatCode") for f in styles.findall("s:numFmts/s:numFmt", ns)}
        style_formats = [xf.get("numFmtId") for xf in styles.findall("s:cellXfs/s:xf", ns)]
        sheets = []
        for sheet in xml("xl/workbook.xml").findall("s:sheets/s:sheet", ns):
            target = targets[sheet.get(f"{{{rel_ns}}}id")]
            path = target.lstrip("/") if target.startswith("/") else "xl/" + target
            root = xml(path)
            cells = []
            for cell in root.findall("s:sheetData/s:row/s:c", ns):
                kind = cell.get("t", "n")
                value = cell.findtext("s:v", default="", namespaces=ns)
                if kind == "s":
                    value = strings[int(value)]
                elif kind == "inlineStr":
                    value = "".join(cell.find("s:is", ns).itertext())
                if value or cell.find("s:f", ns) is not None:
                    cells.append({"ref": cell.get("r"), "type": kind, "value": value,
                                  "style": int(cell.get("s", "0")), "formula": cell.findtext("s:f", namespaces=ns)})
            sheets.append({"name": sheet.get("name"), "cells": cells,
                           "mergedRanges": [c.get("ref") for c in root.findall("s:mergeCells/s:mergeCell", ns)]})
        properties = xml("xl/workbook.xml").find("s:workbookPr", ns)
        return {"kind": "workbook-cell-evidence", "normalizedServices": False,
                "workbookProperties": dict(properties.attrib) if properties is not None else {},
                "customNumberFormats": formats, "styleNumberFormatIds": style_formats, "sheets": sheets}


class Capture:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True)
        self.assets = []
        self.robots = {}

    def fetch(self, url, name, role, expected=None, check_robots=True):
        url = quote(url, safe=":/?=&%+#@,;")
        if check_robots:
            self.robot_check(url)
        path = self.directory / name
        # curl uses the host TLS trust configuration. Never disable certificate verification.
        result = subprocess.run([
            "curl", "--location", "--max-redirs", "3", "--proto", "=https",
            "--proto-redir", "=https", "--connect-timeout", "10", "--max-time", "35",
            "--max-filesize", "30000000", "--silent", "--show-error", "--user-agent", UA,
            "--output", str(path), "--write-out", "%{http_code}\n%{url_effective}\n%{content_type}", url,
        ], capture_output=True, text=True, timeout=40)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or f"curl exit {result.returncode}")
        status, effective, content_type = result.stdout.split("\n", 2)
        raw = path.read_bytes()
        asset = {"url": url, "effectiveUrl": effective, "retrievedAt": now(), "httpStatus": int(status),
                 "contentType": content_type, "path": str(path.relative_to(ROOT)), "role": role,
                 "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        self.assets.append(asset)
        if role != "robots" and status != "200":
            raise RuntimeError(f"HTTP {status}: {url}")
        if expected == "document":
            if raw.startswith(b"%PDF-"):
                suffix = ".pdf"
            elif raw.startswith(b"PK"):
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    if "xl/workbook.xml" not in z.namelist():
                        raise ValueError("Attachment is not an XLSX workbook")
                    if z.testzip():
                        raise ValueError("Damaged XLSX attachment")
                suffix = ".xlsx"
            elif raw.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
                suffix = ".xls"
                asset["parsingStatus"] = "legacy-workbook-not-normalized"
            else:
                raise ValueError("Download is not a PDF/XLSX/XLS (possibly a challenge/error page)")
            renamed = path.with_suffix(suffix)
            path.rename(renamed)
            asset["path"] = str(renamed.relative_to(ROOT))
            if suffix == ".xlsx":
                extracted = workbook_cells(raw)
                cells_path = renamed.with_suffix(".cells.json")
                atomic_json(cells_path, extracted)
                asset["cellsPath"] = str(cells_path.relative_to(ROOT))
                asset["cellsSha256"] = hashlib.sha256(cells_path.read_bytes()).hexdigest()
                asset["sheets"] = [{"name": s["name"], "nonemptyCells": len(s["cells"])} for s in extracted["sheets"]]
            if suffix == ".pdf":
                text_path = renamed.with_suffix(".txt")
                run = subprocess.run(["pdftotext", "-layout", str(renamed), str(text_path)], capture_output=True, timeout=30)
                if run.returncode:
                    raise ValueError("PDF text extraction failed")
                asset["textPath"] = str(text_path.relative_to(ROOT))
                asset["textSha256"] = hashlib.sha256(text_path.read_bytes()).hexdigest()
                asset["textCharacters"] = len(text_path.read_text())
                extracted_text = text_path.read_text()
                asset["parsingStatus"] = "requires-ocr" if not extracted_text.strip() else (
                    "font-encoding-review-required" if re.search(r"[\x00-\x08\x0e-\x1f]", extracted_text)
                    else "text-extracted-not-normalized")
        time.sleep(1)  # low-volume collection, no retry storms
        return raw, asset

    def robot_check(self, url):
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
        if origin not in self.robots:
            raw, asset = self.fetch(origin + "/robots.txt", f"robots-{len(self.robots)}.txt", "robots", check_robots=False)
            body = raw.decode("utf-8", errors="replace")
            parser = None
            if asset["httpStatus"] == 200 and re.search(r"(?im)^\s*user-agent\s*:", body):
                parser = RobotFileParser()
                parser.parse(body.splitlines())
                asset["finding"] = "parsed directives"
            elif asset["httpStatus"] in (404, 410) or (asset["httpStatus"] == 200 and "<html" in body.lower()):
                asset["finding"] = "no robots directives; missing or HTML error page, not a reuse licence"
            else:
                raise RuntimeError(f"robots check unresolved: HTTP {asset['httpStatus']} {origin}")
            self.robots[origin] = parser
        parser = self.robots[origin]
        if parser and not parser.can_fetch(UA, url):
            raise RuntimeError(f"robots disallows {url}")


def capture_source(source, directory):
    cap = Capture(directory / source)
    report = {"source": source, "status": "failed", "assets": cap.assets, "collectorVersion": VERSION,
              "kind": "source-evidence", "runtimeIntegrated": False, "queriedTravelDate": None,
              "reuse": "Local source review; no redistribution licence inferred from public access."}
    try:
        url = PAGES[source]
        raw, page = cap.fetch(url, "feed.zip" if source == "ktmb" else "index.html", "feed" if source == "ktmb" else "index")
        if source == "ktmb":
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                if z.testzip():
                    raise ValueError("Damaged GTFS archive")
                counts = {}
                for file in ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"]:
                    if file not in z.namelist():
                        continue
                    rows = list(csv.DictReader(io.StringIO(z.read(file).decode("utf-8-sig"))))
                    counts[file] = len(rows)
                    if file == "calendar.txt" and rows:
                        report["calendarRange"] = {"start": min(r["start_date"] for r in rows), "end": max(r["end_date"] for r in rows)}
                if not all(counts.get(f) for f in ["stops.txt", "trips.txt", "stop_times.txt"]):
                    raise ValueError("Incomplete GTFS feed")
                report["tableRows"] = counts
        elif source == "thsr-fares":
            if not re.search(rb"(?i)<table\b", raw) or b"1,490" not in raw:
                raise ValueError("THSR fare table not found; review page before accepting")
            page["role"] = "published-fares"
            report["fareBasis"] = "Published table, not a dated quote; class and adult/concession axes require interpretation."
        elif source == "vietnam":
            text = raw.decode("utf-8-sig")
            if not all(f"GridView{n}" in text for n in [1, 2]):
                raise ValueError("Vietnam timetable grids missing")
        elif source == "thailand":
            for line in [1, 2, 4]:
                for trip in [1, 2]:
                    if line == trip == 1:
                        body = raw
                    else:
                        body, _ = cap.fetch(f"https://ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line={line}&trip={trip}", f"line-{line}-{trip}.html", "timetable")
                    if not re.search(rb"(?:Dep|Arr)\.", body):
                        raise ValueError("Thai timetable rows missing")
            cap.fetch("https://ttsview.railway.co.th/timetable_modern/timetable_data.js", "train-metadata.js", "service-rules")
        else:
            links = list(dict.fromkeys(discover(source, raw.decode("utf-8-sig"), url)))
            if not links:
                raise ValueError("No current downloadable timetables discovered")
            report["discoveredDocuments"] = [{"label": label, "url": link} for label, link in links]
            failures = []
            for i, (label, link) in enumerate(links):
                try:
                    _, asset = cap.fetch(link, f"document-{i + 1}.download", "published-fares" if source.endswith("-fares") else "timetable", expected="document")
                    asset["label"] = label
                    asset["discoveredOn"] = page["url"]
                except Exception as error:
                    failures.append({"url": link, "error": str(error)})
            if failures:
                report["failures"] = failures
                raise ValueError(f"{len(failures)} document downloads failed")
        report["status"] = "captured"
    except Exception as error:
        report["error"] = str(error)
    atomic_json(cap.directory / "manifest.json", report)
    print(f"{source}: {report['status']} ({len(cap.assets)} assets) {report.get('error', '')}", flush=True)
    return report


def verify(manifest):
    checked = 0
    for source in manifest["sources"]:
        for asset in source["assets"]:
            for path_key, hash_key in [("path", "sha256"), ("textPath", "textSha256"), ("cellsPath", "cellsSha256")]:
                if path_key in asset:
                    path = (ROOT / asset[path_key]).resolve()
                    if not path.is_relative_to(OUT.resolve()):
                        raise ValueError("Capture path outside data/rail-capture")
                    if hashlib.sha256(path.read_bytes()).hexdigest() != asset[hash_key]:
                        raise ValueError(f"Hash mismatch: {path}")
                    checked += 1
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default=",".join(PAGES))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        manifest = json.loads((OUT / "latest.json").read_text())
        print(f"Verified {verify(manifest)} files offline; capture statuses preserved in latest.json")
        return
    selected = args.only.split(",")
    if len(set(selected)) != len(selected) or any(s not in PAGES for s in selected):
        parser.error("--only must contain distinct supported source names")
    run = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    directory = OUT / "runs" / run
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        sources = list(pool.map(lambda s: capture_source(s, directory), selected))
    # A targeted capture retains the other sources with their original retrieval times.
    previous = json.loads((OUT / "latest.json").read_text()) if (OUT / "latest.json").exists() else {"sources": []}
    merged = {s["source"]: s for s in previous["sources"]}
    merged.update({s["source"]: s for s in sources})
    manifest = {"capturedAt": now(), "collectorVersion": VERSION, "sources": list(merged.values())}
    verify(manifest)
    atomic_json(directory / "manifest.json", manifest)
    # Keep failed attempts and all previous runs; never replace runtime seeds.
    atomic_json(OUT / "latest.json", manifest)
    atomic_json(OUT / "report.json", manifest)
    print(f"Capture manifest: {OUT / 'latest.json'}")
    if any(s["status"] != "captured" for s in sources):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
