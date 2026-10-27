"""Mouse-driven capture-region calibration for the screen-template provider."""

import json
from pathlib import Path
from typing import Dict, Optional, Tuple

from .screen_monitor import NormalizedRegion, ScreenProfile, _capture_screen


class ScreenCalibration:
    """Shows one frozen desktop image and writes a reusable screen profile.

    The user first selects a title area (optional) then a static element that
    appears only while a song is playing.  The latter is saved as a template.
    """

    def __init__(self, profile_path: Path):
        self.profile_path = profile_path

    def run(self) -> None:
        try:
            from PIL import ImageTk
            import tkinter as tk
        except ImportError as error:
            raise RuntimeError("Calibration requires Pillow: {}".format(error))

        screenshot = _capture_screen().convert("RGB")
        root = tk.Tk()
        root.title("BMKeyLogger screen calibration")
        root.attributes("-topmost", True)
        root.geometry("{}x{}+0+0".format(*screenshot.size))

        canvas = tk.Canvas(root, width=screenshot.width, height=screenshot.height, highlightthickness=0)
        canvas.pack(fill="both", expand=True)
        photo = ImageTk.PhotoImage(screenshot)
        canvas.create_image(0, 0, image=photo, anchor="nw")
        instruction = canvas.create_text(
            20,
            20,
            anchor="nw",
            fill="yellow",
            font=("Segoe UI", 16, "bold"),
            text="",
        )

        stages = ("title", "indicator")
        selected: Dict[str, NormalizedRegion] = {}
        start: Optional[Tuple[int, int]] = None
        rectangle: Optional[int] = None
        stage_index = 0

        def update_instruction() -> None:
            stage = stages[stage_index]
            message = (
                "1/2: 曲名の領域をドラッグしてください。不要なら S でスキップ。"
                if stage == "title"
                else "2/2: 曲中にだけ表示される、動かない要素をドラッグしてください。"
            )
            canvas.itemconfigure(instruction, text=message + "  Esc: 中止")

        def finish() -> None:
            indicator = selected["indicator"]
            template_name = "{}.play-template.png".format(self.profile_path.stem)
            template_path = self.profile_path.with_name(template_name)
            self.profile_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot.crop(indicator.box_for(screenshot.size)).save(str(template_path))
            profile = ScreenProfile(
                play_indicator_region=indicator,
                template_path=template_name,
                title_region=selected.get("title"),
            )
            with self.profile_path.open("w", encoding="utf-8", newline="\n") as profile_file:
                json.dump(profile.to_mapping(), profile_file, ensure_ascii=False, indent=2)
                profile_file.write("\n")
            root.destroy()

        def begin(event) -> None:
            nonlocal start, rectangle
            start = (event.x, event.y)
            if rectangle:
                canvas.delete(rectangle)
            rectangle = canvas.create_rectangle(event.x, event.y, event.x, event.y, outline="cyan", width=3)

        def drag(event) -> None:
            if start and rectangle:
                canvas.coords(rectangle, start[0], start[1], event.x, event.y)

        def end(event) -> None:
            nonlocal stage_index, start
            if not start:
                return
            left, right = sorted((start[0], event.x))
            top, bottom = sorted((start[1], event.y))
            start = None
            if right - left < 4 or bottom - top < 4:
                return
            selected[stages[stage_index]] = NormalizedRegion.from_pixels(
                left, top, right, bottom, screenshot.size
            )
            stage_index += 1
            if stage_index == len(stages):
                finish()
            else:
                update_instruction()

        def skip_title(event=None) -> None:
            nonlocal stage_index
            if stage_index == 0:
                stage_index = 1
                update_instruction()

        canvas.bind("<ButtonPress-1>", begin)
        canvas.bind("<B1-Motion>", drag)
        canvas.bind("<ButtonRelease-1>", end)
        root.bind("<Escape>", lambda event: root.destroy())
        root.bind("s", skip_title)
        root.bind("S", skip_title)
        update_instruction()
        root.mainloop()
