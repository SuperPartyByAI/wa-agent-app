package com.superpartybyai.waagentapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.superpartybyai.features.auth.AuthScreen
import com.superpartybyai.waagentapp.ui.MainShellScreen
import io.github.jan.supabase.gotrue.auth
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
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val navController = rememberNavController()

                    NavHost(navController = navController, startDestination = "login") {
                        composable("login") {
                            AuthScreen(
                                onLoginSuccess = {
                                    navController.navigate("main") {
                                        popUpTo("login") { inclusive = true }
                                    }
                                }
                            )
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
                                        com.superpartybyai.core.SupabaseClient.client.auth.signOut()
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
                            com.superpartybyai.features.chat.WhatsAppSessionScreen(
                                onBack = { navController.popBackStack() }
                            )
                        }
                    }
                }
            }
        }
    }
}
