// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { empty, newChannel, decode, encode, validate, listenBand } from "../static/js/codeplug/model.js";
import { importTable } from "../static/js/codeplug/csv.js";
import { channelForm, columns } from "../static/js/editor/views.js";

const t = (key) => key;

test("low-band FM includes both edges and is distinct from the broadcast tuner", () => {
	for (const hz of [66000000, 70012500, 88000000]) assert.equal(listenBand(hz), "low_fm");
	assert.equal(listenBand(88000010), "bcast");
	assert.equal(listenBand(108000000), "air");
	assert.equal(listenBand(65999990), null);
});

test("the channel grid and form save FM receive-only memories at both widths", () => {
	const m = empty();
	const form = channelForm(m, t);
	const rxField = form.find((f) => f.key === "freqs").fields[0];
	const grid = Object.fromEntries(columns("channels", m, t).map((c) => [c.key, c]));
	const narrow = newChannel({ name: "Low narrow", mode: "dmr" });
	const wide = newChannel({ name: "Low wide", mode: "dmr" });
	assert.equal(grid.rxHz.set(narrow, "70.0125"), undefined);
	assert.equal(rxField.parse(wide, "rxHz", "88.000"), undefined);
	grid.bw.set(wide, 25);
	assert.equal(grid.mode.format(narrow.mode, narrow), "FM");
	assert.equal(grid.txHz.readOnly(narrow), true);
	grid.rxOnly.set(narrow, false);
	grid.txHz.set(narrow, "146.520");
	m.channels.push(narrow, wide);
	m.zones.push({ name: "Low band", channels: [narrow, wide] });
	const problems = validate(m, { bands: [[136000000, 174000000]] });
	assert.deepEqual(problems.filter((p) => p.table === "channels"), []);
	const reopened = decode(encode(m));
	assert.deepEqual(reopened.zones[0].channels.map((c) => [c.rxHz, c.txHz, c.bw, c.mode, c.rxOnly]), [
		[70012500, 70012500, 12.5, "fm", true],
		[88000000, 88000000, 25, "fm", true],
	]);
});

test("CSV import gives a low-band receive-only channel the correct TX placeholder", () => {
	const m = empty();
	const csv = "Name,RX Frequency,Mode,Bandwidth\nLow band,66,FM,25\n";
	assert.deepEqual(importTable(m, csv, "channels").problems, []);
	const [c] = decode(encode(m)).channels;
	assert.deepEqual([c.rxHz, c.txHz, c.bw, c.mode, c.rxOnly], [66000000, 66000000, 25, "fm", true]);
});
