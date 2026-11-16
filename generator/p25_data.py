#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 lyra XE1POC
# Gives the P25/NXDN switches real titles in features.json and put them in the DM-32UV variants (radios.json).
import json, sys
root = sys.argv[1]	# the site: python3 generator/p25_data.py .
def load(p): return json.load(open(f"{root}/{p}", encoding="utf-8"))
def save(p, d):
    with open(f"{root}/{p}", "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=1, ensure_ascii=False); f.write("\n")

INFO = {
 "P25": ("P25 Phase 1 digital voice", "Radio and voice", "P25 conventional channels (C4FM, 12.5 kHz): voice both ways, with each channel's NAC and talkgroup", ["DMR"]),
 "P25_NATIVE": ("P25 on the radio's own modem", "Radio and voice", "P25 frames are decoded and built in the firmware, no external modem: what P25 channels run on", ["P25"]),
 "NXDN": ("NXDN48 digital voice", "Radio and voice", "NXDN 6.25 kHz channels with a software modem: voice both ways, with each channel's RAN", ["DMR"]),
 "P25_TRUNK": ("P25 trunking (receive)", "Radio and voice", "follows a P25 Phase 1 trunked system's control channel and joins calls on the talkgroups you listen to", ["P25"]),
 "P25_TRUNK_TX": ("P25 trunking transmit", "Radio and voice", "experimental Phase 1 registration, affiliation and granted voice; each channel must explicitly enable Trunk TX; hardware interoperability untested", ["P25_TRUNK"]),
 "P25_PHASE2": ("P25 Phase 2 decoder", "Radio and voice", "the Phase 2 (TDMA) voice decoder for trunked systems; no physical layer yet, so it adds no bytes", ["P25_TRUNK"]),
 "DV_AES": ("AES-256 voice", "Radio and voice", "P25 Phase 1 conventional and DMR voice with local web CPS keys; hardware interoperability untested", []),
 "P25_BENCH": ("P25 bench tools", "Bench", "replay storage and debug-link commands for testing P25 audio on the bench", ["P25"]),
}
f = load("data/features.json")
for e in f["features"]:
    if e["name"] in INFO:
        e["title"], e["group"], e["help"], e["needs"]["all"] = INFO[e["name"]]
save("data/features.json", f)

rel = load("data/releases.json")["releases"][-1]["features"].split(",")
ON = ["P25", "P25_NATIVE", "NXDN", "P25_TRUNK", "P25_PHASE2"]	# what the published image has on (releases.json)
r = load("data/radios.json")
dm = next(x for x in r["radios"] if x["id"] == "dm32")
for v, names in dm["config"].items():
    optional = {"DV_AES", "P25_TRUNK_TX"}
    dm["config"][v] = sorted((set(names) - optional) | set(ON) | (optional & set(rel)))
dm["support"] = ("FM, DMR, P25 and NXDN voice both ways, CTCSS/DCS, APRS both ways, GPS data, the hotspot and each split "
                 "duplex half work on air. P25 trunking follows Phase 1 calls. "
                 + ("Trunk TX is experimental and requires per-channel opt-in; hardware interoperability is untested. "
                    if "P25_TRUNK_TX" in rel else "This image has receive-only trunking. ")
                 + "Open: FM deviation at 12.5 kHz and an outdoor GPS fix.")
save("data/radios.json", r)
rel = load("data/releases.json")["releases"][-1]["features"].split(",")
missing = [n for n in ON if n not in rel]
assert not missing, missing
print("ok")
