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

    def test_loads_oraja_bridge_monitor(self):
        config = valid_config()
        config["game_monitor"] = {
            "provider": "oraja_bridge",
            "bridge_state_path": "profiles/oraja-state.json",
            "hide_when_not_playing": True,
        }

        loaded = AppConfig.from_mapping(config)

        self.assertEqual(loaded.game_monitor.provider, "oraja_bridge")
        self.assertTrue(loaded.game_monitor.hide_when_not_playing)

    def test_loads_replay_log_configuration(self):
        config = valid_config()
        config["game_monitor"] = {
            "provider": "screen_template",
            "screen_profile_path": "profiles/iidx.json",
        }
        config["replay_log"] = {"enabled": True, "game": "IIDX"}

        loaded = AppConfig.from_mapping(config)

        self.assertTrue(loaded.replay_log.enabled)
        self.assertEqual(loaded.replay_log.directory_name, "IIDX")

    def test_requires_game_when_replay_log_is_enabled(self):
        config = valid_config()
        config["replay_log"] = {"enabled": True}

        with self.assertRaisesRegex(ConfigError, "game is required"):
            AppConfig.from_mapping(config)

    def test_requires_game_monitor_when_replay_log_is_enabled(self):
        config = valid_config()
        config["replay_log"] = {"enabled": True, "game": "oraja"}

        with self.assertRaisesRegex(ConfigError, "requires an enabled game_monitor"):
            AppConfig.from_mapping(config)
