import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from key_display.config import ReplayLogConfig
from key_display.game_state import GameState
from key_display.replay import LaneInputEvent, ReplayRecorder, iidx_chart_name


class ReplayRecorderTests(unittest.TestCase):
    def test_writes_requested_iidx_path_and_normalizes_chart_name(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1]) as directory:
            recorder = ReplayRecorder(
                ReplayLogConfig(enabled=True, game="iidx"),
                Path(directory),
                now=lambda: datetime(2026, 10, 27, 12, 34, 56),
            )
            recorder.observe(GameState(phase="playing", title='A:B', difficulty="ANOTHER"), 1_000_000)
            recorder.record(LaneInputEvent(2, True, 1_234_000, "keyboard"))
            path = recorder.observe(GameState(phase="result"), 2_000_000)

            self.assertEqual(
                path.relative_to(directory).as_posix(),
                "IIDX/20261027-123456-A_B-A-log.json",
            )
            payload = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(payload["song"], {"title": "A:B", "chart": "A"})
        self.assertEqual(payload["events"], [{"t_us": 234, "lane": 2, "pressed": True, "source": "keyboard"}])

    def test_writes_oraja_chart_name_without_iidx_conversion(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1]) as directory:
            recorder = ReplayRecorder(
                ReplayLogConfig(enabled=True, game="oraja"),
                Path(directory),
                now=lambda: datetime(2026, 10, 27, 1, 2, 3),
            )
            recorder.observe(GameState(phase="playing", title="Giselle", difficulty="Leggiero"), 0)
            path = recorder.observe(GameState(phase="result"), 10)

            self.assertEqual(
                path.relative_to(directory).as_posix(),
                "Oraja/20261027-010203-Giselle-Leggiero-log.json",
            )

    def test_maps_iidx_ocr_labels_to_filename_symbols(self):
        self.assertEqual(iidx_chart_name("NORMAL"), "N")
        self.assertEqual(iidx_chart_name("HYPER 10"), "H")
        self.assertEqual(iidx_chart_name("ANOTHER"), "A")
        self.assertEqual(iidx_chart_name("LEGGENDARIA"), "L")
