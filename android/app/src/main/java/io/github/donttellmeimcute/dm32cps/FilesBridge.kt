// SPDX-License-Identifier: MIT
// What the page downloads (backups, codeplugs, CSV, reports: dom.js download()) saved by the app, since a WebView can't
// follow a blob link: Downloads/DM32 on Android 10 and later, the app's own Downloads folder before.
package io.github.donttellmeimcute.dm32cps

import android.app.Activity
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File

class FilesBridge(private val activity: Activity) {
    // "" when saved, else what went wrong (the page throws it as an error)
    @JavascriptInterface
    fun save(name: String, mime: String, base64: String): String = try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val file = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "dm32.bin" }
        val where = if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, file)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DM32")
            }
            val resolver = activity.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no se pudo crear el archivo")
            (resolver.openOutputStream(uri) ?: error("no se pudo escribir")).use { it.write(bytes) }
            "Descargas/DM32/$file"
        } else {
            val dir = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "DM32").apply { mkdirs() }
            File(dir, file).writeBytes(bytes)
            "${dir.path}/$file"
        }
        activity.runOnUiThread { Toast.makeText(activity, activity.getString(R.string.saved, where), Toast.LENGTH_LONG).show() }
        ""
    } catch (e: Exception) {
        "No se pudo guardar $name: ${e.message}"
    }
}
