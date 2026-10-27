import unittest

import numpy

from key_display.measure_sync import MeasureLineDetector, _pixel_region
from key_display.screen_monitor import NormalizedRegion


class MeasureLineDetectorTests(unittest.TestCase):
    def test_emits_one_marker_for_a_bright_line_until_it_leaves_band(self):
        detector = MeasureLineDetector(200, 0.5, 100)
        dark = numpy.zeros((2, 4, 3), dtype=numpy.uint8)
        bright = numpy.full((2, 4, 3), 255, dtype=numpy.uint8)

        self.assertFalse(detector.observe(dark, 0))
        self.assertTrue(detector.observe(bright, 1_000_000_000))
        self.assertFalse(detector.observe(bright, 1_010_000_000))
        self.assertFalse(detector.observe(dark, 1_020_000_000))
        self.assertTrue(detector.observe(bright, 1_200_000_000))

    def test_converts_normalized_region_to_dxcam_pixel_region(self):
        region = NormalizedRegion(0.25, 0.5, 0.5, 0.1)

        self.assertEqual(_pixel_region(region, 1000, 800), (250, 400, 750, 480))
