# SPDX-License-Identifier: MIT
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class FeatureDataTest(unittest.TestCase):
    def test_optional_features_follow_the_image(self):
        base = {"P25", "NXDN", "P25_TRUNK"}
        # the patch-series images, then the current base's
        for optional in (set(), {"DV_AES", "P25_TRUNK_TX", "P25_NATIVE", "P25_PHASE2"}, {"AIR_AES"}):
            with self.subTest(optional=optional), tempfile.TemporaryDirectory() as tmp:
                data = Path(tmp) / "data"
                data.mkdir()
                files = {
                    "features": {"features": []},
                    "releases": {"releases": [{"features": ",".join(sorted(base | optional))}]},
                    "radios": {"radios": [{"id": "dm32", "config": {
                        "full": ["DMR", "DV_AES", "P25_TRUNK_TX", "AIR_AES"]}}]},
                }
                for name, value in files.items():
                    (data / (name + ".json")).write_text(json.dumps(value), encoding="utf-8")
                subprocess.run([sys.executable, str(Path(__file__).with_name("p25_data.py")), tmp],
                               check=True, capture_output=True)
                radio = json.loads((data / "radios.json").read_text(encoding="utf-8"))["radios"][0]
                self.assertEqual(set(radio["config"]["full"]), base | optional | {"DMR"})
                self.assertEqual("Trunk TX is experimental" in radio["support"], "P25_TRUNK_TX" in optional)
                self.assertEqual("no DMR" in radio["support"], "AIR_AES" in optional)


if __name__ == "__main__":
    unittest.main()
