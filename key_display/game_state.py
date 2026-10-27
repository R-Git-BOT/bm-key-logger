"""Game-state providers used to decide when the input display is visible."""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional

from .config import GameMonitorConfig


PLAYING_PHASE = "playing"
KNOWN_PHASES = frozenset(("idle", "select", "decide", PLAYING_PHASE, "result", "unknown"))


@dataclass(frozen=True)
class GameState:
    phase: str = "unknown"
    title: str = ""
    artist: str = ""
    difficulty: str = ""
    source: str = ""
    message: str = ""

    @property
    def is_playing(self) -> bool:
        return self.phase == PLAYING_PHASE


class GameStateProvider:
    def get_state(self) -> GameState:
        raise NotImplementedError


class AlwaysVisibleProvider(GameStateProvider):
    def get_state(self) -> GameState:
        return GameState(phase=PLAYING_PHASE, source="disabled")


class OrajaBridgeProvider(GameStateProvider):
    """Reads the compact JSON state file written by the bundled Lua helper."""

    def __init__(self, path: Path, poll_interval_ms: int = 250):
        self.path = path
        self.poll_interval = poll_interval_ms / 1000.0
        self._next_poll_at = 0.0
        self._state = GameState(source="oraja_bridge", message="Waiting for bridge state file.")

    def get_state(self) -> GameState:
        now = time.monotonic()
        if now < self._next_poll_at:
            return self._state
        self._next_poll_at = now + self.poll_interval

        try:
            with self.path.open(encoding="utf-8") as state_file:
                payload = json.load(state_file)
            self._state = _state_from_bridge_payload(payload)
        except FileNotFoundError:
            self._state = GameState(
                source="oraja_bridge", message="Bridge state file was not found: {}".format(self.path)
            )
        except (OSError, json.JSONDecodeError, ValueError) as error:
            # The Lua helper can be in the middle of writing the file.  Keep
            # polling instead of bringing down the input display.
            self._state = GameState(source="oraja_bridge", message="Could not read bridge state: {}".format(error))
        return self._state


def _state_from_bridge_payload(payload: Any) -> GameState:
    if not isinstance(payload, Mapping):
        raise ValueError("Bridge JSON must be an object.")

    phase = payload.get("state", "unknown")
    # DmNote's established beatoraja bridge uses "play"; accept it as an
    # interoperable alias in addition to this project's "playing" spelling.
    if phase == "play":
        phase = PLAYING_PHASE
    if phase not in KNOWN_PHASES:
        phase = "unknown"
    song = payload.get("song", {})
    if not isinstance(song, Mapping):
        song = {}

    def text(name: str) -> str:
        value = song.get(name, "")
        return value if isinstance(value, str) else ""

    return GameState(
        phase=phase,
        title=text("title"),
        artist=text("artist"),
        difficulty=text("difficulty") or text("level"),
        source="oraja_bridge",
    )


def build_game_state_provider(config: GameMonitorConfig, base_directory: Path) -> GameStateProvider:
    if config.provider == "oraja_bridge":
        return OrajaBridgeProvider(_resolve_path(base_directory, config.bridge_state_path), config.poll_interval_ms)
    if config.provider == "screen_template":
        from .screen_monitor import ScreenTemplateProvider

        return ScreenTemplateProvider(
            _resolve_path(base_directory, config.screen_profile_path), config.poll_interval_ms
        )
    return AlwaysVisibleProvider()


def _resolve_path(base_directory: Path, value: Optional[str]) -> Path:
    if not value:
        raise ValueError("A game-monitor path is required.")
    path = Path(value)
    return path if path.is_absolute() else base_directory / path
