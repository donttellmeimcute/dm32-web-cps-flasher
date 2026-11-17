// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// The AM mode module of the Codeplug Editor (docs/spec/channel-modes.md 4): kind 5, a receive only channel the radio
// receives in AM wherever it is tuned (the receiver's AM path, not only the air band). It has no parameter block and no
// target: the base record stands in as DMR, receive only, and the tag says AM.

import { grow } from "./modebytes.js?v=bbc2466609";

export const amKind = {
	id: 5,
	feature: "AM_RX",
	systemType: null,
	contacts: false,
	ownFreqs: true,
	defaultTx: false,
	recordFields: [],
	flags: {},
	newParams: () => ({}),
	decode: () => ({}),
	encode: (p, prev = null) => grow(prev, 0),
	fields: () => [],
	validate() {},
};
