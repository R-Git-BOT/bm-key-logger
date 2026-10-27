import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping, Optional

from .constants import ANALOG_BINDINGS, LANE_COUNT


class ConfigError(ValueError):
    """Raised when config.json cannot be used by the input display."""


GAME_PROVIDERS = frozenset(("none", "oraja_bridge", "screen_template"))
REPLAY_GAMES = frozenset(("oraja", "iidx"))


@dataclass(frozen=True)
class GameMonitorConfig:
    """Optional source of the current game state.

    Paths are resolved from the directory that contains ``config.json``.
    """

    provider: str = "none"
    bridge_state_path: Optional[str] = None
    screen_profile_path: Optional[str] = None
    poll_interval_ms: int = 250
    hide_when_not_playing: bool = False
    calibration_hotkey: str = "F8"

    @property
    def is_enabled(self) -> bool:
        return self.provider != "none"


@dataclass(frozen=True)
class ReplayLogConfig:
    """Optional persistent input log written once for every detected play."""

    enabled: bool = False
    game: Optional[str] = None

    @property
    def directory_name(self) -> str:
        return "Oraja" if self.game == "oraja" else "IIDX"


def _require_lanes(value: Any, field_name: str) -> List[List[Any]]:
    if not isinstance(value, list) or len(value) != LANE_COUNT:
        raise ConfigError("{} must contain exactly {} lanes.".format(field_name, LANE_COUNT))
    if not all(isinstance(bindings, list) for bindings in value):
        raise ConfigError("Every {} lane must be an array.".format(field_name))
    return value


def _validate_keyboard_bindings(keyboard: List[List[Any]]) -> None:
    for lane, bindings in enumerate(keyboard):
        for binding in bindings:
            if not isinstance(binding, str):
                raise ConfigError("keyboard lane {} contains a non-string binding.".format(lane))
            try:
                int(binding, 16)
            except ValueError:
                raise ConfigError(
                    "keyboard lane {} contains an invalid virtual-key code: {!r}.".format(
                        lane, binding
                    )
                )


def _validate_joypad_bindings(joypad: List[List[List[Any]]]) -> None:
    for controller, lanes in enumerate(joypad):
        _require_lanes(lanes, "joypad controller {}".format(controller))
        for lane, bindings in enumerate(lanes):
            for binding in bindings:
                if isinstance(binding, int) and binding > 0:
                    continue
                if isinstance(binding, str) and binding in ANALOG_BINDINGS:
                    continue
                raise ConfigError(
                    "joypad controller {}, lane {} contains an invalid binding: {!r}.".format(
                        controller, lane, binding
                    )
                )


@dataclass(frozen=True)
class AppConfig:
    font_name: str
    speed: float
    screen_height: int
    threshold: float
    joypad: List[List[List[Any]]]
    keyboard: List[List[str]]
    game_monitor: GameMonitorConfig = GameMonitorConfig()
    replay_log: ReplayLogConfig = ReplayLogConfig()

    @classmethod
    def from_file(cls, path: Path) -> "AppConfig":
        try:
            with path.open(encoding="utf-8") as config_file:
                raw_config = json.load(config_file)
        except OSError as error:
            raise ConfigError("Could not read {}: {}".format(path, error))
        except json.JSONDecodeError as error:
            raise ConfigError("{} is not valid JSON: {}".format(path, error))

        return cls.from_mapping(raw_config)

    @classmethod
    def from_mapping(cls, raw_config: Mapping[str, Any]) -> "AppConfig":
        if not isinstance(raw_config, Mapping):
            raise ConfigError("The configuration root must be an object.")

        required_fields = (
            "font_name", "speed", "screen_height", "threshold", "joypad", "keyboard"
        )
        missing_fields = [field for field in required_fields if field not in raw_config]
        if missing_fields:
            raise ConfigError("Missing configuration fields: {}.".format(", ".join(missing_fields)))

        keyboard = _require_lanes(raw_config["keyboard"], "keyboard")
        joypad = raw_config["joypad"]
        if not isinstance(joypad, list):
            raise ConfigError("joypad must be an array of controller mappings.")

        _validate_keyboard_bindings(keyboard)
        _validate_joypad_bindings(joypad)

        font_name = raw_config["font_name"]
        speed = raw_config["speed"]
        screen_height = raw_config["screen_height"]
        threshold = raw_config["threshold"]
        if not isinstance(font_name, str):
            raise ConfigError("font_name must be a string.")
        if not isinstance(speed, (int, float)) or speed <= 0:
            raise ConfigError("speed must be a positive number.")
        if not isinstance(screen_height, int) or screen_height <= 0:
            raise ConfigError("screen_height must be a positive integer.")
        if not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
            raise ConfigError("threshold must be a number from 0 to 1.")

        game_monitor = _parse_game_monitor(raw_config.get("game_monitor", {}))
        replay_log = _parse_replay_log(raw_config.get("replay_log", {}))
        if replay_log.enabled and not game_monitor.is_enabled:
            raise ConfigError("replay_log.enabled requires an enabled game_monitor.")

        return cls(
            font_name=font_name,
            speed=float(speed),
            screen_height=screen_height,
            threshold=float(threshold),
            joypad=joypad,
            keyboard=keyboard,
            game_monitor=game_monitor,
            replay_log=replay_log,
        )


def _parse_game_monitor(value: Any) -> GameMonitorConfig:
    if value is None:
        return GameMonitorConfig()
    if not isinstance(value, Mapping):
        raise ConfigError("game_monitor must be an object.")

    provider = value.get("provider", "none")
    if provider not in GAME_PROVIDERS:
        raise ConfigError(
            "game_monitor.provider must be one of: {}.".format(
                ", ".join(sorted(GAME_PROVIDERS))
            )
        )

    bridge_state_path = value.get("bridge_state_path")
    screen_profile_path = value.get("screen_profile_path")
    for field_name, field_value in (
        ("bridge_state_path", bridge_state_path),
        ("screen_profile_path", screen_profile_path),
    ):
        if field_value is not None and not isinstance(field_value, str):
            raise ConfigError("game_monitor.{} must be a string.".format(field_name))

    if provider == "oraja_bridge" and not bridge_state_path:
        raise ConfigError("oraja_bridge requires game_monitor.bridge_state_path.")
    if provider == "screen_template" and not screen_profile_path:
        raise ConfigError("screen_template requires game_monitor.screen_profile_path.")

    poll_interval_ms = value.get("poll_interval_ms", 250)
    if not isinstance(poll_interval_ms, int) or poll_interval_ms < 50:
        raise ConfigError("game_monitor.poll_interval_ms must be an integer of at least 50.")

    hide_when_not_playing = value.get("hide_when_not_playing", False)
    if not isinstance(hide_when_not_playing, bool):
        raise ConfigError("game_monitor.hide_when_not_playing must be true or false.")

    calibration_hotkey = value.get("calibration_hotkey", "F8")
    if not isinstance(calibration_hotkey, str) or not calibration_hotkey:
        raise ConfigError("game_monitor.calibration_hotkey must be a non-empty string.")

    return GameMonitorConfig(
        provider=provider,
        bridge_state_path=bridge_state_path,
        screen_profile_path=screen_profile_path,
        poll_interval_ms=poll_interval_ms,
        hide_when_not_playing=hide_when_not_playing,
        calibration_hotkey=calibration_hotkey.upper(),
    )


def _parse_replay_log(value: Any) -> ReplayLogConfig:
    if value is None:
        return ReplayLogConfig()
    if not isinstance(value, Mapping):
        raise ConfigError("replay_log must be an object.")

    enabled = value.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ConfigError("replay_log.enabled must be true or false.")
    game = value.get("game")
    if game is not None:
        if not isinstance(game, str) or game.lower() not in REPLAY_GAMES:
            raise ConfigError("replay_log.game must be one of: iidx, oraja.")
        game = game.lower()
    if enabled and not game:
        raise ConfigError("replay_log.game is required when replay_log.enabled is true.")
    return ReplayLogConfig(enabled=enabled, game=game)
