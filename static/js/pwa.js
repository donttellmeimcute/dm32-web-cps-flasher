// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// The site's offline layer on the page: registers the service worker (so everything but a radio transfer keeps
// working with no connection once the site has been visited), offers the browser's own Install action, and reloads
// once when a new version of the worker takes over.

import { t } from "./flasher/dom.js?v=c16ffd9bbf";

const root = document.body.dataset.root || "./";
if ("serviceWorker" in navigator && window.isSecureContext && !location.host.endsWith("androidplatform.net")) {
	navigator.serviceWorker.register(root + "sw.js").catch(() => {});
	let reloaded = false;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!reloaded) {
			reloaded = true;
			location.reload();
		}
	});
}

// the Install button: the browser offers the app (its own window, Start menu / home screen, works offline)
const buttons = [...document.querySelectorAll(".pwa-install")];
let install = null;
for (const b of buttons) b.textContent = t("pwa.install");
window.addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	install = e;
	for (const b of buttons) b.hidden = false;
});
for (const b of buttons) {
	b.addEventListener("click", () => {
		install?.prompt();
		install = null;
		for (const x of buttons) x.hidden = true;
	});
}
window.addEventListener("appinstalled", () => {
	for (const b of buttons) {
		b.hidden = true;
		b.textContent = t("pwa.installed");
	}
});
if (window.matchMedia("(display-mode: standalone)").matches) for (const b of buttons) b.hidden = true;
