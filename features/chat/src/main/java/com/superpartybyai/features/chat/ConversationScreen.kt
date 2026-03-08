package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var message by remember { mutableStateOf("") }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Chat: $contactId") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                TextField(
                    value = message, 
                    onValueChange = { message = it },
                    modifier = Modifier.weight(1f).padding(8.dp),
                    placeholder = { Text("Type AI-assisted reply...") }
                )
                Button(onClick = { message = "" }, modifier = Modifier.padding(end = 8.dp)) {
                    Text("Send")
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).padding(16.dp).fillMaxSize()) {
            Text("Real-time messages powered by Supabase Realtime will stream here.")
        }
    }
}
