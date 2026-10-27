import unittest

from key_display.random_lane import RandomLaneSession, RandomMappingAnalyzer, NormalChartRecorder


class RandomLaneTests(unittest.TestCase):
    def test_regular_events_eventually_identify_identity_mapping(self):
        recorder = NormalChartRecorder()
        for lane in range(1, 8):
            recorder.add([lane])

        self.assertTrue(recorder._identity_is_unique())
        self.assertEqual(recorder.events[0], (1,))

    def test_random_mapping_discovers_a_permutation(self):
        analyzer = RandomMappingAnalyzer([(1,), (2,), (3,), (4,), (5,), (6,), (7,)])
        for lane in (3, 1, 7, 2, 6, 4, 5):
            analyzer.add([lane])

        self.assertTrue(analyzer.complete)
        self.assertEqual(analyzer.layout, "2416753")

    def test_session_requires_normal_chart_before_random_analysis(self):
        session = RandomLaneSession()

        update = session.start("RANDOM")

        self.assertEqual(update.status, "needs_normal")

    def test_mirror_recording_is_converted_back_to_regular_events(self):
        session = RandomLaneSession()
        session.start("MIRROR")
        for lane in range(1, 8):
            session.observe([lane])

        self.assertEqual(session.normal_events[0], (7,))
        self.assertEqual(session.normal_events[-1], (1,))
