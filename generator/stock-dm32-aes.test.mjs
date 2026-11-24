// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Copyright (c) 2026 lyra XE1POC (changes)
import { test } from "node:test";
import assert from "node:assert/strict";
import { putFreq } from "../static/js/codeplug/fields.js";
import { decode, empty, encode } from "../static/js/codeplug/model.js";
import { CodeplugImage } from "../static/js/codeplug/image.js";
import { DMR_PRIV } from "../static/js/codeplug/records.js";
import { fromBytes, openFile, secretFreeBytes, stockAesAreaForWrite } from "../static/js/editor/files.js";
import { FakeCpsRadio } from "../static/js/codeplug/fakecps.js";
import { CpsSerial } from "../static/js/codeplug/transport.js";

// A generated file for the reported layout. Never use a real key or a radio memory dump in tests.
function stockFile() {
	const bytes = new Uint8Array(0xC9000).fill(0xFF);
	const ch = bytes.subarray(0x1000, 0x2000);
	ch[0] = 4;
	ch[1] = 0;
	ch[0xFFF] = 0x12;
	const ascii = (target, at, size, name) => {
		target.fill(0, at, at + size);
		target.set(new TextEncoder().encode(name), at);
	};
	for (const [i, [name, key, encrypted]] of [["Encrypted A", 1, true], ["Encrypted B", 6, true],
		["Unsupported", 9, true], ["Clear", 1, false]].entries()) {
		const r = ch.subarray(0x10 + i * 48, 0x10 + (i + 1) * 48);
		ascii(r, 0, 16, name);
		putFreq(r, 0x10, 451650000);
		putFreq(r, 0x14, 451650000);
		r[0x18] = 0x14;
		r[0x19] = 0;
		r[0x1D] = 1;
		r[0x1E] = key;
		r[0x1F] = encrypted ? 0x40 : 0;
	}
	for (const [i, [slot, type, name, fill]] of [[1, 4, "Key 1", 0x11], [9, 2, "Other", 0x88], [6, 4, "Key 6", 0x66]].entries()) {
		const at = 0xD300 + i * 44;
		bytes[at] = slot;
		ascii(bytes, at + 1, 10, name);
		bytes[at + 11] = type;
		bytes.fill(fill, at + 12, at + 44);
	}
	bytes[0xD300 + 3 * 44] = 0; // reported terminator: zero slot and erased filler
	bytes[0xD300 + 12] = 0x12;
	bytes[0xD300 + 43] = 0x34;
	return bytes;
}

test("stock .data AES-256 import waits for explicit, unique Encryption IDs", async () => {
	const f = await openFile("synthetic.data", stockFile());
	assert.equal(f.from, "baofeng-dm32");
	assert.deepEqual(f.stockAes.rows, [{ slot: 1, name: "Key 1", channels: 1 }, { slot: 6, name: "Key 6", channels: 1 }]);
	assert.deepEqual(f.model.channels.map((c) => c.rxOnly), [true, true, true, false]);
	assert.deepEqual(f.model.keyring, []);
	assert.deepEqual(f.stockAes.apply(new Map()), { keys: 0, channels: 0 });
	assert.deepEqual(f.stockAes.apply(new Map([[1, "4"], [6, "256"]])), { error: "invalid_id" });
	assert.deepEqual(f.stockAes.apply(new Map([[1, "4"], [6, "004"]])), { error: "duplicate_id" });
	assert.deepEqual(f.model.keyring, []);
	assert.deepEqual(f.model.channels.map((c) => c.rxOnly), [true, true, true, false]);
	assert.deepEqual(f.stockAes.apply(new Map([[1, "4"], [6, "128"]])), { keys: 2, channels: 2 });
	const live = encode(f.model);
	const d = decode(live);
	assert.deepEqual(d.channels.map((c) => [c.rxOnly, c.dmrPrivacy ?? 0, c.dmrPrivacyKey ?? 0]), [
		[false, DMR_PRIV.aes, 4], [false, DMR_PRIV.aes, 128], [true, 0, 0], [false, 0, 0],
	]);
	assert.deepEqual(d.keyring.map(({ alg, id, key }) => [alg, id, key]), [
		[0x25, 4, "12" + "11".repeat(30) + "34"], [0x25, 128, "66".repeat(32)],
	]);
	assert.deepEqual(decode(f.image).keyring, []);
	const withoutKeys = decode(CodeplugImage.from(secretFreeBytes(live)));
	assert.deepEqual(withoutKeys.keyring, []);
	assert.equal(withoutKeys.channels[0].dmrPrivacyKey, 4);
	assert.equal(decode(live).keyring.length, 2, "redaction leaves the image for the radio write alone");
});

test("suppressed, malformed, or unmapped stock keys leave encrypted channels receive-only", async () => {
	const raw = stockFile();
	assert.equal(fromBytes(raw).stockAes, null, "installer or generic import doesn't offer keys");
	const ambiguous = raw.slice();
	ambiguous[0xD300 + 2 * 44] = 1; // duplicate slot
	const unsupported = raw.slice();
	unsupported[0xD300 + 11] = unsupported[0xD300 + 2 * 44 + 11] = 2;
	const corrupted = raw.slice();
	corrupted[0xD300 + 10] = 2; // broken NUL padding
	for (const bytes of [ambiguous, unsupported, corrupted, raw.slice(0, 0xD300 + 30)]) {
		const f = await openFile("synthetic.data", bytes);
		assert.equal(f.stockAes, null);
		assert.deepEqual(decode(f.image).channels.map((c) => c.rxOnly), [true, true, true, false]);
		assert.deepEqual(f.notes.find((n) => n.code === "stock_aes_rx_only"), { code: "stock_aes_rx_only", n: 3 });
	}
	const f = await openFile("synthetic.data", raw);
	assert.deepEqual(f.stockAes.apply(new Map([[6, 255]])), { keys: 1, channels: 1 });
	assert.deepEqual(f.model.channels.map((c) => c.rxOnly), [true, false, true, false]);
});

test("direct CPS transfer keeps an unrelated destination key and follows the on-air ID", async () => {
	const f = await openFile("synthetic.data", stockFile());
	f.stockAes.apply(new Map([[1, "4"], [6, "128"]]));
	const destination = empty();
	destination.keyring = [{ alg: 0x25, id: 78, key: "AA".repeat(32) }, { alg: 0x25, id: 4, key: "12" + "11".repeat(30) + "34" }];
	const old = encode(destination);
	const base = 0x700000, end = 0xF00000;
	const radio = new FakeCpsRadio({ board: "DM-32UV", base, end, image: old.bytes, cable: true });
	const transport = new CpsSerial(radio.stream(), { cable: true });
	await transport.identify([{ id: "dm32", codeplug: { base, end, names: ["DM-32UV", "dm32"] } }]);
	const have = await transport.read({ iddb: false });
	const want = encode(f.model);
	assert.equal(stockAesAreaForWrite(want.bytes, have.bytes, f.model.base.bytes), null);
	const { plan } = await transport.write(want, have, { iddb: false });
	await transport.verify(want, plan);
	const received = decode(await transport.read({ iddb: false }));
	assert.deepEqual(received.keyring.map((k) => k.id), [78, 4, 128]);
	assert.deepEqual(received.channels.map((c) => c.dmrPrivacyKey ?? 0), [4, 128, 0, 0]);
	assert.deepEqual(received.channels.map((c) => c.rxOnly), [false, false, true, false]);
	assert.ok(radio.writes.length > 0);
	await transport.close();

	// A subsequent write to another unit still transfers keys after the editor records its previous write as the base.
	f.model.base = want;
	const another = encode(f.model);
	assert.equal(stockAesAreaForWrite(another.bytes, CodeplugImage.blank().bytes, f.model.base.bytes), null);
	assert.deepEqual(decode(another).keyring.map((k) => k.id), [4, 128]);
	destination.keyring[1].key = "BB".repeat(32);
	const conflict = encode(f.model), before = conflict.bytes.slice();
	assert.deepEqual(stockAesAreaForWrite(conflict.bytes, encode(destination).bytes, f.model.base.bytes), { code: "radio_conflict", id: 4 });
	assert.deepEqual(conflict.bytes, before);
});
