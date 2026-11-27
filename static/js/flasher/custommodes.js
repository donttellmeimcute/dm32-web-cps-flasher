// SPDX-License-Identifier: MIT

const modules = [
	["p25", "P25"], ["nxdn", "NXDN"], ["ysf", "YSF (System Fusion)"], ["m17", "M17"],
	["dstar", "D-STAR"], ["aprs", "APRS"], ["mdc1200", "MDC-1200"], ["rssi-graph", "RSSI"],
	["monitor-scan", "Monitor Scan", true], ["cw", "CW", true],
];

const feature = (id) => id.toUpperCase().replaceAll("-", "_");
const featureSet = (value) => new Set(Array.isArray(value) ? value : String(value ?? "").split(","));

// Old firmware doesn't know these options. Updates keep a tool on only when
// the connected build reports it on. New custom selections leave both off.
export function moduleOmissions(off, features) {
	const disabled = featureSet(off);
	const enabled = featureSet(features);
	return new Set(modules
		.filter(([id, , experimental]) => disabled.has(feature(id)) || (experimental && !enabled.has(feature(id))))
		.map(([id]) => id));
}

export function availableModules(releases) {
	const known = new Set(releases.flatMap((r) => [...featureSet(r.features), ...featureSet(r.off)]));
	return modules.filter(([id, , experimental]) => !experimental || known.has(feature(id)));
}

export function moduleMissingDependency(id, omitted) {
	return (id === "dstar" && omitted.has("p25")) ||
		(id === "m17" && ["p25", "nxdn", "ysf"].every((mode) => omitted.has(mode))) ||
		(id === "mdc1200" && omitted.has("aprs"));
}

export const moduleEnabled = (id, omitted) => !omitted.has(id) && !moduleMissingDependency(id, omitted);
export const isStandardPreset = (id) => ["full", "multimode", "dmr-fm"].includes(id);

export function customFirmwareRelease(releases, omitted) {
	return releases.find((release) => {
		const preset = release.variant || "full";
		if (!isStandardPreset(preset) && !preset.startsWith("modes-")) return false;
		const enabled = featureSet(release.features);
		return modules.every(([id]) => enabled.has(feature(id)) === moduleEnabled(id, omitted));
	});
}

export function localBuildCommand(omitted) {
	const command = ["python3 tools/build_current.py"];
	for (const [id, , experimental] of modules) {
		if (experimental && !omitted.has(id)) command.push(`--with ${id}`);
		if (!experimental && omitted.has(id)) command.push(`--without ${id}`);
	}
	return command.join(" ");
}
