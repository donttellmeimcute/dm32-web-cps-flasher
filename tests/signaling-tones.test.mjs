// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { CodeplugImage } from "../static/js/codeplug/image.js";
import { empty, decode, encode, validate } from "../static/js/codeplug/model.js";
import { areaForWrite, decodeArea, getValue, putArea, RECORD_KEYS, recordValue } from "../static/js/codeplug/kv.js";

const begin = { dmr: 2, fm: 4, hz: [1050, 0, 1050, 0, 1050, 0, 1400, 0, 1800, 1450],
	ms: [70, 20, 30, 20, 60, 30, 100, 10, 100, 80] };
const unknown = { key: 0x7F00, value: Uint8Array.of(1, 2, 3) };

test("reads the legacy five steps and writes all ten without losing other settings", () => {
	const image = CodeplugImage.blank();
	const key = RECORD_KEYS[0].key;
	const bytes = recordValue(begin);
	assert.deepEqual([...bytes.slice(0, 17)], [2, 4, 26, 4, 0, 0, 26, 4, 0, 0, 26, 4, 7, 2, 3, 2, 6]);
	putArea(image.bytes, [{ key, value: bytes.slice(0, 17) }, unknown]);
	const model = decode(image);
	assert.deepEqual(model.general.sigBegin.ms, [70, 20, 30, 20, 60, 0, 0, 0, 0, 0]);
	assert.deepEqual(encode(model).bytes, image.bytes);
	model.general.sigBegin = begin;
	model.general.callEndTone = false;
	const edited = encode(model);
	assert.deepEqual(decode(edited).general.sigBegin, begin);
	assert.equal(decode(edited).general.callEndTone, false);
	assert.deepEqual(getValue(decodeArea(edited.bytes).entries, unknown.key), unknown.value);
});

test("a write to radio merges tone edits and removals with the radio's own keys", () => {
	const model = empty();
	model.general.sigBegin = begin;
	const base = encode(model);
	const edited = decode(base);
	edited.general.sigBegin = null;
	edited.general.sigEnd = { ...begin, dmr: 3, fm: 1 };
	const file = encode(edited);
	const radio = base.clone();
	putArea(radio.bytes, [...decodeArea(radio.bytes).entries, unknown]);
	areaForWrite(file.bytes, radio.bytes, base.bytes);
	const settings = decode(file).general;
	assert.equal(settings.sigBegin, null);
	assert.deepEqual(settings.sigEnd, edited.general.sigEnd);
	assert.deepEqual(getValue(decodeArea(file.bytes).entries, unknown.key), unknown.value);
});

test("channel clear accepts only local output and steps use increments of ten", () => {
	const model = empty();
	model.general.sigIdle = begin;
	model.general.sigBegin = { ...begin, ms: [71, ...begin.ms.slice(1)] };
	const errors = validate(model).filter((problem) => problem.level === "error");
	assert.deepEqual(errors.map((problem) => problem.field), ["sigBegin", "sigIdle"]);
});
