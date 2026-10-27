import datetime
import time
from collections import deque
from pathlib import Path
from typing import Deque, List

import pyglet

from .config import AppConfig
from .calibration import ScreenCalibration
from .constants import (
    LANE_COUNT,
    LANE_X_POSITIONS,
    SCREEN_TITLE,
    SCREEN_WIDTH,
    SCRATCH_LANES,
    WHITE_KEY_LANES,
)
from .input import InputService
from .game_state import GameState, build_game_state_provider
from .hotkey import RisingEdgeHotkey
from .replay import ReplayRecorder


def load_centered_image(path: Path):
    image = pyglet.image.load(str(path))
    image.anchor_x = image.width // 2
    image.anchor_y = image.height // 2
    return image


class KeyDisplayWindow(pyglet.window.Window):
    def __init__(self, config: AppConfig, project_root: Path):
        self.config = config
        self.project_root = project_root
        self.asset_directory = project_root / "images"
        super().__init__(SCREEN_WIDTH, config.screen_height, SCREEN_TITLE)
        self._setup_display()
        self._setup_replay_recorder()
        self._setup_input()
        self._setup_game_monitor()
        # Input is event-driven.  The UI only needs to consume events and move
        # sprites at display cadence, not scan every key every millisecond.
        pyglet.clock.schedule_interval(self.update, 1 / 120)

    def _setup_display(self) -> None:
        self.background_sprite = pyglet.sprite.Sprite(
            pyglet.image.load(str(self.asset_directory / "bg_ac.png")), x=0, y=0
        )
        self.note_images = {
            "white": load_centered_image(self.asset_directory / "note_w.png"),
            "black": load_centered_image(self.asset_directory / "note_b.png"),
            "scratch": load_centered_image(self.asset_directory / "note_scr.png"),
        }
        self.note_sprites: List[Deque] = [deque() for _ in range(LANE_COUNT)]
        self.key_press_counts = [0] * LANE_COUNT

        self.started_at = datetime.datetime.now()
        self.seconds_since_kps_refresh = 0.0
        self.presses_since_kps_refresh = 0

        self.key_count_labels = [
            pyglet.text.Label(
                "0",
                font_name=self.config.font_name,
                font_size=12,
                x=LANE_X_POSITIONS[lane],
                y=10 if lane in WHITE_KEY_LANES else 35,
                anchor_x="center",
            )
            for lane in range(LANE_COUNT)
        ]
        self.current_time_label = pyglet.text.Label(
            "", font_name=self.config.font_name, font_size=10, x=360, y=100, anchor_x="center"
        )
        self.elapsed_time_label = pyglet.text.Label(
            "", font_name=self.config.font_name, font_size=10, x=360, y=70, anchor_x="center"
        )
        self.kps_label = pyglet.text.Label(
            "KPS", font_name=self.config.font_name, font_size=32, x=360, y=180, anchor_x="center"
        )
        self.kps_value_label = pyglet.text.Label(
            "0", font_name=self.config.font_name, font_size=32, x=360, y=140, anchor_x="center"
        )
        self.song_title_label = pyglet.text.Label(
            "", font_name=self.config.font_name, font_size=14, x=360, y=215, anchor_x="center"
        )

    def _setup_input(self) -> None:
        joysticks = pyglet.input.get_joysticks()
        for joystick in joysticks:
            joystick.open()
        self.input_service = InputService(
            self.config,
            joysticks,
            self._record_press,
            on_input_event=self.replay_recorder.record,
        )
        self.input_service.start()

    def _setup_replay_recorder(self) -> None:
        self.replay_recorder = ReplayRecorder(self.config.replay_log, self.project_root)

    def _setup_game_monitor(self) -> None:
        self.game_state_provider = build_game_state_provider(self.config.game_monitor, self.project_root)
        self.calibration_hotkey = RisingEdgeHotkey(self.config.game_monitor.calibration_hotkey)
        self._window_is_visible = True
        self._game_state = GameState(phase="playing")

    def on_draw(self) -> None:
        self.clear()
        self.background_sprite.draw()
        for lane in range(LANE_COUNT):
            for sprite in self.note_sprites[lane]:
                sprite.draw()
            self.key_count_labels[lane].draw()
        self.current_time_label.draw()
        self.elapsed_time_label.draw()
        self.kps_label.draw()
        self.kps_value_label.draw()
        self.song_title_label.draw()

    def on_key_press(self, key, modifiers) -> None:
        if key == pyglet.window.key.ESCAPE:
            self.close()

    def on_close(self) -> None:
        self.replay_recorder.finish(time.perf_counter_ns())
        self.input_service.close()
        super().on_close()

    def update(self, delta_time: float) -> None:
        self._update_clock(delta_time)
        self._update_game_state()
        self.input_service.drain()
        self._move_notes(delta_time)

    def _update_game_state(self) -> None:
        if self.calibration_hotkey.pressed() and self.config.game_monitor.screen_profile_path:
            try:
                profile_path = self.project_root / self.config.game_monitor.screen_profile_path
                ScreenCalibration(profile_path).run()
                self.game_state_provider = build_game_state_provider(
                    self.config.game_monitor, self.project_root
                )
            except RuntimeError as error:
                self.song_title_label.text = str(error)

        self._game_state = self.game_state_provider.get_state()
        saved_path = self.replay_recorder.observe(self._game_state, time.perf_counter_ns())
        self.song_title_label.text = self._game_state.title
        if saved_path:
            self.song_title_label.text = "Saved: {}".format(saved_path.name)
        should_show = (
            not self.config.game_monitor.is_enabled
            or not self.config.game_monitor.hide_when_not_playing
            or self._game_state.is_playing
        )
        if should_show != self._window_is_visible:
            self.set_visible(should_show)
            self._window_is_visible = should_show

    def _update_clock(self, delta_time: float) -> None:
        now = datetime.datetime.now()
        self.current_time_label.text = now.strftime("%Y/%m/%d %H:%M:%S")
        self.elapsed_time_label.text = str(now - self.started_at)

        self.seconds_since_kps_refresh += delta_time
        if self.seconds_since_kps_refresh > 1:
            self.kps_value_label.text = str(self.presses_since_kps_refresh)
            self.seconds_since_kps_refresh = 0.0
            self.presses_since_kps_refresh = 0

    def _move_notes(self, delta_time: float) -> None:
        distance = self.config.speed * delta_time
        for notes in self.note_sprites:
            for sprite in notes:
                sprite.update(sprite.x, sprite.y - distance)
            while notes and notes[0].y <= -20:
                notes.popleft()

    def _record_press(self, lane: int) -> None:
        self.key_press_counts[lane] += 1
        self.presses_since_kps_refresh += 1
        self.key_count_labels[lane].text = str(self.key_press_counts[lane])
        self.note_sprites[lane].append(
            pyglet.sprite.Sprite(
                self._note_image_for(lane),
                x=LANE_X_POSITIONS[lane],
                y=self.config.screen_height + 15,
            )
        )

    def _note_image_for(self, lane: int):
        if lane in SCRATCH_LANES:
            return self.note_images["scratch"]
        if lane in WHITE_KEY_LANES:
            return self.note_images["white"]
        return self.note_images["black"]
