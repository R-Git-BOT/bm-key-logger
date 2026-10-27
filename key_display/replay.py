"""Persistent, game-neutral input logs for later chart-timing analysis."""

import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional

from .config import ReplayLogConfig
from .game_state import GameState


INVALID_FILENAME_CHARACTERS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WHITESPACE = re.compile(r"\s+")
IIDX_CHART_NAMES = (
    ("LEGGENDARIA", "L"),
    ("ANOTHER", "A"),
    ("HYPER", "H"),
    ("NORMAL", "N"),
)


@dataclass(frozen=True)
class LaneInputEvent:
    """A state transition on one display lane, timestamped by the input adapter."""

    lane: int
    pressed: bool
    timestamp_ns: int
    source: str


def sanitize_filename_component(value: str, fallback: str) -> str:
    sanitized = INVALID_FILENAME_CHARACTERS.sub("_", value.strip())
    sanitized = WHITESPACE.sub(" ", sanitized).strip(". ")
    return sanitized or fallback


def iidx_chart_name(value: str) -> str:
    normalized = value.strip().upper()
    if normalized in {"N", "H", "A", "L"}:
        return normalized
    for label, shorthand in IIDX_CHART_NAMES:
        if label in normalized:
            return shorthand
    return "unknown-chart"


class ReplayRecorder:
    """Writes one completed play with a small ``observe``/``record`` interface.

    Files are only made visible after an atomic replacement succeeds.  Events
    stay in memory for the current song, avoiding disk work on every key press.
    """

    def __init__(
        self,
        config: ReplayLogConfig,
        base_directory: Path,
        now: Callable[[], datetime] = datetime.now,
    ):
        self.config = config
        self.base_directory = base_directory
        self._now = now
        self._started_at_ns: Optional[int] = None
        self._started_at_wall_clock: Optional[datetime] = None
        self._state: Optional[GameState] = None
        self._events: List[LaneInputEvent] = []
        self._sync_markers_ns: List[int] = []
        self.last_saved_path: Optional[Path] = None

    @property
    def is_recording(self) -> bool:
        return self._started_at_ns is not None

    def observe(self, state: GameState, timestamp_ns: int) -> Optional[Path]:
        if not self.config.enabled:
            return None
        if state.is_playing and not self.is_recording:
            self._started_at_ns = timestamp_ns
            self._started_at_wall_clock = self._now()
            self._state = state
            self._events = []
            self._sync_markers_ns = []
            return None
        if not state.is_playing and self.is_recording:
            return self.finish(timestamp_ns)
        return None

    def record(self, event: LaneInputEvent) -> None:
        if self.is_recording:
            self._events.append(event)

    def record_measure_line(self, timestamp_ns: int) -> None:
        """Persist a visual time anchor from the IIDX playfield."""
        if self.is_recording:
            self._sync_markers_ns.append(timestamp_ns)

    def finish(self, finished_at_ns: int) -> Optional[Path]:
        if not self.is_recording:
            return None
        assert self._started_at_ns is not None
        assert self._started_at_wall_clock is not None
        assert self._state is not None
        state = self._state
        started_at_ns = self._started_at_ns
        started_at = self._started_at_wall_clock
        payload = {
            "format": "bm-key-display-input-v1",
            "game": self.config.directory_name,
            "started_at": started_at.isoformat(timespec="seconds"),
            "duration_us": max(0, (finished_at_ns - started_at_ns) // 1_000),
            "song": {"title": state.title, "chart": self._chart_name(state.difficulty)},
            "events": [
                {
                    "t_us": max(0, (event.timestamp_ns - started_at_ns) // 1_000),
                    "lane": event.lane,
                    "pressed": event.pressed,
                    "source": event.source,
                }
                for event in self._events
            ],
            "sync_markers": [
                {"kind": "measure_line", "t_us": max(0, (timestamp - started_at_ns) // 1_000)}
                for timestamp in self._sync_markers_ns
            ],
        }
        path = self._build_path(started_at, state)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._write_atomically(path, payload)
        self.last_saved_path = path
        self._started_at_ns = None
        self._started_at_wall_clock = None
        self._state = None
        self._events = []
        self._sync_markers_ns = []
        return path

    def _chart_name(self, value: str) -> str:
        if self.config.game == "iidx":
            return iidx_chart_name(value)
        return value or "unknown-chart"

    def _build_path(self, started_at: datetime, state: GameState) -> Path:
        title = sanitize_filename_component(state.title, "unknown-song")
        chart = sanitize_filename_component(self._chart_name(state.difficulty), "unknown-chart")
        filename = "{}-{}-{}-log.json".format(started_at.strftime("%Y%m%d-%H%M%S"), title, chart)
        return self.base_directory / self.config.directory_name / filename

    @staticmethod
    def _write_atomically(path: Path, payload: object) -> None:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".bm-key-display-", suffix=".json", dir=str(path.parent)
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
                json.dump(payload, output, ensure_ascii=False, indent=2)
                output.write("\n")
            Path(temporary_name).replace(path)
        except BaseException:
            Path(temporary_name).unlink(missing_ok=True)
            raise
