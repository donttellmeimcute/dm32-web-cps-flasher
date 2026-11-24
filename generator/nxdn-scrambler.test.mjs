// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Copyright (c) 2026 lyra XE1POC (changes)
import { test } from "node:test";
import assert from "node:assert/strict";
import { empty, encode, decode, newChannel } from "../static/js/codeplug/model.js";
import { decodeArea, getValue } from "../static/js/codeplug/kv.js";
import { decodeTag, MODE_KEY, KEY_BASE, setKind, validKeyHex, scramblerKeyHex, scramblerSeed, withoutSecrets } from "../static/js/codeplug/channelmodes.js";
import { exportTable, importTable, parse } from "../static/js/codeplug/csv.js";
import { channelForm } from "../static/js/editor/views.js";

const memory = (name) => newChannel({ name, mode: "dmr", rxHz: 433000000, txHz: 433000000, rxOnly: false });

test("NXDN scrambler uses a separate DMR RX-only base and a two-byte keyring record", () => {
	const m = empty();
	const scrambled = memory("Scrambled"), aes = memory("AES");
	m.channels.push(scrambled, aes);
	setKind(m, scrambled, 8);
	setKind(m, aes, 4);
	m.keyring = [{ alg: 1, id: 0, key: scramblerKeyHex(4660) }, { alg: 1, id: 63, key: scramblerKeyHex(32767) },
		{ alg: 3, id: 0, key: "AB".repeat(32) }];
	assert.equal(scramblerKeyHex(4660), "3412");
	assert.equal(scramblerSeed("FF7F"), 32767);
	assert.equal(validKeyHex(1, "0000"), false);
	assert.equal(validKeyHex(1, "0080"), false);
	assert.equal(validKeyHex(3, "AB".repeat(32)), true);
	const f = channelForm(m, (s) => s, { features: "DMR,NXDN,NXDN_SCRAMBLER" });
	const key = f.find((x) => x.key === "k8.keyId");
	assert.deepEqual(key.options(scrambled).map(([id]) => id), [null, 0, 63]);
	key.set(scrambled, 0);
	f.find((x) => x.key === "k4.aes").set(aes, 0);
	scrambled.params.rate9600 = false;
	const image = encode(m);
	const area = decodeArea(image.bytes).entries;
	const scramblerTag = decodeTag(getValue(area, MODE_KEY.tag + scrambled.number - 1));
	assert.equal(scramblerTag.kind, 8);
	assert.equal(scramblerTag.flags & 3, 1);
	assert.deepEqual([...scramblerTag.params.slice(0, 5)], [4, 0, 0, 2, 0]);
	assert.deepEqual([...getValue(area, KEY_BASE)], [255, 1, 0, 0, 0, 0x34, 0x12]);
	const [scr, old] = decode(image).channels;
	assert.equal(scr.rxOnly, true);
	assert.equal(scr.tagTx, true);
	assert.equal(scr.params.keyId, 0);
	assert.equal(old.kind, 4);
	assert.equal(old.params.aes, true);
	assert.equal(old.params.keyId, 0);
	withoutSecrets(image.bytes);
	const clean = decode(image);
	assert.deepEqual(clean.keyring, []);
	assert.equal(clean.channels[0].params.keyId, 0);
});

test("scrambler CSV preserves rate, RAN, key ID and tag TX with a receive-only stand-in", () => {
	const m = empty();
	const imported = importTable(m, "NXDN Scrambler TX,NXDN Scrambler Key ID,Name,RX,RX Only,Mode,RX RAN,TX RAN\nYes,0,Scrambler,433,Yes,NXDN 4800 Scrambler,4,7\n", "channels");
	assert.deepEqual(imported.problems, []);
	assert.equal(m.channels[0].kind, 8);
	assert.equal(m.channels[0].tagTx, true);
	assert.deepEqual(m.channels[0].params, { keyId: 0, rate9600: false, rxRan: 4, txRan: 7, squelch: 0 });
	const text = exportTable(m, "channels");
	const [header, row] = parse(text);
	assert.equal(row[header.indexOf("RX Only")], "Yes");
	assert.equal(row[header.indexOf("NXDN Scrambler TX")], "Yes");
	assert.equal(row[header.indexOf("NXDN Scrambler Key ID")], "0");
	const round = empty();
	assert.deepEqual(importTable(round, text, "channels").problems, []);
	assert.equal(round.channels[0].tagTx, true);
	assert.deepEqual(round.channels[0].params, m.channels[0].params);
});
