"""Ensure evidence collection cannot silently become wrong-date/free-fare offers."""
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('samples', Path(__file__).with_name('capture-rail-samples.py'))
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)


class SampleTests(unittest.TestCase):
    def test_china_rejects_wrong_date_and_preserves_overnight(self):
        rows = [{'start_train_date': '20261004', 'arrive_time': '----', 'start_time': '23:30',
                 'arrive_day_diff': '0', 'start_day_diff': '0'},
                {'start_train_date': '20261004', 'arrive_time': '06:00', 'start_time': '06:00',
                 'arrive_day_diff': '1', 'start_day_diff': '1'}]
        raw = json.dumps({'httpstatus': 200, 'status': True, 'data': {'data': rows}})
        self.assertEqual(samples.china_stops(raw, '2026-10-04')[1]['arrive_day_diff'], '1')
        with self.assertRaisesRegex(ValueError, 'date differs'):
            samples.china_stops(raw, '2026-10-05')

    def test_japan_filters_other_destinations_without_making_free_offers(self):
        rows = [{'departName': 'Tokyo', 'arrivalName': name, 'departTime': '2026-10-04 06:08:00',
                 'cheapestFare': '0'} for name in ('Nagaoka', 'Niigata')]
        props = {'departureInfo': {'clearName': 'Tokyo'}, 'arrivalInfo': {'clearName': 'Niigata'}, 'todayRoutes': rows}
        payload = {'props': {'pageProps': {'initialState': {'modules': [{'name': 'TrainList', 'props': props}]}}}}
        raw = ('<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + '</script>').encode()
        evidence = samples.japan_rows(raw)
        self.assertEqual(evidence['matchedRowCount'], 1)
        self.assertFalse(evidence['normalizedOffers'])
        self.assertIn('not prices', evidence['fareStatus'])

    def test_rejects_challenge_pages_and_failed_catalogues(self):
        with self.assertRaisesRegex(ValueError, 'challenge'):
            samples.japan_rows(b'<html>Access check</html>')
        with self.assertRaisesRegex(ValueError, 'No successful'):
            samples.china_catalog('{"status": false, "data": []}')


if __name__ == '__main__':
    unittest.main()
