from pathlib import Path

from key_display.config import AppConfig
from key_display.window import KeyDisplayWindow


PROJECT_ROOT = Path(__file__).resolve().parent


def main():
    config = AppConfig.from_file(PROJECT_ROOT / "config.json")
    KeyDisplayWindow(config, PROJECT_ROOT)

    import pyglet

    pyglet.app.run()


if __name__ == "__main__":
    main()
