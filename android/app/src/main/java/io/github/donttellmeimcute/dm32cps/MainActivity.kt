// SPDX-License-Identifier: MIT
// DM32 Web CPS & Flasher for Android: the web flasher and codeplug editor of this repository (the site, bundled in the
// APK's assets) in a WebView, with the phone's USB host standing in for Web Serial (SerialBridge) and the app saving
// what the page downloads (FilesBridge).
package io.github.donttellmeimcute.dm32cps

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.AssetManager
import android.graphics.Insets
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewAssetLoader
import java.io.IOException

private const val HOST = "appassets.androidplatform.net"
private const val PICK_FILE = 1

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var serial: SerialBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // a flash, a backup or a codeplug write must not be cut short by the screen going off
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // debug builds: the page can be inspected from a computer (chrome://inspect over adb)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        // edge to edge (targetSdk 35+): the frame keeps the page clear of the status and navigation bars and the keyboard
        // (a WebView ignores its own padding)
        val frame = FrameLayout(this).apply { addView(web) }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
            )
            frame.setOnApplyWindowInsetsListener { v, insets ->
                val types = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
                val b = insets.getInsets(types)
                v.setPadding(b.left, b.top, b.right, b.bottom)
                // The frame already reserves this space; WebView must not apply it a second time.
                WindowInsets.Builder(insets).setInsets(types, Insets.NONE).build()
            }
        }
        setContentView(frame)
        frame.requestApplyInsets()

        val loader = WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/", SiteHandler(assets)).build()
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true	// the editor keeps its work in localStorage
            allowFileAccess = false
        }
        serial = SerialBridge(this, web)
        web.addJavascriptInterface(serial, "AndroidSerial")
        web.addJavascriptInterface(FilesBridge(this), "AndroidFiles")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // the site's own pages stay here; any other link (GitHub, radioid.net...) opens in the browser
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                // the page's accept lists are file extensions (.bin, .zip, .csv): any file, the page checks it
                val pick = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent.createChooser(pick, null), PICK_FILE)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
        web.loadUrl("https://$HOST/index.html")
    }

    private fun back() {
        if (web.canGoBack()) web.goBack() else finish()
    }

    @Deprecated("API < 33")
    override fun onBackPressed() = back()

    @Deprecated("startActivityForResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        serial.closeAll()
        web.destroy()
        super.onDestroy()
    }
}

// The site from the APK's assets (assets/site/...): a folder path gets its index.html, as on GitHub Pages
private class SiteHandler(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse {
        val clean = path.trimStart('/')
        val tries = if (clean.isEmpty() || clean.endsWith("/")) listOf(clean + "index.html")
        else listOf(clean, "$clean/index.html")
        for (p in tries) {
            try {
                val stream = assets.open("site/$p")
                val type = mime(p)
                return WebResourceResponse(type, if (type.startsWith("text/") || type.endsWith("json") || type.endsWith("javascript")) "utf-8" else null, stream)
            } catch (_: IOException) {
            }
        }
        return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
    }

    private fun mime(p: String) = when (p.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "ico" -> "image/x-icon"
        "txt", "md" -> "text/plain"
        "zip" -> "application/zip"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }
}
