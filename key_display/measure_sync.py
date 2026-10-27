"""High-frequency visual anchors from IIDX measure lines.

The capture adapter is deliberately separate from timing estimation.  It emits
only QPC timestamps for visual crossings; the future chart viewer will match
those anchors against chart bars and expose the final manual offset slider.
"""

import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from .config import MeasureSyncConfig
from .screen_monitor import NormalizedRegion, ScreenProfile


class MeasureLineDetector:
    """Detects a bright, lane-wide measure line in already-cropped frames."""

    def __init__(self, bright_threshold: int, minimum_bright_fraction: float, cooldown_ms: int):
        self.bright_threshold = bright_threshold
        self.minimum_bright_fraction = minimum_bright_fraction
        self.cooldown_ns = cooldown_ms * 1_000_000
        self._was_present = False
        self._last_crossing_ns: Optional[int] = None

    def observe(self, frame, timestamp_ns: int) -> bool:
        """Return True once when the selected line enters the observation band."""
        # dxcam gives an ndarray in BGR/RGB.  Averaging channels intentionally
        # avoids tying the detector to a skin-specific measure-line color.
        brightness = frame[..., :3].mean(axis=2)
        fraction = float((brightness >= self.bright_threshold).mean())
        present = fraction >= self.minimum_bright_fraction
        crossing = (
            present
            and not self._was_present
            and (
                self._last_crossing_ns is None
                or timestamp_ns - self._last_crossing_ns >= self.cooldown_ns
            )
        )
        self._was_present = present
        if crossing:
            self._last_crossing_ns = timestamp_ns
        return crossing


@dataclass(frozen=True)
class MeasureSyncStatus:
    running: bool = False
    message: str = ""


class MeasureSyncService:
    """Owns a capture thread and exposes collected marker timestamps via poll."""

    def __init__(self, config: MeasureSyncConfig, profile_path: Path):
        self.config = config
        self.profile_path = profile_path
        self._markers: "queue.SimpleQueue[int]" = queue.SimpleQueue()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.status = MeasureSyncStatus()

    def start(self) -> bool:
        if not self.config.enabled:
            return False
        if self._thread is not None and self._thread.is_alive():
            return True
        try:
            profile = ScreenProfile.from_file(self.profile_path)
            if profile.measure_line_region is None:
                self.status = MeasureSyncStatus(False, "小節線の観測領域が未設定です。F8で設定してください。")
                return False
        except ValueError as error:
            self.status = MeasureSyncStatus(False, str(error))
            return False
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(profile.measure_line_region,),
            name="BMKeyDisplayMeasureSync",
            daemon=True,
        )
        self._thread.start()
        self.status = MeasureSyncStatus(True, "小節線同期を開始しました。")
        return True

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self._thread = None
        if self.config.enabled:
            self.status = MeasureSyncStatus(False, "小節線同期を停止しました。")

    def poll(self) -> List[int]:
        markers = []
        while True:
            try:
                markers.append(self._markers.get_nowait())
            except queue.Empty:
                return markers

    def _run(self, region: NormalizedRegion) -> None:
        try:
            import dxcam
        except ImportError:
            self.status = MeasureSyncStatus(False, "dxcamが必要です。requirements.txtを再インストールしてください。")
            return
        try:
            camera = dxcam.create(output_idx=0, output_color="BGR")
            first_frame = self._wait_for_frame(camera)
            if first_frame is None:
                self.status = MeasureSyncStatus(False, "画面キャプチャを開始できませんでした。")
                return
            height, width = first_frame.shape[:2]
            capture_region = _pixel_region(region, width, height)
            detector = MeasureLineDetector(
                self.config.bright_threshold,
                self.config.minimum_bright_fraction,
                self.config.cooldown_ms,
            )
            interval = 1.0 / self.config.capture_fps
            next_capture_at = time.perf_counter()
            while not self._stop.is_set():
                frame = camera.grab(region=capture_region)
                timestamp_ns = time.perf_counter_ns()
                if frame is not None and detector.observe(frame, timestamp_ns):
                    self._markers.put(timestamp_ns)
                next_capture_at += interval
                remaining = next_capture_at - time.perf_counter()
                if remaining > 0:
                    self._stop.wait(remaining)
                elif remaining < -interval:
                    next_capture_at = time.perf_counter()
            camera.release()
        except Exception as error:  # pragma: no cover - graphics-driver dependent
            self.status = MeasureSyncStatus(False, "小節線キャプチャのエラー: {}".format(error))

    def _wait_for_frame(self, camera):
        deadline = time.perf_counter() + 2.0
        while not self._stop.is_set() and time.perf_counter() < deadline:
            frame = camera.grab()
            if frame is not None:
                return frame
            self._stop.wait(0.01)
        return None


def _pixel_region(region: NormalizedRegion, width: int, height: int):
    left, top, right, bottom = region.box_for((width, height))
    return left, top, right, bottom
