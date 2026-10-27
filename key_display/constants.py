SCREEN_WIDTH = 720
SCREEN_TITLE = "BMKeyLogger 20201107"
LANE_COUNT = 18

# 1P is SCR/SCR/1-7; 2P is 1-7/SCR/SCR.
LANE_X_POSITIONS = (
    30, 30, 79, 111, 143, 175, 207, 239, 271,
    449, 481, 513, 545, 577, 609, 641, 688, 688,
)
SCRATCH_LANES = frozenset((0, 1, 16, 17))
WHITE_KEY_LANES = frozenset((2, 4, 6, 8, 9, 11, 13, 15))

# Bindings intentionally use the same strings accepted by the legacy config.
ANALOG_BINDINGS = {
    "-x": ("x", -1),
    "+x": ("x", 1),
    "-y": ("y", -1),
    "+y": ("y", 1),
}
