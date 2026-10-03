#!/usr/bin/env python3
"""Rebuild pinned OurAirports snapshot, or validate bundled hubs offline.

    python3 scripts/snapshot-hubs.py              # network: pinned CSV only
    python3 scripts/snapshot-hubs.py --check      # offline validation only

Surface hubs and connection estimates are reviewed by hand; see hubs/DATA.md.
Only airports.json is overwritten. No third-party Python packages required.
"""

import argparse
import collections
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src/lib/transport/hubs"
COMMIT = "ac08c301fd36bc1b9ea2bf4acfd4fef691360b5c"
CSV_URL = f"https://raw.githubusercontent.com/davidmegginson/ourairports-data/{COMMIT}/airports.csv"
CSV_SHA256 = "197c68d0520b01c35f03c7fa15bf3467bf8ed788b3ed5a128e86eccebf4465ef"
IMPORTANCE = {"small_airport": 1, "medium_airport": 2, "large_airport": 3}


def snapshot_airports():
    request = urllib.request.Request(CSV_URL, headers={"User-Agent": "TripGlobe-hub-snapshot/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        raw = response.read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != CSV_SHA256:
        raise ValueError(f"Pinned CSV checksum mismatch: {digest}; refusing to write")
    hubs = []
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        if row["scheduled_service"] != "yes" or not row["iata_code"] or row["type"] not in IMPORTANCE:
            continue
        code = row["iata_code"]
        if not re.fullmatch(r"[A-Z]{3}", code):
            raise ValueError(f"Unexpected IATA code: {code!r}")
        hubs.append({
            "id": f"airport:{code}",
            "mode": "flight",
            "name": row["name"],
            # Preserve missing municipality as an empty string; do not invent a city.
            "city": row["municipality"],
            "lat": float(row["latitude_deg"]),
            "lng": float(row["longitude_deg"]),
            "country": row["iso_country"],
            "code": code,
            "iata": code,
            "importance": IMPORTANCE[row["type"]],
            "source": CSV_URL,
        })
    hubs.sort(key=lambda hub: hub["id"])
    if not hubs or len({hub["id"] for hub in hubs}) != len(hubs):
        raise ValueError("Empty snapshot or duplicate IATA codes; manual review required")
    return hubs


def validate(airports, surface, connections):
    required = {"id", "mode", "name", "city", "lat", "lng", "country", "code", "importance", "source"}
    allowed = required | {"iata", "timezone", "providerIds"}
    by_id = {}
    for hub in airports + surface:
        assert required <= hub.keys() <= allowed, f"Unexpected schema: {hub}"
        assert hub["id"] not in by_id, f"Duplicate ID: {hub['id']}"
        by_id[hub["id"]] = hub
        assert hub["mode"] in {"flight", "train", "ferry"}
        for field in {"id", "mode", "name", "city", "country", "code", "source"}:
            assert isinstance(hub[field], str), (hub["id"], field)
        assert hub["id"] and hub["name"] and hub["code"]
        assert re.fullmatch(r"[A-Z]{2}", hub["country"]), hub["id"]
        assert type(hub["importance"]) is int and hub["importance"] in {1, 2, 3}
        assert hub["source"].startswith("https://"), hub["id"]
        for field, low, high in [("lat", -90, 90), ("lng", -180, 180)]:
            value = hub[field]
            assert type(value) in {int, float} and math.isfinite(value) and low <= value <= high
        if "timezone" in hub:
            ZoneInfo(hub["timezone"])
        if "providerIds" in hub:
            assert isinstance(hub["providerIds"], dict)
        if hub["mode"] == "flight":
            assert hub["code"] == hub["iata"] and hub["id"] == f"airport:{hub['iata']}"
            assert re.fullmatch(r"[A-Z]{3}", hub["iata"])
        else:
            assert hub["id"].startswith(hub["mode"] + ":")
    assert all(hub["mode"] == "flight" for hub in airports)
    assert all(hub["mode"] in {"train", "ferry"} for hub in surface)
    seen = set()
    for edge in connections:
        assert set(edge) == {"from", "to", "mode", "durationMin", "source"}
        assert edge["mode"] in {"train", "ferry"}
        assert edge["from"] != edge["to"]
        for endpoint in [edge["from"], edge["to"]]:
            assert endpoint in by_id, f"Unknown connection endpoint: {endpoint}"
            assert by_id[endpoint]["mode"] == edge["mode"]
        assert type(edge["durationMin"]) is int and edge["durationMin"] > 0
        assert edge["source"].startswith("https://")
        key = (edge["from"], edge["to"], edge["mode"])
        assert key not in seen, f"Duplicate connection: {key}"
        seen.add(key)
    return by_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate committed JSON without network")
    args = parser.parse_args()
    airports = json.loads((DATA / "airports.json").read_text()) if args.check else snapshot_airports()
    surface = json.loads((DATA / "surface-hubs.json").read_text())
    connections = json.loads((DATA / "connections.json").read_text())
    by_id = validate(airports, surface, connections)
    if not args.check:
        (DATA / "airports.json").write_text(json.dumps(airports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Validated {len(airports)} airports, {len(surface)} surface hubs, {len(connections)} directed estimated connections")
    print(f"Airport countries/territories: {len({hub['country'] for hub in airports})}")
    print(f"Surface modes: {dict(sorted(collections.Counter(hub['mode'] for hub in surface).items()))}")
    print(f"Surface countries/territories: {len({hub['country'] for hub in surface})}")
    print(f"Total unique hubs: {len(by_id)}")


if __name__ == "__main__":
    main()
