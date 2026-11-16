# SPDX-License-Identifier: MIT
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class FeatureDataTest(unittest.TestCase):
    def test_optional_features_follow_the_image(self):
        base = {"P25", "P25_NATIVE", "NXDN", "P25_TRUNK", "P25_PHASE2"}
        for optional in (set(), {"DV_AES", "P25_TRUNK_TX"}):
            with self.subTest(optional=optional), tempfile.TemporaryDirectory() as tmp:
                data = Path(tmp) / "data"
                data.mkdir()
                files = {
                    "features": {"features": []},
                    "releases": {"releases": [{"features": ",".join(sorted(base | optional))}]},
                    "radios": {"radios": [{"id": "dm32", "config": {
                        "full": ["DMR", "DV_AES", "P25_TRUNK_TX"]}}]},
                }
                for name, value in files.items():
                    (data / (name + ".json")).write_text(json.dumps(value), encoding="utf-8")
                subprocess.run([sys.executable, str(Path(__file__).with_name("p25_data.py")), tmp],
                               check=True, capture_output=True)
                radio = json.loads((data / "radios.json").read_text(encoding="utf-8"))["radios"][0]
                self.assertEqual(set(radio["config"]["full"]), base | optional | {"DMR"})
                self.assertEqual("Trunk TX is experimental" in radio["support"], "P25_TRUNK_TX" in optional)


if __name__ == "__main__":
    unittest.main()
