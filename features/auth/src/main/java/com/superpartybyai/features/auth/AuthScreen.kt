package com.superpartybyai.features.auth

import android.content.Context
import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.Google
import io.github.jan.supabase.gotrue.providers.builtin.IDToken
import kotlinx.coroutines.launch
import com.superpartybyai.core.SupabaseClient

val WEB_CLIENT_ID get() = com.superpartybyai.core.AppConfig.WEB_CLIENT_ID

@Composable
fun AuthScreen(onLoginSuccess: () -> Unit) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Check if session exists on load
    LaunchedEffect(Unit) {
        if (SupabaseClient.client.auth.currentSessionOrNull() != null) {
            onLoginSuccess()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = "Agent Login", style = MaterialTheme.typography.headlineLarge)
        Spacer(modifier = Modifier.height(16.dp))
        Text(text = "Secure internal access via Google Workspace", style = MaterialTheme.typography.bodyMedium)
        Spacer(modifier = Modifier.height(32.dp))

        if (errorMessage != null) {
            Text(text = errorMessage!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(modifier = Modifier.height(16.dp))
        }

        Button(
            onClick = {
                isLoading = true
                errorMessage = null
                coroutineScope.launch {
                    try {
                        val credentialManager = CredentialManager.create(context)
                        
                        val googleIdOption = GetGoogleIdOption.Builder()
                            .setFilterByAuthorizedAccounts(false)
                            .setServerClientId(WEB_CLIENT_ID)
                            .setAutoSelectEnabled(true)
                            .build()

                        val request = GetCredentialRequest.Builder()
                            .addCredentialOption(googleIdOption)
                            .build()

                        val result = credentialManager.getCredential(context, request)
                        val credential = result.credential
                        
                        // Proceed to Supabase Auth if it's a valid Google Token
                        if (credential is com.google.android.libraries.identity.googleid.GoogleIdTokenCredential) {
                            val idToken = credential.idToken
                            SupabaseClient.client.auth.signInWith(IDToken) {
                                this.idToken = idToken
                                provider = Google
                            }
                            onLoginSuccess()
                        } else {
                            errorMessage = "Invalid Credential Type received."
                            isLoading = false
                        }
                    } catch (e: GetCredentialException) {
                        errorMessage = "Google Login Failed: ${e.message}"
                        Log.e("AuthScreen", "CredentialManager err: ${e.message}", e)
                        isLoading = false
                    } catch (e: Exception) {
                        errorMessage = "Supabase Auth Error: \${e.message}"
                        Log.e("AuthScreen", "Auth error", e)
                        isLoading = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth().height(50.dp),
            enabled = !isLoading
        ) {
            if (isLoading) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
            else Text("Sign in with Google")
        }
    }
}
