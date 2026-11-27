// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// The stock Baofeng DM-32UV codeplug (docs/spec/dm32-stock-codeplug.md): 4 KB pages in the data flash, each tagged
// with the logical block it holds. Builds the logical image from a data flash read, recognizes a codeplug in it,
// reads its records, and fills the editing model (model.js) from it as stock_tyt.js does, with the same note codes.

import { getFreq } from "./fields.js?v=c16ffd9bbf";
import { DMR_PRIV, LIMITS, POWER_NAMES } from "./records.js?v=e2482525d8";

export const DM32_STOCK = "baofeng-dm32";

// Pages (spec 1): the codeplug's 4 KB pages from 0x1000 up to (not including) PAGES_END; the last byte of a page is
// the logical block it holds, 0x00 (a page given up) or 0xFF (erased) for none
export const PAGES_START = 0x1000, PAGES_END = 0xC9000, PAGE = 0x1000;

// Logical blocks and record sizes (spec 2)
const BLK = { settings: 0x04, lists: 0x0F, channels: 0x12, txContacts: 0x42, contacts: 0x44, zones: 0x5C, ids: 0x67 };
const CH = 0x30, CONTACT = 0x18, LIST = 0x6D, ZONE = 0x91, RADIO_ID = 0x10;
// Baofeng CPS .data layout observed in issue #42. Physical offsets, not logical block addresses.
const STOCK_KEYS = 0xD300, STOCK_KEYS_END = 0xDFFF, STOCK_KEY_SIZE = 44;
const STOCK_AES256 = 0x04, DMR_AES256 = 0x25, STOCK_ENCRYPTED = 0x40;
const N_LISTS = 32, LIST_MEMBERS = 32, ZONE_CHANNELS = 64, N_IDS = 255;
const BLOCK_DATA = PAGE - 1;	// the last byte is the block number
// The channel blocks: the first (0x12) holds the count at +0 and channels from +0x10 (84 of them); the blocks after
// it (0x13 up) hold 85 more each, raw records from +0x00 with no header. A slot with no name is an unused channel
// number: it counts towards the next block's channels but holds no record
const CH_FIRST_BLOCK = Math.floor((BLOCK_DATA - 0x10) / CH), CH_PER_BLOCK = Math.floor(BLOCK_DATA / CH);
const CONTACTS_PER_BLOCK = Math.floor(BLOCK_DATA / CONTACT), ZONES_PER_BLOCK = Math.floor(BLOCK_DATA / ZONE);

const power = (name) => Number(Object.keys(POWER_NAMES).find((k) => POWER_NAMES[k] === name));
const POWER = [power("Low"), power("Mid"), power("High")];

// {block: page bytes} of every page in use, or null when two pages claim one block (not this layout) or none is in use
export function pageMap(bytes) {
	const out = new Map();
	for (let a = PAGES_START; a + PAGE <= Math.min(bytes.length, PAGES_END); a += PAGE) {
		const id = bytes[a + PAGE - 1];
		if (id === 0x00 || id === 0xFF) continue;
		if (out.has(id)) return null;
		out.set(id, bytes.subarray(a, a + PAGE));
	}
	return out.size ? out : null;
}

// A NUL-ended ASCII name of up to n bytes: {text, ok}; ok when every character before the end is printable. What
// follows the end is not checked: the stock software leaves old text there
function asciiName(b, off, n) {
	let text = "";
	for (let i = 0; i < n; i++) {
		const c = b[off + i];
		if (c === 0x00 || c === 0xFF) break;
		if (c < 0x20 || c > 0x7E) return { text, ok: false };
		text += String.fromCharCode(c);
	}
	return { text, ok: true };
}
const okName = (b, off, n) => {
	const t = asciiName(b, off, n);
	return t.ok ? t.text : "";
};

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

// A tone word (spec 2.2): "" none, "103.5" CTCSS (BCD tenths), "D023N" DCS (flag 0x8000, the code's three digits as a
// binary number). A DCS code with a digit above 7 isn't one: null
export function dm32Tone(b, off) {
	const v = u16(b, off);
	if (v === 0xFFFF || v === 0) return "";
	if (v & 0x8000) {
		const n = v & 0x0FFF;
		const code = String(n).padStart(3, "0");
		return n <= 777 && /^[0-7]{3}$/.test(code) ? `D${code}N` : null;
	}
	let tenths = 0;
	for (let i = 3; i >= 0; i--) {
		const d = (v >> (4 * i)) & 0xF;
		if (d > 9) return null;
		tenths = tenths * 10 + d;
	}
	return tenths >= 300 && tenths <= 3000 ? (tenths / 10).toFixed(1) : null;
}

// The fields of a channel record (spec 2.2), or null when it holds no name
function readChannel(r) {
	const nm = asciiName(r, 0, 16);
	if (!nm.text) return null;
	const dmr = (r[0x18] & 0x10) !== 0;
	const encrypted = dmr && r[0x1F] !== 0xFF && (r[0x1F] & STOCK_ENCRYPTED) !== 0;
	return {
		name: nm.text, nameOk: nm.ok, rxHz: getFreq(r, 0x10), txHz: getFreq(r, 0x14), mode: dmr ? "dmr" : "fm",
		power: POWER[(r[0x18] >> 1) & 3] ?? POWER[2], bw: r[0x19] & 0x80 ? 25 : 12.5, scanList: (r[0x19] >> 2) & 0x1F,
		timeslot: r[0x1D] & 0x10 ? 2 : 1, colorCode: r[0x1D] & 0x0F,
		encrypted, keySlot: encrypted ? r[0x1E] : 0, rxList: encrypted ? r[0x1F] & ~STOCK_ENCRYPTED : r[0x1F],
		rxTone: dm32Tone(r, 0x21),
		txTone: dm32Tone(r, 0x23),
	};
}

// Read only the fixed table reported for .data files. An empty record terminates it. A malformed row or duplicate
// slot makes the table ambiguous, so no migration is offered. At least one AES row must match an encrypted channel.
function stockAesPlan(bytes, channels, channelOf, model) {
	const refs = new Map();
	for (const c of channels) {
		if (!c.encrypted || c.keySlot === 0 || c.keySlot === 0xFF) continue;
		const linked = refs.get(c.keySlot) ?? [];
		linked.push(channelOf.get(c.index));
		refs.set(c.keySlot, linked);
	}
	if (!refs.size) return null;
	const slots = new Set(), records = [];
	let ended = false;
	for (let at = STOCK_KEYS; at + STOCK_KEY_SIZE <= Math.min(STOCK_KEYS_END, bytes.length); at += STOCK_KEY_SIZE) {
		const r = bytes.subarray(at, at + STOCK_KEY_SIZE);
		const slot = r[0];
		if ((slot === 0 || slot === 0xFF) && r.subarray(1).every((b) => b === 0xFF)) {
			ended = true;
			break;
		}
		const n = r.subarray(1, 11), zero = n.indexOf(0), name = asciiName(n, 0, n.length);
		if (!slot || slot === 0xFF || slots.has(slot) || !name.ok || !name.text.trim() ||
			name.text.length !== (zero < 0 ? n.length : zero) ||
			(zero >= 0 && n.subarray(zero).some((b) => b !== 0)) || !r[11] || r[11] === 0xFF) return null;
		slots.add(slot);
		if (r[11] === STOCK_AES256 && !r.subarray(12).every((b) => b === 0xFF) && refs.has(slot))
			records.push({ slot, name: name.text, at });
	}
	if (!ended || !records.length) return null;
	return {
		rows: records.map(({ slot, name }) => ({ slot, name, channels: refs.get(slot).length })),
		// IDs are supplied by the operator. Validate every selected row before touching the codeplug.
		apply(ids) {
			const used = new Set((model.keyring ?? []).filter((k) => k.alg === DMR_AES256).map((k) => k.id));
			const selected = [];
			for (const record of records) {
				const value = String(ids.get(record.slot) ?? "").trim();
				if (!value) continue;
				const id = Number(value);
				if (!/^\d{1,3}$/.test(value) || id < 1 || id > 255) return { error: "invalid_id" };
				if (used.has(id)) return { error: "duplicate_id" };
				used.add(id);
				selected.push({ ...record, id });
			}
			let channels = 0;
			for (const { slot, id, at } of selected) {
				const key = Array.from(bytes.subarray(at + 12, at + STOCK_KEY_SIZE), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
				(model.keyring ??= []).push({ slot: null, alg: DMR_AES256, id, flags: 0, key });
				for (const c of refs.get(slot)) {
					Object.assign(c, { dmrPrivacy: DMR_PRIV.aes, dmrPrivacyKey: id, rxOnly: false });
					channels++;
				}
			}
			return { keys: selected.length, channels };
		},
	};
}

// The logical image's blocks, or null: a page map holding a channel block (detect, spec 3)
function blocksOf(bytes) {
	const m = pageMap(bytes);
	return m && m.has(BLK.channels) ? m : null;
}

// Walk the channel slots the count names, across the channel blocks in order, until the blocks run out. Each slot's
// record (48 bytes) goes to fn(record, zero-based channel number). Returns how many the count named and how many
// were walked: blocks missing from the page map end the walk early
function eachChannel(m, fn) {
	const count = u16(m.get(BLK.channels), 0);
	let n = 0;
	for (let blk = BLK.channels; m.has(blk) && n < count; blk++) {
		const p = m.get(blk);
		const base = blk === BLK.channels ? 0x10 : 0x00;
		const per = blk === BLK.channels ? CH_FIRST_BLOCK : CH_PER_BLOCK;
		for (let i = 0; i < per && n < count; i++, n++) fn(p.subarray(base + i * CH, base + (i + 1) * CH), n);
	}
	return { count, read: n };
}

// Good and bad channels (spec 3): named records with both frequencies are good; a slot with no name is an unused
// channel number, not a bad record
export function stockEvidence(bytes) {
	const m = blocksOf(bytes);
	if (!m) return { good: 0, bad: 0 };
	let good = 0, bad = 0;
	eachChannel(m, (r) => {
		const c = readChannel(r);
		if (!c) return;
		if (c.nameOk && c.rxHz && c.txHz) good++;
		else bad++;
	});
	return { good, bad };
}

// DM32_STOCK or null
export function detectStock(bytes) {
	const { good, bad } = stockEvidence(bytes);
	return good && bad * 4 <= good ? DM32_STOCK : null;
}

// Every record in use; channel, contact and zone references as 1-based stock indexes, list members as DMR IDs
export function readStock(bytes) {
	const m = blocksOf(bytes);
	if (!m) throw new Error("no stock DM-32UV codeplug");
	const blank = new Uint8Array(PAGE).fill(0xFF);
	const blk = (id) => m.get(id) || blank;
	const out = { general: { dmrId: 0, radioName: "", bootLine1: "", bootLine2: "" }, channelCount: 0, channels: [], contacts: [], rxLists: [], zones: [] };

	const s = blk(BLK.settings);
	out.general.bootLine1 = okName(s, 0x01, 14);
	out.general.bootLine2 = okName(s, 0x0F, 14);
	const ids = blk(BLK.ids);
	for (let i = 0; i < Math.min(ids[0], N_IDS); i++) {
		const a = 0x10 + i * RADIO_ID;
		if (a + RADIO_ID > BLOCK_DATA) break;
		const id = u24(ids, a);
		if (id >= 1 && id <= 16776415) {
			out.general.dmrId = id;
			out.general.radioName = okName(ids, a + 3, 13);
			break;
		}
	}

	const ch = blk(BLK.channels), tx = blk(BLK.txContacts);
	const walked = eachChannel(m, (r, i) => {
		const c = readChannel(r);
		if (c) out.channels.push({ index: i + 1, ...c, contact: c.mode === "dmr" && 2 * i + 1 < BLOCK_DATA ? tx[2 * i + 1] : 0 });
	});
	out.channelCount = walked.count;
	out.channelsRead = walked.read;

	// contacts: block 0x44 and the blocks after it, records from +0 with no header; a slot with an empty name is
	// unused but still counts its number
	let contactSlot = 0;
	for (let blkN = BLK.contacts; m.has(blkN); blkN++) {
		const p = m.get(blkN);
		let any = false;
		for (let i = 0; (i + 1) * CONTACT <= BLOCK_DATA; i++, contactSlot++) {
			const r = p.subarray(i * CONTACT, (i + 1) * CONTACT);
			const type = { 3: "private", 4: "group" }[r[0x16]];
			const name = okName(r, 2, 16);
			const id = u24(r, 0x13);
			if (type && name && id) {
				out.contacts.push({ index: contactSlot + 1, name, type, id });
				any = true;
			}
		}
		if (!any && blkN > BLK.contacts) break;
	}

	const gl = blk(BLK.lists);
	for (let i = 0; i < N_LISTS; i++) {
		const a = 0x10 + i * LIST;
		if (a + LIST > BLOCK_DATA) break;
		const name = okName(gl, a + 1, 11);
		if (!name) continue;
		const members = [];
		for (let k = 0; k < LIST_MEMBERS; k++) {
			const id = u24(gl, a + 0x0C + 3 * k);
			if (!id || id === 0xFFFFFF) break;
			members.push(id);
		}
		out.rxLists.push({ index: i + 1, name, ids: members });
	}

	// zones: block 0x5C holds the count and the first 28 records from +0x10; the blocks after it hold 28 more each,
	// raw records from +0x00 with no header
	const zb = blk(BLK.zones);
	const zoneCount = Math.min(zb[0], 255);
	{
		let n = 0;
		for (let blkN = BLK.zones; m.has(blkN) && n < zoneCount; blkN++) {
			const p = m.get(blkN);
			const base = blkN === BLK.zones ? 0x10 : 0x00;
			for (let i = 0; i < ZONES_PER_BLOCK && n < zoneCount; i++, n++) {
				const a = base + i * ZONE;
				if (a + ZONE > BLOCK_DATA) break;
				const name = okName(p, a, 16);
				if (!name) continue;
				const cnt = Math.min(p[a + 0x10], ZONE_CHANNELS), list = [];
				for (let k = 0; k < cnt; k++) {
					const x = u16(p, a + 0x11 + 2 * k);
					if (x && x !== 0xFFFF) list.push(x);
				}
				out.zones.push({ index: n + 1, name, a: list });
			}
		}
	}
	return out;
}

// Keep at most max rows, those in `wanted` first; the rest in table order. Returns the kept rows in table order
function keepWanted(rows, max, wanted) {
	if (rows.length <= max) return rows;
	const keep = new Set(rows.filter((r) => wanted.has(r.index)).slice(0, max));
	for (const r of rows) {
		if (keep.size >= max) break;
		keep.add(r);
	}
	return rows.filter((r) => keep.has(r));
}

// The model filled from a stock codeplug, as stock_tyt.js importStock fills it: {counts, notes}. Every table the
// stock codeplug has is replaced; DTMF contacts and APRS configurations are emptied, the VFOs lose their references
export function importStock(m, bytes, { offerStockAes = false } = {}) {
	const s = readStock(bytes);
	const notes = new Map();
	const note = (code, n = 1) => notes.set(code, (notes.get(code) || 0) + n);
	const shorten = (t, max) => {
		if (t.length <= max) return t;
		note("shortened");
		return t.slice(0, max);
	};

	if (s.channelCount > s.channelsRead) note("too_many_channels", s.channelCount - s.channelsRead);
	let stockChannels = s.channels.filter((c) => {
		if (c.rxHz && c.txHz) return true;
		note("bad_frequency");
		return false;
	});
	if (stockChannels.length > LIMITS.channels) {
		note("too_many_channels", stockChannels.length - LIMITS.channels);
		stockChannels = stockChannels.slice(0, LIMITS.channels);
	}
	if (stockChannels.some((c) => c.scanList)) note("scan_lists");
	const encrypted = stockChannels.filter((c) => c.encrypted).length;
	if (encrypted) note("stock_aes_rx_only", encrypted);

	// A list names its members by ID: the contact with that ID, the first such one; an ID without a contact gets a
	// group contact named after it, as the stock radio shows it
	const listRefs = new Set(stockChannels.filter((c) => c.mode === "dmr" && c.rxList).map((c) => c.rxList));
	const named = s.rxLists.filter((l) => l.ids.length || listRefs.has(l.index));
	const stockLists = keepWanted(named, LIMITS.rxLists, listRefs);
	if (named.length > stockLists.length) note("too_many_rxLists", named.length - stockLists.length);
	const byId = new Map();
	for (const c of s.contacts) if (!byId.has(c.id)) byId.set(c.id, c);
	// numbers past the table's, which has gaps
	let extra = s.contacts.reduce((n, c) => Math.max(n, c.index), 0);
	for (const l of stockLists) {
		for (const id of l.ids) {
			if (byId.has(id)) continue;
			const c = { index: ++extra, name: String(id), type: "group", id };
			s.contacts.push(c);
			byId.set(id, c);
		}
	}
	const contactRefs = new Set(stockChannels.filter((c) => c.mode === "dmr" && c.contact).map((c) => c.contact));
	for (const l of stockLists) for (const id of l.ids) contactRefs.add(byId.get(id).index);
	const stockContacts = keepWanted(s.contacts, LIMITS.contacts, contactRefs);
	if (s.contacts.length > stockContacts.length) note("too_many_contacts", s.contacts.length - stockContacts.length);

	const contactOf = new Map();
	const contacts = stockContacts.map((c, i) => {
		const x = { number: i + 1, name: shorten(c.name, LIMITS.name), id: c.id, type: c.type, timeslot: 0 };
		contactOf.set(c.index, x);
		return x;
	});
	const listOf = new Map();
	const rxLists = stockLists.map((l, i) => {
		const members = l.ids.map((id) => contactOf.get(byId.get(id).index)).filter(Boolean);
		if (members.length > LIMITS.rxListContacts) note("list_cut");
		const x = { number: i + 1, name: shorten(l.name, LIMITS.name), contacts: members.slice(0, LIMITS.rxListContacts) };
		listOf.set(l.index, x);
		return x;
	});

	const channelOf = new Map();
	const channels = stockChannels.map((c, i) => {
		const dmr = c.mode === "dmr";
		const tone = (t) => {
			if (dmr) return "";
			if (t === null) note("bad_tone");
			else if (t.startsWith("D")) note("dcs_polarity");	// the polarity bit isn't mapped yet (spec 5): all come as N
			return t || "";
		};
		const x = {
			number: i + 1, name: shorten(c.name, LIMITS.name), rxHz: c.rxHz, txHz: c.txHz, mode: c.mode,
			power: c.power, tot: 0, rxTone: tone(c.rxTone), txTone: tone(c.txTone),
			bw: dmr ? 12.5 : c.bw, rxOnly: c.encrypted, allSkip: false, zoneSkip: false, vox: false, squelch: 0,
			colorCode: dmr ? c.colorCode : 0, timeslot: dmr ? c.timeslot : 1,
			contact: dmr ? contactOf.get(c.contact) || null : null, rxList: dmr ? listOf.get(c.rxList) || null : null,
			aprs: null, dmrId: 0, noBeep: false, noEco: false, dmo: false, roam: false, aliasTs1: 0, aliasTs2: 0,
			useLocation: false, lat: 0, lon: 0, sfr: false, sfrA: 0, sfrB: 0, toneBurst: false,
		};
		channelOf.set(c.index, x);
		return x;
	});

	let zones = s.zones.map((z) => ({ name: shorten(z.name, LIMITS.name), channels: z.a.map((n) => channelOf.get(n)).filter(Boolean), slot: null }));
	for (const z of zones) {
		if (z.channels.length > LIMITS.zoneChannels) {
			note("zone_cut");
			z.channels = z.channels.slice(0, LIMITS.zoneChannels);
		}
	}
	if (zones.length > LIMITS.zones) {
		note("too_many_zones", zones.length - LIMITS.zones);
		zones = zones.slice(0, LIMITS.zones);
	}

	Object.assign(m, { channels, contacts, rxLists, zones, dtmfContacts: [], aprs: [] });
	for (const v of m.vfo) if (v) Object.assign(v, { contact: null, rxList: null, aprs: null });
	const g = m.general;
	g.dmrId = s.general.dmrId;
	g.radioName = shorten(s.general.radioName, LIMITS.radioName);
	g.bootLine1 = shorten(s.general.bootLine1, LIMITS.bootText);
	g.bootLine2 = shorten(s.general.bootLine2, LIMITS.bootText);

	const counts = { channels: channels.length, contacts: contacts.length, rxLists: rxLists.length, zones: zones.length };
	const stockAes = offerStockAes && encrypted ? stockAesPlan(bytes, stockChannels, channelOf, m) : null;
	return { counts, notes: [...notes].map(([code, n]) => ({ code, n })), stockAes };
}
