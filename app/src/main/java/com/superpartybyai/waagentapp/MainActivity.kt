package com.superpartybyai.waagentapp

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.superpartybyai.core.SupabaseClient
import com.superpartybyai.features.auth.AuthScreen
import com.superpartybyai.features.auth.OnboardingFlow
import com.superpartybyai.features.auth.PendingApprovalScreen
import com.superpartybyai.waagentapp.ui.MainShellScreen
import com.superpartybyai.waagentapp.ui.theme.SuperpartyTheme
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.launch
import kotlinx.coroutines.GlobalScope

class MainActivity : ComponentActivity() {

    // Expected SHA-256 of the signing certificate
    // Update this when switching to release signing key!
    private val EXPECTED_SIGNING_HASH = "9DBB82076709399D666F4C05B58C5FB8E5819BC958E9122B573E79E8AE2225109"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── Integrity Check: Verify APK signature ──
        val signatureValid = verifyAppSignature()
        if (!signatureValid && !BuildConfig.DEBUG) {
            // Only block in RELEASE builds — debug uses different signing
            Log.e("SECURITY", "⛔ APP SIGNATURE INVALID — possible tampered APK!")
            android.widget.Toast.makeText(this, "Aplicație neautorizată!", android.widget.Toast.LENGTH_LONG).show()
            finish()
            return
        }

        com.superpartybyai.core.AppConfig.SUPABASE_URL = BuildConfig.SUPABASE_URL
        com.superpartybyai.core.AppConfig.SUPABASE_ANON_KEY = BuildConfig.SUPABASE_ANON_KEY
        com.superpartybyai.core.AppConfig.WEB_CLIENT_ID = BuildConfig.WEB_CLIENT_ID
        com.superpartybyai.core.AppConfig.BACKEND_URL = BuildConfig.BACKEND_URL
        com.superpartybyai.core.AppConfig.API_KEY = BuildConfig.API_KEY
        setContent {
            SuperpartyTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val navController = rememberNavController()

                    NavHost(navController = navController, startDestination = "login") {
                        composable("login") {
                            AuthScreen(
                                onLoginSuccess = {
                                    // After login, check KYC status
                                    GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                                        val destination = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                                            checkKycStatus()
                                        }
                                        navController.navigate(destination) {
                                            popUpTo("login") { inclusive = true }
                                        }
                                    }
                                }
                            )
                        }
                        composable("onboarding") {
                            OnboardingFlow(
                                onComplete = {
                                    navController.navigate("pending") {
                                        popUpTo("onboarding") { inclusive = true }
                                    }
                                }
                            )
                        }
                        composable("pending") {
                            PendingApprovalScreen()
                        }
                        composable("main") {
                            MainShellScreen(
                                onNavigateToChat = { contactId ->
                                    navController.navigate("conversation/$contactId")
                                },
                                onNavigateToWaLink = {
                                    navController.navigate("wa_link")
                                },
                                onLogout = {
                                    GlobalScope.launch {
                                        SupabaseClient.client.auth.signOut()
                                    }
                                    navController.navigate("login") {
                                        popUpTo("main") { inclusive = true }
                                    }
                                }
                            )
                        }
                        composable("conversation/{contactId}") { backStackEntry ->
                            val contactId = backStackEntry.arguments?.getString("contactId") ?: ""
                            com.superpartybyai.features.chat.ConversationScreen(
                                contactId = contactId,
                                onBack = { navController.popBackStack() }
                            )
                        }
                        composable("wa_link") {
                            com.superpartybyai.features.chat.WhatsAppSessionsScreen(
                                onViewQrClick = { sessionId ->
                                    navController.navigate("wa_session/$sessionId")
                                }
                            )
                        }
                        composable("wa_session/{sessionId}") { backStackEntry ->
                            val sessionId = backStackEntry.arguments?.getString("sessionId") ?: "default"
                            com.superpartybyai.features.chat.WhatsAppSessionScreen(
                                sessionId = sessionId,
                                onBack = { navController.popBackStack() }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Check KYC status after login:
 * - If user is admin (superpartybyai@gmail.com) → go to "main" directly
 * - If employee_profiles.status == "approved" → "main"
 * - If employee_profiles.status == "pending" → "pending"
 * - If no profile exists → "onboarding"
 */
private suspend fun checkKycStatus(): String {
    return try {
        val client = SupabaseClient.client
        val userId = client.auth.currentUserOrNull()?.id ?: return "onboarding"
        val email = client.auth.currentUserOrNull()?.email ?: ""

        // Admin bypass
        if (email == "superpartybyai@gmail.com") {
            Log.d("KYC", "Admin detected, skipping KYC")
            return "main"
        }

        // Check employee profile
        val result = client.postgrest.from("employee_profiles")
            .select {
                filter { eq("user_id", userId) }
            }
            .decodeList<Map<String, Any?>>()

        if (result.isEmpty()) {
            Log.d("KYC", "No profile found, starting onboarding")
            "onboarding"
        } else {
            val status = result[0]["status"]?.toString() ?: "pending"
            Log.d("KYC", "Profile found, status: $status")
            when (status) {
                "approved" -> "main"
                "rejected" -> "onboarding" // Let them retry
                else -> "pending"
            }
        }
    } catch (e: Exception) {
        Log.e("KYC", "Error checking KYC status", e)
        "onboarding" // Default to onboarding if error
    }
}

    /**
     * Verify the APK is signed with the expected certificate.
     * If someone decompiles, modifies, and re-signs the APK — this will detect it.
     */
    @Suppress("DEPRECATION")
    private fun verifyAppSignature(): Boolean {
        return try {
            val packageInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
            } else {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES)
            }

            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures
            }

            if (signatures.isNullOrEmpty()) {
                Log.e("SECURITY", "No signatures found!")
                return false
            }

            val md = java.security.MessageDigest.getInstance("SHA-256")
            val digest = md.digest(signatures[0].toByteArray())
            val hash = digest.joinToString("") { "%02X".format(it) }

            Log.d("SECURITY", "APK signing hash: $hash")

            // Compare with expected hash
            val isValid = hash == EXPECTED_SIGNING_HASH
            if (isValid) {
                Log.d("SECURITY", "✅ Signature verification PASSED")
            } else {
                Log.e("SECURITY", "⛔ Signature mismatch! Expected: $EXPECTED_SIGNING_HASH, Got: $hash")
            }
            isValid
        } catch (e: Exception) {
            Log.e("SECURITY", "Signature verification error", e)
            false
        }
    }
}
