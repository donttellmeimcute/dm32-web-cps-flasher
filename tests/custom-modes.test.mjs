// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	availableModules, customFirmwareRelease, localBuildCommand, moduleEnabled, moduleOmissions,
} from "../static/js/flasher/custommodes.js";

const binaryModes = "DMR,FM,P25,NXDN,YSF,M17,DSTAR,APRS,MDC1200,RSSI_GRAPH";
const oldRelease = { variant: "full", version: "old", features: binaryModes };
const full = { variant: "full", version: "current", features: binaryModes, off: "CW,MONITOR_SCAN" };
const monitor = { ...full, variant: "modes-monitor-scan", features: binaryModes + ",MONITOR_SCAN", off: "CW" };
const cw = { ...full, variant: "modes-cw", features: binaryModes + ",CW", off: "MONITOR_SCAN" };
const tools = { ...full, variant: "modes-monitor-scan-cw", features: binaryModes + ",MONITOR_SCAN,CW", off: "" };
const releases = [full, monitor, cw, tools];

test("default custom and old firmware keep the experimental modules off", () => {
	const omitted = moduleOmissions(oldRelease.off, oldRelease.features);
	assert.deepEqual(omitted, new Set(["monitor-scan", "cw"]));
	assert.equal(customFirmwareRelease([oldRelease], omitted), oldRelease);
	assert.equal(customFirmwareRelease(releases, omitted), full);
	assert.equal(localBuildCommand(omitted), "python3 tools/build_current.py");
	assert.equal(availableModules([oldRelease]).some(([id]) => id === "monitor-scan" || id === "cw"), false);
	assert.deepEqual(availableModules([full]).slice(-2).map(([id]) => id), ["monitor-scan", "cw"]);
});

test("each tool is independent, and upgrades match the exact compiled switches", () => {
	for (const expected of releases) {
		const omitted = moduleOmissions(expected.off, expected.features);
		assert.equal(customFirmwareRelease(releases, omitted), expected);
	}
	const omitted = moduleOmissions([], tools.features);
	assert.equal(customFirmwareRelease([full, monitor, cw], omitted), undefined);
	assert.equal(localBuildCommand(omitted), "python3 tools/build_current.py --with monitor-scan --with cw");
});

test("existing dependencies still take effect when opting into the RX tools", () => {
	const omitted = new Set(["p25", "nxdn", "ysf", "aprs", "cw"]);
	for (const mode of ["p25", "dstar", "m17", "mdc1200", "cw"]) assert.equal(moduleEnabled(mode, omitted), false);
	assert.equal(moduleEnabled("monitor-scan", omitted), true);
	assert.equal(localBuildCommand(omitted), "python3 tools/build_current.py --without p25 --without nxdn --without ysf --without aprs --with monitor-scan");
});
