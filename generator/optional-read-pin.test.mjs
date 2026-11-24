// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { CpsSerial } from "../static/js/codeplug/transport.js";
import { frame, parseFrames } from "../static/js/flasher/link.js";

function radio() {
    const requests = [];
    const stream = {
        buf: new Uint8Array(),
        clear() { this.buf = new Uint8Array(); },
        take(n) { this.buf = this.buf.slice(n); },
        async write(bytes) {
            const [request] = parseFrames(bytes);
            const payload = Array.from(request.payload);
            requests.push(payload);
            const authorized = payload[0] === 10 && String.fromCharCode(...payload.slice(1, 7)) === "004213";
            const op = authorized ? payload[7] : payload[0];
            const info = new Uint8Array(26);
            info.set([1, 2, 0, 16, 1, 1]);
            const data = op === 0 && authorized ? info : op === 2 && authorized ? [0, 0, 0, 0, 2] : [];
            this.buf = frame(0x9c, request.seq, Uint8Array.of(authorized && op <= 2 ? 0 : 6, ...data));
        },
    };
    return { tr: new CpsSerial(stream), requests };
}

test("a protected read preserves leading zeros, and clearing the transfer clears its credential", async () => {
    const { tr, requests } = radio();
    const pin = new TextEncoder().encode("004213");
    await tr.beginProtectedRead(pin);
    assert.equal(tr.fast.block, 4096);
    const block = await tr.fl.read(4096);
    assert.ok(block.every(b => b === 255));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(p => p[7]), [0, 2]);
    tr.endProtectedRead();
    assert.deepEqual(Array.from(pin), [0, 0, 0, 0, 0, 0]);
    assert.equal(tr.fl, null);
    assert.equal(tr.fast, null);
});

test("a refused PIN clears the transfer, and read credentials never decorate write commands", async () => {
    const { tr, requests } = radio();
    const wrong = new TextEncoder().encode("123456");
    await assert.rejects(tr.beginProtectedRead(wrong), { code: "read_pin_refused" });
    assert.ok(wrong.every(b => b === 0));
    assert.equal(tr.fast, null);
    await tr.beginProtectedRead(new TextEncoder().encode("004213"));
    await assert.rejects(tr.fl.begin(false));
    assert.deepEqual(requests.at(-1), [3, 0]);
    tr.endProtectedRead();
});
