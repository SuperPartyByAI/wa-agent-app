package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.widget.Toast

@Serializable
data class WhatsAppSessionModel(
    val session_key: String,
    val label: String? = null,
    val status: String,
    val last_seen_at: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsAppSessionsScreen(
    modifier: Modifier = Modifier,
    onViewQrClick: (String) -> Unit
) {
    var sessionsList by remember { mutableStateOf<List<WhatsAppSessionModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    
    // Rename Modal State
    var sessionToRename by remember { mutableStateOf<WhatsAppSessionModel?>(null) }
    var renameText by remember { mutableStateOf("") }
    
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current

    val loadSessions: () -> Unit = {
        coroutineScope.launch {
            try {
                if (sessionsList.isEmpty()) isLoading = true
                val response = SupabaseClient.client.postgrest["whatsapp_sessions"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("session_key, label, status, last_seen_at"))
                    .decodeList<WhatsAppSessionModel>()
                sessionsList = response.sortedByDescending { it.last_seen_at ?: "" }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadSessions()

        // 1. Supabase Postgres Realtime (Primary)
        launch {
            try {
                val channel = SupabaseClient.client.channel("public-whatsapp_sessions")
                val flow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "whatsapp_sessions"
                }
                channel.subscribe()
                flow.collect {
                    loadSessions()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        // 2. Hard REST Polling Fallback (10 seconds)
        // Defensively guarantees State Updates even if the WebSocket pipe severs instantly.
        launch {
            while (true) {
                kotlinx.coroutines.delay(10000)
                loadSessions()
            }
        }
    }

    fun callRestEndpoint(endpoint: String, sessionId: String) {
        coroutineScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/sessions/$endpoint")
                    val conn = url.openConnection() as HttpURLConnection
                    val method = if (endpoint == "logout" || endpoint == "reconnect" || endpoint == "start") "POST" else "DELETE"
                    
                    if (endpoint.contains("/")) {
                        // For DELETE /api/sessions/:sessionId
                        val delUrl = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/sessions/$sessionId")
                        val delConn = delUrl.openConnection() as HttpURLConnection
                        delConn.requestMethod = "DELETE"
                        delConn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                        if (delConn.responseCode !in 200..299) throw Exception("HTTP ${delConn.responseCode}")
                        return@withContext
                    }
                    
                    conn.requestMethod = method
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                    conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                    
                    if (method == "POST") {
                        conn.doOutput = true
                        val jsonBody = JSONObject().apply { put("sessionId", sessionId) }
                        conn.outputStream.use { os ->
                            val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                            os.write(input, 0, input.size)
                        }
                    }
                    
                    if (conn.responseCode !in 200..299) {
                        throw Exception("HTTP ${conn.responseCode}")
                    }
                }
                Toast.makeText(context, "Comanda trimisa catre $endpoint!", Toast.LENGTH_SHORT).show()
                loadSessions()
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(context, "Eroare: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    if (sessionToRename != null) {
        AlertDialog(
            onDismissRequest = { sessionToRename = null },
            title = { Text("Redenumește Sesiunea") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    label = { Text("Nume Sesiune (ex. Telefon Office)") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(onClick = {
                    val targetSession = sessionToRename!!
                    val newLabel = renameText
                    sessionToRename = null
                    coroutineScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/sessions/rename")
                                val conn = url.openConnection() as HttpURLConnection
                                conn.requestMethod = "POST"
                                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                conn.doOutput = true
                                val jsonBody = JSONObject().apply {
                                    put("sessionId", targetSession.session_key)
                                    put("newLabel", newLabel)
                                }
                                conn.outputStream.use { os ->
                                    val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                    os.write(input, 0, input.size)
                                }
                                if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
                            }
                            Toast.makeText(context, "Sesiune redenumită!", Toast.LENGTH_SHORT).show()
                            loadSessions()
                        } catch (e: Exception) {
                            Toast.makeText(context, "Eroare: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }) {
                    Text("Salvează")
                }
            },
            dismissButton = {
                TextButton(onClick = { sessionToRename = null }) {
                    Text("Anulează")
                }
            }
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("WA Sessions Admin") }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { 
                val newSessionId = "wa_" + java.util.UUID.randomUUID().toString().substring(0, 8)
                onViewQrClick(newSessionId) 
            }) {
                Icon(Icons.Default.Add, contentDescription = "New Link")
            }
        }
    ) { padding ->
        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (sessionsList.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No WhatsApp sessions active in Supabase CRM.")
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                items(sessionsList.size) { index ->
                    val s = sessionsList[index]
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                val displayName = s.label?.takeIf { it.isNotBlank() } ?: "Sesiune ${s.session_key.takeLast(4)}"
                                Text(displayName, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                                IconButton(onClick = { 
                                    sessionToRename = s
                                    renameText = s.label ?: "" 
                                }) {
                                    Icon(Icons.Default.Edit, contentDescription = "Edit Label")
                                }
                            }
                            Text("Session ID: ${s.session_key}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(modifier = Modifier.height(8.dp))
                            
                            Text("Session Active", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            
                            Text("Status: " + s.status, color = if (s.status == "CONNECTED") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                            
                            val lastSeenDisplay = s.last_seen_at?.substringBefore('T') ?: ""
                            Text("Last Seen: " + lastSeenDisplay)
                            
                            Spacer(modifier = Modifier.height(16.dp))
                            
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (s.status == "AWAITING_QR") {
                                    Button(onClick = { onViewQrClick(s.session_key) }) {
                                        Text("View QR")
                                    }
                                } else if (s.status == "DISCONNECTED" || s.status == "CONFLICT" || s.status == "UNPAIRED") {
                                    Button(onClick = { callRestEndpoint("reconnect", s.session_key) }) {
                                        Text("Reconnect")
                                    }
                                    Button(
                                        onClick = { callRestEndpoint(s.session_key, s.session_key) }, // DELETE trick encoded in UI
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                                    ) {
                                        Text("Kill")
                                    }
                                } else if (s.status == "CONNECTED") {
                                    Button(
                                        onClick = { callRestEndpoint("logout", s.session_key) },
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                                    ) {
                                        Text("Logout")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
