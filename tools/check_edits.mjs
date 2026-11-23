// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// The regression checks for the codeplug editor fixes that live in this repository (they have no suite of their
// own here): CSV kind words and the stock CPS's header row (#31/#72/#73 of DM32-nxdn-p25), and the stock converter
// reading channels past the first block (#31). Run from the repository root:
//
//     node tools/check_edits.mjs
import { exportTable, importTable, detect } from "../static/js/codeplug/csv.js?v=c16ffd9bbf";
import { empty } from "../static/js/codeplug/model.js?v=89bf988ad1";
import { importStock, detectStock, PAGE } from "../static/js/codeplug/stock_baofeng.js?v=c16ffd9bbf";

let failed = 0;
const check = (name, ok) => {
	console.log((ok ? "ok   " : "FAIL ") + name);
	if (!ok) failed++;
};

// #73: a CSV whose Mode column names a kind (P25, P25T, T3, AM) or a stock word (Analog/Digital) imports clean
{
	const m = empty();
	const r = importTable(m, "Name,Mode,RX Frequency (MHz),TX Frequency (MHz)\nP25,P25,460.125,460.125\nNXDN,NXDN,460.225,460.225\nAna,Analog,146.52,146.52\n");
	const modes = m.channels.map((c) => [c.kind, c.mode]);
	check("kind and stock mode words import clean",
		r.problems.length === 0 && modes[0][0] === 2 && modes[1][0] === 4 && modes[2][0] === 0 && modes[2][1] === "fm");
	// the editor's own export round-trips: a kind channel exports its kind's short name
	const p25 = m.channels[0];
	const out = exportTable(m, "channels");
	const line = out.split("\r\n")[1];
	check("own export round-trips a P25 channel", line.split(",")[1] === "P25" && line.split(",")[2] === "P25" && importTable(empty(), out).problems.length === 0);
	// #72: RX Only exports as set, on a P25 (kind) channel too
	p25.rxOnly = false;
	const col = out.split("\r\n")[0].split(",").indexOf("RX Only");
	check("P25 exports RX Only No", exportTable(m, "channels").split("\r\n")[1].split(",")[col] === "No");
}

// #31a: the stock CPS's own header row is recognized
{
	const csv = "No.,Channel Name,Channel Type,RX Frequency[MHz],TX Frequency[MHz],Power,Band Width,Squelch Level,Forbid TX,TX Contact,RX Group List,Color Code,Time Slot,CTC/DCS Decode,CTC/DCS Encode,VOX Function\n"
		+ "1,FRS 1,Analog,462.56250,462.56250,Middle,25KHz,2,0,All Call,None,0,Slot 1,None,141.3,0\n";
	const m = empty();
	const r = importTable(m, csv);
	const c = m.channels.find((x) => x.name === "FRS 1");
	check("stock CPS CSV detected as channels", detect(csv) === "channels");
	check("stock CPS CSV row imports (mode/power/bw/tone)",
		r.problems.every((p) => p.column === "TX Contact") && c && c.mode === "fm" && c.power === 6 && c.bw === 25 && c.txTone === "141.3" && c.squelch === 2);
}

// #31b: channels past the first stock block (0x13 up, raw records from +0) are read, zones resolve them
{
	const area = new Uint8Array(0xC9000).fill(0xFF);
	const page = (blk) => area.subarray(0x1000 + blk * 0x1000, 0x1000 + blk * 0x1000 + PAGE);
	const putName = (b, o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); b[o + s.length] = 0; };
	const putFreq = (b, o, mhz) => { // 8 BCD digits of 10 Hz, little-endian nibbles
		const d = String(Math.round(mhz * 100)).padStart(8, "0");
		for (let i = 0; i < 4; i++) b[o + i] = (Number(d[7 - 2 * i]) << 4) | Number(d[6 - 2 * i]);
	};
	const CH = 0x30;
	const c12 = page(0x12);
	new Uint8Array(c12).fill(0, 0, 0x10);
	c12[0] = 86; c12[1] = 0;
	putName(c12, 0x10, "First");
	putFreq(c12, 0x10 + 0x10, 462.5625); putFreq(c12, 0x10 + 0x14, 462.5625);
	const c13 = page(0x13);
	putName(c13, 0 * CH, "Ch85"); putFreq(c13, 0x10, 462.5875); putFreq(c13, 0x14, 462.5875);
	putName(c13, 1 * CH, "Ch86"); putFreq(c13, 1 * CH + 0x10, 462.6125); putFreq(c13, 1 * CH + 0x14, 462.6125);
	const z = page(0x5C);
	new Uint8Array(z).fill(0, 0, 0x10);
	z[0] = 1;
	putName(z, 0x10, "Zone86");
	z[0x10 + 0x10] = 2;
	z[0x10 + 0x11] = 86; z[0x10 + 0x12] = 0;
	for (const blk of [0x12, 0x13, 0x5C]) area[0x1000 + blk * 0x1000 + PAGE - 1] = blk;

	check("stock multi-block codeplug detected", detectStock(area) === "baofeng-dm32");
	const m = empty();
	const r = importStock(m, area);
	const names = m.channels.map((c) => c.name);
	check("channels past the first block convert", names.includes("Ch85") && names.includes("Ch86") && !r.notes.some((n) => n.code === "too_many_channels"));
	check("zone resolves a channel past block one", m.zones.length === 1 && m.zones[0].channels.length === 1 && m.zones[0].channels[0].name === "Ch86");
}

process.exit(failed);
