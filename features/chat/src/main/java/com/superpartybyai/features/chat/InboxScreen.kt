package com.superpartybyai.features.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import kotlinx.coroutines.delay
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.LocalDate

import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Refresh
import coil.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.gotrue.auth
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext

@Serializable
data class ClientRef(val full_name: String, val avatar_url: String? = null, val public_alias: String? = null, val internal_client_code: String? = null)

@Serializable
data class InboxSummaryModel(
    val conversation_id: String,
    val conversation_status: String? = null,
    val conversation_updated_at: String? = null,
    val client_id: String? = null,
    val session_id: String? = null,
    val session_label: String? = null,
    val full_name: String? = null,
    val avatar_url: String? = null,
    val public_alias: String? = null,
    val internal_client_code: String? = null,
    val last_message_content: String? = null,
    val last_message_at: String? = null,
    val last_message_from_me: Boolean? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(modifier: Modifier = Modifier, onChatClick: (String) -> Unit, onWaLinkClick: () -> Unit = {}) {
    var conversations by remember { mutableStateOf<List<InboxSummaryModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    
    var showRealNumberDialog by remember { mutableStateOf(false) }
    var realPhoneNumber by remember { mutableStateOf("") }
    var activeClientIdForRealNumber by remember { mutableStateOf<String?>(null) }
    var showSetRealNumberDialog by remember { mutableStateOf(false) }
    var inputRealNumber by remember { mutableStateOf("") }
    var isSubmittingRealNumber by remember { mutableStateOf(false) }

    val loadConversations: () -> Unit = {
        coroutineScope.launch {
            try {
                if (conversations.isEmpty()) isLoading = true
                
                // Fetch raw array first for diagnostic logging
                val result = SupabaseClient.client.postgrest["v_inbox_summaries"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("conversation_id, conversation_status, conversation_updated_at, client_id, session_id, session_label, full_name, avatar_url, public_alias, internal_client_code, last_message_content, last_message_at, last_message_from_me"))
                    
                val rawResponse = result.data
                android.util.Log.e("InboxScreen", "Raw v_inbox_summaries response length: " + rawResponse.length)
                if (rawResponse.contains("a5652d1f")) {
                    android.util.Log.e("InboxScreen", "Found target conv a5652d1f in raw response!")
                }
                
                val response = result.decodeList<InboxSummaryModel>()
                
                android.util.Log.e("InboxScreen", "Decoded conversations size: ${response.size}")
                response.find { it.last_message_from_me == true }?.let {
                    android.util.Log.e("InboxScreen", "Found outbound-only conversation: ${it.conversation_id} with content: ${it.last_message_content}")
                }
                
                conversations = response.sortedByDescending { it.last_message_at ?: "" }
            } catch (e: Exception) {
                android.util.Log.e("InboxScreen", "Error loading conversations: ${e.message}", e)
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadConversations()
        
        launch {
            try {
                val channel = SupabaseClient.client.channel("public-conversations")
                val flow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "conversations"
                }
                channel.subscribe()
                flow.collect {
                    loadConversations()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        
        // Polling Fallback (Every 5 seconds) to ensure eventual consistency if WebSockets drop
        launch {
            while (true) {
                delay(5000L)
                loadConversations()
            }
        }
    }

    if (showSetRealNumberDialog) {
        AlertDialog(
            onDismissRequest = { if (!isSubmittingRealNumber) showSetRealNumberDialog = false },
            title = { Text("Setează Număr Real") },
            text = {
                Column {
                    Text("Introduceți numărul canonic pentru acest client. Se vor suprascrie automat sursele deduse.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
                    OutlinedTextField(
                        value = inputRealNumber,
                        onValueChange = { inputRealNumber = it },
                        label = { Text("Număr (+40...)") },
                        enabled = !isSubmittingRealNumber,
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (inputRealNumber.isNotBlank() && activeClientIdForRealNumber != null) {
                            isSubmittingRealNumber = true
                            coroutineScope.launch {
                                try {
                                    val token = SupabaseClient.client.auth.currentAccessTokenOrNull()
                                    if (token != null) {
                                        withContext(Dispatchers.IO) {
                                            val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/$activeClientIdForRealNumber/real-number")
                                            val conn = url.openConnection() as HttpURLConnection
                                            conn.requestMethod = "POST"
                                            conn.setRequestProperty("Authorization", "Bearer $token")
                                            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                            conn.doOutput = true
                                            val jsonBody = JSONObject().apply {
                                                put("realNumber", inputRealNumber.trim())
                                                put("notes", "Manual override from InboxScreen")
                                            }
                                            conn.outputStream.use { os ->
                                                val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                                os.write(input, 0, input.size)
                                            }
                                            val rc = conn.responseCode
                                            if (rc in 200..299) {
                                                val resp = conn.inputStream.bufferedReader().use { it.readText() }
                                                val resJson = JSONObject(resp)
                                                realPhoneNumber = resJson.optString("realNumber", inputRealNumber)
                                            } else {
                                                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }
                                                val errMsg = try { JSONObject(err).optString("error", "HTTP $rc") } catch(e:Exception) { "HTTP $rc" }
                                                throw Exception(errMsg)
                                            }
                                        }
                                        showSetRealNumberDialog = false
                                        showRealNumberDialog = true
                                    }
                                } catch (e: Exception) {
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Eroare salvare: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                } finally {
                                    isSubmittingRealNumber = false
                                }
                            }
                        }
                    },
                    enabled = !isSubmittingRealNumber
                ) {
                    if (isSubmittingRealNumber) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Salvează")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showSetRealNumberDialog = false },
                    enabled = !isSubmittingRealNumber
                ) { Text("Anulează") }
            }
        )
    }

    if (showRealNumberDialog) {
        val currentUserEmail = SupabaseClient.client.auth.currentUserOrNull()?.email
        AlertDialog(
            onDismissRequest = { showRealNumberDialog = false },
            title = { Text("Număr Fizic Real (Admin Inbox)") },
            text = { Text("MSISDN / Identificator WhatsApp:\n\n$realPhoneNumber\n\n(Afișat exclusiv pentru sesiunea ursache.andrei1995@gmail.com)") },
            confirmButton = {
                TextButton(onClick = { showRealNumberDialog = false }) { Text("Închide") }
            },
            dismissButton = {
                if (currentUserEmail == "ursache.andrei1995@gmail.com" && realPhoneNumber == "Număr real indisponibil") {
                    TextButton(onClick = {
                        showRealNumberDialog = false
                        inputRealNumber = ""
                        showSetRealNumberDialog = true
                    }) {
                        Text("Setează număr real")
                    }
                }
            }
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = { 
            TopAppBar(
                title = { Text("WhatsApp Inbox") },
                actions = {
                    IconButton(onClick = onWaLinkClick) {
                        Icon(Icons.Default.AddCircle, contentDescription = "Link WA")
                    }
                }
            ) 
        }
    ) { padding ->
        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (conversations.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No active conversations found.")
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                items(conversations.size) { index ->
                    val conv = conversations[index]
                    val contactName = conv.public_alias ?: conv.full_name ?: "Unknown Client"
                    
                    val prefix = if (conv.last_message_from_me == true) "Tu: " else ""
                    val messagePreview = conv.last_message_content?.let { previewText -> 
                        prefix + (if (previewText.length > 50) previewText.take(50) + "..." else previewText)
                    } ?: (conv.internal_client_code ?: "Începeți o conversație")
                    
                    val timeString = try {
                        val isoString = conv.last_message_at
                        if (isoString != null) {
                            val instant = Instant.parse(if (isoString.endsWith("Z") || isoString.contains("+")) isoString else "${isoString}Z")
                            val zoneId = ZoneId.systemDefault()
                            val messageDate = instant.atZone(zoneId).toLocalDate()
                            val today = LocalDate.now(zoneId)
                            
                            if (messageDate.isEqual(today)) {
                                val formatter = DateTimeFormatter.ofPattern("HH:mm").withZone(zoneId)
                                formatter.format(instant)
                            } else {
                                val formatter = DateTimeFormatter.ofPattern("dd/MM/yy").withZone(zoneId)
                                formatter.format(instant)
                            }
                        } else {
                            ""
                        }
                    } catch (e: Exception) {
                        ""
                    }
                    
                    ListItem(
                        modifier = Modifier.clickable { onChatClick(conv.conversation_id) },
                        headlineContent = { Text(contactName) },
                        supportingContent = { 
                            Column {
                                Text(
                                    text = "Via: ${conv.session_label ?: conv.session_id?.take(8) ?: "Necunoscut"}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(bottom = 2.dp)
                                )
                                Text(messagePreview, maxLines = 1)
                            }
                        },
                        trailingContent = { Text(timeString, style = MaterialTheme.typography.labelSmall) },
                        leadingContent = {
                            val avatarModifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .clickable {
                                    val currentUserEmail = SupabaseClient.client.auth.currentUserOrNull()?.email
                                    if (currentUserEmail == "ursache.andrei1995@gmail.com") {
                                        if (conv.client_id != null) {
                                            coroutineScope.launch {
                                                try {
                                                    val token = withContext(Dispatchers.IO) { SupabaseClient.client.auth.currentAccessTokenOrNull() }
                                                    if (token != null) {
                                                        withContext(Dispatchers.IO) {
                                                            val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/${conv.client_id}/real-number")
                                                            val conn = url.openConnection() as HttpURLConnection
                                                            conn.requestMethod = "GET"
                                                            conn.setRequestProperty("Authorization", "Bearer $token")
                                                            conn.setRequestProperty("Accept", "application/json")
                                                            
                                                            val responseCode = conn.responseCode
                                                            if (responseCode == 200) {
                                                                val responseDetails = conn.inputStream.bufferedReader().use { it.readText() }
                                                                val json = JSONObject(responseDetails)
                                                                realPhoneNumber = json.optString("realNumber", "Număr real indisponibil")
                                                            } else {
                                                                realPhoneNumber = "Număr real indisponibil"
                                                            }
                                                            conn.disconnect()
                                                        }
                                                    } else {
                                                        realPhoneNumber = "Număr real indisponibil"
                                                    }
                                                    activeClientIdForRealNumber = conv.client_id
                                                    showRealNumberDialog = true
                                                } catch (e: Exception) {
                                                    withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare API PII: ${e.message}", Toast.LENGTH_SHORT).show() }
                                                }
                                            }
                                        } else {
                                            Toast.makeText(context, "Client ID invalid.", Toast.LENGTH_SHORT).show()
                                        }
                                    } else {
                                        // Fallback default action for non-admins
                                        onChatClick(conv.conversation_id)
                                    }
                                }

                            if (!conv.avatar_url.isNullOrEmpty()) {
                                AsyncImage(
                                    model = conv.avatar_url,
                                    contentDescription = "Profile Picture",
                                    modifier = avatarModifier,
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                Icon(Icons.Default.Person, contentDescription = null, modifier = avatarModifier)
                            }
                        }
                    )
                    Divider()
                }
            }
        }
    }
}
