package com.superpartybyai.features.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class MockConversation(val id: String, val contactName: String, val lastMessage: String, val time: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(modifier: Modifier = Modifier, onChatClick: (String) -> Unit) {
    val conversations = listOf(
        MockConversation("1", "Client A", "Salut, am o intrebare legata de...", "12:05"),
        MockConversation("2", "Client B", "Multumesc pentru confirmare!", "09:30")
    )

    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("WhatsApp Inbox") }) }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
            items(conversations.size) { index ->
                val conv = conversations[index]
                ListItem(
                    modifier = Modifier.clickable { onChatClick(conv.id) },
                    headlineContent = { Text(conv.contactName) },
                    supportingContent = { Text(conv.lastMessage) },
                    trailingContent = { Text(conv.time, style = MaterialTheme.typography.labelSmall) },
                    leadingContent = {
                        Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(40.dp))
                    }
                )
                Divider()
            }
        }
    }
}
