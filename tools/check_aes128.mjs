// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lyra XE1POC
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DMR_PRIV, channelAddr } from "../static/js/codeplug/records.js";
import { validKeyHex, withoutSecrets } from "../static/js/codeplug/channelmodes.js";
import { decode, empty, encode, newChannel } from "../static/js/codeplug/model.js";
import { bulkColumns, channelForm } from "../static/js/editor/views.js";

const t = (key) => key;

test("AES-128 has an independent key type and retains its receive-only base record", () => {
	const m = empty();
	for (const name of ["A", "B"]) {
		m.channels.push(newChannel({ name, mode: "dmr", rxHz: 433000000, txHz: 433000000 }));
	}
	const [a, b] = m.channels;
	m.keyring = [{ alg: 0x24, id: 98, key: "AB".repeat(16) }, { alg: 0x25, id: 98, key: "CD".repeat(32) }];
	assert.equal(validKeyHex(0x24, m.keyring[0].key), true);
	assert.equal(validKeyHex(0x24, m.keyring[1].key), false);
	const forms = channelForm(m, t);
	forms.find((field) => field.key === "dmrPrivacy").set(a, DMR_PRIV.aes128);
	const key = forms.find((field) => field.key === "dmrPrivacyKey");
	assert.deepEqual(key.options(a).map(([id]) => id), [null, 98]);
	const bulk = bulkColumns("channels", m, t, { rows: m.channels });
	const aes128 = bulk.find((field) => field.key === "bulkAes128");
	const aes256 = bulk.find((field) => field.key === "bulkAes");
	assert.deepEqual(aes128.options().map(([id]) => id), [null, 98]);
	aes128.set(a, 98);
	aes256.set(b, 98);
	aes256.set(a, null);
	aes128.set(b, null);
	assert.deepEqual([a.dmrPrivacy, b.dmrPrivacy], [DMR_PRIV.aes128, DMR_PRIV.aes]);
	const image = encode(m);
	const offset = channelAddr(a.number);
	assert.equal(image.bytes[offset + 0x33] & 0x04, 0x04);
	assert.deepEqual(Array.from(image.bytes.subarray(offset + 0x34, offset + 0x37)), [0xAA, 0x5A, 98]);
	const restored = decode(image);
	assert.equal(restored.channels[0].rxOnly, false);
	assert.deepEqual(restored.channels.map((ch) => [ch.dmrPrivacy, ch.dmrPrivacyKey]), [[DMR_PRIV.aes128, 98], [DMR_PRIV.aes, 98]]);
	assert.deepEqual(restored.keyring.map((entry) => [entry.alg, entry.id, entry.key.length]), [[0x24, 98, 32], [0x25, 98, 64]]);
	const copy = image.clone();
	withoutSecrets(copy.bytes);
	assert.equal(decode(copy).keyring.length, 0);
	assert.equal(decode(copy).channels[0].dmrPrivacy, DMR_PRIV.aes128);
});

test("both generated editor pages and generator catalogs name AES-128", () => {
	for (const [language, page] of [["es", "codeplug"], ["en", "en/codeplug"]]) {
		const html = readFileSync(new URL(`../${page}/index.html`, import.meta.url), "utf8");
		const strings = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
		assert.equal(strings["editor.keys.alg.dmr128"], "DMR AES-128");
		const catalog = JSON.parse(readFileSync(new URL(`../generator/i18n/${language}.json`, import.meta.url), "utf8"));
		assert.equal(catalog["editor.keys.alg.dmr128"], "DMR AES-128");
	}
});
