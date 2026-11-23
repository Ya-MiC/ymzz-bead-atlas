import csv
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "convert.py"
SPEC = importlib.util.spec_from_file_location("bead_atlas_convert", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def make_args(image, output, **overrides):
    values = {
        "image": str(image),
        "output": str(output),
        "brand": "mard",
        "preset": "",
        "override": [],
        "extra_color": [],
        "palette_file": "",
        "width": 4,
        "height": 2,
        "max_colors": 0,
        "bead_mm": 5.0,
        "background": "#FFFFFF",
        "board_width": 29,
        "board_height": 29,
        "pack_size": 1000,
        "spare_percent": 10.0,
        "save_preset": "",
        "list_brands": False,
        "list_presets": False,
        "overwrite": False,
    }
    values.update(overrides)
    return Namespace(**values)


def sample_image(path):
    image = Image.new("RGBA", (4, 2))
    image.putdata(
        [
            (216, 1, 39, 255),
            (0, 189, 53, 255),
            (1, 172, 235, 255),
            (0, 0, 0, 255),
            (216, 1, 39, 255),
            (0, 189, 53, 255),
            (1, 172, 235, 255),
            (255, 255, 255, 0),
        ]
    )
    image.save(path)


class BrandTests(unittest.TestCase):
    def test_registry_and_palettes(self):
        payload, brands = MODULE.load_brands()
        self.assertEqual(len(brands), 15)
        total = 0
        for brand in payload["brands"]:
            entries = MODULE.read_palette_csv(MODULE.DATA_DIR / brand["file"])
            self.assertGreater(len(entries), 20, brand["id"])
            self.assertEqual(len({entry["code"] for entry in entries}), len(entries), brand["id"])
            total += len(entries)
        self.assertEqual(total, 2093)

    def test_mard_counts(self):
        entries = MODULE.read_palette_csv(MODULE.DATA_DIR / "mard.csv")
        self.assertEqual(len(entries), 291)
        hama = MODULE.read_palette_csv(MODULE.DATA_DIR / "hama.csv")
        self.assertEqual(len(hama), 92)

    def test_delta_e_reference_pair(self):
        value = MODULE.delta_e_2000((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485))
        self.assertAlmostEqual(value, 2.0425, places=4)

    def test_nearest_known_colors(self):
        palette = MODULE.read_palette_csv(MODULE.DATA_DIR / "mard.csv")
        cases = [((216, 1, 39), "F5"), ((0, 189, 53), "B5"), ((1, 172, 235), "C5"), ((0, 0, 0), "H7")]
        for rgb, code in cases:
            entry, delta = MODULE.nearest(rgb, palette)
            self.assertEqual(entry["code"], code)
            self.assertLess(delta, 0.5)


class ConversionTests(unittest.TestCase):
    def test_end_to_end_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.png"
            output = root / "out"
            sample_image(source)
            usage = MODULE.convert(make_args(source, output))
            local = usage["local_usage"]
            self.assertEqual(local["grid_cells"], 8)
            self.assertEqual(local["placed_beads"], 7)
            self.assertEqual(local["blank_cells"], 1)
            self.assertEqual(local["used_colors"], 4)
            self.assertEqual(usage["brand"]["id"], "mard")
            self.assertEqual(usage["brand"]["name"], "MARD")
            self.assertEqual(sum(row["bead_count"] for row in usage["materials"]), 7)
            for name in ("pattern.png", "pattern.svg", "preview.png", "materials.csv", "coordinates.csv", "usage.json", "report.md"):
                self.assertTrue((output / name).is_file(), name)
            with (output / "materials.csv").open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[0]["brand"], "MARD")
            with (output / "coordinates.csv").open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 8)
            self.assertEqual(rows[0]["code"], "F5")
            self.assertEqual(rows[-1]["code"], "")

    def test_override_marks_user_origin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.png"
            output = root / "out"
            sample_image(source)
            usage = MODULE.convert(make_args(source, output, override=["F5=#D80127"]))
            row = next(item for item in usage["materials"] if item["code"] == "F5")
            self.assertEqual(row["reference_hex"], "#D80127")
            self.assertEqual(row["origin"], "user")
            self.assertEqual(usage["user_edits"]["overrides"]["F5"], "#D80127")

    def test_extra_color_and_preset_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.png"
            output = root / "out"
            sample_image(source)
            saved = MODULE.save_preset("test-preset", "mard", MODULE.parse_assignments(["A1=#FAF5CD"], "override"), MODULE.parse_assignments(["X1=#FF7AB0|我的粉"], "extra-color"))
            try:
                usage = MODULE.convert(make_args(source, output, preset="test-preset", max_colors=8))
                self.assertEqual(usage["user_edits"]["preset"], "test-preset")
                self.assertIn("A1", usage["user_edits"]["overrides"])
                self.assertIn("X1", usage["user_edits"]["extra_colors"])
                self.assertTrue(saved.is_file())
            finally:
                saved.unlink()

    def test_custom_palette_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.png"
            output = root / "out"
            palette = root / "mine.csv"
            palette.write_text("X1,我的紅,216,1,39\nX2,我的綠,0,189,53\n", encoding="utf-8")
            sample_image(source)
            usage = MODULE.convert(make_args(source, output, palette_file=str(palette), max_colors=0))
            self.assertEqual(usage["user_edits"]["custom_palette_file"], str(palette.resolve()))
            codes = {row["code"] for row in usage["materials"]}
            self.assertTrue(codes.issubset({"X1", "X2"}))

    def test_existing_output_requires_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.png"
            output = root / "out"
            sample_image(source)
            output.mkdir()
            (output / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "已有內容"):
                MODULE.convert(make_args(source, output))
            self.assertEqual((output / "keep.txt").read_text(encoding="utf-8"), "keep")

    def test_cli_lists_brands_and_presets(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--list-brands"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertIn("mard", result.stdout)
        self.assertIn("hama", result.stdout)
        self.assertIn("diamonddotz", result.stdout)


if __name__ == "__main__":
    unittest.main()
