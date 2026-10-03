import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import stations


class CoordinatesTests(unittest.TestCase):
    def enrich(self, rows, resolved):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'coords.json'
            path.write_text(json.dumps(resolved))
            with patch.object(stations, 'COORDS', path):
                stations.enrich(rows)

    def test_fills_missing_station_with_provenance(self):
        rows = {'JP:test-station': {'name': 'Test station fixture', 'country': 'JP', 'aliases': []}}
        self.enrich(rows, {'JP:test-station': {'lat': 35, 'lng': 135, 'coordinateSource': 'https://www.wikidata.org/wiki/Q1'}})
        self.assertEqual(rows['JP:test-station']['lat'], 35)
        self.assertIn('wikidata', rows['JP:test-station']['coordinateSource'])

    def test_preserves_previously_saved_coordinates(self):
        rows = {'JP:test-station': {'name': 'Test station fixture', 'country': 'JP', 'aliases': [], 'lat': 35, 'lng': 135, 'coordinateSource': 'reviewed'}}
        self.enrich(rows, {'JP:test-station': {'lat': 36, 'lng': 136, 'coordinateSource': 'new'}})
        self.assertEqual(rows['JP:test-station']['lat'], 35)
        self.assertEqual(rows['JP:test-station']['coordinateSource'], 'reviewed')

    def test_rejects_invalid_coordinates(self):
        rows = {'JP:test-station': {'name': 'Test station fixture', 'country': 'JP', 'aliases': []}}
        with self.assertRaisesRegex(ValueError, 'Invalid station coordinates'):
            self.enrich(rows, {'JP:test-station': {'lat': 100, 'lng': 135, 'coordinateSource': 'bad'}})


if __name__ == '__main__':
    unittest.main()
