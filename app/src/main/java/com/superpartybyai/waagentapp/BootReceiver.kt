package com.superpartybyai.waagentapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val PREFS = "phone_gateway_startup"
        private val START_ACTIONS = setOf(
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_USER_UNLOCKED,
            Intent.ACTION_MY_PACKAGE_REPLACED
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in START_ACTIONS) return

        val directBootContext = context.createDeviceProtectedStorageContext()
        val prefs = directBootContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val observedAt = System.currentTimeMillis()

        prefs.edit()
            .putString("last_broadcast_action", action)
            .putLong("last_broadcast_at_ms", observedAt)
            .remove("last_start_error")
            .commit()

        try {
            PhoneGatewayService.start(directBootContext)
            prefs.edit()
                .putLong("last_service_start_requested_at_ms", System.currentTimeMillis())
                .commit()
        } catch (error: Throwable) {
            prefs.edit()
                .putString(
                    "last_start_error",
                    "${error.javaClass.name}:${error.message.orEmpty()}".take(1000)
                )
                .putLong("last_start_error_at_ms", System.currentTimeMillis())
                .commit()
        }
    }
}
