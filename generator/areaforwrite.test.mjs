// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// Tests for the settings area a write to a radio sends (static/js/codeplug/kv.js areaForWrite). A P25 or NXDN channel is
// a DMR receive-only record plus a tag in this area, so a write that loses the file's tags turns those channels into
// DMR. Cloning a codeplug to another radio, or opening a file and writing it unchanged, must keep them.

import test from "node:test";
import assert from "node:assert/strict";
import { areaForWrite, decodeArea, putKeys, KEY, KV_ADDR, KV_SIZE } from "../static/js/codeplug/kv.js";
import { CodeplugImage } from "../static/js/codeplug/image.js";
import { empty, decode, encode, newChannel } from "../static/js/codeplug/model.js";
import { setKind } from "../static/js/codeplug/channelmodes.js";

const P25 = 2, NXDN = 4;

// An image holding an FM channel, a P25 channel and an NXDN channel
function sourceImage() {
	const m = empty();
	m.channels.push(newChannel({ name: "Repeater FM" }));
	for (const [name, kind] of [["Local P25", P25], ["Local NXDN", NXDN]]) {
		const c = newChannel({ name });
		m.channels.push(c);
		setKind(m, c, kind);
		c.baseOwn = false;
	}
	return encode(m);
}

const kinds = (bytes) => decode(CodeplugImage.from(bytes)).channels.map((c) => `${c.name}:${c.kind}:${c.mode}`);
const WANT = ["Repeater FM:0:fm", `Local P25:${P25}:dmr`, `Local NXDN:${NXDN}:dmr`];

test("the source image reads back with its P25 and NXDN kinds", () => {
	assert.deepEqual(kinds(sourceImage().bytes), WANT);
});

test("an unedited file written to a radio with an erased area keeps its tags (new radio)", () => {
	const src = sourceImage();
	const file = src.bytes.slice(), radio = CodeplugImage.blank().bytes;
	assert.equal(decodeArea(radio).state, "empty");
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(kinds(file), WANT);
});

test("an unedited file written to a radio with a different valid area keeps its tags (clone)", () => {
	const src = sourceImage();
	const radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 4242 });
	assert.equal(decodeArea(radio).state, "valid");
	const file = src.bytes.slice();
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(kinds(file), WANT);
});

test("an edited file written to a radio with a different valid area keeps its tags", () => {
	const src = sourceImage();
	const radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 4242 });
	const file = src.bytes.slice();
	putKeys(file, { callEndTone: true });
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(kinds(file), WANT);
});

test("radio-local keys still follow the radio unless the edit changed them", () => {
	const src = sourceImage();
	const radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 4242, batteryTone: true });
	const file = src.bytes.slice();
	putKeys(file, { callEndTone: true });
	areaForWrite(file, radio, src.bytes);
	const entries = decodeArea(file).entries;
	const key = (k) => entries.find((e) => e.key === KEY[k])?.value;
	assert.deepEqual([...key("arsServer")], [0x92, 0x10, 0, 0], "the radio's ARS server stays");
	assert.deepEqual([...key("batteryTone")], [1], "the radio's battery tone stays");
	assert.deepEqual([...key("callEndTone")], [1], "the edit's change is written");
});

test("a file with no settings area never erases the radio's", () => {
	const radio = sourceImage().bytes.slice();
	const file = CodeplugImage.blank().bytes;
	const before = radio.slice(KV_ADDR, KV_ADDR + KV_SIZE);
	areaForWrite(file, radio, CodeplugImage.blank().bytes);
	assert.deepEqual(file.slice(KV_ADDR, KV_ADDR + KV_SIZE), before);
});

test("an area of a newer version on the radio is left as it is", () => {
	const src = sourceImage();
	const radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 1 });
	radio[KV_ADDR + 4] = 2;
	const before = radio.slice(KV_ADDR, KV_ADDR + KV_SIZE);
	const file = src.bytes.slice();
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(file.slice(KV_ADDR, KV_ADDR + KV_SIZE), before);
});

const KEY_P25 = "AB".repeat(32);
const withKey = () => {
	const m = decode(sourceImage());
	m.keyring.push({ slot: null, alg: 0x84, id: 1, flags: 0, key: KEY_P25 });
	return encode(m);
};
const ring = (bytes) => decode(CodeplugImage.from(bytes)).keyring.map((k) => k.key);

test("a traffic key the file doesn't hold stays on the radio", () => {
	const src = sourceImage();
	const file = src.bytes.slice(), radio = withKey().bytes;
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(ring(file), [KEY_P25]);
	assert.deepEqual(kinds(file), WANT);
});

test("a traffic key the edit removed is removed from the radio", () => {
	const keyed = withKey();
	const m = decode(keyed);
	m.keyring.length = 0;
	const file = encode(m).bytes, radio = keyed.bytes.slice();
	areaForWrite(file, radio, keyed.bytes);
	assert.deepEqual(ring(file), []);
});

test("a clone takes the file's traffic keys with its channels", () => {
	const keyed = withKey();
	const file = keyed.bytes.slice(), radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 1 });
	areaForWrite(file, radio, keyed.bytes);
	assert.deepEqual(ring(file), [KEY_P25]);
});

test("the other channel kinds (YSF, M17, D-STAR) keep their tags on a clone too", () => {
	const m = empty();
	const want = [];
	for (const [name, kind] of [["Local YSF", 6], ["Local M17", 7], ["Local D-STAR", 9]]) {
		const c = newChannel({ name });
		m.channels.push(c);
		setKind(m, c, kind);
		c.baseOwn = false;
		want.push(`${name}:${kind}:dmr`);
	}
	const src = encode(m);
	assert.deepEqual(kinds(src.bytes), want);
	const radio = CodeplugImage.blank().bytes;
	putKeys(radio, { arsServer: 4242 });
	const file = src.bytes.slice();
	areaForWrite(file, radio, src.bytes);
	assert.deepEqual(kinds(file), want);
});
