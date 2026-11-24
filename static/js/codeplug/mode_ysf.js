// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Copyright (c) 2026 lyra XE1POC (changes)
// The YSF mode module of the Codeplug Editor (docs/spec/ysf-codeplug.md): kind 6 (conventional) on the channel-mode
// layer (channelmodes.js). Bytes to fields and back, and the fields the pages show, as data. The destination call sign
// is the channel's; the source, downlink and uplink call signs are the radio's own (the radio-wide record).

import { u8, grow } from "./modebytes.js?v=c16ffd9bbf";

export const DGID_MAX = 127, TX_DGID_SET = 0x80, DT_MASK = 0x03, NARROW = 0x04;
export const DT_VD1 = 0, DT_DATA_FR = 1, DT_VD2 = 2, DT_VW = 3;
export const CALLSIGN_LEN = 10, DEST_ALL = "ALL";

// A call sign of 10 ASCII characters, space padded: a byte outside the printable range reads as a space
function unpackCall(b, off) {
	let s = "";
	for (let i = 0; i < CALLSIGN_LEN; i++) {
		const c = u8(b, off + i);
		s += c >= 0x20 && c <= 0x7E ? String.fromCharCode(c) : " ";
	}
	return s.replace(/ +$/, "");
}

function packCall(v, off, s) {
	for (let i = 0; i < CALLSIGN_LEN; i++) {
		const c = i < s.length ? s.charCodeAt(i) : 0x20;
		v[off + i] = c >= 0x20 && c <= 0x7E ? c : 0x20;
	}
}

// --- Conventional channel (2) ---

export function decodeConv(b) {
	const f = u8(b, 0);
	let rx = u8(b, 1);
	if (rx > DGID_MAX) rx = 0;
	const t = u8(b, 2);
	const dt = f & DT_MASK;
	return {
		dt,
		// The firmware uses narrow deviation for every data type except Voice FR.
		narrow: dt !== DT_VW || (f & NARROW) !== 0,
		rxDgid: rx,
		txDgid: (t & TX_DGID_SET) !== 0 ? t & DGID_MAX : rx,
		// a destination of all spaces or all zeros reads as ALL
		dest: unpackCall(b, 3) || DEST_ALL,
	};
}

export function encodeConv(p, prev = null) {
	const v = grow(prev, 13);
	const rx = p.rxDgid >= 0 && p.rxDgid <= DGID_MAX ? p.rxDgid : 0;
	v[0] = (v[0] & ~7) | (p.dt & DT_MASK) | (p.narrow ? NARROW : 0);
	v[1] = rx;
	v[2] = p.txDgid === rx ? 0 : TX_DGID_SET | (p.txDgid & DGID_MAX);
	packCall(v, 3, !p.dest || p.dest === DEST_ALL ? DEST_ALL : p.dest);
	return v;
}

// The radio-wide record (1): the source, downlink and uplink call signs; a short or absent field reads empty
export function decodeIdentity(b) {
	return { src: unpackCall(b, 0), down: unpackCall(b, 10), up: unpackCall(b, 20) };
}

export function encodeIdentity(s, prev = null) {
	if (!s.src && !s.down && !s.up) return null;
	const v = grow(prev, 30);
	packCall(v, 0, s.src ?? "");
	packCall(v, 10, s.down ?? "");
	packCall(v, 20, s.up ?? "");
	return v;
}

const dgidField = (key, label, extra) => ({ key, label, type: "int", min: 0, max: DGID_MAX, ...extra });

export const ysfKind = {
	id: 6,
	feature: "YSF",
	systemType: null,
	contacts: false,
	ownFreqs: true,
	defaultTx: true,
	recordFields: [],
	flags: {},
	newParams: () => ({ dt: DT_VD1, narrow: true, rxDgid: 0, txDgid: 0, dest: DEST_ALL }),
	decode: decodeConv,
	encode: encodeConv,
	fields: () => [
		{ key: "dt", label: "editor.ysf.dt", type: "select", options: () => [[DT_VD1, "editor.ysf.dt_vd1"], [DT_DATA_FR, "editor.ysf.dt_data"], [DT_VD2, "editor.ysf.dt_dn"], [DT_VW, "editor.ysf.dt_vw"]] },
		{ key: "narrow", label: "editor.ysf.dev", type: "select", options: () => [[false, "editor.ysf.dev_wide"], [true, "editor.ysf.dev_narrow"]] },
		dgidField("rxDgid", "editor.ysf.rx_dgid", { help: "editor.ysf.dgid_any" }),
		// blank: the RX DG-ID
		dgidField("txDgid", "editor.ysf.tx_dgid", { blank: (p) => p.rxDgid }),
		{ key: "dest", label: "editor.ysf.dest", type: "text", blank: DEST_ALL, help: "editor.ysf.dest_help" },
	],
	validate(c, p, problem) {
		if (p.dest && (p.dest.length > CALLSIGN_LEN || /[^ -~]/.test(p.dest))) problem.warn("dest", "ysf_dest_chars");
		// DN, V/D-1 and Data FR are narrow; only VW is wide (Yaesu 4.2.1). A mismatch is usually a channel
		// left on the old Wide default, which real YSF radios and hotspots do not expect for DN.
		if ((p.dt === DT_VW) === p.narrow) problem.warn("narrow", "ysf_dev_mismatch");
	},
	settings: {
		key: "ysf",
		decode: decodeIdentity,
		encode: encodeIdentity,
		fields: [
			{ key: "src", label: "editor.ysf.src", type: "text", help: "editor.ysf.src_help" },
			{ key: "down", label: "editor.ysf.down", type: "text", help: "editor.ysf.down_help" },
			{ key: "up", label: "editor.ysf.up", type: "text", help: "editor.ysf.up_help" },
		],
		validate() {},
	},
};
