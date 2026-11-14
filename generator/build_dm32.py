#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry Authors
# Modifications (c) 2026 lyra XE1POC: the DM-32UV-only site of the Open25-DM32 P25/NXDN derivative.
"""site/build.py, cut down to the DM-32UV: a landing page, the web flasher and the codeplug editor, for a static host
under a subpath (GitHub Pages). Runs the RadioFoundry generator unchanged (rfoundrysite.build.Site) and only overrides
which radios and pages it makes.

    python3 site/build_dm32.py --out DIR --firmware DIST --repo-url URL
"""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rfoundrysite import build as B, i18n, toolzip  # noqa: E402

B.SITE_URL = "https://donttellmeimcute.github.io/dm32-web-cps-flasher/"
B.COMMUNITY_URL = "https://github.com/donttellmeimcute/DM32-nxdn-p25/issues"
RADIO = "dm32"


class DM32Site(B.Site):
	def load(self):
		super().load()
		self.boards = [b for b in self.boards if b["id"] == RADIO]
		self.planned = []

	def nav(self, lang, home, current):
		items = [("flash", "flash/index.html"), ("codeplug", "codeplug/index.html")]
		return "".join('<a href="%s%s"%s>%s</a>' % (home, href, ' aria-current="page"' if key == current else "",
							    B.html.escape(self.i18n.t(lang, "nav." + key))) for key, href in items)

	def home(self, lang):
		b = self.boards[0]
		self.drawn(b, b["frame_geometry"], B.shots.css_px(".hero-device img", "max-height") * b["frame_geometry"]["aspect"])
		self.page(lang, "index.html", self.t(lang, "home.title"), self.tpl.render("home", {"radio_id": b["id"], "radio_name": b["name"]}, lang), "home")

	def flash_page(self, lang):
		super().flash_page(lang)
		# no flash log is sent from this site (static/js/flasher/app.js FLASH_LOG): its privacy note goes
		p = os.path.join(self.out, self.i18n.prefix(lang), "flash", "index.html")
		with open(p, encoding="utf-8") as f:
			text = f.read()
		start = text.find('<details class="wrap flash-log small">')
		end = text.find("</details>", start)
		if start < 0 or end < 0:
			raise B.repo.SourceError("flash page: no flash log note to take out")
		with open(p, "w", encoding="utf-8") as f:
			f.write(text[:start] + text[end + len("</details>"):])

	def build(self):
		"""Site.build() with the landing, flasher, editor and 404 pages only (no docs, radio, feature, screenshot or
		tools pages, no link preview image)."""
		self.load()
		if os.path.isdir(self.out):
			shutil.rmtree(self.out)
		os.makedirs(self.out)
		shutil.copytree(B.repo.path("site", "static"), os.path.join(self.out, "static"))
		self.version_imports(os.path.join(self.out, "static", "js"))
		shutil.rmtree(os.path.join(self.out, "static", "img", "radios", "src"), ignore_errors=True)
		for b in self.boards:
			img = B.device.render(b, b["name"])
			self.write("static/img/radios/%s-frame.svg" % b["id"], img["frame"])
			b["frame_geometry"] = img["geometry"]
			b["render"] = img
			b["look_renders"] = {}
		self.tool = toolzip.write(os.path.join(self.out, "downloads"))
		for name, obj in self.json_data().items():
			self.write("data/" + name, json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
		self.copy_firmware()
		for lang in self.i18n.codes:
			self.home(lang)
			self.flash_page(lang)
			self.codeplug_page(lang)
			self.not_found(lang)
		for b in self.boards:
			self.write("static/img/radios/%s.svg" % b["id"], B.device.boot(b["render"], self.shots.scaled(b["gallery"], "boot")))
		self.shots.write(self.out)
		self.write(".nojekyll", "")
		self.check_links()
		for problem in i18n.check(self.i18n_dir):
			self.warn(problem)
		return self.warnings


def main():
	ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	ap.add_argument("--out", required=True)
	ap.add_argument("--firmware", required=True, help="tools/release.py --out: the image and its manifest")
	ap.add_argument("--repo-url", required=True)
	args = ap.parse_args()
	site = DM32Site(args.out, args.repo_url, "main", firmware=args.firmware)
	warnings = site.build()
	if not site.releases:
		print("no release manifest in %s" % args.firmware, file=sys.stderr)
		return 1
	print("site: %s (%d warnings)" % (args.out, len(warnings)))
	return 0


if __name__ == "__main__":
	sys.exit(main())
