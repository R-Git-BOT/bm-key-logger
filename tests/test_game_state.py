import json
import tempfile
import unittest
from pathlib import Path

from key_display.game_state import OrajaBridgeProvider, _state_from_bridge_payload
from key_display.screen_monitor import NormalizedRegion, ScreenProfile, image_similarity


class GameStateTests(unittest.TestCase):
    def test_reads_playing_song_from_oraja_bridge_payload(self):
        state = _state_from_bridge_payload(
            {
                "state": "playing",
                "song": {"title": "Test Song", "artist": "Test Artist", "difficulty": "Another"},
            }
        )

        self.assertTrue(state.is_playing)
        self.assertEqual(state.title, "Test Song")
        self.assertEqual(state.artist, "Test Artist")
        self.assertEqual(state.difficulty, "Another")

    def test_accepts_dmnote_play_state_for_bridge_interoperability(self):
        state = _state_from_bridge_payload({"state": "play", "song": {}})

        self.assertTrue(state.is_playing)

    def test_bridge_provider_reads_json_file(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1]) as directory:
            state_path = Path(directory) / "oraja-state.json"
            state_path.write_text(json.dumps({"state": "result", "song": {"title": "Done"}}), encoding="utf-8")

            state = OrajaBridgeProvider(state_path, poll_interval_ms=50).get_state()

        self.assertEqual(state.phase, "result")
        self.assertEqual(state.title, "Done")

    def test_normalized_regions_round_trip(self):
        region = NormalizedRegion.from_pixels(100, 200, 400, 500, (1000, 1000))
        profile = ScreenProfile(
            region,
            "indicator.png",
            title_region=region,
            chart_region=region,
            chart_ocr_language="eng",
        )

        restored = ScreenProfile.from_file(self._write_profile(profile))

        self.assertEqual(restored.play_indicator_region.box_for((1000, 1000)), (100, 200, 400, 500))
        self.assertEqual(restored.chart_region, region)
        self.assertEqual(restored.chart_ocr_language, "eng")

    def test_image_similarity_is_one_for_identical_images(self):
        from PIL import Image

        image = Image.new("RGB", (4, 4), "navy")

        self.assertEqual(image_similarity(image, image.copy()), 1.0)

    def _write_profile(self, profile):
        directory = tempfile.TemporaryDirectory(dir=Path(__file__).parents[1])
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "profile.json"
        path.write_text(json.dumps(profile.to_mapping()), encoding="utf-8")
        return path
