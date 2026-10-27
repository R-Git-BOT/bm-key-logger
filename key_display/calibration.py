"""Mouse-driven capture-region calibration for the screen-template provider."""

import json
from pathlib import Path
from typing import Dict, Optional, Tuple

from .screen_monitor import NormalizedRegion, ScreenProfile, _capture_screen


class CalibrationMode:
    """A dedicated F-key calibration session for the screen-template provider.

    The user selects optional metadata, timing, and RANDOM-lane detection
    regions, then the required in-play indicator.  The indicator is saved as
    a template.  Keeping every selection in this one modal mode prevents
    accidental overwrites during ordinary play.
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
        root.title("BMKeyLogger — キャリブレーションモード")
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

        stages = ("title", "chart", "measure_line", "random_lane_band", "indicator")
        selected: Dict[str, NormalizedRegion] = {}
        start: Optional[Tuple[int, int]] = None
        rectangle: Optional[int] = None
        stage_index = 0

        def update_instruction() -> None:
            stage = stages[stage_index]
            message = (
                "キャリブレーションモード  1/5: 曲名の領域をドラッグしてください。不要なら S でスキップ。"
                if stage == "title"
                else (
                    "キャリブレーションモード  2/5: 譜面名／難易度の領域をドラッグしてください。不要なら S でスキップ。"
                    if stage == "chart"
                    else (
                        "キャリブレーションモード  3/5: 小節線が横切る高さに、レーン幅の細い横長領域をドラッグしてください。不要なら S でスキップ。"
                        if stage == "measure_line" else (
                            "キャリブレーションモード  4/5: 7鍵だけを横切る細い検出帯をドラッグしてください。RANDOM配置認識用です。不要なら S でスキップ。"
                            if stage == "random_lane_band"
                            else "キャリブレーションモード  5/5: 曲中にだけ表示される、動かない要素をドラッグしてください。"
                        )
                    )
                )
            )
            canvas.itemconfigure(instruction, text=message + "  Esc: 中止  /  F8を再度押すと次回再設定")

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
                chart_region=selected.get("chart"),
                measure_line_region=selected.get("measure_line"),
                random_lane_band_region=selected.get("random_lane_band"),
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

        def skip_optional_stage(event=None) -> None:
            nonlocal stage_index
            if stages[stage_index] in ("title", "chart", "measure_line", "random_lane_band"):
                stage_index += 1
                update_instruction()

        canvas.bind("<ButtonPress-1>", begin)
        canvas.bind("<B1-Motion>", drag)
        canvas.bind("<ButtonRelease-1>", end)
        root.bind("<Escape>", lambda event: root.destroy())
        root.bind("s", skip_optional_stage)
        root.bind("S", skip_optional_stage)
        update_instruction()
        root.mainloop()


# Kept as a small compatibility alias for consumers that imported the old name.
ScreenCalibration = CalibrationMode
