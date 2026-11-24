// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
import { grow } from "./modebytes.js";

const CALL_LEN = 8;
const KEYS = ["ur", "rpt1", "rpt2"];

function readCall(b, i) {
	const from = i * CALL_LEN;
	if (!b || b.length < from + CALL_LEN) return "";
	return String.fromCharCode(...b.subarray(from, from + CALL_LEN)).trimEnd();
}

function routeCall(key, raw) {
	const call = (raw ?? "").trim().toUpperCase();
	if (key === "ur") return /^[EIU]$/.test(call) ? call.padStart(CALL_LEN) : call;
	return call.replace(/^([A-Z0-9]{1,6}) +([A-Z])$/, (_, base, module) => base.padEnd(7) + module);
}

export function dstarCallValid(key, raw) {
	if (key === "ur") return /^[A-Za-z0-9/ ]{0,8}$/.test(raw ?? "");
	const value = routeCall(key, raw);
	return !value || (value.length === CALL_LEN && /^[A-Z0-9]+ *[A-Z]$/.test(value));
}

export const dstarKind = {
	id: 9,
	feature: "DSTAR",
	systemType: null,
	contacts: false,
	ownFreqs: true,
	defaultTx: true,
	recordFields: [],
	flags: {},
	newParams: () => ({ ur: "", rpt1: "", rpt2: "" }),
	decode: (b) => Object.fromEntries(KEYS.map((key, i) => [key, readCall(b, i)])),
	encode(params, prev = null) {
		const calls = KEYS.map((key) => routeCall(key, params[key]));
		if (!prev?.length && !calls.some(Boolean)) return grow(prev, 0);
		const v = grow(prev, KEYS.length * CALL_LEN);
		calls.forEach((call, i) => {
			for (let j = 0; j < CALL_LEN; j++) v[i * CALL_LEN + j] = call.charCodeAt(j) || 0x20;
		});
		return v;
	},
	fields: () => [
		{ key: "ur", label: "URCALL", type: "text", help: "editor.dstar.ur_help" },
		{ key: "rpt1", label: "RPT1", type: "text", help: "editor.dstar.rpt1_help" },
		{ key: "rpt2", label: "RPT2", type: "text", help: "editor.dstar.rpt2_help" },
	],
	validate(c, p, problem) {
		if (!dstarCallValid("ur", p.ur)) problem.err("ur", "dstar_ur_chars");
		const rpt1 = p.rpt1?.trim(), rpt2 = p.rpt2?.trim();
		if (Boolean(rpt1) !== Boolean(rpt2)) problem.err(rpt1 ? "rpt2" : "rpt1", "dstar_route_pair");
		for (const [key, value] of [["rpt1", rpt1], ["rpt2", rpt2]]) {
			if (!dstarCallValid(key, value))
				problem.err(key, "dstar_rpt_format");
		}
	},
};
