// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// The boot screen preview for the Radio tab: draws the radio's start-up screen on a canvas, from the codeplug's
// boot text alone. No image is loaded here: the factory photo the radio shows is drawn as a neutral placeholder
// (its pixels live in the firmware, not in the codeplug), so this preview can never show a photo the radio won't.
//
// Geometry follows the firmware's kawaii boot screen (ui_screens.c kawaii_boot): a 220x310 visible area, the
// photo card 192x192 at (14, 35), the boot lines centred from y = 35 + 192 + 12, and the board and version in
// tiny type along the bottom. Colours are the same rose paper/card/ink family, as shown on the panel.

export const BOOT_PREVIEW_WIDTH = 220;
export const BOOT_PREVIEW_HEIGHT = 310;

const PAPER = "#fbeeee";	// the screen's rose paper
const CARD = "#f6dbe2";		// the card behind the photo
const PHOTO = "#f1e2e6";	// the factory photo's placeholder
const PHOTO_EDGE = "#c9a3ad";
const INK = "#33252a";
const MUTED = "#7a5560";

export function drawBootPreview(ctx, { line1 = "", line2 = "", model = "DM-32UV", version = "", photoLabel = "Factory photo" } = {}) {
	const W = BOOT_PREVIEW_WIDTH, H = BOOT_PREVIEW_HEIGHT;
	const side = 192, x = (W - side) / 2, y = 35;
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, W, H);
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
