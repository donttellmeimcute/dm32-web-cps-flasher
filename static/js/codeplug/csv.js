// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Codeplug tables as CSV (RFC 4180): one file per table, a header row of fixed English names, references by name
// (a channel's contact, a zone's channels). Import matches rows to the records already there by number, then by
// name, so references from other tables follow an edited record; records missing from the file are removed and
// their references cleared. A file may hold only some columns: the others keep their values. Problems come back as
// {row, column, code, params}, and the page words them.

import { parseFreq, parseTone, mhz } from "./fields.js?v=c16ffd9bbf";
import { LIMITS, POWER_NAMES, CALL_TYPES, validDtmf } from "./records.js?v=f3daccc684";
import { newChannel, newContact, remove, assignNumbers } from "./model.js?v=1274c7a098";
import { setKind } from "./channelmodes.js?v=24556515d7";
import { kindName } from "./modes.js?v=2b5c5c629e";
import { callOk } from "./mode_m17.js?v=e54b64a875";
import { SCRAMBLER_KIND } from "./mode_nxdn.js";

// --- RFC 4180 ---

// Rows of fields. The delimiter is the first of , ; or tab found outside quotes in the first line (Excel writes ;
// in locales with a decimal comma). A leading byte order mark is dropped; blank lines are skipped.
export function parse(text) {
	text = String(text).replace(/^﻿/, "");
	const delim = sniff(text);
	const rows = [];
	let row = [], field = "", quoted = false, i = 0, any = false;
	const endField = () => {
		row.push(field);
		field = "";
	};
	const endRow = () => {
		endField();
		if (row.length > 1 || row[0] !== "" || any) rows.push(row);
		row = [];
		any = false;
	};
	while (i < text.length) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"' && field === "") {
			quoted = true;
			any = true;
		} else if (c === delim) endField();
		else if (c === "\r" || c === "\n") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			endRow();
		} else field += c;
		i++;
	}
	if (field !== "" || row.length || any) endRow();
	return rows;
}

function sniff(text) {
	let quoted = false;
	for (const c of text) {
		if (c === '"') quoted = !quoted;
		else if (!quoted && (c === "," || c === ";" || c === "\t")) return c;
		else if (!quoted && (c === "\n" || c === "\r")) break;
	}
	return ",";
}

export function stringify(rows) {
	const cell = (v) => {
		const s = v == null ? "" : String(v);
		return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// --- Values ---

const YES = new Set(["yes", "y", "true", "1", "on", "x"]);
const NO = new Set(["no", "n", "false", "0", "off", ""]);

class Bad extends Error {
	constructor(code, params = {}) {
		super(code);
		Object.assign(this, { code, params });
	}
}

const asBool = (s) => {
	const v = s.trim().toLowerCase();
	if (YES.has(v)) return true;
	if (NO.has(v)) return false;
	throw new Bad("bad_bool");
};
const yesNo = (v) => (v ? "Yes" : "No");

const asInt = (lo, hi, blank) => (s) => {
	s = s.trim();
	if (s === "" && blank !== undefined) return blank;
	const n = Number(s);
	if (!Number.isInteger(n) || n < lo || n > hi) throw new Bad("range", { min: lo, max: hi });
	return n;
};

const asNum = (lo, hi) => (s) => {
	s = s.trim().replace(",", ".");
	if (s === "") return 0;
	const n = Number(s);
	if (!Number.isFinite(n) || n < lo || n > hi) throw new Bad("range", { min: lo, max: hi });
	return n;
};

const asName = (max, required = true) => (s) => {
	s = s.trim();
	if (required && !s) throw new Bad("no_name");
	if (s.length > max) throw new Bad("too_long", { max });
	return s;
};

const asFreq = (blank) => (s) => {
	if (blank !== undefined && !s.trim()) return blank;
	const hz = parseFreq(s.trim().replace(",", "."));
	if (hz === null) throw new Bad("bad_freq");
	return hz;
};

const asTone = (s) => {
	const v = s.trim().replace(",", ".");
	if (/^(none|-)$/i.test(v)) return "";
	const t = parseTone(v);
	if (t === null) throw new Bad("bad_tone");
	return t;
};

const asId = (s) => {
	s = s.trim();
	if (s === "" || s === "0") return 0;
	const n = Number(s);
	if (!Number.isInteger(n) || n < 1 || n > 0xFFFFFF) throw new Bad("id_range");
	return n;
};

// One of a few words (case-insensitive), or a number in range; a blank cell is the default. `extra` maps more words
// a file may use to a key (the stock CPS writes "Middle" for the power level the editor calls Mid)
const asWord = (words, dflt, lo, hi, extra = {}) => (s) => {
	const v = s.trim().toLowerCase();
	if (!v) return dflt;
	for (const [k, w] of Object.entries(words)) if (w.toLowerCase() === v) return isNaN(Number(k)) ? k : Number(k);
	for (const [w, k] of Object.entries(extra)) if (w.toLowerCase() === v) return k;
	if (lo !== undefined && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi) return Number(v);
	throw new Bad("bad_value", { value: s.trim(), allowed: Object.values(words).join(", ") });
};

const POWER = { ...POWER_NAMES };
const powerText = (n) => POWER_NAMES[n] || String(n);
const MODES = { fm: "FM", dmr: "DMR", nxdn: "NXDN", ysf: "YSF" };
// A word a file may use for the mode, and the channel kind it means (0: a plain FM or DMR channel). Besides the
// editor's own names these are the kind short names the editor itself exports (P25, P25T, T3, AM), so its own files
// round-trip, and the stock CPS's Analog/Digital
const MODE_WORDS = { fm: 0, dmr: 0, analog: 0, digital: 0, nxdn: 4, ysf: 6, c4fm: 6, fusion: 6, "system fusion": 6, "yaesu system fusion": 6, p25: 2, p25t: 3, t3: 1, am: 5, m17: 7, "d-star": 9, dstar: 9 };
const PLAIN_OF_WORD = { analog: "fm", digital: "dmr" };
const MODE_ALLOWED = "FM, DMR, NXDN, NXDN Scrambler, YSF, P25, P25T, T3, AM, M17, D-STAR";

// A channel's mode, as a kind or a plain mode: a kind channel exports its kind's name (the base record stands in as
// DMR, so MODES[mode] would read DMR for it), a plain one its mode. Setting it makes or unmakes the kind
// (channelmodes.js setKind): NXDN or YSF gives the channel the kind's parameters, FM or DMR takes it back to plain.
// A blank cell leaves the mode on an existing channel; a new channel defaults to FM.
const modeCol = {
	header: "Mode", aliases: ["Channel Mode", "Channel Type", "Type"], key: "mode",
	get: (r) => {
		if (r.kind === SCRAMBLER_KIND) return `NXDN ${r.params?.rate9600 === false ? "4800" : "9600"} Scrambler`;
		if (r.kind === NXDN_KIND) return r.params?.rate9600 === false ? "NXDN 4800" : "NXDN 9600";
		if (r.kind) {
			const n = kindName(r.kind);
			if (n !== "?") return n;
		}
		return MODES[r.mode] ?? r.mode;
	},
	set: (r, s, m) => {
		const v = s.trim().toLowerCase();
		if (!v) return;
		if (["nxdn scrambler", "nxdn-s", "nxdn 9600 scrambler", "nxdn 4800 scrambler"].includes(v)) {
			setKind(m, r, SCRAMBLER_KIND);
			r.params = { ...r.params, rate9600: v !== "nxdn 4800 scrambler" };
			return;
		}
		if (["nxdn48", "nxdn96", "nxdn 4800", "nxdn 9600"].includes(v)) {
			setKind(m, r, NXDN_KIND);
			r.params = { ...r.params, rate9600: v === "nxdn96" || v === "nxdn 9600" };
			return;
		}
		const kind = MODE_WORDS[v];
		if (kind === undefined) throw new Bad("bad_value", { value: s.trim(), allowed: MODE_ALLOWED });
		const key = Object.keys(MODES).find((k) => MODES[k].toLowerCase() === v) ?? PLAIN_OF_WORD[v] ?? "dmr";
		if (kind) setKind(m, r, kind);
		else setKind(m, r, 0, key);
	},
};
const TYPES = Object.fromEntries(CALL_TYPES.map((k) => [k, k[0].toUpperCase() + k.slice(1)]));

// --- References by name ---

// A record's name in a file: its name, or "#n" when the name can't stand for it (another record has it, or it holds
// the member list separator or looks like "#n" itself)
function refText(x, list) {
	if (x == null) return "";
	if (typeof x === "number") return `#${x}`;
	const plain = !x.name.includes(SEP) && !/^#\d+$/.test(x.name.trim()) && list.filter((y) => y.name === x.name).length === 1;
	return plain || !x.number ? x.name : `#${x.number}`;
}

function findRef(text, list) {
	const s = text.trim();
	if (!s) return null;
	const num = /^#(\d+)$/.exec(s);
	if (num) {
		const n = Number(num[1]);
		const hit = list.find((x) => x.number === n);
		if (!hit) throw new Bad("unknown_ref", { name: s });
		return hit;
	}
	const hits = list.filter((x) => x.name === s);
	if (hits.length === 1) return hits[0];
	const loose = hits.length ? hits : list.filter((x) => x.name.toLowerCase() === s.toLowerCase());
	if (loose.length === 1) return loose[0];
	throw new Bad(loose.length ? "ambiguous_ref" : "unknown_ref", { name: s });
}

const SEP = "|";

function refsText(list, pool) {
	return list.map((x) => refText(x, pool)).join(SEP);
}

// Member lists: problems for the names that don't resolve, the rest kept
function findRefs(text, pool, max, bad) {
	const out = [];
	for (const part of text.split(SEP)) {
		if (!part.trim()) continue;
		try {
			out.push(findRef(part, pool));
		} catch (e) {
			bad(e);
		}
	}
	if (out.length > max) {
		bad(new Bad("too_many", { max, count: out.length }));
		out.length = max;
	}
	return out;
}

// --- Tables ---

// A column: header, other names a file may use, get(record, model) -> text, set(record, text, model, bad)
const c = (header, key, put, get = (r) => r[key] ?? "", aliases = []) => ({
	header, aliases, key,
	get,
	set: (r, s) => {
		r[key] = put(s);
	},
});

const ref = (header, key, table, aliases = []) => ({
	header, aliases, key,
	get: (r, m) => refText(r[key], m[table]),
	set: (r, s, m) => {
		const v = s.trim();
		r[key] = !v || /^(0|none|-)$/i.test(v) ? null : findRef(v, m[table]);
	},
});

const NUMBER = (max) => ({ header: "Number", aliases: ["No", "#", "Index"], key: "number", get: (r) => r.number ?? "", set: (r, s) => {
	r.number = asInt(1, max, null)(s);
} });

// NXDN RANs (mode_nxdn.js): kind 4 (modes.js). These columns update a channel that already is NXDN, or one the
// file itself makes NXDN (Mode is applied before the other columns). A blank RX RAN keeps the value; a blank TX RAN
// sends the RX RAN, RAN 1 when that is every RAN (0), as the editor's blank TX RAN does.
const NXDN_KIND = 4, RAN_MAX = 63;
const isNxdn = (kind) => kind === NXDN_KIND || kind === SCRAMBLER_KIND;
const txRanDefault = (rx) => (rx !== 0 ? rx : 1);
const ranCol = (header, key, aliases) => ({
	header, aliases, key,
	get: (r) => {
		if (!isNxdn(r.kind) || !r.params) return "";
		const v = r.params[key];
		if (v === undefined || v === null) return "";
		if (key === "txRan" && v === txRanDefault(r.params.rxRan ?? 0)) return "";
		return String(v);
	},
	set: (r, s) => {
		s = s.trim();
		if (!isNxdn(r.kind) || !r.params) {
			if (s === "") return;
			throw new Bad("bad_value", { value: s, allowed: "NXDN channels" });
		}
		if (s === "") {
			if (key === "txRan") r.params = { ...r.params, txRan: txRanDefault(r.params.rxRan ?? 0) };
			return;
		}
		const n = Number(s);
		if (!Number.isInteger(n) || n < 0 || n > RAN_MAX) throw new Bad("range", { min: 0, max: RAN_MAX });
		r.params = { ...r.params, [key]: n };
	},
});

// YSF (mode_ysf.js): kind 6 (modes.js). A column of a YSF channel's parameters, blank on any other channel; a value
// on a channel that is not YSF is reported as a bad value instead of being dropped silently. A blank cell keeps the
// value, except TX DG-ID, which sends the RX DG-ID, and Destination, which calls ALL, as the editor's blanks do.
const M17_KIND = 7, DSTAR_KIND = 9;
const m17Col = (header, key, parse) => ({
	header, key, aliases: [],
	get: (r) => r.kind === M17_KIND ? r.params[key] : "",
	set: (r, s) => {
		if (!s.trim()) return;
		if (r.kind !== M17_KIND) throw new Bad("bad_value", { value: s, allowed: "M17" });
		r.params = { ...r.params, [key]: parse(s.trim()) };
	},
});
const YSF_KIND = 6, DGID_MAX = 127, CALLSIGN_LEN = 10;
const ysfCol = (header, key, aliases, get, set) => ({
	header, aliases, key,
	get: (r) => (r.kind === YSF_KIND && r.params ? get(r.params) : ""),
	set: (r, s) => {
		s = s.trim();
		if (r.kind !== YSF_KIND || !r.params) {
			if (s === "") return;
			throw new Bad("bad_value", { value: s, allowed: "YSF channels" });
		}
		set(r, s);
	},
});

// The data type (mode_ysf.js DT_*): V/D-1, Data FR, DN, VW, or 0-3
const DT_WORDS = {
	"v/d-1": 0, vd1: 0, "v/d mode 1": 0, "data fr": 1, data: 1, dn: 2, "v/d-2": 2, vd2: 2, "v/d mode 2": 2,
	vw: 3, "voice fr": 3, voice: 3,
};
const DT_TEXT = ["V/D-1", "Data FR", "DN", "VW"];
const ysfDtCol = () => ysfCol("YSF DT", "dt", ["YSF Data Type", "Data Type"], (p) => DT_TEXT[p.dt] ?? "", (r, s) => {
	if (s === "") return;
	const v = s.toLowerCase();
	const n = v in DT_WORDS ? DT_WORDS[v] : /^\d+$/.test(v) ? Number(v) : NaN;
	if (!Number.isInteger(n) || n < 0 || n > 3) throw new Bad("bad_value", { value: s, allowed: "V/D-1, Data FR, DN, VW" });
	r.params = { ...r.params, dt: n };
});

// Wide or narrow deviation
const ysfDevCol = () => ysfCol("Deviation", "narrow", ["YSF Deviation"], (p) => (p.narrow ? "Narrow" : "Wide"), (r, s) => {
	if (s === "") return;
	const v = s.toLowerCase();
	if (v !== "wide" && v !== "narrow") throw new Bad("bad_value", { value: s, allowed: "Wide, Narrow" });
	r.params = { ...r.params, narrow: v === "narrow" };
});

// A DG-ID, 0-127. A blank TX DG-ID sends the RX DG-ID
const ysfDgidCol = (header, key, aliases) => ysfCol(header, key, aliases,
	(p) => {
		const v = p[key];
		if (v === undefined || v === null) return "";
		if (key === "txDgid" && v === (p.rxDgid ?? 0)) return "";
		return String(v);
	}, (r, s) => {
		if (s === "") {
			if (key === "txDgid") r.params = { ...r.params, txDgid: r.params.rxDgid ?? 0 };
			return;
		}
		const n = Number(s);
		if (!Number.isInteger(n) || n < 0 || n > DGID_MAX) throw new Bad("range", { min: 0, max: DGID_MAX });
		r.params = { ...r.params, [key]: n };
	});

// The destination call sign, up to 10 printable ASCII characters. A blank cell calls ALL
const ysfDestCol = () => ysfCol("Destination", "dest", ["YSF Destination", "Callsign"], (p) => (p.dest === "ALL" ? "" : (p.dest ?? "")), (r, s) => {
	if (s === "") {
		r.params = { ...r.params, dest: "ALL" };
		return;
	}
	if (s.length > CALLSIGN_LEN || /[^ -~]/.test(s)) throw new Bad("bad_value", { value: s, allowed: "up to 10 printable ASCII characters" });
	r.params = { ...r.params, dest: s };
});

export const TABLES = {
	contacts: {
		file: "contacts.csv",
		columns: [
			NUMBER(LIMITS.contacts),
			c("Name", "name", asName(LIMITS.name), undefined, ["Contact Name", "Contact"]),
			c("ID", "id", asInt(1, 0xFFFFFF), undefined, ["DMR ID", "Call ID", "Radio ID", "TG", "Talkgroup"]),
			c("Call Type", "type", asWord(TYPES, "group"), (r) => TYPES[r.type], ["Type"]),
			c("Timeslot", "timeslot", asInt(0, 2, 0), (r) => r.timeslot || "", ["TS", "Timeslot Override"]),
		],
		create: () => newContact(),
		required: ["name", "id"],
	},
	rxLists: {
		file: "rx-group-lists.csv",
		columns: [
			NUMBER(LIMITS.rxLists),
			c("Name", "name", asName(LIMITS.name), undefined, ["Group List", "RX Group List"]),
			{ header: "Contacts", aliases: ["Members", "Talkgroups"], key: "contacts", get: (r, m) => refsText(r.contacts, m.contacts),
				set: (r, s, m, bad) => {
					r.contacts = findRefs(s, m.contacts, LIMITS.rxListContacts, bad);
				} },
		],
		create: () => ({ number: null, name: "", contacts: [] }),
		required: ["name", "contacts"],
	},
	dtmfContacts: {
		file: "dtmf-contacts.csv",
		columns: [
			NUMBER(LIMITS.dtmfContacts),
			c("Name", "name", asName(LIMITS.name)),
			c("Code", "code", (s) => {
				s = s.trim().toUpperCase();
				if (!validDtmf(s)) throw new Bad("bad_dtmf");
				return s;
			}, undefined, ["DTMF", "DTMF Code", "Number String"]),
		],
		create: () => ({ number: null, name: "", code: "" }),
		required: ["name", "code"],
	},
	aprs: {
		file: "aprs.csv",
		columns: [
			NUMBER(LIMITS.aprs),
			c("Name", "name", asName(LIMITS.aprsName)),
			c("SSID", "ssid", asInt(0, 15, 0)),
			c("Path 1", "path1", path, undefined, ["Path1"]),
			c("Path 2", "path2", path, undefined, ["Path2"]),
			c("Symbol Table", "symTable", (s) => char(s, "/")),
			c("Symbol", "symCode", (s) => char(s, ">"), undefined, ["Symbol Code"]),
			c("Comment", "comment", asName(LIMITS.aprsComment, false)),
			c("TX Frequency (MHz)", "txHz", asFreq(0), (r) => (r.txHz ? mhz(r.txHz) : ""), ["TX Frequency", "Frequency"]),
			c("300 Baud", "baud300", asBool, (r) => yesNo(r.baud300)),
			c("Fixed Position", "useFixed", asBool, (r) => yesNo(r.useFixed), ["Use Fixed Position"]),
			c("Latitude", "lat", asNum(-90, 90), (r) => coordText(r.lat)),
			c("Longitude", "lon", asNum(-180, 180), (r) => coordText(r.lon)),
			c("QSY", "qsy", asBool, (r) => yesNo(r.qsy)),
			c("Silent", "silent", asBool, (r) => yesNo(r.silent)),
			c("Ambiguity", "ambiguity", asInt(0, 4, 0), undefined, ["Position Ambiguity"]),
		],
		create: () => ({
			number: null, name: "", ssid: 0, lat: 0, lon: 0, path1: "", path2: "", symTable: "/", symCode: ">", comment: "",
			txHz: 0, baud300: false, useFixed: false, qsy: false, silent: false, ambiguity: 0,
		}),
		required: ["name"],
	},
	channels: {
		file: "channels.csv",
		columns: [
			NUMBER(LIMITS.channels),
			c("Name", "name", asName(LIMITS.name), undefined, ["Channel Name", "Channel"]),
			modeCol,
			c("RX Frequency (MHz)", "rxHz", asFreq(), (r) => mhz(r.rxHz), ["RX Frequency", "RX Freq", "Receive Frequency", "RX", "RX Frequency[MHz]"]),
			c("TX Frequency (MHz)", "txHz", asFreq(), (r) => mhz(r.txHz), ["TX Frequency", "TX Freq", "Transmit Frequency", "TX", "TX Frequency[MHz]"]),
			c("Power", "power", asWord(POWER, 0, 0, 10, { middle: 6 }), (r) => powerText(r.power), ["TX Power"]),
			c("Timeout (s)", "tot", asInt(0, 3825, 0), undefined, ["Timeout", "TOT"]),
			c("Bandwidth (kHz)", "bw", (s) => {
				const v = s.trim().replace(",", ".").replace(/\s*khz$/i, "");
				if (v === "" || v === "12.5") return 12.5;
				if (v === "25") return 25;
				throw new Bad("bad_value", { value: s.trim(), allowed: "12.5, 25" });
			}, undefined, ["Bandwidth", "BW"]),
			c("RX Tone", "rxTone", asTone, undefined, ["RX CTCSS/DCS", "Decode", "RX CTCSS", "CTC/DCS Decode"]),
			c("TX Tone", "txTone", asTone, undefined, ["TX CTCSS/DCS", "Encode", "TX CTCSS", "CTC/DCS Encode"]),
			c("Squelch", "squelch", asInt(0, 21, 0), undefined, ["Squelch Level"]),
			c("Color Code", "colorCode", asInt(0, 15, 1), undefined, ["CC", "Colour Code"]),
			c("Timeslot", "timeslot", (s) => {
				const slot = /^slot\s*([12])$/i.exec(s.trim());
				return slot ? Number(slot[1]) : asInt(1, 2, 1)(s);
			}, undefined, ["TS", "Time Slot", "Slot"]),
			ranCol("RX RAN", "rxRan", ["Receive RAN"]),
			ranCol("TX RAN", "txRan", ["Transmit RAN"]),
			m17Col("M17 CAN", "can", asInt(0, 15)),
			m17Col("M17 Destination", "dest", (s) => {
				if (!callOk(s)) throw new Bad("bad_value", { value: s, allowed: "A–Z, 0–9, / . - (1–9)" });
				return s.toUpperCase();
			}),
			{ header: "Accept Invalid CRC", key: "acceptBadCrc", aliases: [],
				get: (r) => r.kind === 1 ? yesNo(r.acceptBadCrc) : "",
				set: (r, s) => {
					if (!s.trim()) return;
					if (r.kind !== 1) throw new Bad("bad_value", { value: s, allowed: "T3" });
					r.acceptBadCrc = asBool(s);
				} },
			ysfDtCol(),
			ysfDevCol(),
			ysfDgidCol("RX DG-ID", "rxDgid", ["Receive DG-ID"]),
			ysfDgidCol("TX DG-ID", "txDgid", ["Transmit DG-ID"]),
			ysfDestCol(),
			ref("TX Contact", "contact", "contacts", ["Contact"]),
			ref("RX Group List", "rxList", "rxLists", ["Group List", "RX List"]),
			ref("APRS", "aprs", "aprs", ["APRS Configuration"]),
			c("DMR ID", "dmrId", asId, (r) => r.dmrId || "", ["Channel DMR ID"]),
			{ header: "RX Only", key: "rxOnly", aliases: ["Forbid TX"],
				get: (r) => yesNo(r.kind === SCRAMBLER_KIND || ([1, YSF_KIND, M17_KIND, DSTAR_KIND].includes(r.kind) ? !r.tagTx : r.rxOnly)),
				set: (r, s) => {
					if ([1, YSF_KIND, M17_KIND, SCRAMBLER_KIND, DSTAR_KIND].includes(r.kind) && !s.trim()) return;
					const rxOnly = asBool(s);
					if ([1, YSF_KIND, M17_KIND, SCRAMBLER_KIND, DSTAR_KIND].includes(r.kind)) r.tagTx = !rxOnly;
					else r.rxOnly = rxOnly;
				} },
			{ header: "NXDN Scrambler Key ID", key: "scramblerKeyId", aliases: [],
				get: (r) => r.kind === SCRAMBLER_KIND ? r.params?.keyId ?? "" : "",
				set: (r, s) => {
					if (!s.trim()) return;
					if (r.kind !== SCRAMBLER_KIND) throw new Bad("bad_value", { value: s.trim(), allowed: "an NXDN Scrambler channel" });
					r.params = { ...r.params, keyId: asInt(0, RAN_MAX)(s) };
				} },
			{ header: "NXDN Scrambler TX", key: "scramblerTx", aliases: [],
				get: (r) => r.kind === SCRAMBLER_KIND ? yesNo(r.tagTx) : "",
				set: (r, s) => {
					if (!s.trim()) return;
					if (r.kind !== SCRAMBLER_KIND) throw new Bad("bad_value", { value: s.trim(), allowed: "an NXDN Scrambler channel" });
					r.tagTx = asBool(s);
				} },
			c("All Skip", "allSkip", asBool, (r) => yesNo(r.allSkip), ["Scan Skip"]),
			c("Zone Skip", "zoneSkip", asBool, (r) => yesNo(r.zoneSkip)),
			c("VOX", "vox", asBool, (r) => yesNo(r.vox), ["VOX Function"]),
			c("Tone Burst", "toneBurst", asBool, (r) => yesNo(r.toneBurst), ["1750 Hz"]),
			c("No Beep", "noBeep", asBool, (r) => yesNo(r.noBeep)),
			c("No Eco", "noEco", asBool, (r) => yesNo(r.noEco)),
			c("DMO", "dmo", asBool, (r) => yesNo(r.dmo)),
			c("Roaming", "roam", asBool, (r) => yesNo(r.roam)),
			c("Talker Alias TS1", "aliasTs1", asInt(0, 3, 0)),
			c("Talker Alias TS2", "aliasTs2", asInt(0, 3, 0)),
			c("Use Location", "useLocation", asBool, (r) => yesNo(r.useLocation)),
			c("Latitude", "lat", asNum(-90, 90), (r) => coordText(r.lat)),
			c("Longitude", "lon", asNum(-180, 180), (r) => coordText(r.lon)),
			c("SFR", "sfr", asBool, (r) => yesNo(r.sfr)),
			c("SFR A", "sfrA", asInt(0, 255, 0)),
			c("SFR B", "sfrB", asInt(0, 255, 0)),
		],
		create: () => newChannel(),
		required: ["name", "rxHz"],
	},
	zones: {
		file: "zones.csv",
		columns: [
			c("Name", "name", asName(LIMITS.name), undefined, ["Zone Name", "Zone"]),
			{ header: "Channels", aliases: ["Members", "Channel Members"], key: "channels", get: (r, m) => refsText(r.channels, m.channels),
				set: (r, s, m, bad) => {
					r.channels = findRefs(s, m.channels, LIMITS.zoneChannels, bad);
				} },
		],
		create: () => ({ name: "", channels: [], slot: null }),
		required: ["name", "channels"],
	},
};

// Import order for several tables at once: what a table refers to comes first
export const ORDER = ["contacts", "rxLists", "dtmfContacts", "aprs", "channels", "zones"];

function path(s) {
	s = s.trim().toUpperCase();
	if (s && !/^[A-Z0-9]{1,6}(-([0-9]|1[0-5]))?$/.test(s)) throw new Bad("bad_path");
	return s;
}

function char(s, dflt) {
	const v = s.trim();
	if (!v) return dflt;
	if (v.length !== 1 || v.charCodeAt(0) > 0x7E) throw new Bad("bad_value", { value: v, allowed: "one character" });
	return v;
}

function coordText(x) {
	return x ? Number(x).toFixed(4).replace(/\.?0+$/, "") : "";
}

// --- Export ---

export function exportTable(m, table) {
	const spec = TABLES[table];
	return stringify([spec.columns.map((x) => x.header), ...m[table].map((r) => spec.columns.map((x) => x.get(r, m)))]);
}

// --- Import ---

const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9#]/g, "");

// The columns a header row names: [{column, index}], plus the headers not recognized
function mapHeader(spec, head) {
	const found = [], unknown = [];
	const used = new Set();
	head.forEach((hname, index) => {
		const n = norm(hname);
		const col = spec.columns.find((x) => !used.has(x) && [x.header, ...x.aliases].some((a) => norm(a) === n));
		if (col) {
			used.add(col);
			found.push({ col, index });
		} else if (n) unknown.push(hname.trim());
	});
	return { found, unknown };
}

// Which table a header row is for: the one whose columns it names most, among those whose required columns it has
export function detect(text) {
	const head = parse(text)[0] || [];
	let best = null, score = 0;
	for (const [table, spec] of Object.entries(TABLES)) {
		const { found } = mapHeader(spec, head);
		const keys = new Set(found.map((f) => f.col.key));
		if (!spec.required.every((k) => keys.has(k))) continue;
		if (found.length > score) {
			best = table;
			score = found.length;
		}
	}
	return best;
}

// Import one table's CSV into m (changed in place). Returns {table, added, updated, removed, problems, unknown}
// or throws Bad("not_a_table") when no table's columns match.
export function importTable(m, text, table = detect(text)) {
	if (!table) throw new Bad("not_a_table");
	const spec = TABLES[table];
	const rows = parse(text);
	const { found, unknown } = mapHeader(spec, rows[0] || []);
	const problems = [];
	const keys = new Set(found.map((f) => f.col.key));
	if (table === "channels") {
		if (!spec.required.every((key) => keys.has(key))) throw new Bad("not_a_table");
		// Read the mode and RX DG-ID first. Scrambler TX overrides the receive-only base record.
		const priority = { mode: 0, rxDgid: 1, scramblerTx: 3 };
		found.sort((a, b) => (priority[a.col.key] ?? 2) - (priority[b.col.key] ?? 2));
	}
	const hasNumber = keys.has("number");
	const old = m[table];
	const taken = new Set();
	const out = [];
	let added = 0, updated = 0;
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		if (row.every((v) => !v.trim())) continue;
		const cell = (key) => {
			const f = found.find((x) => x.col.key === key);
			return f ? row[f.index] ?? "" : undefined;
		};
		// the record this row stands for: same number, else same name, else a new one
		let rec = null;
		const nText = hasNumber ? cell("number").trim() : "";
		if (nText) rec = old.find((x) => !taken.has(x) && String(x.number) === nText) || null;
		const nameText = (cell("name") ?? "").trim();
		if (!rec && nameText) rec = old.find((x) => !taken.has(x) && x.name === nameText) || null;
		const fresh = !rec;
		if (fresh) rec = spec.create();
		else taken.add(rec);
		const work = { ...rec };
		let skip = false;
		for (const { col, index } of found) {
			try {
				col.set(work, row[index] ?? "", m, (e) => problems.push({ row: i + 1, column: col.header, code: e.code, params: e.params }));
			} catch (e) {
				if (!(e instanceof Bad)) throw e;
				// A new channel with an invalid explicit mode must not be saved as default FM.
				const lost = fresh && (spec.required.includes(col.key) || (table === "channels" && col.key === "mode"));
				problems.push({ row: i + 1, column: col.header, code: e.code, params: e.params, skipped: lost });
				skip ||= lost;
			}
		}
		if (!skip && !work.name) {
			problems.push({ row: i + 1, column: "Name", code: "no_name", params: {}, skipped: true });
			skip = true;
		}
		if (skip) continue;
		Object.assign(rec, work);
		if (fresh) added++;
		else updated++;
		out.push(rec);
	}
	const gone = old.filter((x) => !taken.has(x));
	remove(m, table, gone);
	m[table] = out;
	// rows the file numbered twice keep the first; the rest get free numbers
	if (table !== "zones") assignNumbers(out, LIMITS[table]);
	if (out.length > LIMITS[table]) problems.push({ row: 0, column: "", code: "too_many", params: { max: LIMITS[table], count: out.length } });
	return { table, added, updated, removed: gone.length, problems, unknown };
}

// Several tables (the .zip export): [{name, text}] in dependency order. Files that match no table are listed.
export function importAll(m, files) {
	const results = [], skipped = [];
	const tagged = files.map((f) => ({ ...f, table: detect(f.text) }));
	for (const table of ORDER) for (const f of tagged.filter((x) => x.table === table)) results.push({ name: f.name, ...importTable(m, f.text, table) });
	for (const f of tagged) if (!f.table) skipped.push(f.name);
	return { results, skipped };
}

export function exportAll(m) {
	return ORDER.map((table) => ({ name: TABLES[table].file, data: "﻿" + exportTable(m, table) }));
}

export { Bad as CsvError };
