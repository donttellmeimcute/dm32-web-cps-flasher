// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { empty, newChannel, encode, decode, validate } from "../static/js/codeplug/model.js";
import { newSystem, setKind, decodeSystemRecord, MODE_KEY } from "../static/js/codeplug/channelmodes.js";
import { decodeArea, getValue } from "../static/js/codeplug/kv.js";
import { channelAddr } from "../static/js/codeplug/records.js";
import { offeredKinds } from "../static/js/codeplug/modes.js";
import { exportTable, importTable } from "../static/js/codeplug/csv.js";
import { channelForm } from "../static/js/editor/views.js";

test("receive-only Tier III options reach the system block and channel record independently", () => {
	const m = empty();
	const system = newSystem(m, 1, "Amateur");
	system.tx = false;
	system.fields.learnSystem = true;
	system.fields.followAll = true;
	system.entries = [{ cls: 0, chan: 1, control: true, rxHz: 433000000, txHz: 433000000, cc: null }];
	m.systems.push(system);
	const c = newChannel({ name: "Monitor", rxOnly: true });
	m.channels.push(c);
	setKind(m, c, 1);
	c.acceptBadCrc = true;
	const image = encode(m);
	const entries = decodeArea(image.bytes).entries;
	const systemBlock = decodeSystemRecord(getValue(entries, MODE_KEY.system)).block;
	assert.equal(systemBlock[5] & 0x18, 0x18);
	const at = channelAddr(c.number) + 0x2a;
	assert.equal(image.bytes[at] & 0x30, 0x20);
	const saved = decode(image);
	assert.equal(saved.channels[0].acceptBadCrc, true);
	assert.equal(saved.channels[0].tagTx, false);
	assert.equal(saved.systems[0].fields.learnSystem, true);
	assert.deepEqual(encode(saved).bytes, image.bytes);
	saved.channels[0].acceptBadCrc = false;
	const off = encode(saved);
	assert.notEqual(off.bytes[at] & 0x30, 0x20);
	for (const legacy of [0xff, 0xbf, 0x10, 0]) {
		off.bytes[at] = legacy;
		assert.equal(decode(off).channels[0].acceptBadCrc, false);
	}
	const form = channelForm(m, (s) => s, {});
	for (const key of ["acceptBadCrc", "contact", "rxList"])
		assert.equal(form.find((f) => f.key === key).show(c), true, key);
});

test("M17 and D-STAR remain distinct across codeplug and CSV saves", () => {
	const m = empty();
	for (const [kind, name] of [[7, "M17 memory"], [9, "D-STAR memory"]]) {
		const c = newChannel({ name });
		m.channels.push(c);
		setKind(m, c, kind);
	}
	m.channels[0].params = { can: 11, dest: "N0CALL/P" };
	m.channels[1].tagTx = false;
	const saved = decode(encode(m));
	assert.deepEqual(saved.channels.map((c) => c.kind), [7, 9]);
	assert.equal(validate(saved).some((p) => p.code === "mode_kind_unknown"), false);
	assert.deepEqual(offeredKinds(empty(), "DSTAR").map((r) => r.id), [9]);
	const csv = exportTable(saved, "channels"), reread = empty();
	assert.deepEqual(importTable(reread, csv, "channels").problems, []);
	assert.deepEqual(reread.channels.map((c) => [c.kind, c.tagTx, c.params]), saved.channels.map((c) => [c.kind, c.tagTx, c.params]));
});
