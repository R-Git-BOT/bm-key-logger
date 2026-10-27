import unittest

from key_display.config import AppConfig
from key_display.input import InputPoller, InputState


class FakeJoystick:
    def __init__(self):
        self.buttons = [False]
        self.x = 0.0
        self.y = 0.0


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
