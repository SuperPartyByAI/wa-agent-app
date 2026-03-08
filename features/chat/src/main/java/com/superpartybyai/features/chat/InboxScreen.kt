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
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.Serializable

import androidx.compose.material.icons.filled.AddCircle

@Serializable
data class ClientRef(val full_name: String, val phone: String?)

@Serializable
data class ConversationModel(
    val id: String,
    val status: String,
    val updated_at: String,
    val clients: ClientRef? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(modifier: Modifier = Modifier, onChatClick: (String) -> Unit, onWaLinkClick: () -> Unit = {}) {
    var conversations by remember { mutableStateOf<List<ConversationModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        coroutineScope.launch {
            try {
                // Fetch conversations joined with Client details
                val response = SupabaseClient.client.postgrest["conversations"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, status, updated_at, clients(full_name, phone)"))
                    .decodeList<ConversationModel>()
                conversations = response
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
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
                    val contactName = conv.clients?.full_name ?: "Unknown Client"
                    val phone = conv.clients?.phone ?: "No Number"
                    
                    ListItem(
                        modifier = Modifier.clickable { onChatClick(conv.id) },
                        headlineContent = { Text(contactName) },
                        supportingContent = { Text(phone) },
                        trailingContent = { Text(conv.status, style = MaterialTheme.typography.labelSmall) },
                        leadingContent = {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(40.dp))
                        }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
