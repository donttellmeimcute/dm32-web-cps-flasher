// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const template = readFileSync(new URL("patch_tree.py", import.meta.url), "utf8");
const request = template.match(/async function requestBuild\(redraw\) \{[\s\S]*?\n\}/)[0];

test("a second install in the same tab refreshes the catalog and verifies the new image", async () => {
	let version = "old", verified = [], requests = [], badManifest = false, offline = false;
	const S = { selection: {}, data: { releases: [] }, radio: { id: "dm32" }, board: { id: "dm32" } };
	const context = vm.createContext({
		S, ROOT: "/", selectionKey: () => "dm32", t: (s) => s, fb: () => ({}),
		errorText: String, diag: { currentError: () => null },
		verify: async (manifest, image, backend, board) => {
			assert.equal(board, "dm32"); assert.deepEqual([...image], [1, 2]);
			verified.push(manifest.version);
		},
		fetch: async (url, options) => {
			requests.push({ url, options });
			if (url.startsWith("/data/releases.json?check=")) {
				assert.equal(options.cache, "no-store");
				return { ok: !offline, status: 503, json: async () => ({ releases: [{ board: "dm32",
					version, manifest: version + ".json", image: version + ".bin", sha256: version }] }) };
			}
			if (url === `/${version}.json`) return { ok: true, json: async () => ({
				version, image: { sha256: badManifest ? "mismatch" : version } }) };
			if (url === `/${version}.bin`) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
			throw new Error("stale image requested: " + url);
		},
	});
	vm.runInContext(request + "\nglobalThis.install = requestBuild;", context);
	await context.install(() => {});
	assert.equal(S.firmware.manifest.version, "old");
	version = "new"; S.firmware = null;
	await context.install(() => {});
	assert.equal(S.firmware.manifest.version, "new");
	assert.deepEqual(verified, ["old", "new"]);
	assert.equal(requests.filter((r) => r.url.startsWith("/data/releases.json")).length, 2);
	badManifest = true; S.firmware = null;
	await context.install(() => {});
	assert.equal(S.firmware, null);
	assert.ok(S.build.error);
	assert.deepEqual(verified, ["old", "new"]);
	offline = true; requests = [];
	await context.install(() => {});
	assert.equal(S.firmware, null);
	assert.equal(requests.length, 1, "failed catalog fetch must not install the stale cached release");
});
