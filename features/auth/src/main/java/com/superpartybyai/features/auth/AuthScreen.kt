package com.superpartybyai.features.auth

import android.content.Context
import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.Google
import io.github.jan.supabase.gotrue.providers.builtin.Email
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
    var showEmailLogin by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

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
        Text(text = "Autentificare internă securizată", style = MaterialTheme.typography.bodyMedium)
        Spacer(modifier = Modifier.height(32.dp))

        if (errorMessage != null) {
            Text(text = errorMessage!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(modifier = Modifier.height(16.dp))
        }

        if (!showEmailLogin) {
            // Google Sign-In button
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

                            when {
                                credential is CustomCredential &&
                                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL -> {
                                    try {
                                        val googleIdTokenCredential =
                                            GoogleIdTokenCredential.createFrom(credential.data)
                                        val idToken = googleIdTokenCredential.idToken
                                        SupabaseClient.client.auth.signInWith(IDToken) {
                                            this.idToken = idToken
                                            provider = Google
                                        }
                                        onLoginSuccess()
                                    } catch (e: GoogleIdTokenParsingException) {
                                        errorMessage = "Google token error: ${e.message}"
                                        isLoading = false
                                    }
                                }
                                else -> {
                                    errorMessage = "Credential type invalid"
                                    isLoading = false
                                }
                            }
                        } catch (e: GetCredentialException) {
                            errorMessage = "Google Login: ${e.message}"
                            Log.e("AuthScreen", "CredentialManager err: ${e.message}", e)
                            isLoading = false
                            // Show email fallback
                            showEmailLogin = true
                        } catch (e: Exception) {
                            errorMessage = "Auth Error: ${e.message}"
                            isLoading = false
                            showEmailLogin = true
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                enabled = !isLoading
            ) {
                if (isLoading) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
                else Text("Sign in with Google")
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(onClick = { showEmailLogin = true }) {
                Text("Sau loghează-te cu email", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            // Email/Password login
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Parola") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(modifier = Modifier.height(20.dp))

            Button(
                onClick = {
                    if (email.isBlank() || password.isBlank()) {
                        errorMessage = "Completează email-ul și parola"
                        return@Button
                    }
                    isLoading = true
                    errorMessage = null
                    coroutineScope.launch {
                        try {
                            SupabaseClient.client.auth.signInWith(Email) {
                                this.email = email
                                this.password = password
                            }
                            onLoginSuccess()
                        } catch (e: Exception) {
                            // If sign in fails, try sign up
                            try {
                                SupabaseClient.client.auth.signUpWith(Email) {
                                    this.email = email
                                    this.password = password
                                }
                                // Sign in after sign up
                                SupabaseClient.client.auth.signInWith(Email) {
                                    this.email = email
                                    this.password = password
                                }
                                onLoginSuccess()
                            } catch (e2: Exception) {
                                errorMessage = "Login error: ${e2.message}"
                                isLoading = false
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                enabled = !isLoading
            ) {
                if (isLoading) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
                else Text("Loghează-te")
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(onClick = { showEmailLogin = false; errorMessage = null }) {
                Text("← Înapoi la Google Sign-In", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
