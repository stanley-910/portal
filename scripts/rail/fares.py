"""Published rail fares for the rail-cache and TDX providers, from tables the capture already holds.

Reads data/rail-cache/fares.json (raw extracted tables) and the station names in the rail cache, and writes
src/lib/transport/providers/rail-cache/fares.json: per table, a station-name index and the adult one-way fare in a
standard seat for each station pair. Only tables whose layout is known become fares; the OCR'd MTR charts don't.

    python3 scripts/rail/fares.py
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/rail-cache/fares.json"
CACHE = ROOT / "src/lib/transport/providers/rail-cache/cache.json"
OUT = ROOT / "src/lib/transport/providers/rail-cache/fares.json"

def norm(name: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", name.lower())

def num(v):
    if isinstance(v, (int, float)): return int(v) if v > 0 else None
    if isinstance(v, str):
        s = v.replace(",", "").replace("*", "").strip()
        return int(s) if s.isdigit() and int(s) > 0 else None
    return None

class Names:
    """A country's cache stations by every name they go by. A name two stations share resolves to neither."""
    def __init__(self, cache, country, overrides=None):
        self.ids, seen = {}, {}
        for sid, s in cache["stations"].items():
            if s["country"] != country: continue
            names = [s["name"], *s.get("aliases", [])]
            names += [re.sub(r"\s*\(.*\)$", "", n) for n in names]
            for n in {norm(n) for n in names if n}:
                seen.setdefault(n, set()).add(sid)
        self.ids = {n: next(iter(v)) for n, v in seen.items() if len(v) == 1}
        for n, sid in (overrides or {}).items(): self.ids[norm(n)] = sid
        self.missing = set()
    def __call__(self, name):
        sid = self.ids.get(norm(name))
        if not sid: self.missing.add(name)
        return sid

def key(a, b): return "|".join(sorted((a, b)))

def table(id, cache, source, currency, seat, country, operators, names, prices, note="", line_only=False):
    src = cache["sources"][source]
    used = {i for k in prices for i in k.split("|")}
    return {"id": id, "currency": currency, "seat": seat, "country": country, "operators": operators,
            "source": src["url"], "label": src.get("label"), "retrievedAt": src.get("retrievedAt", "")[:10], "note": note, "lineOnly": line_only,
            "names": {n: i for n, i in names.ids.items() if i in used}, "prices": prices}

def thsr(raw, cache):
    names = Names(cache, "TW")
    rows = raw["tables"][0]["rows"]
    head = rows[0][1:]
    prices = {}
    # lower triangle is the standard car, reserved; upper is business
    for i, r in enumerate(rows[1:len(head) + 1]):
        for j in range(i):
            a, b, p = names(r[0]), names(head[j]), num(r[j + 1])
            if a and b and p: prices[key(a, b)] = [{"price": p}]
    return table("thsr", cache, raw["source"], "TWD", "standard car, reserved", "TW", ["Taiwan High Speed Rail", "THSR"], names, prices), names

def smartex(raw, cache):
    names = Names(cache, "JP", {"Sendai": "JP:sendai-kagoshima"})
    page = next(t for t in raw["tables"] if "Hikari" in t["lines"][2] and "adult" in t["lines"][2])
    prices, order = {}, []
    for line in page["lines"]:
        m = re.match(r"^([A-Za-z][A-Za-z\- ]*?)((?: [\d,]+)*) \1$", line.strip())
        if not m and re.fullmatch(r"[A-Z][A-Za-z\-]+", line.strip()) and not order:
            order.append(line.strip()); continue
        if not m: continue
        station, cells = m.group(1), [num(c) for c in m.group(2).split()]
        for j, p in enumerate(cells):
            a, b = names(station), names(order[j]) if j < len(order) else None
            if a and b and p: prices[key(a, b)] = [{"price": p}]
        order.append(station)
    return table("smartex", cache, raw["source"], "JPY", "ordinary car, reserved (smartEX)", "JP",
                 ["JR Shinkansen", "JR Kyushu"], names, prices,
                 "Hikari, Kodama, Sakura and Tsubame price; Nozomi and Mizuho cost a few hundred yen more. Regular season.",
                 line_only=True), names

def ktx(raws, cache):
    names = Names(cache, "KR")
    prices = {}
    for raw in raws:
        for t in raw["tables"]:
            vias = [v for g in re.findall(r"\(([^)]*)\)", t["sheet"]) for v in re.split(r"[,，]\s*", g)]
            via = sorted(filter(None, (names(v.strip()) for v in vias)))
            for r in t["rows"]:
                if len(r) < 4 or not isinstance(r[1], str) or not isinstance(r[2], str): continue
                a, b, p = names(r[1]), names(r[2]), num(r[3])
                if not (a and b and p): continue
                cands = prices.setdefault(key(a, b), [])
                if not any(c["price"] == p and c.get("via", []) == via for c in cands):
                    cands.append({"price": p, **({"via": via} if via else {})})
    return table("ktx", cache, raws[0]["source"], "KRW", "standard car", "KR", ["KTX", "SRT"], names, prices,
                 "Where routes differ in price, the one through the stations the train calls at."), names

def saemaeul(raw, cache):
    names = Names(cache, "KR")
    prices = {}
    for t in raw["tables"]:
        for r in t["rows"]:
            # a sheet can hold two blocks side by side: from, to, fare, from, to, fare
            for k in range(1, len(r) - 2, 3):
                if isinstance(r[k], str) and isinstance(r[k + 1], str):
                    a, b, p = names(r[k]), names(r[k + 1]), num(r[k + 2])
                    if a and b and p: prices.setdefault(key(a, b), [{"price": p}])
    return table("saemaeul", cache, raw["source"], "KRW", "standard car", "KR", ["ITX-새마을", "새마을", "ITX-마음"], names, prices), names

raw = {g["source"]: g for g in json.loads(RAW.read_text())}
cache = json.loads(CACHE.read_text())
by = lambda prefix: [g for s, g in raw.items() if s.startswith(prefix)]
built = [thsr(by("thsr-fares")[0], cache), smartex(by("smartex-fares:b6b5313b86ba3485")[0], cache),
         ktx([raw["korail-fares:17da4e097143ba0c"], raw["sr-fares:bc18040242a61866"]], cache),
         saemaeul(raw["korail-fares:287423a7bb3d504b"], cache)]
OUT.write_text(json.dumps({"tables": [t for t, _ in built]}, ensure_ascii=False, separators=(",", ":")) + "\n")
for t, n in built:
    print(f'{t["id"]}: {len(t["prices"])} pairs; names not in the cache: {len(n.missing)} {sorted(n.missing)[:8]}')
