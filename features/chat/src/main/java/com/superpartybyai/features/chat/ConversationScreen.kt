package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
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
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.PostgresAction

@Serializable
data class MessageModel(
    val id: String,
    val sender_type: String,
    val content: String,
    val created_at: String
)

@Serializable
data class ClientPhone(val phone: String)

@Serializable
data class ConvClientPhone(val clients: ClientPhone?, val session_id: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<MessageModel>>(emptyList()) }
    var inputMessage by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    var targetPhone by remember { mutableStateOf<String?>(null) }
    var currentSessionId by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    
    val loadMessages: () -> Unit = {
        coroutineScope.launch {
            try {
                val response = SupabaseClient.client.postgrest["messages"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, sender_type, content, created_at")) {
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
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("clients(phone), session_id")) {
                        filter { eq("id", contactId) }
                    }.decodeSingleOrNull<ConvClientPhone>()
                targetPhone = convInfo?.clients?.phone
                if (convInfo?.session_id != null) {
                    currentSessionId = convInfo.session_id
                }
            } catch (e: Exception) {
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Chat Details") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
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
                        if (inputMessage.isNotBlank() && targetPhone != null) {
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
                                        jsonBody.put("to", targetPhone)
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
                                Text(
                                    text = msg.content,
                                    modifier = Modifier.padding(12.dp),
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
