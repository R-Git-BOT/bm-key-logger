"""Passive RANDOM lane-layout inference shared by IIDX and Oraja.

The detector deliberately receives *screen observations*, not controller
events.  It learns the sequence of simultaneous notes in a REGULAR/MIRROR
play, then eliminates the 7! possible mappings during a RANDOM play.  This
matches the proven method used by inf_daken_counter_obsw while keeping this
application free of game hooks and memory reads.
"""

import itertools
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Set, Tuple


LANES = tuple(range(1, 8))
REGULAR_LAYOUT = "1234567"
MIRROR_LAYOUT = "7654321"


def layout_text(permutation: Sequence[int]) -> str:
    """Return the original key number under each displayed key."""
    return "".join(str(permutation.index(original) + 1) for original in LANES)


class NormalChartRecorder:
    """Collect distinct simultaneous-note events from a regular play."""

    def __init__(self) -> None:
        self.events: List[Tuple[int, ...]] = []
        self._seen: Set[int] = set()

    def add(self, lanes: Iterable[int]) -> bool:
        event = tuple(sorted(set(int(lane) for lane in lanes if int(lane) in LANES)))
        if not event:
            return False
        self.events.append(event)
        self._seen.update(event)
        return self._seen == set(LANES) and self._identity_is_unique()

    def _identity_is_unique(self) -> bool:
        for candidate in itertools.permutations(LANES):
            if candidate == LANES:
                continue
            if all({candidate[lane - 1] for lane in event} == set(event) for event in self.events):
                return False
        return True


class RandomMappingAnalyzer:
    """Narrow every lane permutation using matching normal/RANDOM events."""

    def __init__(self, normal_events: Iterable[Iterable[int]]) -> None:
        self.normal_events = [tuple(sorted(set(event))) for event in normal_events]
        self.candidates: List[Tuple[int, ...]] = list(itertools.permutations(LANES))
        self.index = 0
        self.layout: Optional[str] = None
        self.failure_reason: Optional[str] = None

    @property
    def complete(self) -> bool:
        return self.layout is not None

    @property
    def failed(self) -> bool:
        return self.failure_reason is not None

    def add(self, observed_lanes: Iterable[int]) -> None:
        if self.complete or self.failed:
            return
        if self.index >= len(self.normal_events):
            self.failure_reason = "正規譜面データの末尾までに配置を確定できませんでした"
            return
        normal = set(self.normal_events[self.index])
        observed = {int(lane) for lane in observed_lanes if int(lane) in LANES}
        event_number = self.index + 1
        self.index += 1
        if len(normal) != len(observed):
            self.candidates = []
        else:
            self.candidates = [
                candidate
                for candidate in self.candidates
                if {candidate[lane - 1] for lane in normal} == observed
            ]
        if not self.candidates:
            self.failure_reason = "イベント{}: 正規{} / 観測{}".format(
                event_number, sorted(normal), sorted(observed)
            )
        elif len(self.candidates) == 1:
            self.layout = layout_text(self.candidates[0])

    def partial_layout(self) -> Optional[str]:
        """Known key digits, W/B color certainty, or '?' for each display lane."""
        if not self.candidates:
            return None
        positions = [set() for _ in LANES]
        for candidate in self.candidates:
            for original, target in enumerate(candidate, 1):
                positions[target - 1].add(original)
        text = "".join(
            str(next(iter(keys))) if len(keys) == 1 else
            "W" if all(key % 2 for key in keys) else
            "B" if all(key % 2 == 0 for key in keys) else "?"
            for keys in positions
        )
        return None if text == "???????" else text


@dataclass(frozen=True)
class RandomLaneUpdate:
    status: str
    layout: str = ""
    message: str = ""


class RandomLaneSession:
    """Small state machine used by capture adapters or the chart viewer.

    ``arrangement`` is passed by the adapter after it recognizes the game's
    option display.  The inference itself is game-neutral and testable without
    a game window.
    """

    def __init__(self, normal_events: Optional[Iterable[Iterable[int]]] = None) -> None:
        self.recorder: Optional[NormalChartRecorder] = None
        self.analyzer: Optional[RandomMappingAnalyzer] = None
        self.normal_events = [tuple(event) for event in normal_events] if normal_events else []
        self.arrangement = ""

    def start(self, arrangement: str) -> RandomLaneUpdate:
        self.arrangement = arrangement.upper()
        self.recorder = None
        self.analyzer = None
        if self.arrangement == "REGULAR":
            self.recorder = NormalChartRecorder()
            return RandomLaneUpdate("recording", REGULAR_LAYOUT, "正規配置を記録中")
        if self.arrangement == "MIRROR":
            self.recorder = NormalChartRecorder()
            return RandomLaneUpdate("recording", MIRROR_LAYOUT, "MIRROR配置を正規譜面として記録中")
        if self.arrangement in {"RANDOM", "R-RANDOM"}:
            if not self.normal_events:
                return RandomLaneUpdate("needs_normal", message="先にREGULARまたはMIRRORで譜面を登録してください")
            self.analyzer = RandomMappingAnalyzer(self.normal_events)
            return RandomLaneUpdate("analyzing", message="RANDOM配置を解析中")
        return RandomLaneUpdate("unsupported", message="{}は配置認識の対象外です".format(arrangement))

    def observe(self, lanes: Iterable[int]) -> Optional[RandomLaneUpdate]:
        observed = tuple(sorted(set(int(lane) for lane in lanes if int(lane) in LANES)))
        if not observed:
            return None
        if self.recorder:
            normalized = tuple(8 - lane for lane in observed) if self.arrangement == "MIRROR" else observed
            if self.recorder.add(normalized):
                self.normal_events = list(self.recorder.events)
                layout = MIRROR_LAYOUT if self.arrangement == "MIRROR" else REGULAR_LAYOUT
                return RandomLaneUpdate("registered", layout, "正規譜面データを登録しました")
            return RandomLaneUpdate("recording", MIRROR_LAYOUT if self.arrangement == "MIRROR" else REGULAR_LAYOUT)
        if self.analyzer:
            self.analyzer.add(observed)
            if self.analyzer.complete:
                return RandomLaneUpdate("confirmed", self.analyzer.layout or "", "RANDOM配置を確定しました")
            if self.analyzer.failed:
                return RandomLaneUpdate("failed", self.analyzer.partial_layout() or "", self.analyzer.failure_reason or "")
            return RandomLaneUpdate("partial", self.analyzer.partial_layout() or "", "RANDOM配置を解析中")
        return None
