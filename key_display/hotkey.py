"""Small polling helper for a configurable global Windows hotkey."""

from typing import Optional

from .input import is_virtual_key_down


FUNCTION_KEYS = {"F{}".format(number): 0x6F + number for number in range(1, 25)}


def virtual_key_code(name: str) -> Optional[int]:
    normalized = name.upper()
    if normalized in FUNCTION_KEYS:
        return FUNCTION_KEYS[normalized]
    if len(normalized) == 1 and "A" <= normalized <= "Z":
        return ord(normalized)
    return None


class RisingEdgeHotkey:
    def __init__(self, name: str):
        self.name = name
        self.key_code = virtual_key_code(name)
        self._was_down = False

    def pressed(self) -> bool:
        if self.key_code is None:
            return False
        is_down = is_virtual_key_down(self.key_code)
        result = is_down and not self._was_down
        self._was_down = is_down
        return result
