// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// The desktop codeplug editor: the site's offline one-file editor (tools/offline_zip.py builds it) in an Electron
// window, with Web Serial enabled so a radio on the programming cable can be read and written with no browser.
const { app, BrowserWindow, Menu, session } = require("electron");
const path = require("path");

const page = () => path.join(__dirname, app.getLocale().startsWith("es") ? "codeplug-editor-es.html" : "codeplug-editor-en.html");

app.whenReady().then(() => {
	// Web Serial: grant the editor's port requests. ponytail: single-radio setups — the first port wins; a picker
	// window is the upgrade if someone programs several radios at once
	session.defaultSession.setDevicePermissionHandler(() => true);
	app.on("select-serial-port", (event, portList, webContents, callback) => callback(portList[0]?.portId));
	Menu.setApplicationMenu(null);
	const win = new BrowserWindow({
		width: 1280, height: 840, show: false,
		icon: path.join(__dirname, "icon.png"),
		title: "DM32 Codeplug Editor",
	});
	win.once("ready-to-show", () => win.show());
	win.loadFile(page()).then(() =>
		// this build has Web Serial: take the offline copy's "use the app or the site for USB" note out
		win.webContents.executeJavaScript('document.querySelector(".ed-offline-note")?.remove()').catch(() => {}));
	app.on("activate", () => BrowserWindow.getAllWindows().length || app.whenReady().then(() => win.loadFile(page())));
});
app.on("window-all-closed", () => app.quit());
