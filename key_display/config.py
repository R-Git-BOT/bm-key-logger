import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping

from .constants import ANALOG_BINDINGS, LANE_COUNT


class ConfigError(ValueError):
    """Raised when config.json cannot be used by the input display."""


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

        return cls(
            font_name=font_name,
            speed=float(speed),
            screen_height=screen_height,
            threshold=float(threshold),
            joypad=joypad,
            keyboard=keyboard,
        )
