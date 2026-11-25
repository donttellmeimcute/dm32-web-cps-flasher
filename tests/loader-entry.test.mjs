// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { concat, le32 } from "../static/js/flasher/bytes.js";
import { frame, Link, parseFrames } from "../static/js/flasher/link.js";
import { STUB_MAGIC, Stub, stubImages } from "../static/js/flasher/stub.js";

const image = stubImages(JSON.parse(readFileSync(new URL("../data/c7000-stub.json", import.meta.url), "utf8"))).image;
const text = new TextEncoder();

function debugStream({ mode = "fm", viewStatus = 0, enterStatus = 0 } = {}) {
	const requests = [];
	const stream = {
		buf: new Uint8Array(0),
		clear() { this.buf = new Uint8Array(0); },
		take(n) { this.buf = this.buf.subarray(n); },
		async write(data) {
			const [{ cmd, seq, payload }] = parseFrames(data);
			requests.push([cmd, payload[0]]);
			let body = new Uint8Array([0]);
			if (cmd === 0x09)
				body = concat(new Uint8Array([viewStatus, 0, 0, 0, 0, 0xFF]), text.encode(`section=core\nmode=${mode}\n`));
			else if (payload[0] === 0)
				body = concat(body, le32(STUB_MAGIC), le32(0x44000), le32(0x14000), new Uint8Array([59, 0]));
			else if (payload[0] === 3)
				body = new Uint8Array([enterStatus]);
			this.buf = frame(cmd | 0x80, seq, body);
		},
	};
	return { stream, requests };
}

test("C7000 entry recognizes modes that share the loader's RAM", async () => {
	for (const [mode, features, viewStatus, expected] of [
		["m17", "FM,DMR,M17", 0, true],
		["dstar", "FM,DSTAR", 0, true],
		["?", "FM,DSTAR", 0, true],
		["fm", "FM,DSTAR,M17", 0, false],
		["?", "FM,DMR,M17", 0, false],
		["fm", "FM,DSTAR", 3, false],
	]) {
		const { stream, requests } = debugStream({ mode, viewStatus });
		assert.equal(await Stub.rfoundryUsesCodecWindow(new Link(stream), features), expected, mode);
		assert.deepEqual(requests, [[0x09, 0]], "mode check is read-only");
	}
	const { stream, requests } = debugStream();
	assert.equal(await Stub.rfoundryUsesCodecWindow(new Link(stream), "FM,DMR"), false);
	assert.deepEqual(requests, []);
});

test("status 2 at ENTER reports a RAM transfer error before jumping", async () => {
	const { stream, requests } = debugStream({ enterStatus: 2 });
	const stub = new Stub(stream);
	stub.afterJump = () => assert.fail("the radio refused the jump");
	await assert.rejects(stub.enterFromRFoundry(image), { code: "stub-transfer", message: /CRC mismatch, status 2/ });
	assert.deepEqual(requests.at(-1), [0x1A, 3]);
});

test("loader entry preserves a distinct status 7 and still accepts a valid transfer", async () => {
	const refused = new Stub(debugStream({ enterStatus: 7 }).stream);
	await assert.rejects(refused.enterFromRFoundry(image), { status: 7, message: /status 7/ });
	const normal = new Stub(debugStream().stream);
	let jumped = false;
	normal.afterJump = () => { jumped = true; };
	await normal.enterFromRFoundry(image);
	assert.ok(jumped);
});
