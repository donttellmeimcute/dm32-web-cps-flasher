// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOT_IMAGE_EDGE, BOOT_IMAGE_KEY, packBootImage } from "../static/js/codeplug/bootimage.js";
import { decode, empty, encode } from "../static/js/codeplug/model.js";
import { decodeArea, getValue, putArea, setValue } from "../static/js/codeplug/kv.js";

test("a startup image round-trips alongside other settings and can be removed", () => {
	const pixels = new Uint8ClampedArray(BOOT_IMAGE_EDGE ** 2 * 4);
	pixels.set([255, 255, 255, 255, 170, 170, 170, 255, 85, 85, 85, 255, 255, 255, 255, 0]);
	const image = packBootImage(pixels);
	assert.equal(image[0], 0xe4);
	const model = empty();
	model.general.bootImage = image;
	model.general.batteryTone = true;
	const saved = encode(model);
	const loaded = decode(saved);
	assert.deepEqual(loaded.general.bootImage, image);
	assert.equal(loaded.general.batteryTone, true);
	assert.deepEqual(encode(loaded).bytes, saved.bytes);
	loaded.general.bootImage = null;
	const reset = decode(encode(loaded));
	assert.equal(reset.general.bootImage, undefined);
	assert.equal(reset.general.batteryTone, true);
});

test("an unknown startup image record is preserved by unrelated edits", () => {
	const original = encode(empty());
	const area = decodeArea(original.bytes);
	assert.ok(putArea(original.bytes, setValue(area.entries, BOOT_IMAGE_KEY, [1, 2, 3])));
	const model = decode(original);
	assert.equal(model.general.bootImage, undefined);
	model.general.radioName = "XE1POC";
	assert.deepEqual(getValue(decodeArea(encode(model).bytes).entries, BOOT_IMAGE_KEY), Uint8Array.of(1, 2, 3));
});

test("a transparent black logo is visible and can replace obsolete mode records", () => {
	const pixels = new Uint8ClampedArray(BOOT_IMAGE_EDGE ** 2 * 4);
	pixels.set([0, 0, 0, 255]);
	const image = packBootImage(pixels);
	assert.equal(image[0], 0xc0);
	const saved = encode(empty());
	assert.ok(putArea(saved.bytes, setValue(decodeArea(saved.bytes).entries, 0x0400, new Uint8Array(3500))));
	const model = decode(saved);
	model.general.bootImage = image;
	assert.deepEqual(decode(encode(model)).general.bootImage, image);
});
