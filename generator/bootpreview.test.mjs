// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// Tests for the Radio tab's boot screen preview (static/js/editor/bootpreview.js). The module is pure canvas
// drawing, so it runs in node with a stub 2d context that records the calls; no DOM or radio is needed.

import test from "node:test";
import assert from "node:assert/strict";
import { drawBootPreview, BOOT_PREVIEW_WIDTH, BOOT_PREVIEW_HEIGHT } from "../static/js/editor/bootpreview.js";

function stubContext() {
	const calls = [];
	const ctx = {
		calls,
		fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h]); },
		strokeRect(x, y, w, h) { calls.push(["strokeRect", x, y, w, h]); },
		fillText(text, x, y) { calls.push(["fillText", String(text), x, y]); },
		setLineDash(dash) { calls.push(["setLineDash", [...dash]]); },
	};
	return ctx;
}

const texts = (ctx) => ctx.calls.filter(([op]) => op === "fillText").map(([, text]) => text);
const rects = (ctx) => ctx.calls.filter(([op]) => op === "fillRect" || op === "strokeRect");

test("the preview draws the placeholder, both boot lines and the board", () => {
	const ctx = stubContext();
	drawBootPreview(ctx, { line1: "XE1ARS", line2: "Lyra", model: "DM-32UV", version: "2026.11.20-709ec189", photoLabel: "Factory photo" });
	const t = texts(ctx);
	assert.ok(t.includes("Factory photo"), "the factory photo's placeholder is labelled");
	assert.ok(t.includes("XE1ARS"), "boot line 1 is drawn");
	assert.ok(t.includes("Lyra"), "boot line 2 is drawn");
	assert.ok(t.some((s) => s.includes("DM-32UV") && s.includes("2026.11.20-709ec189")), "the footer names the board and version");
});

test("an empty boot line is left out, as the radio leaves it out", () => {
	const ctx = stubContext();
	drawBootPreview(ctx, { line1: "", line2: "Lyra", model: "DM-32UV" });
	const t = texts(ctx);
	assert.ok(t.includes("Lyra"));
	assert.ok(!t.includes(""), "no empty text is drawn");
});

test("nothing is drawn outside the 220x310 screen", () => {
	const ctx = stubContext();
	drawBootPreview(ctx, { line1: "A".repeat(16), line2: "B".repeat(16), model: "DM-32UV", version: "v" });
	for (const [op, x, y, w = 0, h = 0] of rects(ctx)) {
		assert.ok(x >= 0 && y >= 0 && x + w <= BOOT_PREVIEW_WIDTH && y + h <= BOOT_PREVIEW_HEIGHT, `${op} stays on screen`);
	}
	for (const [, text, x, y] of ctx.calls.filter(([op]) => op === "fillText")) {
		assert.ok(x >= 0 && x <= BOOT_PREVIEW_WIDTH && y >= 0 && y <= BOOT_PREVIEW_HEIGHT, `fillText ${JSON.stringify(text)} stays on screen`);
	}
});
