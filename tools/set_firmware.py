#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 lyra XE1POC
"""Point the site at a new DM-32UV firmware image. Takes the image's rfoundry-release/1 manifest (made by
tools/release.py in the firmware tree, the image next to it), copies both into firmware/dm32/ (removing the old ones)
and rewrites data/releases.json, the list the flasher installs from, and firmware/dm32/SHA256SUMS.

    python tools/set_firmware.py path/to/rfoundry-dm32-<version>.json

Refuses a manifest for another radio, one that says it includes the codec, an image that doesn't match it, and an
image that would reach the codec's flash window: this repository must never carry the AMBE codec.
"""
import datetime
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "firmware", "dm32")
PAGES = ("index.html", "404.html", "flash/index.html", "codeplug/index.html",
	 "en/index.html", "en/404.html", "en/flash/index.html", "en/codeplug/index.html")


def main(man_path):
	with open(man_path, encoding="utf-8") as f:
		m = json.load(f)
	if m.get("format") != "rfoundry-release/1" or m.get("board") != "dm32":
		sys.exit("not a DM-32 rfoundry-release/1 manifest")
	name = m["image"]["file"]
	with open(os.path.join(os.path.dirname(os.path.abspath(man_path)), name), "rb") as f:
		image = f.read()
	sha = hashlib.sha256(image).hexdigest()
	if len(image) != m["image"]["size"] or sha != m["image"]["sha256"]:
		sys.exit("%s doesn't match its manifest" % name)
	end = int(m["ranges"][0]["addr"], 16) + len(image)
	if m["codec"]["included"] or "codec" in name or any(end > int(w["addr"], 16) for w in m["codec"]["windows"]):
		sys.exit("refused: %s would carry or reach the codec" % name)
	base = name[:-len(".bin")]
	for old in os.listdir(DIR):
		if old.startswith("rfoundry-dm32-"):
			os.remove(os.path.join(DIR, old))
	with open(os.path.join(DIR, name), "wb") as f:	# from memory: the old files may have been the ones given
		f.write(image)
	text = json.dumps(m, indent=2) + "\n"
	with open(os.path.join(DIR, base + ".json"), "w", encoding="utf-8", newline="\n") as f:
		f.write(text)
	with open(os.path.join(DIR, "SHA256SUMS"), "w", encoding="ascii", newline="\n") as f:
		f.write("%s  %s\n%s  %s.json\n" % (sha, name, hashlib.sha256(text.encode()).hexdigest(), base))
	# the entry site/rfoundrysite/build.py release_list() writes
	entry = {"board": "dm32", "variant": m.get("variant", "full"), "version": m["version"], "name": "NXDN-P25-DM32 " + m["version"], "git": m.get("git"),
		 "git_time": m.get("git_time"), "features": m.get("features", ""), "off": m.get("off"),
		 "image": "firmware/dm32/" + name, "manifest": "firmware/dm32/%s.json" % base,
		 "size": len(image), "sha256": sha}
	with open(os.path.join(ROOT, "data", "releases.json"), "w", encoding="utf-8", newline="\n") as f:
		f.write(json.dumps({"releases": [entry]}, indent=1, ensure_ascii=False) + "\n")
	pages = stamp_pages(m["version"], m.get("git_time"))
	print("firmware/dm32/%s (%d bytes, %s), data/releases.json and %d page footers updated" %
	      (name, len(image), m["version"], pages))


# The footer's stamp ("Changelog · <site git> · <site build time>") stayed at the last site build, so after a firmware
# sync every page still showed the old date: it names the firmware the site offers instead, with that build's time
STAMP = re.compile(r'(<p class="build-stamp">.*?</a>) · [^<]* · <time datetime="[^"]*">[^<]*</time></p>')


def stamp_pages(version, git_time):
	when = datetime.datetime.fromtimestamp(git_time or 0, datetime.timezone.utc)
	new = r'\1 · NXDN-P25-DM32 %s · <time datetime="%s">%s</time></p>' % (
		version, when.strftime("%Y-%m-%dT%H:%MZ"), when.strftime("%Y-%m-%d %H:%M UTC"))
	count = 0
	for page in PAGES:
		path = os.path.join(ROOT, page)
		with open(path, encoding="utf-8") as f:
			text = f.read()
		stamped, n = STAMP.subn(new, text)
		if n != 1:
			sys.exit("%s: no build stamp to update" % page)
		if stamped != text:
			with open(path, "w", encoding="utf-8", newline="\n") as f:
				f.write(stamped)
			count += 1
	return count


if __name__ == "__main__":
	if len(sys.argv) != 2:
		sys.exit(__doc__)
	main(sys.argv[1])
