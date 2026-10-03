import unittest
from build import clock, unfold, Builder
from datetime import time

class TimetableTests(unittest.TestCase):
    def test_midnight_only_for_large_jump(self):
        stops=unfold([{'station':'A','departure':23*3600},{'station':'B','arrival':3600}])
        self.assertEqual(stops[1]['arrival'],25*3600)
        with self.assertRaisesRegex(ValueError,'Non-monotonic'):
            unfold([{'station':'A','departure':10*3600},{'station':'B','arrival':9*3600}])

    def test_preserve_half_minutes_and_gtfs_extended_hours(self):
        self.assertEqual(clock(time(7,16,30)),26190)
        self.assertEqual(clock('25:20:00'),91200)
        self.assertIsNone(clock('12:99'))

    def test_bad_trip_is_quarantined(self):
        b=Builder()
        b.add('source','X','JP',[{'station':'A','departure':36000},{'station':'B','arrival':35000}])
        self.assertEqual(b.trips,[])
        self.assertEqual(len(b.review),1)

if __name__=='__main__':unittest.main()
