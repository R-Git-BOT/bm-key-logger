import unittest
from pathlib import Path

from key_display.config import AppConfig, ConfigError


def valid_config():
    return {
        "font_name": "",
        "speed": 720,
        "screen_height": 720,
        "threshold": 0.9,
        "joypad": [[[] for _ in range(18)]],
        "keyboard": [[] for _ in range(18)],
    }


class AppConfigTests(unittest.TestCase):
    def test_loads_project_config_file(self):
        project_config = Path(__file__).parents[1] / "config.json"

        loaded = AppConfig.from_file(project_config)

        self.assertEqual(len(loaded.keyboard), 18)
        self.assertEqual(len(loaded.joypad), 2)

    def test_loads_legacy_config_shape(self):
        config = valid_config()
        config["keyboard"][0] = ["A0"]
        config["joypad"][0][1] = ["-x", 3]

        loaded = AppConfig.from_mapping(config)

        self.assertEqual(loaded.speed, 720.0)
        self.assertEqual(loaded.keyboard[0], ["A0"])
        self.assertEqual(loaded.joypad[0][1], ["-x", 3])

    def test_rejects_incomplete_lane_configuration(self):
        config = valid_config()
        config["keyboard"] = [[] for _ in range(17)]

        with self.assertRaisesRegex(ConfigError, "exactly 18 lanes"):
            AppConfig.from_mapping(config)
