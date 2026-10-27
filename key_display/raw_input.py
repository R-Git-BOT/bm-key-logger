"""Passive Windows Raw Input keyboard observer.

This module deliberately registers only ``RIDEV_INPUTSINK``.  It does not use
``RIDEV_NOLEGACY``, install a keyboard hook, or synthesize input, so the game
continues to receive its normal keyboard messages.
"""

import ctypes
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from ctypes import wintypes


WM_INPUT = 0x00FF
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WM_QUIT = 0x0012
RIM_TYPEKEYBOARD = 1
RID_INPUT = 0x10000003
RIDEV_INPUTSINK = 0x00000100
RI_KEY_BREAK = 0x0001
HWND_MESSAGE = -3


@dataclass(frozen=True)
class RawKeyboardEvent:
    """A keyboard transition timestamped on the Raw Input receiver thread."""

    virtual_key: int
    is_down: bool
    timestamp_ns: int
    scan_code: int
    is_extended: bool


if os.name == "nt":
    ULONG_PTR = wintypes.WPARAM
    LRESULT = ctypes.c_ssize_t

    class RAWINPUTDEVICE(ctypes.Structure):
        _fields_ = (
            ("usUsagePage", wintypes.WORD),
            ("usUsage", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("hwndTarget", wintypes.HWND),
        )

    class RAWINPUTHEADER(ctypes.Structure):
        _fields_ = (
            ("dwType", wintypes.DWORD),
            ("dwSize", wintypes.DWORD),
            ("hDevice", wintypes.HANDLE),
            ("wParam", ULONG_PTR),
        )

    class RAWKEYBOARD(ctypes.Structure):
        _fields_ = (
            ("MakeCode", wintypes.WORD),
            ("Flags", wintypes.WORD),
            ("Reserved", wintypes.WORD),
            ("VKey", wintypes.WORD),
            ("Message", wintypes.UINT),
            ("ExtraInformation", wintypes.ULONG),
        )

    class WNDCLASSW(ctypes.Structure):
        _fields_ = (
            ("style", wintypes.UINT),
            ("lpfnWndProc", ctypes.c_void_p),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", wintypes.HANDLE),
            ("hCursor", wintypes.HANDLE),
            ("hbrBackground", wintypes.HANDLE),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
        )


class RawInputKeyboardObserver:
    """Observes keyboard transitions in a background message-only window.

    ``start`` returns False if Windows cannot provide Raw Input.  Callers then
    choose their fallback; no exception from a worker thread is leaked.
    """

    def __init__(
        self,
        emit: Callable[[RawKeyboardEvent], None],
        on_error: Optional[Callable[[str], None]] = None,
    ):
        self._emit = emit
        self._on_error = on_error or (lambda _message: None)
        self._ready = threading.Event()
        self._stopped = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._hwnd = None
        self._started = False

    @property
    def is_running(self) -> bool:
        return self._started and not self._stopped.is_set()

    def start(self) -> bool:
        if os.name != "nt":
            return False
        if self._thread is not None:
            return self.is_running
        self._thread = threading.Thread(
            target=self._run, name="BMKeyDisplayRawInput", daemon=True
        )
        self._thread.start()
        self._ready.wait(1.0)
        return self._started

    def close(self) -> None:
        if self._hwnd:
            self._user32.PostMessageW(self._hwnd, WM_CLOSE, 0, 0)
        if self._thread is not None:
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        try:
            self._run_windows_loop()
        except Exception as error:  # pragma: no cover - requires Windows API failure
            self._on_error("Raw Input を開始できませんでした: {}".format(error))
        finally:
            self._stopped.set()
            self._ready.set()

    def _run_windows_loop(self) -> None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
        kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        user32.RegisterClassW.argtypes = (ctypes.POINTER(WNDCLASSW),)
        user32.RegisterClassW.restype = wintypes.ATOM
        user32.CreateWindowExW.argtypes = (
            wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
            wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
        )
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.RegisterRawInputDevices.argtypes = (
            ctypes.POINTER(RAWINPUTDEVICE), wintypes.UINT, wintypes.UINT
        )
        user32.RegisterRawInputDevices.restype = wintypes.BOOL
        user32.GetMessageW.argtypes = (
            ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT
        )
        user32.GetMessageW.restype = ctypes.c_int
        user32.GetRawInputData.argtypes = (
            wintypes.HANDLE, wintypes.UINT, wintypes.LPVOID,
            ctypes.POINTER(wintypes.UINT), wintypes.UINT,
        )
        user32.GetRawInputData.restype = wintypes.UINT
        user32.DefWindowProcW.argtypes = (
            wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
        )
        user32.DefWindowProcW.restype = LRESULT
        user32.DestroyWindow.argtypes = (wintypes.HWND,)
        user32.DestroyWindow.restype = wintypes.BOOL
        user32.PostQuitMessage.argtypes = (ctypes.c_int,)
        user32.PostQuitMessage.restype = None
        user32.PostMessageW.argtypes = (
            wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
        )
        user32.PostMessageW.restype = wintypes.BOOL
        self._user32 = user32
        hinstance = kernel32.GetModuleHandleW(None)
        class_name = "BMKeyDisplayRawInput_{}".format(id(self))
        WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

        @WNDPROC
        def window_proc(hwnd, message, wparam, lparam):
            if message == WM_INPUT:
                self._handle_raw_input(lparam)
                # GetRawInputData has consumed the packet; legacy input remains
                # untouched because RIDEV_NOLEGACY is never registered.
                return user32.DefWindowProcW(hwnd, message, wparam, lparam)
            if message == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if message == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, message, wparam, lparam)

        # Keep the callback alive until GetMessage returns.
        self._window_proc = window_proc
        window_class = WNDCLASSW()
        window_class.lpfnWndProc = ctypes.cast(window_proc, ctypes.c_void_p).value
        window_class.hInstance = hinstance
        window_class.lpszClassName = class_name
        if not user32.RegisterClassW(ctypes.byref(window_class)):
            raise ctypes.WinError(ctypes.get_last_error())

        hwnd = user32.CreateWindowExW(
            0, class_name, class_name, 0, 0, 0, 0, 0,
            HWND_MESSAGE, None, hinstance, None,
        )
        if not hwnd:
            raise ctypes.WinError(ctypes.get_last_error())
        self._hwnd = hwnd

        keyboard = RAWINPUTDEVICE(0x01, 0x06, RIDEV_INPUTSINK, hwnd)
        if not user32.RegisterRawInputDevices(
            ctypes.byref(keyboard), 1, ctypes.sizeof(RAWINPUTDEVICE)
        ):
            raise ctypes.WinError(ctypes.get_last_error())

        self._started = True
        self._ready.set()
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))

    def _handle_raw_input(self, lparam) -> None:
        user32 = ctypes.windll.user32
        size = wintypes.UINT(0)
        header_size = ctypes.sizeof(RAWINPUTHEADER)
        if user32.GetRawInputData(
            lparam, RID_INPUT, None, ctypes.byref(size), header_size
        ) == 0xFFFFFFFF or not size.value:
            return
        payload = ctypes.create_string_buffer(size.value)
        read = user32.GetRawInputData(
            lparam, RID_INPUT, payload, ctypes.byref(size), header_size
        )
        if read == 0xFFFFFFFF:
            return
        header = ctypes.cast(payload, ctypes.POINTER(RAWINPUTHEADER)).contents
        if header.dwType != RIM_TYPEKEYBOARD:
            return
        keyboard_offset = ctypes.sizeof(RAWINPUTHEADER)
        keyboard = ctypes.cast(
            ctypes.byref(payload, keyboard_offset), ctypes.POINTER(RAWKEYBOARD)
        ).contents
        if keyboard.VKey == 0xFF:  # fake key used by some drivers
            return
        self._emit(
            RawKeyboardEvent(
                virtual_key=keyboard.VKey,
                is_down=not bool(keyboard.Flags & RI_KEY_BREAK),
                timestamp_ns=time.perf_counter_ns(),
                scan_code=keyboard.MakeCode,
                is_extended=bool(keyboard.Flags & 0x02),
            )
        )
