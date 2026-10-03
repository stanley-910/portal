"""Offline regression checks for public timetable discovery and evidence integrity."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("capture_rail", Path(__file__).with_name("capture-rail.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_mtr_ignores_commented_out_historical_downloads(self):
        html = '''<!-- <a href="/old.pdf">2024</a> -->
        <a href="/current.pdf"><span>Current</span></a>
        <a href="/next.pdf">Next revision</a>'''
        self.assertEqual(list(capture.discover("mtr", html, "https://operator.test/times")), [
            ("Current", "https://operator.test/current.pdf"),
            ("Next revision", "https://operator.test/next.pdf"),
        ])

    def test_sr_discovers_new_revision_instead_of_pinning_september(self):
        html = '''<a onclick="JBCMS.downloadAttach('PAGE', '29')">2026. 09. 01. 기준</a>
        <a onclick="JBCMS.downloadAttach('PAGE', '30')">2026. 10. 11. 기준</a>'''
        rows = list(capture.discover("sr", html, "https://etk.srail.kr/"))
        self.assertEqual(len(rows), 1)
        self.assertIn("atchNo=30", rows[0][1])

    def test_korail_keeps_current_categories_and_rejects_missing_category(self):
        rows = [
            {"bdTitle": "KTX 시간표 old", "bdIdx": 1, "fileId": ["jfile/old.xlsx"]},
            {"bdTitle": "KTX 시간표 new", "bdIdx": 3, "fileId": ["jfile/new.xlsx"]},
            {"bdTitle": "일반열차 시간표", "bdIdx": 2, "fileId": ["jfile/regular.xlsx"]},
        ]
        found = list(capture.discover("korail", json.dumps({"boardList": rows}), "https://www.korail.com/"))
        self.assertEqual([label for label, _ in found], ["KTX 시간표 new", "일반열차 시간표"])
        with self.assertRaisesRegex(ValueError, "Missing Korail"):
            list(capture.discover("korail", '{"boardList": []}', "https://www.korail.com/"))

    def test_integrity_rejects_changed_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            file = root / "source.pdf"
            file.write_bytes(b"original")
            manifest = {"sources": [{"assets": [{"path": "source.pdf", "sha256": capture.hashlib.sha256(b"original").hexdigest()}]}]}
            with patch.object(capture, "ROOT", root), patch.object(capture, "OUT", root):
                self.assertEqual(capture.verify(manifest), 1)
                file.write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "Hash mismatch"):
                    capture.verify(manifest)

    def test_ktmb_excludes_commented_and_previous_year_downloads(self):
        html = '''<!-- <a data-dl="/2026/old.pdf">Old</a> -->
        <a data-dl="/2025/previous.pdf">Previous year</a>
        <a data-dl="/2026/current.pdf">Effective October</a>'''
        self.assertEqual(list(capture.discover("ktmb-published", html, "https://operator.test/")),
                         [("Effective October", "https://operator.test/2026/current.pdf")])

    def test_korail_fares_accept_legacy_workbook_without_selecting_timetable(self):
        rows = [
            {"bdTitle": "KTX 운임표", "bdIdx": 2, "fileId": ["jfile/fares.xls"]},
            {"bdTitle": "일반열차(ITX-마음) 운임표", "bdIdx": 3, "fileId": ["jfile/regular.xlsx"]},
            {"bdTitle": "KTX 시간표", "bdIdx": 4, "fileId": ["jfile/timetable.xlsx"]},
        ]
        found = list(capture.discover("korail-fares", json.dumps({"boardList": rows}), "https://operator.test/"))
        self.assertEqual(len(found), 2)
        self.assertTrue(found[0][1].endswith("fares.xls"))


if __name__ == "__main__":
    unittest.main()
