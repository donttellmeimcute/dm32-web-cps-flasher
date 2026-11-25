// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { empty, encode, decode } from "../static/js/codeplug/model.js";
import { importTable, exportTable } from "../static/js/codeplug/csv.js";
import { ysfKind } from "../static/js/codeplug/mode_ysf.js";

test("DN keeps the selected deviation through a codeplug and CSV round trip", () => {
	for (const [name, narrow] of [["Wide", false], ["Narrow", true]]) {
		const model = empty();
		const csv = "Name,Mode,RX Frequency,TX Frequency,YSF DT,Deviation,RX DG-ID,TX DG-ID\n"
			+ `Fusion,YSF,435.000,435.000,DN,${name},0,7\n`;
		assert.deepEqual(importTable(model, csv, "channels").problems, []);
		const reopened = decode(encode(model));
		const copy = empty();
		assert.deepEqual(importTable(copy, exportTable(reopened, "channels"), "channels").problems, []);
		for (const ch of [model.channels[0], reopened.channels[0], decode(encode(copy)).channels[0]]) {
			assert.equal(ch.kind, 6);
			assert.equal(ch.params.dt, 2);
			assert.equal(ch.params.narrow, narrow);
			assert.equal(ch.params.txDgid, 7);
		}
	}
});

test("YSF preserves an explicit flags byte, including zero, and defaults a missing byte to Narrow", () => {
	assert.equal(ysfKind.newParams().narrow, true);
	assert.equal(ysfKind.decode(new Uint8Array()).narrow, true);
	for (let dt = 0; dt < 4; dt++) {
		for (const narrow of [false, true]) {
			const flags = dt | (narrow ? 4 : 0);
			const params = ysfKind.decode(Uint8Array.of(flags));
			assert.equal(params.dt, dt);
			assert.equal(params.narrow, narrow);
			assert.equal(ysfKind.encode(params)[0], flags);
			ysfKind.validate({}, params, { warn: (key) => assert.fail(key) });
		}
	}
});
