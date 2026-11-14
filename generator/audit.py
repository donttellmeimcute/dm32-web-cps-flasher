#!/usr/bin/env python3
# Audit the site output: no codec bytes (windows of the local build's rfoundry_dm32.codec.bin, read-only), no stock
# firmware, and a list of every binary file with its size.
import hashlib, io, os, sys, zipfile
OUT, CODEC = sys.argv[1], sys.argv[2]
whole = open(CODEC, "rb").read()
# rfoundry_dm32.codec.bin is the application with the codec slot merged at the slot's offset (manifest codec window
# minus app base): only that part is the codec
import json, glob
m = json.load(open(glob.glob(os.path.join(OUT, "firmware", "dm32", "rfoundry-dm32-*.json"))[0]))
slot = int(m["codec"]["windows"][0]["addr"], 16) - int(m["ranges"][0]["addr"], 16)
app = open(glob.glob(os.path.join(OUT, "firmware", "dm32", "rfoundry-dm32-*.bin"))[0], "rb").read()
print("merged file starts with the hosted image:", whole[:len(app)] == app, "; slot at 0x%X, hosted image ends at 0x%X" % (slot, len(app)))
codec = whole[slot:]
# 48-byte windows every 256 bytes of the codec part that isn't padding
probes = [codec[o:o + 48] for o in range(0, len(codec) - 48, 256) if len(set(codec[o:o + 48])) > 8]
print("codec slot %d bytes, %d probes" % (len(codec), len(probes)))
def blobs():
    for d, _, fs in os.walk(OUT):
        for f in fs:
            p = os.path.join(d, f)
            data = open(p, "rb").read()
            yield os.path.relpath(p, OUT), data
            if f.endswith(".zip"):
                z = zipfile.ZipFile(io.BytesIO(data))
                for n in z.namelist():
                    yield os.path.relpath(p, OUT) + "!" + n, z.read(n)
hits, binaries = [], []
for name, data in blobs():
    if any(p in data for p in probes):
        hits.append(name)
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        binaries.append((name, len(data)))
    if data[:4] == b"\x02\x0a\x00\x03" or b"BFUV32" in data[:64]:
        hits.append(name + " (stock header?)")
print("files with codec bytes:", hits or "none")
print("binary files:")
for n, s in sorted(binaries):
    print("  %9d  %s" % (s, n))
