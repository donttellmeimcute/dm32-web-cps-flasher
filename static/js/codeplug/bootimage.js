// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// RadioFoundry startup image asset in the codeplug settings area.
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
