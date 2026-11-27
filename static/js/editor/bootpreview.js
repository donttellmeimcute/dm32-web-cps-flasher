// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// The boot screen preview for the Radio tab: draws the radio's start-up screen on a canvas, from the codeplug's
// boot text and its optional custom image. The built-in photo is drawn as a neutral placeholder.
//
// Geometry follows the firmware's kawaii boot screen (ui_screens.c kawaii_boot): a 220x310 visible area, the
// photo card 192x192 at (14, 35), the boot lines centred from y = 35 + 192 + 12, and the board and version in
// tiny type along the bottom. Colours are the same rose paper/card/ink family, as shown on the panel.

import { BOOT_IMAGE_EDGE, bootImageValid, BOOT_COLOR_EDGE, bootColorValid, bootColorPalette, bootColorIndex } from "../codeplug/bootimage.js?v=e2482525d8";

export const BOOT_PREVIEW_WIDTH = 220;
export const BOOT_PREVIEW_HEIGHT = 310;

const PAPER = "#fbeeee";	// the screen's rose paper
const CARD = "#f6dbe2";		// the card behind the photo
const PHOTO = "#f1e2e6";	// the factory photo's placeholder
const PHOTO_EDGE = "#c9a3ad";
const INK = "#33252a";
const MUTED = "#7a5560";

export function drawBootPreview(ctx, { line1 = "", line2 = "", model = "DM-32UV", version = "", photoLabel = "Factory photo", bootImage = null, bootColor = null } = {}) {
	const W = BOOT_PREVIEW_WIDTH, H = BOOT_PREVIEW_HEIGHT;
	const side = 192, x = (W - side) / 2, y = 35;
	const color = bootColorValid(bootColor);
	const palette = color ? bootColorPalette(bootColor).map((rgb) => `rgb(${rgb.join(",")})`)
		: [PAPER, "#b8abb5", "#786869", INK];
	ctx.fillStyle = palette[0];
	ctx.fillRect(0, 0, W, H);
	if (color || bootImageValid(bootImage)) {
		const edge = color ? BOOT_COLOR_EDGE : BOOT_IMAGE_EDGE;
		const top = Math.floor((H - W) / 2);
		for (let y = 0; y < edge; y++) {
			for (let x = 0; x < edge; x++) {
				const i = y * edge + x;
				const index = color ? bootColorIndex(bootColor, i) : (bootImage[i >> 2] >> (6 - 2 * (i & 3))) & 3;
				if (!index) continue;
				ctx.fillStyle = palette[index];
				const left = Math.ceil(x * W / edge), right = Math.ceil((x + 1) * W / edge);
				const y0 = Math.ceil(y * W / edge), y1 = Math.ceil((y + 1) * W / edge);
				ctx.fillRect(left, top + y0, right - left, y1 - y0);
			}
		}
		return;
	}
	// the screen's edge, so the preview reads as a screen on the page
	ctx.strokeStyle = MUTED;
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
	// the card and the factory photo's place in it
	ctx.fillStyle = CARD;
	ctx.fillRect(x - 5, y - 5, side + 10, side + 10);
	ctx.fillStyle = PHOTO;
	ctx.fillRect(x, y, side, side);
	ctx.strokeStyle = PHOTO_EDGE;
	ctx.setLineDash([6, 4]);
	ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
	ctx.setLineDash([]);
	ctx.fillStyle = MUTED;
	ctx.font = "13px system-ui, sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(photoLabel, W / 2, y + side / 2);
	// the owner's lines, as the radio shows them: centred, an empty one left out
	ctx.fillStyle = INK;
	ctx.font = "600 19px system-ui, sans-serif";
	ctx.textBaseline = "alphabetic";
	const ly = y + side + 12;
	if (line1) ctx.fillText(line1, W / 2, ly + 19);
	if (line2) ctx.fillText(line2, W / 2, ly + 45);
	// the board and version along the bottom
	const foot = [model, version].filter(Boolean).join("  ");
	if (foot) {
		ctx.fillStyle = MUTED;
		ctx.font = "11px system-ui, sans-serif";
		ctx.fillText(foot, W / 2, H - 8);
	}
}
