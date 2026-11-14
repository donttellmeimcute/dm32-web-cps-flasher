// SPDX-License-Identifier: MIT
// The phone's USB host as the page's serial ports (static/js/flasher/nativeserial.js): the programming cable's
// USB-serial chip driven by usb-serial-for-android (CH340/CH341, FTDI, CP210x, PL2303, CDC-ACM). The page calls these
// methods as window.AndroidSerial (strings and numbers only); the app answers and sends what the cable receives
// through window.__androidSerial. Opening, writing and closing run in order on one thread; reads come from each
// port's SerialInputOutputManager.
package io.github.donttellmeimcute.dm32cps

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

private const val NOT_CHOSEN = "NotFoundError|No port selected by the user."

class SerialBridge(private val activity: Activity, private val web: WebView) {
    private val usb = activity.getSystemService(Context.USB_SERVICE) as UsbManager
    private val io = Executors.newSingleThreadExecutor()
    private val ports = ConcurrentHashMap<Int, Open>()		// device id -> the open port
    private val asking = ConcurrentHashMap<Int, Int>()		// device id -> the call waiting for Android's USB permission
    private val permission = activity.packageName + ".USB_PERMISSION"

    private class Open(val port: UsbSerialPort, val reader: SerialInputOutputManager, val baud: Int) {
        @Volatile var closing = false
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val device = intent.usbDevice() ?: return
            when (intent.action) {
                permission -> {
                    val call = asking.remove(device.deviceId) ?: return
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) answer(call, "", info(device).toString())
                    else answer(call, NOT_CHOSEN, null)
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> if (shut(device.deviceId)) event("error", device.deviceId, "The cable was disconnected.")
            }
        }
    }

    init {
        val filter = IntentFilter(permission).apply { addAction(UsbManager.ACTION_USB_DEVICE_DETACHED) }
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else @Suppress("UnspecifiedRegisterReceiverFlag") activity.registerReceiver(receiver, filter)
    }

    private fun js(code: String) {
        web.post { web.evaluateJavascript(code, null) }
    }
    private fun answer(call: Int, error: String, value: String?) =
        js("__androidSerial.answer($call,${JSONObject.quote(error)},${JSONObject.quote(value ?: "")})")
    private fun event(kind: String, device: Int, payload: String) =
        js("__androidSerial.$kind($device,${JSONObject.quote(payload)})")

    private fun drivers() = UsbSerialProber.getDefaultProber().findAllDrivers(usb)
    private fun info(d: UsbDevice) = JSONObject().put("id", d.deviceId).put("vid", d.vendorId).put("pid", d.productId)
        .put("name", d.productName ?: d.deviceName)

    // The cables the page may use without asking again (navigator.serial.getPorts)
    @JavascriptInterface
    fun ports(): String = JSONArray(drivers().map { it.device }.filter { usb.hasPermission(it) }.map { info(it) }).toString()

    // navigator.serial.requestPort: the cables with one of these vendor ids (all of them for an empty list), picked from
    // a list when there are several, then Android's permission dialog
    @JavascriptInterface
    fun request(call: Int, vidsJson: String) {
        val vids = JSONArray(vidsJson).let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() }
        val devices = drivers().map { it.device }.filter { vids.isEmpty() || it.vendorId in vids }
        activity.runOnUiThread {
            when (devices.size) {
                0 -> answer(call, NOT_CHOSEN, null)
                1 -> permit(call, devices[0])
                else -> AlertDialog.Builder(activity).setTitle(R.string.choose_cable)
                    .setItems(devices.map { "${it.productName ?: "USB"} (%04X:%04X)".format(it.vendorId, it.productId) }.toTypedArray()) { _, i ->
                        permit(call, devices[i])
                    }
                    .setOnCancelListener { answer(call, NOT_CHOSEN, null) }
                    .show()
            }
        }
    }

    private fun permit(call: Int, d: UsbDevice) {
        if (usb.hasPermission(d)) return answer(call, "", info(d).toString())
        asking[d.deviceId] = call
        // mutable: Android adds the answer to it; explicit (this package) as Android 14 requires of a mutable one
        val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        usb.requestPermission(d, PendingIntent.getBroadcast(activity, d.deviceId, Intent(permission).setPackage(activity.packageName), flags))
    }

    @JavascriptInterface
    fun open(call: Int, device: Int, baud: Int) = io.execute {
        try {
            check(!ports.containsKey(device)) { "The port is already open." }
            val driver = drivers().firstOrNull { it.device.deviceId == device } ?: error("The cable is gone.")
            val conn = usb.openDevice(driver.device) ?: error("No USB permission, or another app holds the cable.")
            val port = driver.ports[0]
            try {
                port.open(conn)
                port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
                runCatching { port.setDTR(true); port.setRTS(true) }	// as Web Serial leaves them on open
            } catch (e: Exception) {
                runCatching { port.close() }
                throw e
            }
            lateinit var entry: Open
            val reader = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
                override fun onNewData(data: ByteArray) = event("data", device, Base64.encodeToString(data, Base64.NO_WRAP))
                override fun onRunError(e: Exception) {
                    if (!entry.closing && shut(device)) event("error", device, e.message ?: "USB read error")
                }
            })
            entry = Open(port, reader, baud)
            ports[device] = entry
            reader.start()
            answer(call, "", null)
        } catch (e: Exception) {
            answer(call, "NetworkError|${e.message}", null)
        }
    }

    // Twice the time the bytes take on the line, plus 2 s: a slow boot ROM rate still gets its whole write
    @JavascriptInterface
    fun write(call: Int, device: Int, base64: String) = io.execute {
        try {
            val o = ports[device] ?: error("The port is closed.")
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            o.port.write(bytes, (2000 + bytes.size * 20_000L / o.baud).toInt())
            answer(call, "", null)
        } catch (e: Exception) {
            answer(call, "NetworkError|${e.message}", null)
        }
    }

    @JavascriptInterface
    fun close(call: Int, device: Int) = io.execute {
        shut(device)
        answer(call, "", null)
    }

    // Closes a port once (true the first time): reading stops, DTR and RTS drop as when an OS driver closes it
    private fun shut(device: Int): Boolean {
        val o = ports.remove(device) ?: return false
        o.closing = true
        runCatching { o.reader.stop() }
        runCatching { o.port.setDTR(false); o.port.setRTS(false) }
        runCatching { o.port.close() }
        return true
    }

    fun closeAll() {
        ports.keys.toList().forEach { shut(it) }
        runCatching { activity.unregisterReceiver(receiver) }
        io.shutdown()
    }
}

private fun Intent.usbDevice(): UsbDevice? =
    if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
    else @Suppress("DEPRECATION") getParcelableExtra(UsbManager.EXTRA_DEVICE)
