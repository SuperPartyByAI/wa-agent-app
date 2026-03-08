package com.superpartybyai.features.calls

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class MockCall(val contactName: String, val status: String, val time: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallsScreen(modifier: Modifier = Modifier) {
    val calls = listOf(
        MockCall("Client C (3CX: 0722..)", "Missed", "14:20"),
        MockCall("Client A", "Completed (5m)", "Yesterday")
    )

    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("3CX Live Switchboard") }) }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
            items(calls.size) { index ->
                val call = calls[index]
                ListItem(
                    headlineContent = { Text(call.contactName) },
                    supportingContent = { Text("Status: ${call.status}") },
                    trailingContent = { Text(call.time) },
                    leadingContent = {
                        Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(40.dp))
                    }
                )
                Divider()
            }
        }
    }
}
