#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry Authors
# Builds the offline codeplug editor: one HTML file per language with every script and style of the editor page
# inlined, packed into downloads/dm32-codeplug-editor-offline.zip. Opened straight from disk (no server, no
# connection), it edits codeplug files, CSV tables and qdmr YAML, and saves .bin/.csv/.zip — everything except a
# radio transfer, which needs the installed app or the site. Run from the repository root:
#
#     python tools/offline_zip.py
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
V = re.search(r"site\.css\?v=([0-9a-f]+)", (ROOT / "codeplug/index.html").read_text(encoding="utf-8")).group(1)

IMPORT_BRACES = re.compile(r'import\s*\{([^}]*)\}\s*from\s*"([^"]+)";')
IMPORT_STAR = re.compile(r'import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*"([^"]+)";')
IMPORT_BARE = re.compile(r'import\s*"([^"]+)";')
EXPORT_DECL = re.compile(r'^export\s+(async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_DESTRUCT = re.compile(r'^export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=', re.M)
EXPORT_LIST = re.compile(r'^export\s*\{([^}]*)\};?\s*$', re.M)
STYLES = re.compile(r'<link rel="stylesheet" href="[^"]*css/([^"?]+)\?v=[^"]*">')
SCRIPTS = re.compile(r'<script type="module" src="[^"]*js/((?:editor/)?(?:app|site)\.js)\?v=[^"]*"></script>')
PWA_SCRIPT = re.compile(r'<script type="module" src="[^"]*js/pwa\.js\?v=[^"]*"></script>\s*')
PWA_ROW = re.compile(r'<p class="page-actions">.*?</p>\s*', re.S)
OTHER_LINKS = re.compile(r'<link rel="(?:icon|apple-touch-icon|manifest|alternate)"[^>]*>\s*')


def module(path):
    """(body, imports [(kind, names, target)], export map {exported: local}) of one ES module."""
    src = path.read_text(encoding="utf-8")
    imports = []
    for names, spec in IMPORT_BRACES.findall(src):
        pairs = []
        for n in names.split(","):
            if not n.strip():
                continue
            p = [x.strip() for x in n.split(" as ")]
            pairs.append((p[0], p[-1]))  # (name in the module, local name)
        imports.append(("braces", pairs, spec))
    src = IMPORT_BRACES.sub("", src)
    for name, spec in IMPORT_STAR.findall(src):
        imports.append(("star", name, spec))
    src = IMPORT_STAR.sub("", src)
    for spec in IMPORT_BARE.findall(src):
        imports.append(("bare", None, spec))
    src = IMPORT_BARE.sub("", src)
    exports = {}
    for _, name in EXPORT_DECL.findall(src):
        exports[name] = name
    for names in EXPORT_DESTRUCT.findall(src):
        for part in names.split(","):
            name = part.strip().split(" as ")[-1].strip()
            if name:
                exports[name] = name
    src = EXPORT_DECL.sub(lambda m: m.group(0).removeprefix("export ").lstrip(), src)
    src = EXPORT_DESTRUCT.sub(lambda m: m.group(0).removeprefix("export ").lstrip(), src)
    for names in EXPORT_LIST.findall(src):
        for part in names.split(","):
            if not part.strip():
                continue
            local, _, exported = [x.strip() for x in part.partition(" as ")]
            exports[exported or local] = local
    src = EXPORT_LIST.sub("", src)
    return src, imports, exports


def graph(entries):
    """The modules behind the entry scripts, in dependency order, as (repo-relative key, body, imports, exports)."""
    order, seen, stack = [], {}, []
    def walk(path):
        key = path.resolve().relative_to(ROOT).as_posix()
        if seen.get(key) == 2:
            return
        if seen.get(key) == 1:
            sys.exit(f"offline bundle: import cycle through {key}")
        seen[key] = 1
        stack.append(key)
        body, imports, exports = module(path)
        for kind, names, spec in imports:
            target = (path.parent / spec.split("?")[0]).resolve()
            if not target.is_file():
                sys.exit(f"offline bundle: {key} imports {spec}, which is not a file")
            walk(target)
        seen[key] = 2
        order.append((key, body, imports, exports))
    for e in entries:
        walk(ROOT / "static/js" / e)
    return order


def bundle():
    parts = [
        "// The codeplug editor, bundled from the site's modules by tools/offline_zip.py.\n"
        '"use strict";\n'
        "const $m = window.__modules = {};\n"
    ]
    radios = (ROOT / "data/radios.json").read_text(encoding="utf-8")
    parts.append(
        "// no site around this file: the two data files the editor asks the site for come along inside it\n"
        "(() => {\n"
        f"\tconst raw = {json.dumps(radios)};\n"
        "\tconst real = window.fetch ? window.fetch.bind(window) : null;\n"
        "\twindow.fetch = (url, opts) => {\n"
        "\t\tconst u = String(url);\n"
        '\t\tif (u.includes("data/radios.json")) return Promise.resolve(new Response(raw, { headers: { "Content-Type": "application/json" } }));\n'
        '\t\tif (u.includes("data/releases.json")) return Promise.resolve(new Response(\'{"releases": []}\', { headers: { "Content-Type": "application/json" } }));\n'
        "\t\treturn real ? real(url, opts) : Promise.reject(new Error(\"offline\"));\n"
        "\t};\n"
        "})();\n"
    )
    keys = {}
    for key, body, imports, exports in graph(["site.js", "editor/app.js"]):
        keys[key] = exports
    for key, body, imports, exports in graph(["site.js", "editor/app.js"]):
        deps = []
        for kind, names, spec in imports:
            target = ((ROOT / key).parent / spec.split("?")[0]).resolve().relative_to(ROOT).as_posix()
            if kind == "star":
                deps.append(f"\tconst {names} = $m[{json.dumps(target)}];")
            elif kind == "bare":
                deps.append(f"\t$m[{json.dumps(target)}];")
            else:
                pairs = ", ".join(f"{exported}: {local}" for exported, local in names)  # {name in module as local}
                deps.append(f"\tconst {{ {pairs} }} = $m[{json.dumps(target)}];")
        exp = ", ".join(f"{exported}: {local}" for exported, local in sorted(exports.items()))
        parts.append(
            f"{{ // {key}\n"
            f"\tconst E = $m[{json.dumps(key)}] = {{}};\n"
            + "\t(function () {\n"
            + "\n".join(deps) + ("\n" if deps else "")
            + body.rstrip() + "\n"
            + (f"\t\tObject.assign(E, {{ {exp} }});\n" if exp else "")
            + "\t})();\n"
            "}\n"
        )
    return "\n".join(parts)


def page(lang):
    html = (ROOT / ("codeplug" if lang == "es" else f"{lang}/codeplug") / "index.html").read_text(encoding="utf-8")
    css = "\n".join((ROOT / "static/css" / f).read_text(encoding="utf-8") for f in ("tokens.css", "site.css"))
    html = STYLES.sub(lambda m: f"<style>\n{css}\n</style>" if m.group(1) == "tokens.css" else "", html, count=1)
    html = STYLES.sub("", html)
    js = bundle().replace("</script", "<\\/script")  # inside a JS string this is the same text
    # the bundle takes the editor script's place: after the page's inline i18n JSON, as the module it replaces ran
    html = SCRIPTS.sub("", html, count=1)
    html = SCRIPTS.sub(lambda m: f"<script>\n{js}\n</script>", html, count=1)
    html = OTHER_LINKS.sub("", html)
    html = PWA_SCRIPT.sub("", html)
    html = PWA_ROW.sub("", html)
    icon = (ROOT / "static/img/icon.svg").read_text(encoding="utf-8")
    icon = "data:image/svg+xml," + quote(icon.strip(), safe="")
    html = re.sub(r'src="[^"]*img/icon\.svg\?v=[^"]*"', f'src="{icon}"', html)
    note = {
        "es": "<p class=\"notice ed-offline-note\">Copia sin conexión del editor de codeplug: abre, edita y guarda archivos de codeplug, tablas CSV y YAML de qdmr. Para leer o escribir la radio por USB usa la aplicación instalada o el sitio.</p>",
        "en": "<p class=\"notice ed-offline-note\">Offline copy of the codeplug editor: open, edit and save codeplug files, CSV tables and qdmr YAML. To read or write the radio over USB use the installed app or the site.</p>",
    }[lang]
    html = html.replace('<div id="editor"', f"{note}\n\t<div id=\"editor\"", 1)
    return html


README = """DM32 Codeplug Editor — copia sin conexión / offline copy

ES  Abre codeplug-editor-es.html con cualquier navegador moderno (doble clic, sin servidor ni conexión).
    Edita canales, zonas, contactos, listas y ajustes, importa/exporta CSV y YAML de qdmr, y guarda el
    codeplug como .bin para escribirlo luego en la radio. La transferencia por USB necesita la app
    instalada o el sitio (https://donttellmeimcute.github.io/dm32-web-cps-flasher/).

EN  Open codeplug-editor-en.html in any modern browser (double click, no server, no connection).
    Edit channels, zones, contacts, lists and settings, import/export CSV and qdmr YAML, and save the
    codeplug as .bin to write to the radio later. USB transfer needs the installed app or the site
    (https://donttellmeimcute.github.io/dm32-web-cps-flasher/).
"""


if __name__ == "__main__":
    out = ROOT / "downloads/dm32-codeplug-editor-offline.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("LEEME-README.txt", README)
        for lang in ("es", "en"):
            html = page(lang)
            z.writestr(f"codeplug-editor-{lang}.html", html)
            print(f"codeplug-editor-{lang}.html: {len(html)} bytes")
    print(f"{out.relative_to(ROOT)}: {out.stat().st_size} bytes")
