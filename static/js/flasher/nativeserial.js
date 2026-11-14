// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Web Serial's port API over the Android app's own USB serial driver (DM32 Web CPS & Flasher for Android, android/ in
// dm32-web-cps-flasher). The app's WebView has neither Web Serial nor WebUSB, so the app drives the cable's USB-serial
// chip itself (usb-serial-for-android: CH340/CH341, FTDI, CP210x, PL2303, CDC-ACM) and the page reaches it through
// window.AndroidSerial (calls, strings only) and window.__androidSerial (the app's answers and events). Outside the app
// nativeSerial is null and nothing here runs. The ports behave as usbserial.js's: SerialStream (link.js) takes them.

const bridge = globalThis.AndroidSerial;

export function toBase64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// An asynchronous call: the app answers __androidSerial.answer(call, error, value), error "" or "Name|message"
let calls = 0;
const waiting = new Map();
function call(method, ...args) {
	return new Promise((resolve, reject) => {
		const id = ++calls;
		waiting.set(id, { resolve, reject });
		try {
			bridge[method](id, ...args);
		} catch (e) {
			waiting.delete(id);
			reject(e);
		}
	});
}

const ports = new Map();	// the app's device id -> its one port object (a page compares ports it was given)

class NativeSerialPort {
	constructor(info) {
		this.info = info;
		this.readable = null;
		this.writable = null;
		this.isOpen = false;
		this.ctl = null;	// the readable's controller while it takes data
	}

	getInfo() { return { usbVendorId: this.info.vid, usbProductId: this.info.pid }; }

	async open({ baudRate = 115200 } = {}) {
		if (this.isOpen) throw new DOMException("The port is already open.", "InvalidStateError");
		await call("open", this.info.id, baudRate);
		this.isOpen = true;
		const stream = new ReadableStream({ start: (c) => { this.ctl = c; }, cancel: () => { this.ctl = null; } });
		this.readable = stream;
		this.writable = new WritableStream({ write: (chunk) => this.send(chunk) });
	}

	received(bytes) {
		try { this.ctl?.enqueue(bytes); } catch { /* the stream ended */ }
	}

	// As Web Serial after a fatal error (the cable unplugged): no readable, so a reader loop ends instead of reading on
	failed(message) {
		const c = this.ctl;
		this.ctl = null;
		this.readable = null;
		c?.error(new DOMException(message, "NetworkError"));
	}

	async send(chunk) {
		const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength);
		if (data.length) await call("write", this.info.id, toBase64(data));
	}

	// As Web Serial: a port whose readable or writable is locked refuses to close
	async close() {
		if (this.readable?.locked || this.writable?.locked) throw new DOMException("A stream of the port is locked.", "InvalidStateError");
		if (!this.isOpen) return;
		this.isOpen = false;
		const c = this.ctl;
		this.ctl = null;
		this.readable = null;
		this.writable = null;
		try { c?.close(); } catch { /* already ended */ }
		await call("close", this.info.id);
	}
}

const portOf = (info) => {
	if (!ports.has(info.id)) ports.set(info.id, new NativeSerialPort(info));
	return ports.get(info.id);
};

if (bridge) {
	globalThis.__androidSerial = {
		answer(id, error, value) {
			const w = waiting.get(id);
			if (!w) return;
			waiting.delete(id);
			if (!error) return w.resolve(value);
			const at = error.indexOf("|");
			w.reject(new DOMException(at < 0 ? error : error.slice(at + 1), at < 0 ? "NetworkError" : error.slice(0, at)));
		},
		data(device, base64) { ports.get(device)?.received(fromBase64(base64)); },
		error(device, message) { ports.get(device)?.failed(message); },
	};
}

// navigator.serial's requestPort and getPorts, from the app. requestPort shows the app's own list when several cables
// match (Web Serial filters: their usbVendorId), then Android's USB permission dialog
export const nativeSerial = bridge ? {
	async requestPort({ filters = [] } = {}) {
		const vids = filters.map((f) => f.usbVendorId).filter((v) => v !== undefined);
		return portOf(JSON.parse(await call("request", JSON.stringify(vids))));
	},
	async getPorts() {
		return JSON.parse(bridge.ports()).map(portOf);
	},
} : null;

// Saving a file inside the app (dom.js download()): the app writes it to Downloads/DM32 and says so
export const androidFiles = globalThis.AndroidFiles || null;
