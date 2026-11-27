// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
// Tests for the Mode column of channels.csv (static/js/codeplug/csv.js): what export writes for a channel of a kind,
// import reads back, so a codeplug's P25 and NXDN channels survive a trip through a CSV file.

import test from "node:test";
import assert from "node:assert/strict";
import { empty, newChannel } from "../static/js/codeplug/model.js";
import { setKind } from "../static/js/codeplug/channelmodes.js";
import { exportTable, importTable } from "../static/js/codeplug/csv.js";

const P25 = 2, NXDN = 4, YSF = 6;

// A channels table needs an RX frequency to be one (csv.js required: name, rxHz): add the column to a file that
// has none, so each test below is about the column it names
const withFreq = (csv) => csv.includes("RX Frequency") ? csv :
	csv.split("\n").map((l, i) => l === "" ? l : l + (i ? ",446.0" : ",RX Frequency (MHz)")).join("\n");

function model() {
	const m = empty();
	m.channels.push(newChannel({ name: "Repeater FM" }));
	for (const [name, kind] of [["Local P25", P25], ["Local NXDN", NXDN], ["Local YSF", YSF]]) {
		const c = newChannel({ name });
		m.channels.push(c);
		setKind(m, c, kind);
	}
	m.channels.forEach((c, i) => (c.number = i + 1));
	return m;
}

const kinds = (m) => m.channels.map((c) => `${c.name}:${c.kind}`);
const WANT = ["Repeater FM:0", `Local P25:${P25}`, `Local NXDN:${NXDN}`, `Local YSF:${YSF}`];

test("export names the kinds", () => {
	const text = exportTable(model(), "channels");
	// an NXDN channel names its rate, as the editor's own export does
	for (const w of ["P25", "NXDN 9600", "YSF"]) assert.match(text, new RegExp(`,${w},`));
});

test("a channels.csv exported from a codeplug imports into a blank one with its kinds", () => {
	const text = exportTable(model(), "channels");
	const m = empty();
	importTable(m, text, "channels");
	assert.deepEqual(kinds(m), WANT);
});

test("a channels.csv imports over the codeplug it came from with its kinds", () => {
	const m = model();
	importTable(m, exportTable(m, "channels"), "channels");
	assert.deepEqual(kinds(m), WANT);
});

test("a Mode cell naming the kind a channel already has leaves it as it is", () => {
	const m = model();
	const p25 = m.channels.find((c) => c.kind === P25);
	p25.params = { ...p25.params, rxNac: 0x123, txNac: 0x123 };
	importTable(m, exportTable(m, "channels"), "channels");
	assert.deepEqual(m.channels.find((c) => c.kind === P25).params.rxNac, 0x123);
});

test("a P25 Mode cell is case-insensitive and turns a DMR channel into P25", () => {
	const m = empty();
	importTable(m, "Name,Mode,RX Frequency (MHz),TX Frequency (MHz)\nTG1,p25,446.00625,446.00625\n", "channels");
	assert.equal(m.channels[0].kind, P25);
});

test("an unknown Mode cell is reported, and the message lists P25", () => {
	const m = empty();
	const { problems } = importTable(m, withFreq("Name,Mode\nX,Banana\n"), "channels");
	assert.equal(problems.length, 1);
	assert.equal(problems[0].code, "bad_value");
	assert.match(problems[0].params.allowed, /P25/);
});

// --- P25 NACs ---

const p25 = (m) => m.channels.find((c) => c.kind === P25);
const text = (m) => exportTable(m, "channels");
const col = (csv, header) => {
	const [head, ...rows] = csv.trim().split(/\r?\n/).map((l) => l.split(","));
	const i = head.indexOf(header);
	assert.ok(i >= 0, `column ${header} is exported`);
	return rows.map((r) => r[i]);
};

test("export writes the RX and TX NAC of a P25 channel, and nothing for the others", () => {
	const m = model();
	p25(m).params = { ...p25(m).params, rxNac: 0x123, txNac: 0x456 };
	const csv = text(m);
	assert.deepEqual(col(csv, "RX NAC"), ["", "123", "", ""]);
	assert.deepEqual(col(csv, "TX NAC"), ["", "456", "", ""]);
});

test("a TX NAC equal to the default (the RX NAC) is left blank on export", () => {
	const m = model();
	p25(m).params = { ...p25(m).params, rxNac: 0x123, txNac: 0x123 };
	assert.deepEqual(col(text(m), "TX NAC"), ["", "", "", ""]);
});

test("NACs survive a trip through a CSV into a blank codeplug", () => {
	const m = model();
	p25(m).params = { ...p25(m).params, rxNac: 0x123, txNac: 0x456 };
	const out = empty();
	importTable(out, text(m), "channels");
	assert.deepEqual([p25(out).params.rxNac, p25(out).params.txNac], [0x123, 0x456]);
});

test("a blank TX NAC sends the RX NAC, and a blank RX NAC keeps the value", () => {
	const m = empty();
	importTable(m, withFreq("Name,Mode,RX NAC,TX NAC\nA,P25,3B1,\nB,P25,,\n"), "channels");
	const [a, b] = m.channels;
	assert.deepEqual([a.params.rxNac, a.params.txNac], [0x3B1, 0x3B1]);
	assert.deepEqual([b.params.rxNac, b.params.txNac], [0x293, 0x293]);
});

test("NAC cells read hex, with or without 0x, and any-NAC F7E on receive", () => {
	const m = empty();
	importTable(m, withFreq("Name,Mode,RX NAC,TX NAC\nA,P25,0x2a,0xB\nB,P25,f7e,\n"), "channels");
	const [a, b] = m.channels;
	assert.deepEqual([a.params.rxNac, a.params.txNac], [0x2A, 0xB]);
	assert.deepEqual([b.params.rxNac, b.params.txNac], [0xF7E, 0x293]);
});

test("a NAC out of range or not hex is reported and the channel keeps its value", () => {
	const m = empty();
	const { problems } = importTable(m, withFreq("Name,Mode,RX NAC,TX NAC\nA,P25,1000,zz\n"), "channels");
	assert.deepEqual(problems.map((p) => p.column).sort(), ["RX NAC", "TX NAC"]);
	assert.deepEqual([m.channels[0].params.rxNac, m.channels[0].params.txNac], [0x293, 0x293]);
});

test("a NAC on a channel that is not P25 is reported, a blank one is not", () => {
	const m = empty();
	const { problems } = importTable(m, withFreq("Name,Mode,RX NAC\nA,DMR,293\nB,DMR,\n"), "channels");
	assert.equal(problems.length, 1);
	assert.equal(problems[0].row, 2);
});

test("a file without NAC columns leaves the NACs as they are", () => {
	const m = model();
	p25(m).params = { ...p25(m).params, rxNac: 0x123, txNac: 0x456 };
	importTable(m, "Name,RX Frequency (MHz)\nLocal P25,446.00625\n", "channels");
	assert.deepEqual([p25(m).params.rxNac, p25(m).params.txNac], [0x123, 0x456]);
});

test("a blank TX NAC follows the RX NAC even when its column comes first", () => {
	const m = empty();
	importTable(m, withFreq("Name,Mode,TX NAC,RX NAC\nA,P25,,3B1\n"), "channels");
	assert.deepEqual([m.channels[0].params.rxNac, m.channels[0].params.txNac], [0x3B1, 0x3B1]);
});

test("every mode word the editor exports imports, plain DMR and FM included", () => {
	const m = empty();
	const { problems } = importTable(m, withFreq("Name,Mode\nA,DMR\nB,FM\nC,Analog\nD,Digital\nE,NXDN\nF,YSF\nG,P25\n"), "channels");
	assert.deepEqual(problems, []);
	assert.deepEqual(m.channels.map((c) => c.kind), [0, 0, 0, 0, NXDN, YSF, P25]);
});
