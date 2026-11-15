#!/bin/bash
# SPDX-License-Identifier: MIT
# Builds the static DM32 Web CPS & Flasher site (dm32-web-cps-flasher) from the derived RadioFoundry tree with the
# RadioFoundry site generator. The tree is only read: everything happens in a scratch copy under $W.
#
#   bash gen.sh                      (in WSL, as a user that can read $SRC)
#   SRC=... BUILD=... OUT=... bash gen.sh
set -euo pipefail
GEN=$(cd "$(dirname "$0")" && pwd)
SRC=${SRC:-/var/tmp/codex-dm32-5abf48c-20261113/work/NXDN-Open25-DM32-kali/build/radiofoundry-p25}
BUILD=${BUILD:-$SRC/build/dm32-p25-native}
OUT=${OUT:-$(dirname "$GEN")/dm32-web-cps-flasher}
W=${W:-/var/tmp/dm32web}
FW_REPO=https://github.com/donttellmeimcute/DM32-nxdn-p25

read -r VERSION _ < "$BUILD/version"
GIT_FULL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upstream_commit"])' "$BUILD/rfoundry_dm32.json")
# the build's own CONFIG_*/CROSS overrides, so make print-config (tools/release.py) lists what the image really has
CFG=$(python3 -c 'import json,sys; print(" ".join(a for a in json.load(open(sys.argv[1]))["command"] if a.startswith(("CONFIG_","CROSS="))))' "$BUILD/rfoundry_dm32.json")

rm -rf "$W"; mkdir -p "$W/rf" "$W/dist"
tar -C "$SRC" --exclude=./build -cf - . | tar -C "$W/rf" -xf -
cd "$W/rf"

# 1. the release image and its rfoundry-release/1 manifest, by the upstream tool (it refuses an image with the codec)
MAKEFLAGS="$CFG" python3 tools/release.py --board dm32 --version "$VERSION" --git "$GIT_FULL" \
	--bin "$BUILD/rfoundry_dm32.bin" --out "$W/dist"

# 2. the site: the RadioFoundry generator, patched for the DM-32UV only (patch_tree.py, build_dm32.py)
python3 "$GEN/patch_tree.py" "$W/rf"
python3 site/build_dm32.py --out "$W/site" --firmware "$W/dist" --repo-url "$FW_REPO"

# 3. trim what only other radios or dropped pages use
cd "$W/site"
rm -f static/js/tools.js data/f4-stub.json data/screens.json
gal=$(python3 -c 'import json; print(json.load(open("data/radios.json"))["radios"][0]["gallery"])')
find static/img/screens -mindepth 1 -maxdepth 1 -type d ! -name "$gal" -exec rm -rf {} +
find "static/img/screens/$gal" -type f ! -name boot.png ! -name stub_entry.png -delete
cp "$W/dist/SHA256SUMS" firmware/dm32/

# 4. the repository's own files: README, licenses, the firmware helper
if [ -d "$GEN/repo" ]; then cp -r "$GEN/repo/." "$W/site/"; fi	# in the published repo these live at the root
mkdir -p firmware/LICENSES
cp "$SRC/../../LICENSE" firmware/LICENSES/GPL-3.0-or-later.txt
cp "$SRC/../../LICENSES/mbelib-ISC.txt" firmware/LICENSES/
cp "$SRC"/LICENSES/*.txt firmware/LICENSES/
cp "$SRC/COPYING-P25" "$SRC/P25-DERIVATIVE.txt" firmware/LICENSES/

# 5. this repository's own layer: its look (static/css, kept from the repository) and the P25/NXDN feature data
if [ -d "$OUT/static/css" ]; then cp "$OUT"/static/css/*.css "$W/site/static/css/"; fi
python3 "$GEN/p25_data.py" "$W/site"

# copied over the repository, never a rm -rf of it: .git, android/ and generator/ stay; git status shows the rest
mkdir -p "$OUT"; rm -rf "$OUT/firmware/dm32"
cp -r "$W/site/." "$OUT/"
echo "site written to $OUT"
