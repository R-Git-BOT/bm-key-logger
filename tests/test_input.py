import unittest

from key_display.config import AppConfig
from key_display.input import InputEvent, InputPoller, InputService, InputState, KeyboardEventMapper


class FakeJoystick:
    def __init__(self):
        self.buttons = [False]
        self.x = 0.0
        self.y = 0.0

    def push_handlers(self, **_handlers):
        pass


class UnavailableObserver:
    def __init__(self, _emit):
        self.is_running = False

    def start(self):
        return False

    def close(self):
        pass


class InputStateTests(unittest.TestCase):
    def test_counts_only_press_transitions_and_releases_active_binding(self):
        presses = []
        state = InputState(presses.append)

        self.assertTrue(state.begin_press(4, "5A"))
        self.assertFalse(state.begin_press(4, "53"))
        self.assertFalse(state.end_press(4, "53"))
        self.assertTrue(state.end_press(4, "5A"))
        self.assertTrue(state.begin_press(4, "53"))

        self.assertEqual(presses, [4, 4])


class InputPollerTests(unittest.TestCase):
    def test_uses_legacy_button_and_axis_bindings_without_repeat_events(self):
        joysticks = [FakeJoystick()]
        presses = []
        config = AppConfig(
            font_name="",
            speed=720.0,
            screen_height=720,
            threshold=0.9,
            joypad=[[[1], ["-x"]] + [[] for _ in range(16)]],
            keyboard=[[] for _ in range(18)],
        )
        poller = InputPoller(config, joysticks, presses.append, key_is_down=lambda _: False)

        poller.poll()
        joysticks[0].buttons[0] = True
        poller.poll()
        poller.poll()
        joysticks[0].buttons[0] = False
        poller.poll()
        joysticks[0].x = -1.0
        poller.poll()

        self.assertEqual(presses, [0, 1])


class KeyboardEventMapperTests(unittest.TestCase):
    def test_emits_only_down_transitions_for_configured_raw_key(self):
        presses = []
        mapper = KeyboardEventMapper([["5A"]] + [[] for _ in range(17)], presses.append)
        down = InputEvent("keyboard", 0x5A, True, 1)
        up = InputEvent("keyboard", 0x5A, False, 2)

        mapper.handle(down)
        mapper.handle(down)
        mapper.handle(up)
        mapper.handle(down)
        mapper.handle(InputEvent("keyboard", 0x58, True, 3))

        self.assertEqual(presses, [0, 0])

    def test_preserves_raw_event_timestamp_for_recording(self):
        events = []
        mapper = KeyboardEventMapper(
            [["5A"]] + [[] for _ in range(17)],
            lambda _lane: None,
            events.append,
        )

        mapper.handle(InputEvent("keyboard", 0x5A, True, 123_456_789))

        self.assertEqual(events[0].lane, 0)
        self.assertTrue(events[0].pressed)
        self.assertEqual(events[0].timestamp_ns, 123_456_789)


class InputServiceTests(unittest.TestCase):
    def test_uses_keyboard_poller_only_when_raw_input_is_unavailable(self):
        pressed = {0x5A: False}
        presses = []
        config = AppConfig(
            font_name="",
            speed=720.0,
            screen_height=720,
            threshold=0.9,
            joypad=[],
            keyboard=[["5A"]] + [[] for _ in range(17)],
        )
        service = InputService(
            config,
            [],
            presses.append,
            observer_factory=UnavailableObserver,
            key_is_down=lambda key: pressed[key],
        )

        service.start()
        pressed[0x5A] = True
        service.drain()
        service.drain()

        self.assertFalse(service.uses_raw_keyboard)
        self.assertEqual(presses, [0])
