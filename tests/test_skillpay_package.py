"""The SkillPay ZIP must stay the Python Skill only, without the DSH plugin files."""
import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bead_atlas_package", ROOT / "scripts" / "package.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

EXCLUDED_PREFIXES = ("dsh-plugin/", "node_modules/", "locale/", ".venv/", "tests/")
EXCLUDED_FILES = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "docs/DSH-PLUGIN.md"}


class SkillPayPackageTest(unittest.TestCase):
    def test_included_list_has_no_dsh_plugin_files(self):
        for name in PACKAGE.included_files():
            self.assertFalse(name.startswith(EXCLUDED_PREFIXES), name)
            self.assertNotIn(name, EXCLUDED_FILES)

    def test_built_zip_has_no_dsh_plugin_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "ymzz-bead-atlas.zip"
            PACKAGE.package(output)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
        self.assertIn("scripts/convert.py", names)
        for name in names:
            self.assertFalse(name.startswith(EXCLUDED_PREFIXES), name)
            self.assertNotIn(name, EXCLUDED_FILES)
            self.assertFalse(name.endswith(".tgz"), name)


if __name__ == "__main__":
    unittest.main()
