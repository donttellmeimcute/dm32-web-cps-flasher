// SPDX-License-Identifier: MIT
// The public endpoint returns display names only. Keep rendering independent of radio operations.
const panel = document.querySelector("[data-kofi-supporters]");

async function showSupporters(panel) {
    const response = await fetch("https://dm32-kofi-supporters.arcanehero32768.chatgpt.site/supporters", {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return;
    const { supporters } = await response.json();
    if (!Array.isArray(supporters)) return;

    const names = new Set();
    for (const value of supporters) {
        if (typeof value !== "string") continue;
        const name = value.trim();
        if (name) names.add(name);
    }
    if (!names.size) return;

    const list = panel.querySelector("ul");
    for (const name of [...names].sort(new Intl.Collator(document.documentElement.lang).compare)) {
        const item = document.createElement("li");
        const label = document.createElement("bdi");
        label.textContent = name;
        item.append(label);
        list.append(item);
    }
    panel.hidden = false;
}

if (panel) {
    // Offline use and an unavailable feed leave the support links and flasher usable.
    showSupporters(panel).catch(() => {});
}
