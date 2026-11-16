// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
import { EE } from "./image.js?v=fb0b2c065d";
const BASE = EE + 0x7C00, ENTRY = 96, SLOTS = 4;
const magic = [68, 86, 65, 69, 83, 49, 0, 0];
const hex = (b) => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
const word = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);
const put = (b, o, n) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(o, n, true);
function crc(b) {
 let n = 0xFFFFFFFF;
 for (const x of b) {
  n ^= x;
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xEDB88320 : 0);
 }
 return (n ^ 0xFFFFFFFF) >>> 0;
}
export function decodeAesKeys(b) {
 const h = b.subarray(BASE, BASE + 16);
 const valid = magic.every((n, i) => h[i] === n) && h[8] === SLOTS && h[9] === ENTRY && word(h, 12) === crc(h.subarray(0, 12));
 return Array.from({ length: SLOTS }, (_, i) => {
  const e = b.subarray(BASE + 16 + i * ENTRY, BASE + 16 + (i + 1) * ENTRY);
  return valid && e[0] === 1 && e[1] === 0 && (e[2] || e[3]) && word(e, 92) === crc(e.subarray(0, 92))
   ? { kid: e[2] | (e[3] << 8), key: hex(e.subarray(4, 36)) } : { kid: 0, key: "" };
 });
}
export function validateAesKeys(keys) {
 const seen = new Set();
 if (keys.length > SLOTS) return true;
 for (const k of keys) {
  if (!k?.key) continue;
  if (!/^[0-9A-Fa-f]{64}$/.test(k.key) || !Number.isInteger(k.kid) || k.kid < 1 || k.kid > 65535 || seen.has(k.kid)) return true;
  seen.add(k.kid);
 }
 return false;
}
export function encodeAesKeys(keys, b) {
 if (validateAesKeys(keys)) throw new Error("Invalid AES keys");
 const was = decodeAesKeys(b);
 let changed = false;
 for (let i = 0; i < SLOTS; i++) {
  const k = keys[i] || { kid: 0, key: "" };
  if ((k.key || "").toUpperCase() === was[i].key && (!k.key || k.kid === was[i].kid)) continue;
  const e = b.subarray(BASE + 16 + i * ENTRY, BASE + 16 + (i + 1) * ENTRY);
  e.fill(0);
  if (k.key) {
   e[0] = 1; e[2] = k.kid & 255; e[3] = k.kid >> 8;
   e.set(k.key.match(/../g).map((s) => parseInt(s, 16)), 4);
   crypto.getRandomValues(e.subarray(36, 52));
  }
  put(e, 92, crc(e.subarray(0, 92))); changed = true;
 }
 if (changed) {
  const h = b.subarray(BASE, BASE + 16); h.fill(0); h.set(magic); h[8] = SLOTS; h[9] = ENTRY;
  put(h, 12, crc(h.subarray(0, 12)));
 }
}

export function aesFirmwareAllowed(model, features) {
 const secure = [...model.channels, ...(model.vfo || [])].some((c) => c?.aesSlot);
 return !secure || String(features || "").split(",").includes("DV_AES");
}
