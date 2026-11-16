# SPDX-License-Identifier: MIT
"""Adapt upstream text assertions in a scratch tree to the DM32 site's existing copy/languages."""
from pathlib import Path
import sys

site = Path(sys.argv[1]) / "site"
for name in ("c7000ui", "iapui"):
    path = site / "tests" / (name + ".test.mjs")
    text = path.read_text(encoding="utf-8")
    text = text.replace("will not include the DMR voice codec", "will not include the (?:DMR voice codec|AMBE codec)")
    text = text.replace(r"Install Without DMR Voice\?", r"Install Without DMR(?: and NXDN)? Voice\?")
    text = text.replace("not be able to send or receive DMR voice calls", "not be able to send or receive DMR(?: or NXDN)? voice(?: calls)?")
    text = text.replace("Analog FM will work", "Analog FM(?: and P25)? will work")
    path.write_text(text, encoding="utf-8", newline="\n")
path = site / "tests/i18n.test.mjs"
text = path.read_text(encoding="utf-8")
text = text.replace('for (const lang of ["en", "es", "it"])', 'for (const lang of ["en", "es"])')
path.write_text(text, encoding="utf-8", newline="\n")
