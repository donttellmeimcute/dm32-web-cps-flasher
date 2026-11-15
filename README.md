# DM32 Web CPS & Flasher — Open25-DM32 (P25 / NXDN)

[![Regálame un radio en Throne](https://img.shields.io/badge/Throne-Reg%C3%A1lame%20un%20radio-ff69b4?style=for-the-badge)](https://throne.com/lyraarsgoetia)

**¿Quieres firmware para tu radio?** Regálamelo desde mi lista de deseos y lo porto: **<https://throne.com/lyraarsgoetia>** · *Want firmware for your radio? Gift it from my wishlist and I'll port it.*

Flasher web y editor de codeplug (CPS) para la **Baofeng DM-32UV** con el firmware **Open25-DM32**, el derivado con
P25 y NXDN de RadioFoundry. Todo corre en el navegador: la radio, las copias de seguridad y tus archivos nunca salen de
tu computadora.

Sitio: <https://donttellmeimcute.github.io/dm32-web-cps-flasher/> (español; inglés en `/en/`).

- **Flasher** (`flash/`): copia de seguridad, instalación, actualización y restauración del firmware por el cable de
  programación.
- **Editor de codeplug** (`codeplug/`): canales FM, DMR, P25, NXDN y P25 troncal, zonas, contactos y base de datos de ID;
  lee y escribe la radio o guarda archivos (.bin, CSV, YAML de qdmr).

Ambos tienen un modo de práctica sin radio: `flash/#sim=dm32-stock` (DM-32UV con firmware original), `flash/#sim=dm32`
(con RadioFoundry) y `codeplug/#sim`.

> **Firmware experimental.** La voz P25 y NXDN funciona en ambos sentidos en la radio, pero APRS y algunas funciones
> aún no se han probado en el aire. Guarda siempre la copia de seguridad que ofrece el flasher. Úsala bajo tu propia
> responsabilidad, en frecuencias en las que tengas licencia.

## Requisitos

- **Chrome o Edge en una computadora de escritorio** (Windows, macOS o Linux). El flasher y el editor usan
  **Web Serial**, que Firefox y Safari no tienen.
- El cable de programación de la DM-32UV.
- El sitio debe servirse por `https://` o desde `localhost` (Web Serial no funciona en `file://`).

## Modo de actualización de la DM-32UV

1. Apaga la radio y conecta el cable de programación.
2. Mantén pulsados **PTT** y **SK1** mientras la enciendes.
3. El **LED verde** indica que está en modo de actualización; suelta las teclas.

El flasher indica en cada paso qué hacer; normalmente basta con apagar y encender la radio cuando lo pide (la página
carga su cargador por el boot ROM). El modo de actualización es la vía de respaldo del cargador de fábrica.

## Política del códec AMBE

Este repositorio **no contiene** el códec AMBE (propiedad de DVSI), ni `rfoundry_dm32.codec.bin`, ni ningún firmware
original de Baofeng (`DM32.01.01.0xx.bin`, `BFUV32…`). La imagen de `firmware/dm32/` es la compilación **sin códec**
(`tools/release.py` la rechaza si lleva el slot del códec). El códec llega a la radio como en RadioFoundry: el flasher lo
lee de la memoria de programa de tu radio durante la copia de seguridad, o lo extrae del archivo de firmware original que
tú elijas, y lo combina con la imagen **dentro del navegador**. Nunca se sube a ningún servidor.

**Obtener el archivo original:** el paso Códec ofrece «Descargar firmware original», que abre el
[ZIP oficial de Baofeng DM-32UV v1.01.048](https://baofeng.s3.amazonaws.com/Baofeng_DM-32UV_Firmware_v1.01.048.zip),
publicado en la [página de descargas del fabricante](https://www.baofengradio.com/pages/download).
Selecciona ese ZIP en el flasher; no hace falta instalar previamente el firmware de fábrica. El archivo interno
`DM32_L01_048_20250821.bin` ya está reconocido por su SHA-256. No alojamos el ZIP ni un códec independiente.
La [licencia pública de DVSI, sección 2.3](https://www.dvsinc.com/papers/DVSI%20End%20User%20Product%20Liceanse%20Agreement.pdf),
requiere permiso escrito para redistribuir su software. La descarga del fabricante no concede ese permiso;
siguen aplicándose las condiciones de licencia correspondientes.

Los nombres de archivos de Baofeng que aparecen en `data/flash-boards.json` y en los scripts son solo para reconocer
(por nombre y SHA-256) el archivo que elige el usuario; no hay bytes de esos archivos aquí.

## Cómo se instala la imagen

La versión `2026.11.15-dv-monitor` añade el **monitor digital en P25 y NXDN** como en DMR (SK1 corto: todos los
NAC/RAN y grupos del canal, `DMon` en pantalla; otra pulsación, Atrás o cambiar de canal lo quita), «cualquier RAN»
por canal en NXDN (OK sin escribir en la fila RAN), F7E/F7F como RX «cualquiera» en P25, y la escucha de
**repetidores DMR con RAS** con el monitor digital (la llamada sale como grupo desconocido, TG/ID 0). El editor
acepta `any` en RX RAN, y la conversión del codeplug original conserva los canales de banda aérea como solo RX.
Incluye lo de `2026.11.14-p25-nac` (NAC P25 escrito en la radio) y la corrección del siseo P25. Pasa las pruebas
automatizadas y compila sin avisos; queda pendiente probarla en una radio física.

`data/releases.json` lista la imagen; el flasher descarga `firmware/dm32/<imagen>.bin` y su manifiesto
`rfoundry-release/1` (`.json`) de este mismo sitio y comprueba tamaño, SHA-256, rangos y que no toque el códec antes de
escribir nada. No hay servicio de compilación: no se eligen funciones. En "Usar mi propia compilación del firmware" se
puede instalar otro `rfoundry_dm32.bin` (sin códec) con o sin su manifiesto.

Este sitio no envía telemetría: el registro de instalaciones y el envío de informes y archivos al backend de
RadioFoundry están desactivados. "Informar de un problema" solo descarga el informe para adjuntarlo a un issue.

## Cambiar la imagen cuando haya una compilación nueva

**Automático:** cada commit a `main` de DM32-nxdn-p25 publica una release con la imagen. La acción `Sync firmware`
(`.github/workflows/sync-firmware.yml`) revisa cada 15 minutos la última release; si es nueva, comprueba sus SHA-256,
la instala con `tools/set_firmware.py` y hace commit, y GitHub Pages la sirve. Se puede lanzar a mano en Actions › Sync
firmware. Para que sea inmediato, guarda en DM32-nxdn-p25 un secreto `FLASHER_TOKEN` (token con permiso de Actions
sobre este repositorio).

A mano:

1. En el árbol del firmware, empaqueta la imagen sin códec con la herramienta de RadioFoundry (mismas variables
   `CONFIG_*` que la compilación, para que la lista de funciones sea la real):

   ```sh
   MAKEFLAGS="CONFIG_P25=y CONFIG_NXDN=y ..." python3 tools/release.py --board dm32 \
       --version <versión> --bin build/<dir>/rfoundry_dm32.bin --git <commit> --out dist
   ```

2. En este repositorio:

   ```sh
   python tools/set_firmware.py ruta/a/dist/rfoundry-dm32-<versión>.json
   ```

   Copia la imagen y su manifiesto a `firmware/dm32/` (borra los anteriores), reescribe `data/releases.json` y
   `firmware/dm32/SHA256SUMS`, y se niega si el manifiesto no es de la DM-32, si dice incluir el códec o si la imagen no
   coincide.
3. Publica también el código fuente correspondiente en <https://github.com/donttellmeimcute/DM32-nxdn-p25> (GPL).

## Probar en local

Desde la carpeta **que contiene** este repositorio (para reproducir la subruta de GitHub Pages):

```sh
python -m http.server 8000
```

y abre <http://localhost:8000/dm32-web-cps-flasher/>.

## Publicación (GitHub Pages)

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **main**, carpeta **/ (root)**.
El archivo `.nojekyll` hace que Pages sirva los archivos tal cual. Todas las rutas son relativas.

## Apoya el proyecto

¿Quieres soporte para otro radio? Si me regalas uno desde mi lista de deseos, puedo hacer firmware para él:
**<https://throne.com/lyraarsgoetia>**

## Créditos y licencias

- **RadioFoundry** — flasher web, editor de codeplug y generador del sitio originales. MIT, © 2026 The RadioFoundry
  Authors. <https://github.com/radiofoundry/radiofoundry>
- **Open25-DM32** por tylerwatt12 — base del firmware (GPL-3.0). <https://github.com/tylerwatt12/Open25-DM32>
- **Derivado P25/NXDN** por lyra XE1POC — firmware y esta adaptación del sitio.
  <https://github.com/donttellmeimcute/DM32-nxdn-p25>

El código del sitio es MIT (`LICENSE`); cada archivo conserva su cabecera SPDX. La imagen del firmware es
GPL-3.0-or-later (obra combinada; partes MIT, ISC, BSD-2-Clause, OFL-1.1): textos en `firmware/LICENSES/`. Ver `NOTICE`.

---

## English

Web flasher and codeplug editor (CPS) for the **Baofeng DM-32UV** running **Open25-DM32**, the P25/NXDN derivative of
RadioFoundry. Static site, everything runs in the browser; Spanish at the root, English under `/en/`.

- **Browser:** Chrome or Edge on a desktop computer (Web Serial), over `https://` or `localhost`.
- **Update mode:** radio off, hold PTT + SK1 while switching it on, green LED. The flasher usually only asks you to
  switch the radio off and on.
- **AMBE policy:** no AMBE codec, no `rfoundry_dm32.codec.bin` and no Baofeng stock firmware in this repository. The
  hosted image has no codec; the flasher takes the codec from the radio's own flash or from a stock file the user picks
  and merges it in the browser only.
- **Experimental firmware:** P25 and NXDN voice work both ways on the radio; APRS and some features are untested on air.
- **New firmware:** package it with `tools/release.py` in the firmware tree, then `python tools/set_firmware.py
  <manifest.json>` here (updates `firmware/dm32/` and `data/releases.json`).
- **No telemetry:** the flash log and uploads to the RadioFoundry backend are disabled.
- **Credits:** RadioFoundry Authors (MIT, original flasher/editor), Open25-DM32 by tylerwatt12 (GPL-3.0 firmware base),
  P25/NXDN derivative by lyra XE1POC. Site code MIT (`LICENSE`), firmware GPL-3.0-or-later (`firmware/LICENSES/`).
- **Support:** want firmware for another radio? Gift one from my wishlist: <https://throne.com/lyraarsgoetia>
