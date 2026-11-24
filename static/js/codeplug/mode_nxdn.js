// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Copyright (c) 2026 lyra XE1POC (changes)
// The NXDN mode module of the Codeplug Editor (docs/spec/nxdn-codeplug.md): kind 4 (conventional) on the channel-mode
// layer (channelmodes.js). Bytes to fields and back, and the fields the pages show, as data. Talk targets are the
// contact list's: a group contact is a group, a private one a unit.

import { u8, u16, put16, grow } from "./modebytes.js?v=c16ffd9bbf";

export const RAN_MAX = 63, TX_RAN_SET = 0x80, TX_RAN_DEFAULT = 1, RATE_4800 = 0x04;
export const UNIT_MAX = 65519, ID_ALL = 0xFFFF;
export const SCRAMBLER_ALG = 1, SCRAMBLER_KIND = 8, SCRAMBLER_MARK = 2, SCRAMBLER_SEED_MAX = 32767;

// The TX RAN a block that leaves it unset sends: the RX RAN, RAN 1 when that is every RAN (0)
const txDefault = (rx) => (rx !== 0 ? rx : TX_RAN_DEFAULT);

// A group is 1 to 65535 and a unit 1 to 65519: a contact out of range calls group 1 (2)
function targetRange(c, problem) {
	const t = c.contact && typeof c.contact === "object" ? c.contact : null;
	if (t && t.type === "group" && t.id > 0xFFFF) problem.warn("contact", "nxdn_group_range");
	if (t && t.type === "private" && t.id > UNIT_MAX) problem.warn("contact", "nxdn_unit_range", { max: UNIT_MAX });
}

// --- Conventional channel (2) ---

export function decodeConv(b) {
	const f = u8(b, 0);
	let rx = u8(b, 1);
	if (rx > RAN_MAX) rx = 0;
	const t = u8(b, 2);
	return {
		rate9600: (f & RATE_4800) === 0,
		squelch: (f & 3) === 1 ? 1 : 0,
		rxRan: rx,
		txRan: (t & 0xC0) === TX_RAN_SET ? t & RAN_MAX : txDefault(rx),
		// AES-256 (docs/spec/air-encryption.md): byte 3 bit 0 and the key id (6 bits) in byte 4; shorter blocks are clear
		aes: (u8(b, 3) & 1) !== 0,
		keyId: (u8(b, 3) & 1) !== 0 ? u8(b, 4) & 0x3F : 0,
	};
}

export function encodeConv(p, prev = null) {
	const v = grow(prev, 5);
	const rx = p.rxRan >= 0 && p.rxRan <= RAN_MAX ? p.rxRan : 0;
	v[0] = (v[0] & ~7) | (p.squelch === 1 ? 1 : 0) | (p.rate9600 ? 0 : RATE_4800);
	v[1] = rx;
	v[2] = p.txRan === txDefault(rx) ? 0 : TX_RAN_SET | (p.txRan & RAN_MAX);
	v[3] = (v[3] & ~1) | (p.aes ? 1 : 0);
	v[4] = p.aes ? p.keyId & 0x3F : 0;
	return v;
}

// The radio-wide record (1): {unitId: 0 = the radio's DMR ID where it fits, else 1}
export function decodeUnit(b) {
	const id = b && b.length >= 2 ? u16(b, 0) : 0;
	return { unitId: id >= 1 && id <= UNIT_MAX ? id : 0 };
}

// The unit ID a radio with this DMR ID uses when the record leaves it unset (1)
export const unitFallback = (dmrId) => (dmrId >= 1 && dmrId <= UNIT_MAX ? dmrId : 1);

const ranField = (key, label, extra) => ({ key, label, type: "int", min: 0, max: RAN_MAX, ...extra });

export const nxdnKind = {
	id: 4,
	feature: "NXDN",
	systemType: null,
	contacts: true,
	ownFreqs: true,
	defaultTx: true,
	recordFields: ["contact", "dmrId"],
	flags: {},
	newParams: () => ({ rate9600: true, squelch: 0, rxRan: 0, txRan: TX_RAN_DEFAULT, aes: false, keyId: 0 }),
	decode: decodeConv,
	encode: encodeConv,
	fields: () => [
		{ key: "rate9600", label: "editor.nxdn.rate", type: "select", options: () => [[true, "editor.nxdn.rate9600"], [false, "editor.nxdn.rate4800"]] },
		{ key: "squelch", label: "editor.nxdn.squelch", type: "select", options: () => [[0, "editor.nxdn.squelch0"], [1, "editor.nxdn.squelch1"]] },
		ranField("rxRan", "editor.nxdn.rx_ran", { help: "editor.nxdn.ran_any" }),
		// blank: the RX RAN, RAN 1 when that is every RAN
		ranField("txRan", "editor.nxdn.tx_ran", { blank: (p) => txDefault(p.rxRan) }),
		{ key: "aes", label: "editor.nxdn.aes", type: "bool", help: "editor.nxdn.aes_help" },
		{ key: "keyId", label: "editor.nxdn.key_id", type: "int", min: 0, max: 63 },
	],
	validate(c, p, problem) {
		targetRange(c, problem);
		if (c.dmrId > UNIT_MAX) problem.warn("dmrId", "nxdn_unit_range", { max: UNIT_MAX });
	},
	settings: {
		key: "nxdn",
		decode: decodeUnit,
		encode: (s, prev) => {
			if (!s.unitId) return null;
			const v = grow(prev, 2);
			put16(v, 0, s.unitId);
			return v;
		},
		fields: [{ key: "unitId", label: "editor.nxdn.unit_id", type: "int", min: 0, max: UNIT_MAX, blank: 0, help: "editor.nxdn.unit_id_help" }],
		validate() {},
	},
};

export const nxdnScramblerKind = {
	...nxdnKind,
	id: SCRAMBLER_KIND,
	feature: "NXDN_SCRAMBLER",
	settings: null,
	requiredKeyAlg: SCRAMBLER_ALG,
	newParams: () => ({ rate9600: true, squelch: 0, rxRan: 0, txRan: TX_RAN_DEFAULT, keyId: null }),
	decode(b) {
		const { rate9600, squelch, rxRan, txRan } = decodeConv(b);
		const trunk = (u8(b, 5) & 1) !== 0;
		const keyId = b?.length >= 5 && b[3] === SCRAMBLER_MARK && b[4] <= 63 && !trunk ? b[4] : null;
		return { rate9600, squelch, rxRan, txRan, keyId };
	},
	encode(p, prev = null) {
		const v = encodeConv(p, prev);
		const keyOk = Number.isInteger(p.keyId) && p.keyId >= 0 && p.keyId <= 63;
		v[3] = keyOk ? SCRAMBLER_MARK : 0;
		v[4] = keyOk ? p.keyId : 0;
		if (v.length > 5) v[5] &= ~3;
		return v;
	},
	fields: () => nxdnKind.fields().filter((f) => ["rate9600", "squelch", "rxRan", "txRan", "keyId"].includes(f.key)),
};
