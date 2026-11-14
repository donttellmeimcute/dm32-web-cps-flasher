package io.github.donttellmeimcute.dm32cps

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Insets
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.FrameLayout

class WindowInsetsTest : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        try {
            checkContentInsets()
            finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "PASS: status bar, cutout and keyboard insets") })
        } catch (e: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", e.stackTraceToString()) })
        }
    }

    private fun checkContentInsets() {
        if (Build.VERSION.SDK_INT < 30) return
        val intent = Intent(targetContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = startActivitySync(intent)
        waitForIdleSync()
        try {
            runOnMainSync {
                val frame = activity.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as FrameLayout
                val web = frame.getChildAt(0) as WebView
                val bars = frame.rootWindowInsets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val position = IntArray(2)
                web.getLocationOnScreen(position)
                check(position[1] >= bars.top) { "WebView overlaps the status bar" }
                check(position[0] >= bars.left) { "WebView overlaps the cutout" }

                val types = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
                val fake = WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.statusBars(), Insets.of(0, 50, 0, 0))
                    .setInsets(WindowInsets.Type.navigationBars(), Insets.of(0, 0, 0, 30))
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.of(75, 0, 0, 0))
                    .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 400))
                    .setVisible(types, true).build()
                val forwarded = frame.dispatchApplyWindowInsets(fake)
                check(frame.paddingTop == 50)
                check(frame.paddingLeft == 75)
                check(frame.paddingBottom == 400)
                check(forwarded.getInsets(types) == Insets.NONE)
                frame.dispatchApplyWindowInsets(WindowInsets.Builder(fake).setInsets(WindowInsets.Type.ime(), Insets.NONE).build())
                check(frame.paddingBottom == 30) { "Keyboard dismissal must restore the navigation inset" }
                frame.requestApplyInsets()
            }
        } finally {
            runOnMainSync { activity.finish() }
        }
    }
}
