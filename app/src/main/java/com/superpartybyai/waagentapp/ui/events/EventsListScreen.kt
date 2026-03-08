package com.superpartybyai.waagentapp.ui.events

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Event
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.Serializable

@Serializable
data class ClientRef(val full_name: String, val phone: String?)

@Serializable
data class EventModel(
    val id: String,
    val title: String,
    val status: String,
    val event_type: String,
    val theme: String?,
    val created_at: String,
    val clients: ClientRef? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsListScreen(modifier: Modifier = Modifier, onEventClick: (String) -> Unit) {
    var events by remember { mutableStateOf<List<EventModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        coroutineScope.launch {
            try {
                val response = SupabaseClient.client.postgrest["events"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, title, status, event_type, theme, created_at, clients(full_name, phone)"))
                    .decodeList<EventModel>()
                events = response.sortedByDescending { it.created_at }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("AI Events Pipeline") }) }
    ) { padding ->
        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (events.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No AI events drafted yet. Send a message with 'petrecere' to test.")
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                items(events.size) { index ->
                    val event = events[index]
                    val contactName = event.clients?.full_name ?: "Unknown Client"
                    
                    ListItem(
                        modifier = Modifier.clickable { onEventClick(event.id) },
                        headlineContent = { Text(event.title) },
                        supportingContent = { Text("Client: $contactName | Status: ${event.status.uppercase()}") },
                        trailingContent = { Text(event.event_type.capitalize(), style = MaterialTheme.typography.labelSmall) },
                        leadingContent = {
                            Icon(Icons.Default.Event, contentDescription = null, modifier = Modifier.size(40.dp))
                        }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
