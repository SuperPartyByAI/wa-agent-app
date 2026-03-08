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
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.serialization.Serializable

@Serializable
data class MessageModel(
    val id: String,
    val sender_type: String,
    val content: String,
    val created_at: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<MessageModel>>(emptyList()) }
    var inputMessage by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()
    
    LaunchedEffect(contactId) {
        coroutineScope.launch {
            try {
                // Fetch message history for this conversation
                val response = SupabaseClient.client.postgrest["messages"]
                    .select {
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
                        // TODO: Triggers backend send API
                        inputMessage = "" 
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
