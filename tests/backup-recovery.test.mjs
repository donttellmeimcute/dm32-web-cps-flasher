// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors

import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeC7000 } from "../static/js/flasher/fakec7000.js";
import { SECTOR, Stub } from "../static/js/flasher/stub.js";

const failingSector = 0x1C6000;
const start = failingSector - SECTOR;
const end = failingSector + 3 * SECTOR;

function radio({ loseSingles = false, corruptChunk = false, misplaceNeighbor = false } = {}) {
	const fake = new FakeC7000({ progmem: new Uint8Array(0x100000), speed: 200 });
	fake.state = "stub";
	const expected = fake.q128.subarray(start, end);
	for (let i = 0; i < expected.length; i++) expected[i] = (i ^ (i >>> 7) ^ (i >>> 12)) & 0xFF;

	const requests = [];
	const chunks = [];
	const write = fake.stream.write.bind(fake.stream);
	const reply = fake.reply.bind(fake);
	fake.stream.write = async (frame) => {
		if (frame[1] !== 0x09 && !(frame[1] === 0x05 && frame[16] === 0x03)) {
			await write(frame);
			return;
		}
		if (frame[1] === 0x05) {
			const addr = (frame[17] << 16) | (frame[18] << 8) | frame[19];
			chunks.push([addr, (frame[14] << 8) | frame[15]]);
			fake.reply = (status, body) => {
				if (corruptChunk) body[0] ^= 1;
				reply(status, body);
			};
		} else {
			const addr = new DataView(frame.buffer, frame.byteOffset).getUint32(12);
			const count = frame[16];
			requests.push([addr, count, frame[17]]);
			if (misplaceNeighbor && addr === failingSector + SECTOR && count > 1) fake.faults.misplace.push(addr);
			let replyAddr = addr;
			fake.reply = (status, body) => {
				if (replyAddr === failingSector && (loseSingles || count > 1)) fake.send(new Uint8Array(6));
				else reply(status, body);
				replyAddr += SECTOR;
			};
		}
		try {
			await write(frame);
		} finally {
			fake.reply = reply;
		}
	};
	return { fake, expected, requests, chunks };
}

test("a stream error retries the failing sector alone and resumes at the next sector", async (t) => {
	const { fake, expected, requests, chunks } = radio();
	t.after(() => fake.stop());
	const stub = new Stub(fake.stream, { retries: 2 });
	const progress = [];
	assert.deepEqual(await stub.dump("q128", start, end, { progress: (done) => progress.push(done) }), expected);
	assert.deepEqual(requests, [[start, 4, 1], [failingSector, 3, 1], [failingSector, 1, 0], [failingSector + SECTOR, 2, 1]]);
	assert.deepEqual(progress, [SECTOR, 2 * SECTOR, 3 * SECTOR, 4 * SECTOR]);
	assert.equal(chunks.length, 0);
	assert.equal(fake.writes, 0);
});

test("a sector with repeatedly damaged headers is recovered using verified 1 KiB reads", async (t) => {
	const { fake, expected, chunks } = radio({ loseSingles: true, misplaceNeighbor: true });
	t.after(() => fake.stop());
	const stub = new Stub(fake.stream, { retries: 2 });
	assert.deepEqual(await stub.dump("q128", start, end), expected);
	assert.deepEqual(chunks, [0, 1024, 2048, 3072].map((offset) => [failingSector + offset, 1024]));
	assert.equal(stub.retried, 4, "the final CRC pass also repaired the misplaced neighboring sector");
	assert.equal(fake.writes, 0);
});

test("a corrupted short SPI reply with a valid frame checksum cannot complete the backup", async (t) => {
	const { fake } = radio({ loseSingles: true, corruptChunk: true });
	t.after(() => fake.stop());
	const stub = new Stub(fake.stream, { retries: 2 });
	await assert.rejects(stub.dump("q128", start, end), /0x1c6000: no clean read.*smaller SPI reads failed.*radio's CRC/);
	assert.equal(fake.writes, 0);
});
