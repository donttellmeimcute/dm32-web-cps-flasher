// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOT_IMAGE_EDGE, BOOT_IMAGE_KEY, packBootImage, BOOT_COLOR_EDGE, BOOT_COLOR_AREA, packBootColor, bootColorPalette, bootColorIndex, bootColorForWrite } from "../static/js/codeplug/bootimage.js";
import { FakeCpsRadio } from "../static/js/codeplug/fakecps.js";
import { CpsSerial } from "../static/js/codeplug/transport.js";
import { decode, empty, encode } from "../static/js/codeplug/model.js";
import { decodeArea, getValue, putArea, setValue, areaForWrite } from "../static/js/codeplug/kv.js";

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

function testColor() {
	const pixels = new Uint8ClampedArray(BOOT_COLOR_EDGE ** 2 * 4);
	const colors = Array.from({ length: 16 }, (_, i) => [i & 1 ? 255 : 0, i & 2 ? 255 : 0, (i >> 2) * 85]);
	for (let i = 0; i < BOOT_COLOR_EDGE ** 2; i++) pixels.set([...colors[i & 15], 255], i * 4);
	return packBootColor(pixels);
}

test("the color record uses all 16 colors and survives a file round-trip", () => {
	const model = empty();
	model.general.bootImage = new Uint8Array(1024).fill(255);
	model.general.bootColor = testColor();
	const palette = bootColorPalette(model.general.bootColor);
	const firstRow = Array.from({ length: 16 }, (_, i) => bootColorIndex(model.general.bootColor, i));
	assert.equal(new Set(firstRow).size, 16);
	assert.deepEqual(palette[firstRow[3]], [255, 255, 0]);
	assert.deepEqual(palette[firstRow[15]], [255, 255, 255]);
	const image = encode(model);
	assert.deepEqual(decode(image).general.bootColor, model.general.bootColor);
	assert.deepEqual(encode(decode(image)).bytes, image.bytes);
	image.bytes[BOOT_COLOR_AREA[1] - 1] ^= 1;
	assert.equal(decode(image).general.bootColor, undefined);
	assert.deepEqual(decode(image).general.bootImage, model.general.bootImage);
});

test("a grayscale write by an older CPS overrides the color record", () => {
	const model = empty();
	model.general.bootImage = new Uint8Array(1024).fill(255);
	model.general.bootColor = testColor();
	const saved = encode(model);
	const legacy = new Uint8Array(1024).fill(0x55);
	assert.ok(putArea(saved.bytes, setValue(decodeArea(saved.bytes).entries, BOOT_IMAGE_KEY, legacy)));
	const reloaded = decode(saved);
	assert.equal(reloaded.general.bootColor, undefined);
	assert.deepEqual(reloaded.general.bootImage, legacy);
});

test("a new color splash writes through the serial CPS and older radios only receive grayscale", async () => {
	const model = empty();
	model.general.bootImage = new Uint8Array(1024).fill(255);
	model.general.bootColor = testColor();
	const file = encode(model);
	const codeplug = { names: ["DM-32UV"], base: 0x700000, end: 0xF00000 };
	for (const support of [true, false]) {
		const radio = new FakeCpsRadio({ ...codeplug, board: "DM-32UV",
			features: support ? "FM,DMR,SPLASH_COLOR" : "FM,DMR", image: model.base.bytes });
		const transport = new CpsSerial(radio.stream());
		await transport.identify([{ codeplug }]);
		const before = await transport.read({ iddb: false });
		const written = await transport.write(file, before);
		await transport.verify(file, written.plan);
		const after = decode(await transport.read({ iddb: false }));
		assert.deepEqual(after.general.bootColor, support ? model.general.bootColor : undefined);
		assert.deepEqual(after.general.bootImage, model.general.bootImage);
	}
});

test("a channel-only write preserves the radio splash and explicit reset clears both formats", () => {
	const model = empty();
	model.general.bootImage = new Uint8Array(1024).fill(255);
	model.general.bootColor = testColor();
	const radio = encode(model);
	const other = empty();
	other.general.radioName = "XE1POC";
	const untouched = encode(other);
	areaForWrite(untouched.bytes, radio.bytes, other.base.bytes);
	bootColorForWrite(untouched.bytes, radio.bytes, other.base.bytes, other.general, true);
	assert.deepEqual(decode(untouched).general.bootColor, model.general.bootColor);

	const loaded = decode(radio);
	loaded.general.bootImage = null;
	loaded.general.bootColor = null;
	const reset = encode(loaded);
	areaForWrite(reset.bytes, radio.bytes, radio.bytes);
	bootColorForWrite(reset.bytes, radio.bytes, radio.bytes, loaded.general, false);
	assert.equal(decode(reset).general.bootImage, undefined);
	assert.equal(decode(reset).general.bootColor, undefined);
	assert.ok(reset.bytes.subarray(...BOOT_COLOR_AREA).every((v) => v === 0xFF));
});
