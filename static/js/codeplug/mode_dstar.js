// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
import { grow } from "./modebytes.js";

// D-STAR simplex uses the radio name and fixed DIRECT routing.
export const dstarKind = {
	id: 9,
	feature: "DSTAR",
	systemType: null,
	contacts: false,
	ownFreqs: true,
	defaultTx: true,
	recordFields: [],
	flags: {},
	newParams: () => ({}),
	decode: () => ({}),
	encode: (params, prev = null) => grow(prev, 0),
	fields: () => [],
	validate() {},
};
