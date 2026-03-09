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
import kotlinx.coroutines.delay
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.Serializable

import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Refresh
import coil.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.PostgresAction

@Serializable
data class ClientRef(val full_name: String, val phone: String?, val avatar_url: String? = null, val public_alias: String? = null, val internal_client_code: String? = null)

@Serializable
data class ConversationModel(
    val id: String,
    val status: String,
    val session_id: String? = null,
    val updated_at: String,
    val clients: ClientRef? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(modifier: Modifier = Modifier, onChatClick: (String) -> Unit, onWaLinkClick: () -> Unit = {}) {
    var conversations by remember { mutableStateOf<List<ConversationModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    val loadConversations: () -> Unit = {
        coroutineScope.launch {
            try {
                if (conversations.isEmpty()) isLoading = true
                val response = SupabaseClient.client.postgrest["conversations"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, status, updated_at, clients(full_name, phone, avatar_url, public_alias, internal_client_code)"))
                    .decodeList<ConversationModel>()
                conversations = response.sortedByDescending { it.updated_at }
            } catch (e: Exception) {
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
                    val contactName = conv.clients?.public_alias ?: conv.clients?.full_name ?: "Unknown Client"
                    val secondaryLabel = conv.clients?.internal_client_code ?: "Identity Obfuscated"
                    
                    ListItem(
                        modifier = Modifier.clickable { onChatClick(conv.id) },
                        headlineContent = { Text(contactName) },
                        supportingContent = { Text(secondaryLabel) },
                        trailingContent = { Text(conv.status, style = MaterialTheme.typography.labelSmall) },
                        leadingContent = {
                            if (!conv.clients?.avatar_url.isNullOrEmpty()) {
                                AsyncImage(
                                    model = conv.clients?.avatar_url,
                                    contentDescription = "Profile Picture",
                                    modifier = Modifier.size(40.dp).clip(CircleShape),
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(40.dp))
                            }
                        }
                    )
                    Divider()
                }
            }
        }
    }
}
