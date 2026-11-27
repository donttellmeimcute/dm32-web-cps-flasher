// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// RadioFoundry startup image assets in the codeplug.
import { crc32 } from "../flasher/bytes.js?v=c16ffd9bbf";
import { decodeArea, deleteValue, getValue, putArea, setValue } from "./kv.js?v=0b03c0496e";
export const BOOT_IMAGE_KEY = 0x2000;
export const BOOT_IMAGE_EDGE = 64;
export const BOOT_IMAGE_BYTES = BOOT_IMAGE_EDGE ** 2 / 4;

export function bootImageValid(image) {
	return image instanceof Uint8Array && image.length === BOOT_IMAGE_BYTES;
}

export function packBootImage(rgba) {
	if (rgba.length !== BOOT_IMAGE_EDGE ** 2 * 4) throw new RangeError("Invalid image dimensions");
	const image = new Uint8Array(BOOT_IMAGE_BYTES);
	const luma = (i) => (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
	let coverage = 0, brightness = 0, transparent = false;
	for (let i = 0; i < rgba.length; i += 4) {
		const alpha = rgba[i + 3];
		transparent ||= alpha < 255;
		coverage += alpha;
		brightness += luma(i) * alpha;
	}
	// A dark logo on a transparent background should use the theme foreground.
	const invert = transparent && brightness < coverage / 2;
	for (let i = 0; i < rgba.length; i += 4) {
		const shade = (invert ? 1 - luma(i) : luma(i)) * rgba[i + 3] / 255;
		const pixel = i / 4;
		image[pixel >> 2] |= Math.round(shade * 3) << (6 - 2 * (pixel & 3));
	}
	return image;
}

// DM-32UV color splash, in three unused sectors of the open-firmware EEPROM image.
// RFB1, CRC32 of the legacy image, CRC32 of the color payload, 16 little-endian
// RGB565 colors, then 128 rows of 4-bit palette indexes (high nibble first).
export const BOOT_COLOR_EDGE = 128;
const COLOR_TABLE_SIZE = 32;
const COLOR_BYTES = COLOR_TABLE_SIZE + BOOT_COLOR_EDGE ** 2 / 2;
const HEADER_SIZE = 12;
const COLOR_MAGIC = 0x31424652;
export const BOOT_COLOR_AREA = [0xB000, 0xB000 + HEADER_SIZE + COLOR_BYTES];

export function bootColorValid(pixels) {
	return pixels instanceof Uint8Array && pixels.length === COLOR_BYTES;
}

function rgb565(r, g, b) {
	return (Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255);
}

export function bootColorRgb(color) {
	return [Math.round((color >> 11) * 255 / 31), Math.round(((color >> 5) & 63) * 255 / 63), Math.round((color & 31) * 255 / 31)];
}

function colorBox(colors) {
	const bounds = [0, 1, 2].map((axis) => {
		let min = 255, max = 0;
		for (const color of colors) {
			min = Math.min(min, color.rgb[axis]);
			max = Math.max(max, color.rgb[axis]);
		}
		return max - min;
	});
	const axis = bounds.indexOf(Math.max(...bounds));
	const weight = colors.reduce((sum, color) => sum + color.count, 0);
	return { colors, axis, weight, score: bounds[axis] * weight };
}

// Weighted median cut in RGB space, after binning to the panel's RGB565 values.
// Every distinct source color stays exact when it already fits the palette.
export function packBootColor(rgba) {
	const size = BOOT_COLOR_EDGE ** 2;
	if (rgba.length !== size * 4) throw new RangeError("Invalid color image dimensions");
	const histogram = new Map();
	const source = new Uint16Array(size);
	for (let p = 0; p < size; p++) {
		const i = p * 4;
		const alpha = rgba[i + 3] / 255;
		const color = rgb565(rgba[i] * alpha, rgba[i + 1] * alpha, rgba[i + 2] * alpha);
		source[p] = color;
		histogram.set(color, (histogram.get(color) || 0) + 1);
	}
	const colors = Array.from(histogram, ([color, count]) => ({ rgb: bootColorRgb(color), count }));
	const boxes = [colorBox(colors)];
	while (boxes.length < 16) {
		boxes.sort((a, b) => b.score - a.score);
		if (!boxes[0].score) break;
		const { colors, axis, weight } = boxes.shift();
		colors.sort((a, b) => a.rgb[axis] - b.rgb[axis]);
		let split = 1, subtotal = colors[0].count;
		while (split < colors.length - 1 && subtotal < weight / 2) subtotal += colors[split++].count;
		boxes.push(colorBox(colors.slice(0, split)), colorBox(colors.slice(split)));
	}
	const result = new Uint8Array(COLOR_BYTES);
	const view = new DataView(result.buffer);
	const indexes = new Map();
	boxes.sort((a, b) => b.weight - a.weight);
	boxes.forEach(({ colors, weight }, index) => {
		const sums = [0, 0, 0];
		for (const { rgb, count } of colors) {
			indexes.set(rgb565(...rgb), index);
			for (let axis = 0; axis < 3; axis++) sums[axis] += rgb[axis] * count;
		}
		view.setUint16(index * 2, rgb565(...sums.map((sum) => sum / weight)), true);
	});
	for (let p = 0; p < size; p++) {
		result[COLOR_TABLE_SIZE + (p >> 1)] |= indexes.get(source[p]) << (p & 1 ? 0 : 4);
	}
	return result;
}

export function bootColorPalette(image) {
	const view = new DataView(image.buffer, image.byteOffset, COLOR_TABLE_SIZE);
	return Array.from({ length: COLOR_TABLE_SIZE / 2 }, (_, i) => bootColorRgb(view.getUint16(i * 2, true)));
}

export function bootColorIndex(image, pixel) {
	return (image[COLOR_TABLE_SIZE + (pixel >> 1)] >> (pixel & 1 ? 0 : 4)) & 15;
}

function colorRecord(bytes) {
	return bytes.subarray(...BOOT_COLOR_AREA);
}

export function decodeBootColor(bytes, legacy) {
	const record = colorRecord(bytes);
	if (record.length !== HEADER_SIZE + COLOR_BYTES || !bootImageValid(legacy)) return undefined;
	const header = new DataView(record.buffer, record.byteOffset, HEADER_SIZE);
	const payload = record.subarray(HEADER_SIZE);
	if (header.getUint32(0, true) !== COLOR_MAGIC || header.getUint32(4, true) !== crc32(legacy)
			|| header.getUint32(8, true) !== crc32(payload)) return undefined;
	return payload.slice();
}

export function encodeBootColor(bytes, color, legacy) {
	const record = colorRecord(bytes);
	if (bootColorValid(color) && bootImageValid(legacy)) {
		const header = new DataView(record.buffer, record.byteOffset, HEADER_SIZE);
		header.setUint32(0, COLOR_MAGIC, true);
		header.setUint32(4, crc32(legacy), true);
		header.setUint32(8, crc32(color), true);
		record.set(color, HEADER_SIZE);
	} else if (color === null) {
		const header = new DataView(record.buffer, record.byteOffset, HEADER_SIZE);
		if (header.getUint32(0, true) === COLOR_MAGIC) record.fill(0xFF);
	}
}

// Merge the splash after the rest of the settings. Only a file with a splash
// or an explicit image edit can replace the connected radio's asset.
export function bootColorForWrite(file, radio, base, { bootColor, bootImage }, fromFile) {
	const record = colorRecord(file);
	const current = colorRecord(radio);
	const original = base && colorRecord(base);
	const edited = bootColor === null || (bootColorValid(bootColor)
		&& (fromFile || !original || record.some((v, i) => v !== original[i])));
	if (!edited) {
		record.set(current);
		return;
	}
	const area = decodeArea(file);
	if (area.state === "newer") throw new RangeError("Newer codeplug settings area");
	const legacy = getValue(area.entries, BOOT_IMAGE_KEY);
	if (bootImageValid(bootImage)) {
		if (!legacy || legacy.length !== bootImage.length || legacy.some((v, i) => v !== bootImage[i])) {
			if (!putArea(file, setValue(area.entries, BOOT_IMAGE_KEY, bootImage)))
				throw new RangeError("Startup image fallback does not fit");
		}
		encodeBootColor(file, bootColor, bootImage);
	} else {
		if (bootImageValid(legacy) && !putArea(file, deleteValue(area.entries, BOOT_IMAGE_KEY)))
			throw new RangeError("Cannot reset startup image");
		record.set(current);
		encodeBootColor(file, null);
	}
}
