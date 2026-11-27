// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, empty, encode, newChannel } from "../static/js/codeplug/model.js";
import { channelAddr, FM_SQUELCH_OPEN } from "../static/js/codeplug/records.js";
import { CpsSerial } from "../static/js/codeplug/transport.js";
import { channelForm } from "../static/js/editor/views.js";
import { exportTable, importTable } from "../static/js/codeplug/csv.js";
import { crc32 } from "../static/js/flasher/bytes.js";

test("editing only the FM squelch writes the on-radio level through both CPS plans", async () => {
	const model = empty();
	model.channels.push(newChannel({ name: "Local FM", rxHz: 146520000, txHz: 146520000, squelch: 5 }));
	const addr = channelAddr(1) + 0x37;
	const field = channelForm(model, (key) => key).find((f) => f.key === "squelch");
	const channel = model.channels[0];
	const cps = new CpsSerial({});
	cps.fastSums = async (blocks) => new Map(blocks.map((a) => [a, {
		crc: crc32(have.bytes.subarray(a, a + 4096)), blank: false,
	}]));

	let have = encode(model);
	assert.equal(field.get(channel), 3);
	field.set(channel, 3);
	assert.equal(encode(model).bytes[addr], 5, "leaving the selection alone preserves the old encoding");
	const changes = [[2, 4], [null, 0], [0, FM_SQUELCH_OPEN]];
	for (const [choice, raw] of changes) {
		field.set(channel, choice);
		const want = encode(model);
		assert.equal(want.bytes[addr], raw);
		assert.equal(field.get(decode(want).channels[0]), choice);
		assert.deepEqual(cps.cpsPlan(want, have).plan, [[addr & ~4095, [[addr, Uint8Array.of(raw)]]]]);
		const { plan } = await cps.fastPlan(want, have);
		assert.equal(plan.length, 1);
		assert.equal(plan[0][0], addr & ~4095);
		assert.equal(plan[0][1][addr % 4096], raw);
		have = want;
	}

	const imported = empty();
	assert.deepEqual(importTable(imported, exportTable(model, "channels"), "channels").problems, []);
	assert.equal(imported.channels[0].squelch, FM_SQUELCH_OPEN);
});
