package com.superpartybyai.waagentapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class PhoneGatewayService : Service() {
    companion object {
        private const val CHANNEL_ID = "superparty_phone_gateway"
        private const val NOTIFICATION_ID = 29021
        private const val HEARTBEAT_SECONDS = 120L

        fun start(context: Context) {
            val intent = Intent(context, PhoneGatewayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("SuperParty Phone Gateway")
                .setContentText("Gateway activ · monitorizare WhatsApp")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build()
        )
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SuperParty:PhoneGateway").apply {
            setReferenceCounted(false)
            acquire()
        }
        executor.scheduleWithFixedDelay({ sendHeartbeat() }, 0, HEARTBEAT_SECONDS, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        executor.shutdownNow()
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SuperParty Phone Gateway",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Conexiune persistentă și heartbeat pentru gateway-ul WhatsApp"
                setShowBadge(false)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun packageVersion(packageName: String): String? = try {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(packageName, 0).versionName
    } catch (_: Exception) {
        null
    }

    private fun networkType(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return "offline"
        val caps = cm.getNetworkCapabilities(network) ?: return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
    }

    private fun batteryState(): Pair<Int, Boolean> {
        val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (intent == null) return -1 to false
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val pct = if (level >= 0 && scale > 0) (level * 100 / scale) else -1
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return pct to charging
    }

    private fun heartbeatPayload(): JSONObject {
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown-${Build.MODEL}"
        val whatsappVersion = packageVersion("com.whatsapp")
        val businessVersion = packageVersion("com.whatsapp.w4b")
        val (batteryLevel, charging) = batteryState()
        return JSONObject().apply {
            put("device_id", deviceId)
            put("model", Build.MODEL ?: "unknown")
            put("manufacturer", Build.MANUFACTURER ?: "unknown")
            put("android_version", Build.VERSION.RELEASE ?: "unknown")
            put("android_sdk", Build.VERSION.SDK_INT)
            put("gateway_app_version", BuildConfig.VERSION_NAME)
            put("network_type", networkType())
            put("battery_level", batteryLevel)
            put("charging", charging)
            put("whatsapp_installed", whatsappVersion != null)
            put("whatsapp_version", whatsappVersion ?: JSONObject.NULL)
            put("whatsapp_business_installed", businessVersion != null)
            put("whatsapp_business_version", businessVersion ?: JSONObject.NULL)
            put("device_uptime_ms", SystemClock.elapsedRealtime())
            put("observed_at_ms", System.currentTimeMillis())
            put("primary_whatsapp_modified", false)
        }
    }

    private fun sendHeartbeat() {
        var connection: HttpURLConnection? = null
        try {
            val base = BuildConfig.BACKEND_URL.trim().trimEnd('/')
            if (!base.startsWith("http://") && !base.startsWith("https://")) return
            connection = (URL("$base/api/phone-gateway/heartbeat").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 15000
                doOutput = true
                useCaches = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
            val payload = heartbeatPayload().toString().toByteArray(Charsets.UTF_8)
            connection.outputStream.use { it.write(payload) }
            val code = connection.responseCode
            if (code !in 200..299) {
                connection.errorStream?.close()
            } else {
                connection.inputStream?.close()
            }
        } catch (_: Exception) {
            // Heartbeat is best-effort; the scheduled executor retries automatically.
        } finally {
            connection?.disconnect()
        }
    }
}
