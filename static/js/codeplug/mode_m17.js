// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 lyra XE1POC
// The M17 mode module of the Codeplug Editor (docs/spec/m17.md 5): kind 7 on the channel-mode layer (channelmodes.js).
// The channel holds its channel access number (CAN) and the destination; the source call sign is the radio's own (the
// radio-wide record).

import { u8, grow } from "./modebytes.js";

export const CAN_MAX = 15, CALLSIGN_LEN = 9, DEST_ALL = "ALL";
// The M17 alphabet (base-40 addresses): letters, digits, '-', '/', '.' and space; lower case reads as upper case
const ALPHABET = /^[A-Za-z0-9\-/. ]*$/;

function unpackCall(b, off) {
	let s = "";
	for (let i = 0; i < CALLSIGN_LEN; i++) {
		const c = u8(b, off + i);
		s += c >= 0x20 && c <= 0x7E ? String.fromCharCode(c) : " ";
	}
	return s.replace(/ +$/, "");
}

function packCall(v, off, s) {
	const t = (s ?? "").toUpperCase();
	for (let i = 0; i < CALLSIGN_LEN; i++) {
		const c = i < t.length ? t.charCodeAt(i) : 0x20;
		v[off + i] = c >= 0x20 && c <= 0x7E ? c : 0x20;
	}
}

// --- Conventional channel: byte 0 bits 0-3 the CAN, bytes 1-9 the destination ---

export function decodeConv(b) {
	return { can: u8(b, 0) & CAN_MAX, dest: unpackCall(b, 1) || DEST_ALL };
}

export function encodeConv(p, prev = null) {
	const v = grow(prev, 1 + CALLSIGN_LEN);
	v[0] = (v[0] & ~CAN_MAX) | (p.can & CAN_MAX);
	packCall(v, 1, !p.dest ? DEST_ALL : p.dest);
	return v;
}

// The radio-wide record: the source call sign (blank: the radio's name is sent)
export function decodeIdentity(b) {
	return { src: unpackCall(b, 0) };
}

export function encodeIdentity(s, prev = null) {
	if (!s.src) return null;
	const v = grow(prev, CALLSIGN_LEN);
	packCall(v, 0, s.src);
	return v;
}

const callOk = (s) => !s || (s.length <= CALLSIGN_LEN && ALPHABET.test(s));

export const m17Kind = {
	id: 7,
	feature: "M17",
	systemType: null,
	contacts: false,
	ownFreqs: true,
	defaultTx: true,
	recordFields: [],
	flags: {},
	newParams: () => ({ can: 0, dest: DEST_ALL }),
	decode: decodeConv,
	encode: encodeConv,
	fields: () => [
		{ key: "can", label: "editor.m17.can", type: "int", min: 0, max: CAN_MAX, help: "editor.m17.can_help" },
		{ key: "dest", label: "editor.m17.dest", type: "text", blank: DEST_ALL, help: "editor.m17.dest_help" },
	],
	validate(c, p, problem) {
		if (!callOk(p.dest)) problem.warn("dest", "m17_call_chars");
	},
	settings: {
		key: "m17",
		decode: decodeIdentity,
		encode: encodeIdentity,
		fields: [{ key: "src", label: "editor.m17.src", type: "text", help: "editor.m17.src_help" }],
		validate(s, problem) {
			if (!callOk(s.src)) problem.warn("src", "m17_call_chars");
		},
	},
};
