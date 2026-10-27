import ctypes
import queue
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .config import AppConfig
from .constants import ANALOG_BINDINGS, LANE_COUNT
from .raw_input import RawInputKeyboardObserver, RawKeyboardEvent
from .replay import LaneInputEvent


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


@dataclass(frozen=True)
class InputEvent:
    """A normalized transition kept separate from rendering frame timing."""

    source: str
    binding: Any
    is_down: bool
    timestamp_ns: int


class KeyboardEventMapper:
    """Maps configured virtual keys to display lanes without polling state."""

    def __init__(
        self,
        keyboard: List[List[str]],
        on_press: Callable[[int], None],
        on_input_event: Optional[Callable[[LaneInputEvent], None]] = None,
    ):
        self.state = InputState(on_press)
        self._on_input_event = on_input_event or (lambda _event: None)
        self._lanes_by_key: Dict[int, List[int]] = {}
        for lane, bindings in enumerate(keyboard):
            for binding in bindings:
                self._lanes_by_key.setdefault(int(binding, 16), []).append(lane)

    def handle(self, event: InputEvent) -> None:
        if event.source != "keyboard":
            return
        key_code = int(event.binding)
        for lane in self._lanes_by_key.get(key_code, []):
            binding = ("keyboard", key_code)
            changed = (
                self.state.begin_press(lane, binding)
                if event.is_down
                else self.state.end_press(lane, binding)
            )
            if changed:
                self._on_input_event(
                    LaneInputEvent(lane, event.is_down, event.timestamp_ns, event.source)
                )


class JoystickEventMapper:
    """Turns Pyglet's controller events into lane transitions.

    Pyglet/DirectInput owns device delivery.  This mapper only handles the
    configured controls, so it has no periodic scan when the controller is
    idle.
    """

    def __init__(
        self,
        config: AppConfig,
        joysticks: Iterable[Any],
        on_press: Callable[[int], None],
        on_input_event: Optional[Callable[[LaneInputEvent], None]] = None,
    ):
        self.config = config
        self._on_input_event = on_input_event or (lambda _event: None)
        self.joysticks = list(joysticks)
        self.state = InputState(on_press)
        self._button_lanes: Dict[Tuple[int, int], List[int]] = {}
        self._axis_lanes: Dict[Tuple[int, str, int], List[int]] = {}
        self._register_bindings()
        self._attach_handlers()

    def _register_bindings(self) -> None:
        for controller, lane_bindings in enumerate(self.config.joypad):
            for lane, bindings in enumerate(lane_bindings):
                for binding in bindings:
                    if isinstance(binding, int):
                        self._button_lanes.setdefault((controller, binding - 1), []).append(lane)
                    else:
                        axis_name, direction = ANALOG_BINDINGS[binding]
                        self._axis_lanes.setdefault((controller, axis_name, direction), []).append(lane)

    def _attach_handlers(self) -> None:
        for controller, joystick in enumerate(self.joysticks):
            joystick.push_handlers(
                on_joybutton_press=self._button_handler(controller, True),
                on_joybutton_release=self._button_handler(controller, False),
                on_joyaxis_motion=self._axis_handler(controller),
            )

    def _button_handler(self, controller: int, is_down: bool):
        def handle(_joystick: Any, button: int) -> None:
            binding = ("joybutton", controller, button)
            for lane in self._button_lanes.get((controller, button), []):
                changed = (
                    self.state.begin_press(lane, binding)
                    if is_down
                    else self.state.end_press(lane, binding)
                )
                if changed:
                    self._on_input_event(
                        LaneInputEvent(lane, is_down, _timestamp_ns(), "joybutton")
                    )

        return handle

    def _axis_handler(self, controller: int):
        def handle(_joystick: Any, axis_name: str, value: float) -> None:
            for direction in (-1, 1):
                binding = ("joyaxis", controller, axis_name, direction)
                is_down = value * direction >= self.config.threshold
                for lane in self._axis_lanes.get((controller, axis_name, direction), []):
                    changed = (
                        self.state.begin_press(lane, binding)
                        if is_down
                        else self.state.end_press(lane, binding)
                    )
                    if changed:
                        self._on_input_event(
                            LaneInputEvent(lane, is_down, _timestamp_ns(), "joyaxis")
                        )

        return handle


class InputService:
    """One input module for the UI: Raw Input keyboard plus event controllers.

    The public interface is intentionally small: ``start``, ``drain`` and
    ``close``.  The caller never needs to know whether keyboard data came from
    Raw Input or the compatibility polling adapter.
    """

    def __init__(
        self,
        config: AppConfig,
        joysticks: Iterable[Any],
        on_press: Callable[[int], None],
        observer_factory: Callable[..., RawInputKeyboardObserver] = RawInputKeyboardObserver,
        key_is_down: Callable[[int], bool] = is_virtual_key_down,
        on_input_event: Optional[Callable[[LaneInputEvent], None]] = None,
    ):
        self.config = config
        self._on_press = on_press
        self._events: "queue.SimpleQueue[InputEvent]" = queue.SimpleQueue()
        self.keyboard = KeyboardEventMapper(config.keyboard, on_press, on_input_event)
        self.joysticks = JoystickEventMapper(config, joysticks, on_press, on_input_event)
        self._keyboard_fallback: Optional[InputPoller] = None
        self._observer = observer_factory(self._enqueue_raw_keyboard)
        self._key_is_down = key_is_down

    @property
    def uses_raw_keyboard(self) -> bool:
        return self._observer.is_running

    def start(self) -> None:
        if not self._observer.start():
            # Compatibility only: used outside Windows or if Raw Input cannot
            # be registered. Controllers stay event-driven in either case.
            self._keyboard_fallback = InputPoller(
                self.config, [], self._on_press, self._key_is_down, True
            )

    def drain(self) -> None:
        while True:
            try:
                self.keyboard.handle(self._events.get_nowait())
            except queue.Empty:
                break
        if self._keyboard_fallback is not None:
            self._keyboard_fallback.poll()

    def close(self) -> None:
        self._observer.close()

    def _enqueue_raw_keyboard(self, event: RawKeyboardEvent) -> None:
        self._events.put(
            InputEvent(
                source="keyboard",
                binding=event.virtual_key,
                is_down=event.is_down,
                timestamp_ns=event.timestamp_ns,
            )
        )


def _timestamp_ns() -> int:
    # Imported lazily to keep the input data types independent of a clock in
    # tests, while controller callbacks retain their arrival time.
    import time

    return time.perf_counter_ns()


class InputPoller:
    """Polls configured controller and keyboard bindings without owning UI state."""

    def __init__(
        self,
        config: AppConfig,
        joysticks: Iterable[Any],
        on_press: Callable[[int], None],
        key_is_down: Callable[[int], bool] = is_virtual_key_down,
        poll_keyboard: bool = True,
    ):
        self.config = config
        self.joysticks = list(joysticks)
        self.key_is_down = key_is_down
        self.poll_keyboard = poll_keyboard
        self.state = InputState(on_press)

    def poll(self) -> None:
        for joystick, lane_bindings in zip(self.joysticks, self.config.joypad):
            for lane, bindings in enumerate(lane_bindings):
                self._poll_bindings(
                    lane,
                    bindings,
                    lambda binding: self._joypad_binding_down(joystick, binding),
                )

        if self.poll_keyboard:
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
