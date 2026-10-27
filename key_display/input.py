import ctypes
from typing import Any, Callable, Iterable, List, Optional

from .config import AppConfig
from .constants import ANALOG_BINDINGS, LANE_COUNT


def is_virtual_key_down(key_code: int) -> bool:
    return bool(ctypes.windll.user32.GetAsyncKeyState(key_code) & 0x8000)


class InputState:
    """Tracks the one active binding for each display lane."""

    def __init__(self, on_press: Callable[[int], None]):
        self._on_press = on_press
        self._active_bindings: List[Optional[Any]] = [None] * LANE_COUNT

    def is_pressed(self, lane: int) -> bool:
        return self._active_bindings[lane] is not None

    def begin_press(self, lane: int, binding: Any) -> bool:
        if self.is_pressed(lane):
            return False
        self._active_bindings[lane] = binding
        self._on_press(lane)
        return True

    def end_press(self, lane: int, binding: Any) -> bool:
        if self._active_bindings[lane] != binding:
            return False
        self._active_bindings[lane] = None
        return True


class InputPoller:
    """Polls configured controller and keyboard bindings without owning UI state."""

    def __init__(
        self,
        config: AppConfig,
        joysticks: Iterable[Any],
        on_press: Callable[[int], None],
        key_is_down: Callable[[int], bool] = is_virtual_key_down,
    ):
        self.config = config
        self.joysticks = list(joysticks)
        self.key_is_down = key_is_down
        self.state = InputState(on_press)

    def poll(self) -> None:
        for joystick, lane_bindings in zip(self.joysticks, self.config.joypad):
            for lane, bindings in enumerate(lane_bindings):
                self._poll_bindings(
                    lane,
                    bindings,
                    lambda binding: self._joypad_binding_down(joystick, binding),
                )

        for lane, bindings in enumerate(self.config.keyboard):
            self._poll_bindings(
                lane,
                bindings,
                lambda binding: self.key_is_down(int(binding, 16)),
            )

    def _poll_bindings(
        self,
        lane: int,
        bindings: Iterable[Any],
        is_down: Callable[[Any], bool],
    ) -> None:
        for binding in bindings:
            if not self.state.is_pressed(lane):
                if is_down(binding):
                    self.state.begin_press(lane, binding)
            elif not is_down(binding):
                self.state.end_press(lane, binding)

    def _joypad_binding_down(self, joystick: Any, binding: Any) -> bool:
        if isinstance(binding, int):
            button_index = binding - 1
            return 0 <= button_index < len(joystick.buttons) and joystick.buttons[button_index]

        axis_name, direction = ANALOG_BINDINGS[binding]
        axis_value = getattr(joystick, axis_name)
        return axis_value * direction >= self.config.threshold
