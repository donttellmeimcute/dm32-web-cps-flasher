#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry Authors
# Modifications (c) 2026 lyra XE1POC.
"""Patch a scratch copy of the RadioFoundry tree's site/ for the DM-32UV-only Open25-DM32 site (never the original
tree). Every text edit must match exactly once, so an upstream change fails here instead of shipping half a patch.

    python3 patch_tree.py SCRATCH_TREE
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(sys.argv[1], "site")


def edit(rel, pairs, count=1):
	p = os.path.join(SITE, rel)
	with open(p, encoding="utf-8") as f:
		text = f.read()
	for old, new in pairs:
		n = text.count(old)
		if n != count and not (count is None and n):
			raise SystemExit("%s: %r found %d times" % (rel, old[:70], n))
		text = text.replace(old, new)
	with open(p, "w", encoding="utf-8") as f:
		f.write(text)


def between(rel, start, end, new):
	"""Replace start..end (end kept) with new."""
	p = os.path.join(SITE, rel)
	with open(p, encoding="utf-8") as f:
		text = f.read()
	a, b = text.find(start), text.find(end)
	if a < 0 or b < a or text.count(start) != 1 or text.count(end) != 1:
		raise SystemExit("%s: markers %r .. %r not found once" % (rel, start[:50], end[:50]))
	with open(p, "w", encoding="utf-8") as f:
		f.write(text[:a] + new + text[b:])


# languages: Spanish at the root, English under en/
with open(os.path.join(SITE, "i18n", "languages.json"), encoding="utf-8") as f:
	langs = json.load(f)
langs["default"] = "es"
langs["languages"] = [l for c in ("es", "en") for l in langs["languages"] if l["code"] == c]
with open(os.path.join(SITE, "i18n", "languages.json"), "w", encoding="utf-8") as f:
	json.dump(langs, f, indent=2, ensure_ascii=False)
	f.write("\n")
for code in ("es", "en"):
	p = os.path.join(SITE, "i18n", code + ".json")
	with open(p, encoding="utf-8") as f:
		cat = json.load(f)
	with open(os.path.join(HERE, "i18n", code + ".json"), encoding="utf-8") as f:
		cat.update(json.load(f))
	with open(p, "w", encoding="utf-8") as f:
		json.dump(cat, f, indent=1, ensure_ascii=False)
		f.write("\n")
os.remove(os.path.join(SITE, "i18n", "it.json"))

for rel in ("templates/home.html", "templates/base.html", "templates/partials/beta_notice.html"):
	shutil.copy(os.path.join(HERE, rel), os.path.join(SITE, rel))
shutil.copy(os.path.join(HERE, "build_dm32.py"), os.path.join(SITE, "build_dm32.py"))

# pink accent: the firmware's new default light theme
edit("static/css/tokens.css", [("--accent: #b8431f;", "--accent: #c2185b;"), ("--accent-soft: #fbe9e2;", "--accent-soft: #fce4ec;"),
			       ("--accent: #ef7a50;", "--accent: #f48fb1;"), ("--accent-soft: #3a2219;", "--accent-soft: #3a1a2a;")], count=None)

# the codeplug editor's practice radio is a DM-32UV (the only radio in radios.json here)
edit("static/js/editor/app.js", [('new FakeCpsRadio({ board: "DM-1701",', 'new FakeCpsRadio({ board: "DM-32UV",')])

APP = "static/js/flasher/app.js"
edit(APP, [
	# nothing goes to RadioFoundry's backend (api.radiofoundry.org) from this site: no flash log, no problem reports
	# posted there (the report is still offered as a download), no vendor file samples
	('const FLASH_LOG = new URLSearchParams(location.search).get("reporting") !== "0";',
	 'const FLASH_LOG = false;	// Open25-DM32 site: no flash log is sent to the RadioFoundry backend'),
	('initReporting({ tool: "flasher", context: reportContext, attachments: reportAttachments, backend: { api: API, meta: reportMeta, practice: () => !!S.sim || SIM_HASH.test(location.hash) } });',
	 'initReporting({ tool: "flasher", context: reportContext, attachments: reportAttachments });'),
	("function analysisOffer(cand, boardId, problem = null) {",
	 "// Open25-DM32 site: no backend to send vendor files to (the upstream offer is kept below, unused)\n"
	 "const analysisOffer = () => null;\n"
	 "// eslint-disable-next-line no-unused-vars\n"
	 "function analysisOfferUpstream(cand, boardId, problem = null) {"),
	# the update installs the hosted image as it is: no build to keep, edit or extend
	('S.editBuild = S.current.kind === "unknown";', 'S.editBuild = false;	// Open25-DM32 site: one hosted image, no build to edit'),
	(',\n\t\t\t\th("dt", {}, t("flash.update.build")), h("dd", {}, buildText, " ", cur.kind === "unknown" ? null : edit))', ")"),
	# (no feature plan either: what a new image drops is told in flash.task.update.text, i18n/*.json)
	('\t\t\tcur.kind === "unknown" ? notice(t("flash.update.unknown_text", { variant: vtitle(cur.guess) }), "info") : null,\n'
	 "\t\t\tS.editBuild ? null : startAsk, S.editBuild ? null : dropped, S.editBuild ? null : asks, S.editBuild ? null : added, "
	 "S.editBuild ? null : needed, backup,", "\t\t\tbackup,"),
	("disabled: busy || (!S.editBuild && !plan.ready) || (S.updateBackup && !!backupPanel) }),\n"
	 '\t\t\tS.editBuild || plan.ready ? null : t(plan.dropped.length && !S.decided[DROP_OK] ? "flash.update.drop_first"\n'
	 '\t\t\t\t: plan.startAsk.length && !(START_KEEP in S.decided) ? "flash.update.start_first" : "flash.update.decide_first"));',
	 "disabled: busy || (S.updateBackup && !!backupPanel) }));"),
])

between(APP, "function buildView() {", "// Escape closes the open ⓘ bubble", """\
// Open25-DM32 site: the firmware step. One image, hosted on this site (data/releases.json), no feature choice and no
// build service; or the user's own DM-32 build with its manifest
function buildView() {
	const wrap = h("div", { class: "flasher" });
	const go = async () => {
		if (!S.firmware && S.sim) await ensureFirmware();
		if (!S.firmware && !S.sim) await requestBuild(draw);
		if (S.firmware) next();
	};
	const draw = () => {
		const rel = S.data.releases.filter((x) => x.board === S.radio.id).at(-1);
		const busy = !!S.build && !S.build.error;
		S.forward(button(busy ? [spinner(), t("flash.fw.loading")] : t(`flash.nav.to_${stepsFor()[S.step + 1]}`), go,
			{ primary: true, disabled: busy || (!rel && !S.firmware && !S.sim) }));
		const image = S.firmware ? notice(t("flash.build.image_ready", { what: S.firmware.source }), "ok")
			: S.build?.error ? buildErrorNotice(S.build.error)
			: busy ? h("p", { class: "muted", role: "status" }, spinner(), S.build.text)
			: S.sim ? h("p", { class: "small muted" }, t("flash.sim.image")) : null;
		wrap.replaceChildren(panel(t("flash.fw.title"),
			rel ? h("dl", { class: "kv-list" },
				h("dt", {}, t("flash.fw.version")), h("dd", {}, (rel.name || rel.version)),
				h("dt", {}, t("flash.fw.size")), h("dd", {}, t("flash.fw.kb", { n: Math.round(rel.size / 1024) })),
				h("dt", {}, "SHA-256"), h("dd", {}, h("code", { class: "small" }, rel.sha256)))
				: notice(t("flash.build.no_image"), "bad"),
			h("p", {}, t("flash.fw.lead")),
			h("p", { class: "small muted" }, t("flash.fw.codec")),
			image,
			h("details", { class: "small" }, h("summary", {}, t("flash.build.self_title")),
				h("p", {}, t("flash.fw.self_text")),
				filePicker(t("flash.build.own_image"), ".bin", (f) => loadOwnImage(f, draw)),
				filePicker(t("flash.build.own_manifest"), ".json", async (f) => { S.ownManifest = JSON.parse(new TextDecoder().decode(f.data)); }))));
	};
	draw();
	return wrap;
}

""")

between(APP, "// Ask the build API for the current selection, wait for it, and take the image like a release's",
	"// What to do about a build too big for the radio", """\
// Open25-DM32 site: the image this site hosts (site/build.py --firmware: firmware/<board>/, listed in releases.json),
// fetched from the same origin and checked against its manifest like a release's. There is no build service for this
// derivative, so the selection is not sent anywhere
async function requestBuild(redraw) {
	const key = selectionKey(S.selection);
	S.build = { selection: key, text: t("flash.fw.loading") };
	redraw();
	try {
		const catalog = await fetch(`${ROOT}data/releases.json?check=${Date.now()}`, { cache: "no-store" });
		if (!catalog.ok) throw new Error(`releases.json: HTTP ${catalog.status}`);
		S.data.releases = (await catalog.json()).releases || [];
		const rel = S.data.releases.filter((x) => x.board === S.radio.id).at(-1);
		if (!rel) throw new Error(t("flash.build.no_image"));
		const get = async (url) => {
			const r = await fetch(ROOT + url, { cache: "no-cache" });
			if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
			return r;
		};
		const [m, img] = await Promise.all([get(rel.manifest).then((r) => r.json()),
			get(rel.image).then((r) => r.arrayBuffer()).then((x) => new Uint8Array(x))]);
		if (m.image?.sha256 !== rel.sha256) throw new Error(`${rel.manifest} is not the manifest releases.json lists`);
		await verify(m, img, fb(), S.board.id);
		S.firmware = { manifest: m, image: img, source: t("flash.fw.source", { version: m.version }), origin: "release", variant: m.variant || "full" };
		S.build = null;
	} catch (e) {
		if (S.build?.selection === key) S.build.error = { text: t("flash.fw.unavailable", { error: errorText(e) }), rec: diag.currentError() };
	}
	redraw();
}

""")
print("patched", SITE)
