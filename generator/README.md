# Generador del sitio

Scripts que construyen este sitio a partir del árbol derivado del firmware
([DM32-nxdn-p25](https://github.com/donttellmeimcute/DM32-nxdn-p25), `build/radiofoundry-p25/site`) con el
generador de RadioFoundry. Se ejecutan en Linux/WSL con el árbol ya compilado:

- `gen.sh`: empaqueta la imagen con `tools/release.py` (rechaza imágenes con códec), adapta el generador a la DM-32UV
  (`patch_tree.py`, `build_dm32.py`, `templates/`, `i18n/`) y escribe el sitio. Variables: `SRC`, `BUILD`, `OUT`, `W`.
- `test.sh`: tests JS del sitio (`site/tests`) sobre el árbol original, el adaptado y la salida recortada.
- `adapt_tests.py`: adapta en la copia de prueba los textos del aviso AMBE (DMR/NXDN) y los dos idiomas del sitio. Solo se omiten cuatro comprobaciones de la interfaz de compilación personalizada que este flasher no ofrece; el árbol original las ejecuta. `test.sh` devuelve error si falla cualquier prueba aplicable.
- `test_p25_data.py` y `test_updates.mjs`: verifican que las funciones anunciadas coincidan con la imagen y que una instalación posterior en la misma pestaña consulte y verifique la versión nueva.
- `audit.py SITIO CODEC_BIN`: comprueba que ningún archivo del sitio contiene bytes del códec AMBE.
- `p25_data.py SITIO`: da nombre y ayuda a las funciones P25/NXDN en `data/features.json` y las añade a las variantes
  de la DM-32UV en `data/radios.json` (el árbol de RadioFoundry no las trae). `gen.sh` lo ejecuta.

`gen.sh` copia el sitio nuevo **encima** del repositorio (ya no lo borra: `.git`, `android/` y `generator/` se quedan) y
conserva el CSS del repositorio (`static/css`, el aspecto propio). La pestaña de Throne y los textos de voz/códec del
flasher salen de `templates/base.html` e `i18n/`.

`gen.sh` copia `repo/` (README, LICENSE, NOTICE, `tools/set_firmware.py`) sobre la salida; en este repositorio esos
archivos están en la raíz. Para cambiar solo la imagen basta `tools/set_firmware.py`.
