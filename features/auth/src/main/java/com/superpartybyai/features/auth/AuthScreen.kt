package com.superpartybyai.features.auth

import android.app.Activity
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
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

    // Legacy Google Sign-In client
    val googleSignInClient: GoogleSignInClient = remember {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(WEB_CLIENT_ID)
            .requestEmail()
            .build()
        GoogleSignIn.getClient(context, gso)
    }

    // Activity result launcher for Google Sign-In
    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            try {
                val account = task.getResult(ApiException::class.java)
                val idToken = account?.idToken
                if (idToken != null) {
                    Log.d("AuthScreen", "Google ID Token obtained, signing in with Supabase...")
                    coroutineScope.launch {
                        try {
                            SupabaseClient.client.auth.signInWith(IDToken) {
                                this.idToken = idToken
                                provider = Google
                            }
                            Log.d("AuthScreen", "Supabase auth SUCCESS")
                            onLoginSuccess()
                        } catch (e: Exception) {
                            errorMessage = "Supabase auth error: ${e.message}"
                            Log.e("AuthScreen", "Supabase signIn error", e)
                            isLoading = false
                        }
                    }
                } else {
                    errorMessage = "Nu am primit ID token de la Google"
                    isLoading = false
                }
            } catch (e: ApiException) {
                errorMessage = "Google Sign-In error: code=${e.statusCode} ${e.message}"
                Log.e("AuthScreen", "GoogleSignIn ApiException: ${e.statusCode}", e)
                isLoading = false
            }
        } else {
            errorMessage = "Login anulat (resultCode=${result.resultCode})"
            isLoading = false
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
            // Google Sign-In button (Legacy API)
            Button(
                onClick = {
                    isLoading = true
                    errorMessage = null
                    // Sign out first to force account picker
                    googleSignInClient.signOut().addOnCompleteListener {
                        val signInIntent = googleSignInClient.signInIntent
                        googleSignInLauncher.launch(signInIntent)
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
