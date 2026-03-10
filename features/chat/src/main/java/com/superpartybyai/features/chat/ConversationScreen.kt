package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Info
import androidx.compose.foundation.clickable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.serialization.Serializable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import coil.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.PostgresAction

@Serializable
data class MessageModel(
    val id: String,
    val sender_type: String,
    val content: String,
    val created_at: String,
    val message_type: String? = "text",
    val media_url: String? = null,
    val file_name: String? = null,
    val duration_seconds: Int? = null
)

@Serializable
data class ClientIdentity(val avatar_url: String? = null, val public_alias: String? = null, val internal_client_code: String? = null)

@Serializable
data class ConvClientIdentity(val clients: ClientIdentity? = null, val session_id: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<MessageModel>>(emptyList()) }
    var inputMessage by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    var targetAlias by remember { mutableStateOf<String?>(null) }
    var currentSessionId by remember { mutableStateOf<String?>(null) }
    var targetAvatarUrl by remember { mutableStateOf<String?>(null) }
    
    // Rename Modal State
    var isRenamingClient by remember { mutableStateOf(false) }
    var newAliasText by remember { mutableStateOf("") }
    
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    
    val loadMessages: () -> Unit = {
        coroutineScope.launch {
            try {
                val response = SupabaseClient.client.postgrest["messages"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, sender_type, content, created_at, message_type, media_url, file_name, duration_seconds")) {
                        filter {
                            eq("conversation_id", contactId)
                        }
                        order("created_at", order = io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                    }.decodeList<MessageModel>()
                messages = response
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(contactId) {
        loadMessages()
        
        coroutineScope.launch {
            try {
                val convInfo = SupabaseClient.client.postgrest["conversations"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("clients(avatar_url, public_alias, internal_client_code), session_id")) {
                        filter { eq("id", contactId) }
                    }.decodeSingleOrNull<ConvClientIdentity>()
                targetAlias = convInfo?.clients?.public_alias ?: convInfo?.clients?.internal_client_code ?: "Anonymous Identity"
                targetAvatarUrl = convInfo?.clients?.avatar_url
                if (convInfo?.session_id != null) {
                    currentSessionId = convInfo.session_id
                }
            } catch (e: Exception) {
                android.util.Log.e("Antigravity", "Error fetching ConvClientIdentity for '$contactId': ${e.message}", e)
                e.printStackTrace()
            }
        }
        
        launch {
            try {
                val channel = SupabaseClient.client.channel("public-messages-\$contactId")
                val flow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "messages"
                }
                channel.subscribe()
                flow.collect {
                    loadMessages()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        
        // Polling Fallback (Every 5 seconds) to ensure eventual consistency if WebSockets drop
        launch {
            while (true) {
                delay(5000L)
                loadMessages()
            }
        }
    }

    if (isRenamingClient) {
        AlertDialog(
            onDismissRequest = { isRenamingClient = false },
            title = { Text("Redenumește Clientul") },
            text = {
                OutlinedTextField(
                    value = newAliasText,
                    onValueChange = { newAliasText = it },
                    label = { Text("Nume NOU (ex. Gigel Firma X)") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(onClick = {
                    val aliasToSave = newAliasText
                    isRenamingClient = false
                    coroutineScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/rename")
                                val conn = url.openConnection() as HttpURLConnection
                                conn.requestMethod = "POST"
                                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                conn.doOutput = true
                                val jsonBody = JSONObject().apply {
                                    put("conversationId", contactId)
                                    put("newAlias", aliasToSave)
                                }
                                conn.outputStream.use { os ->
                                    val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                    os.write(input, 0, input.size)
                                }
                                if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
                            }
                            targetAlias = aliasToSave
                            Toast.makeText(context, "Client redenumit!", Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            Toast.makeText(context, "Eroare redenumire: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }) {
                    Text("Salvează")
                }
            },
            dismissButton = {
                TextButton(onClick = { isRenamingClient = false }) {
                    Text("Anulează")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!targetAvatarUrl.isNullOrEmpty()) {
                            AsyncImage(
                                model = targetAvatarUrl,
                                contentDescription = "Avatar",
                                modifier = Modifier.size(32.dp).clip(CircleShape).padding(end = 8.dp),
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(32.dp).padding(end = 8.dp))
                        }
                        Column {
                            Text(targetAlias ?: "Chat Details", style = MaterialTheme.typography.bodyLarge)
                            Text("Secure Channel", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = {
                        isRenamingClient = true
                        newAliasText = targetAlias ?: ""
                    }) {
                        Icon(Icons.Default.Edit, contentDescription = "Rename Client")
                    }
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                TextField(
                    value = inputMessage, 
                    onValueChange = { inputMessage = it },
                    modifier = Modifier.weight(1f).padding(8.dp),
                    placeholder = { Text("Type AI-assisted reply...") }
                )
                Button(
                    onClick = { 
                        if (currentSessionId == null) {
                            Toast.makeText(context, "Sesiunea sursă lipsește. Rutele de reply sunt blocate.", Toast.LENGTH_LONG).show()
                            return@Button
                        }
                        if (inputMessage.isNotBlank() && contactId != null) {
                            val textToSend = inputMessage
                            inputMessage = ""
                            coroutineScope.launch {
                                try {
                                    withContext(Dispatchers.IO) {
                                        val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                                        val conn = url.openConnection() as HttpURLConnection
                                        conn.requestMethod = "POST"
                                        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                        conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                        conn.doOutput = true
                                        
                                        val jsonBody = JSONObject()
                                        jsonBody.put("conversationId", contactId)
                                        jsonBody.put("text", textToSend)
                                        jsonBody.put("sessionId", currentSessionId)
                                        
                                        conn.outputStream.use { os ->
                                            val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                            os.write(input, 0, input.size)
                                        }
                                        val rc = conn.responseCode
                                        if (rc !in 200..299) {
                                            withContext(Dispatchers.Main) {
                                                Toast.makeText(context, "Eroare trimitere: HTTP $rc", Toast.LENGTH_LONG).show()
                                            }
                                            return@withContext
                                        }
                                    }
                                    // Append locally optimistically
                                    messages = messages + MessageModel(
                                       id = java.util.UUID.randomUUID().toString(),
                                       sender_type = "agent",
                                       content = textToSend,
                                       created_at = java.time.Instant.now().toString()
                                    )
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Eroare rețea: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    }, 
                    modifier = Modifier.padding(end = 8.dp)
                ) {
                    Text("Send")
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (isLoading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
                LazyColumn(modifier = Modifier.weight(1f).padding(16.dp)) {
                    items(messages.size) { index ->
                        val msg = messages[index]
                        val isAgent = msg.sender_type == "agent" || msg.sender_type == "ai"
                        
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = if (isAgent) Arrangement.End else Arrangement.Start
                        ) {
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = if (isAgent) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
                                )
                            ) {
                                Column(modifier = Modifier.padding(8.dp)) {
                                    if (msg.message_type == "image" && !msg.media_url.isNullOrEmpty()) {
                                        AsyncImage(
                                            model = msg.media_url,
                                            contentDescription = "Imagine atașată",
                                            modifier = Modifier.fillMaxWidth(0.7f).heightIn(max = 300.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                                                .clickable { uriHandler.openUri(msg.media_url) },
                                            contentScale = ContentScale.Crop
                                        )
                                        if (msg.content.isNotBlank() && msg.content != "📷 Imagine") {
                                            Text(text = msg.content, modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium)
                                        }
                                    } else if (msg.message_type == "document" || msg.message_type == "audio" || msg.message_type == "video") {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.clickable { msg.media_url?.let { uriHandler.openUri(it) } }.padding(4.dp)
                                        ) {
                                            Icon(
                                                imageVector = if (msg.message_type == "audio") androidx.compose.material.icons.Icons.Default.PlayArrow else androidx.compose.material.icons.Icons.Default.Info,
                                                contentDescription = msg.message_type,
                                                modifier = Modifier.size(24.dp).padding(end = 8.dp)
                                            )
                                            Column {
                                                Text(text = msg.file_name ?: msg.content, style = MaterialTheme.typography.bodyMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                                                if (msg.message_type == "audio" && msg.duration_seconds != null) {
                                                    Text(text = "${msg.duration_seconds} sec", style = MaterialTheme.typography.labelSmall)
                                                }
                                            }
                                        }
                                    } else if (msg.message_type == "location") {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(androidx.compose.material.icons.Icons.Default.LocationOn, contentDescription = "Locație", modifier = Modifier.padding(end=4.dp))
                                            Text(text = msg.content, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                                        }
                                    } else {
                                        Text(
                                            text = msg.content,
                                            modifier = Modifier.padding(4.dp),
                                            style = MaterialTheme.typography.bodyMedium
                                        )
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
