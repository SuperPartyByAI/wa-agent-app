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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
                                    GlobalScope.launch {
                                        val destination = checkKycStatus()
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
