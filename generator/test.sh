#!/bin/bash
# Runs the RadioFoundry site's JS tests (site/tests/*.test.mjs) three ways: on an unpatched copy of the tree (baseline),
# on the patched scratch tree gen.sh left in $W/rf, and with that tree's site/static replaced by the trimmed output.
set -uo pipefail
SRC=${SRC:-/var/tmp/codex-dm32-5abf48c-20261113/work/NXDN-Open25-DM32-kali/build/radiofoundry-p25}
GEN=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$(dirname "$GEN")/dm32-web-cps-flasher}
W=${W:-/var/tmp/dm32web}
run() {	# tree label
	cd "$1"
	python3 site/tests/fixtures.py "$W/fx-$2" > "$W/fixtures-$2.log" 2>&1 || { echo "$2: fixtures failed"; tail -5 "$W/fixtures-$2.log"; }
	RFOUNDRY_SITE_FIXTURES="$W/fx-$2" node --test site/tests/*.test.mjs > "$W/tests-$2.log" 2>&1
	echo "== $2: $(grep -E '^ℹ (tests|pass|fail|skipped)' "$W/tests-$2.log" | tr '\n' ' ')"
	awk '/^✖ failing tests:/{f=1} f && /^✖ /' "$W/tests-$2.log" | grep -v "failing tests"
}
if [ -z "${ONLY_OUTPUT:-}" ]; then
	rm -rf "$W/rf0" && mkdir -p "$W/rf0" && tar -C "$SRC" --exclude=./build -cf - . | tar -C "$W/rf0" -xf -
	run "$W/rf0" baseline
	run "$W/rf" patched
fi
# the output's scripts, without the build's cache-busting ?v= on their imports: the tests import the modules without
# it, and the same file under two URLs would be two module instances
rm -rf "$W/rf/site/static" && cp -r "$OUT/static" "$W/rf/site/static"
find "$W/rf/site/static/js" -name '*.js' -exec sed -i -E 's/(\.js)\?v=[0-9a-f]+"/\1"/g' {} +
run "$W/rf" output
