# DM32 CPS & Flasher para Android

La app incluye el sitio de este repositorio y usa el cable de programación mediante USB OTG. Requiere Android 8.0
o posterior. Los archivos se guardan en Descargas/DM32; en Android 8 y 9, en la carpeta de descargas de la app.

La versión 0.1.1 mantiene el contenido debajo de la barra de estado, respeta el recorte de la cámara y ajusta el
espacio cuando aparece o desaparece el teclado. Las operaciones de radio conservan su funcionamiento anterior.

## Compilar

Con JDK 17 o posterior y Android SDK 36 configurados, desde esta carpeta:

```sh
./gradlew assembleDebug
```

En Windows, usa `gradlew.bat`. La APK se genera en `app/build/outputs/apk/debug/app-debug.apk` y está firmada para
pruebas. La compilación copia el sitio de la carpeta superior dentro de la APK.

## Comprobar los márgenes en un dispositivo

```sh
./gradlew assembleDebug assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w io.github.donttellmeimcute.dm32cps.test/io.github.donttellmeimcute.dm32cps.WindowInsetsTest
adb uninstall io.github.donttellmeimcute.dm32cps.test
```

La comprobación abre la app y valida el espacio de la barra de estado, el recorte de cámara y el teclado en Android
11 o posterior. No escribe en la radio.
