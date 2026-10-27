"""Configurable screen-template fallback for games without a state bridge."""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Tuple

from .game_state import GameState, GameStateProvider, PLAYING_PHASE


@dataclass(frozen=True)
class NormalizedRegion:
    x: float
    y: float
    width: float
    height: float

    @classmethod
    def from_pixels(cls, left: int, top: int, right: int, bottom: int, image_size: Tuple[int, int]):
        image_width, image_height = image_size
        if right <= left or bottom <= top:
            raise ValueError("A region must have a positive width and height.")
        return cls(
            x=left / image_width,
            y=top / image_height,
            width=(right - left) / image_width,
            height=(bottom - top) / image_height,
        )

    @classmethod
    def from_mapping(cls, value: Any) -> "NormalizedRegion":
        if not isinstance(value, Mapping):
            raise ValueError("A region must be an object.")
        try:
            region = cls(*(float(value[name]) for name in ("x", "y", "width", "height")))
        except (KeyError, TypeError, ValueError):
            raise ValueError("A region must contain numeric x, y, width, and height.")
        if not 0 <= region.x < 1 or not 0 <= region.y < 1 or not 0 < region.width <= 1 or not 0 < region.height <= 1:
            raise ValueError("Region values must be normalized values between 0 and 1.")
        if region.x + region.width > 1 or region.y + region.height > 1:
            raise ValueError("Region must fit within the captured screen.")
        return region

    def as_mapping(self) -> Mapping[str, float]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}

    def box_for(self, image_size: Tuple[int, int]) -> Tuple[int, int, int, int]:
        image_width, image_height = image_size
        left = round(self.x * image_width)
        top = round(self.y * image_height)
        right = round((self.x + self.width) * image_width)
        bottom = round((self.y + self.height) * image_height)
        return left, top, max(left + 1, right), max(top + 1, bottom)


@dataclass(frozen=True)
class ScreenProfile:
    play_indicator_region: NormalizedRegion
    template_path: str
    similarity_threshold: float = 0.90
    title_region: Optional[NormalizedRegion] = None
    ocr_language: Optional[str] = None

    @classmethod
    def from_file(cls, path: Path) -> "ScreenProfile":
        try:
            with path.open(encoding="utf-8") as profile_file:
                raw = json.load(profile_file)
        except OSError as error:
            raise ValueError("Could not read screen profile: {}".format(error))
        except json.JSONDecodeError as error:
            raise ValueError("Screen profile is not valid JSON: {}".format(error))
        if not isinstance(raw, Mapping):
            raise ValueError("Screen profile must be an object.")
        threshold = raw.get("similarity_threshold", 0.90)
        if not isinstance(threshold, (float, int)) or not 0 < threshold <= 1:
            raise ValueError("similarity_threshold must be a number from 0 (exclusive) to 1.")
        template_path = raw.get("template_path")
        if not isinstance(template_path, str) or not template_path:
            raise ValueError("template_path must be a non-empty string.")
        title_region = raw.get("title_region")
        ocr_language = raw.get("ocr_language")
        if ocr_language is not None and not isinstance(ocr_language, str):
            raise ValueError("ocr_language must be a string when set.")
        return cls(
            play_indicator_region=NormalizedRegion.from_mapping(raw.get("play_indicator_region")),
            template_path=template_path,
            similarity_threshold=float(threshold),
            title_region=NormalizedRegion.from_mapping(title_region) if title_region else None,
            ocr_language=ocr_language,
        )

    def to_mapping(self) -> Mapping[str, Any]:
        result = {
            "play_indicator_region": self.play_indicator_region.as_mapping(),
            "template_path": self.template_path,
            "similarity_threshold": self.similarity_threshold,
        }
        if self.title_region:
            result["title_region"] = self.title_region.as_mapping()
        if self.ocr_language:
            result["ocr_language"] = self.ocr_language
        return result


class ScreenTemplateProvider(GameStateProvider):
    """Checks a user-selected, static in-play screen element against a template."""

    def __init__(self, profile_path: Path, poll_interval_ms: int = 250):
        self.profile_path = profile_path
        self.poll_interval = poll_interval_ms / 1000.0
        self._next_poll_at = 0.0
        self._state = GameState(source="screen_template", message="Waiting for screen profile.")
        self._profile: Optional[ScreenProfile] = None
        self._profile_mtime: Optional[int] = None

    def get_state(self) -> GameState:
        now = time.monotonic()
        if now < self._next_poll_at:
            return self._state
        self._next_poll_at = now + self.poll_interval
        try:
            profile = self._load_profile()
            screenshot = _capture_screen()
            region = screenshot.crop(profile.play_indicator_region.box_for(screenshot.size))
            template = _load_template(self.profile_path.parent / profile.template_path, region.size)
            similarity = image_similarity(region, template)
            if similarity < profile.similarity_threshold:
                self._state = GameState(
                    phase="idle",
                    source="screen_template",
                    message="Play indicator similarity: {:.3f}".format(similarity),
                )
            else:
                self._state = GameState(
                    phase=PLAYING_PHASE,
                    title=_read_title(screenshot, profile),
                    source="screen_template",
                    message="Play indicator similarity: {:.3f}".format(similarity),
                )
        except (ImportError, OSError, ValueError) as error:
            self._state = GameState(source="screen_template", message="Screen monitor error: {}".format(error))
        return self._state

    def _load_profile(self) -> ScreenProfile:
        mtime = self.profile_path.stat().st_mtime_ns
        if self._profile is None or self._profile_mtime != mtime:
            self._profile = ScreenProfile.from_file(self.profile_path)
            self._profile_mtime = mtime
        return self._profile


def _capture_screen():
    try:
        from PIL import ImageGrab
    except ImportError:
        raise ImportError("Install Pillow with: py -m pip install -r requirements.txt")
    try:
        return ImageGrab.grab(all_screens=True)
    except TypeError:
        return ImageGrab.grab()


def _load_template(path: Path, size: Tuple[int, int]):
    try:
        from PIL import Image
    except ImportError:
        raise ImportError("Install Pillow with: py -m pip install -r requirements.txt")
    with Image.open(str(path)) as image:
        template = image.convert("RGB")
    if template.size != size:
        resampling = getattr(Image, "Resampling", Image).LANCZOS
        template = template.resize(size, resampling)
    return template


def image_similarity(left, right) -> float:
    """Return 1.0 for identical RGB images and 0.0 for maximum difference."""
    try:
        from PIL import ImageChops, ImageStat
    except ImportError:
        raise ImportError("Install Pillow with: py -m pip install -r requirements.txt")
    if left.size != right.size:
        raise ValueError("Images must have identical sizes.")
    difference = ImageChops.difference(left.convert("RGB"), right.convert("RGB"))
    mean_difference = sum(ImageStat.Stat(difference).mean) / 3.0
    return max(0.0, 1.0 - mean_difference / 255.0)


def _read_title(screenshot, profile: ScreenProfile) -> str:
    if not profile.title_region or not profile.ocr_language:
        return ""
    try:
        import pytesseract
    except ImportError:
        return ""
    title_image = screenshot.crop(profile.title_region.box_for(screenshot.size))
    try:
        return pytesseract.image_to_string(title_image, lang=profile.ocr_language).strip()
    except (OSError, RuntimeError):
        # The Python package can be installed before the native Tesseract
        # executable or its requested language data.  A missing OCR engine
        # must not prevent play-state detection from working.
        return ""
