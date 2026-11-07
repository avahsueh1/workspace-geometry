import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('photos', Path(__file__).parents[1] / 'scripts/analyze_photos.py')
photos = importlib.util.module_from_spec(spec)
spec.loader.exec_module(photos)

class PhotoTests(unittest.TestCase):
    def test_clipping_and_normalization(self):
        d = photos.make_detection('couch', .8, [-4, 10, 120, 50], 100, 50, 1)
        self.assertEqual(d['normalizedBox'], [0, .2, 1, 1])
        self.assertEqual(d['category'], 'sofa')
        self.assertIsNone(d['dimensionsMetres'])
        self.assertIsNone(d['placement'])

    def test_non_furniture_preserves_label_without_inventing_category(self):
        self.assertEqual(photos.make_detection('person', .9, [0, 0, 10, 20], 30, 30, 1)['category'], 'unknown')

    def test_invalid_prediction(self):
        for score, box in [(float('nan'), [0, 0, 1, 2]), (.8, [4, 1, 2, 3]), (.8, [0, 0, float('inf'), 2])]:
            with self.assertRaises(ValueError):
                photos.make_detection('chair', score, box, 100, 100, 1)

if __name__ == '__main__':
    unittest.main()
