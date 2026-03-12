package com.superpartybyai.waagentapp.ui.events

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.coroutines.Dispatchers

@Serializable
data class ClientRef(val full_name: String, val phone: String?)

@Serializable
data class EventModelModel(
    val id: String,
    val title: String,
    val status: String,
    val event_type: String,
    val theme: String?,
    val city: String?,
    val date_string: String?,
    val created_at: String,
    val clients: ClientRef? = null
)

@Serializable
data class TaskModel(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val created_at: String
)

// Legacy AiActionModel removed — AI features now served via ManagerAi schema API

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventModelsListScreen(modifier: Modifier = Modifier, onEventModelClick: (String) -> Unit) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Events", "Tasks")

    var events by remember { mutableStateOf<List<EventModelModel>>(emptyList()) }
    var tasks by remember { mutableStateOf<List<TaskModel>>(emptyList()) }

    
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    fun loadData() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                events = SupabaseClient.client.postgrest["events"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, title, status, event_type, theme, city, date_string, created_at, clients(full_name, public_alias)"))
                    .decodeList<EventModelModel>().sortedByDescending { it.created_at }
                
                tasks = SupabaseClient.client.postgrest["tasks"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, title, description, status, created_at"))
                    .decodeList<TaskModel>().sortedByDescending { it.created_at }

                // Legacy ai_actions query removed — AI features via ManagerAi schema API
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadData()
        
        launch(Dispatchers.IO) {
            try {
                val channel = SupabaseClient.client.channel("public-ai-dashboard")
                val eventsFlow = channel.postgresChangeFlow<PostgresAction>(schema = "public") { table = "events" }
                val tasksFlow = channel.postgresChangeFlow<PostgresAction>(schema = "public") { table = "tasks" }
                // Legacy ai_actions realtime removed
                
                channel.subscribe()
                
                launch { eventsFlow.collectLatest { loadData() } }
                launch { tasksFlow.collectLatest { loadData() } }

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = { 
            Column {
                TopAppBar(title = { Text("AI CRM Dashboard") }) 
                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title) }
                        )
                    }
                }
            }
        }
    ) { padding ->
        if (isLoading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                when (selectedTab) {
                    0 -> { // EVENTS
                        if (events.isEmpty()) {
                            item { Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) { Text("No AI events drafted yet.") } }
                        } else {
                            items(events.size) { index ->
                                val event = events[index]
                                val contactName = event.clients?.full_name ?: "Unknown Client"
                                ListItem(
                                    modifier = Modifier.clickable { onEventModelClick(event.id) },
                                    headlineContent = { Text(event.title, fontWeight = FontWeight.Bold) },
                                    supportingContent = { 
                                        Column {
                                            Text("Client: $contactName | Status: ${event.status.uppercase()}")
                                            Text("Locație: ${event.city ?: "N/A"} | Dată: ${event.date_string ?: "N/A"}")
                                        }
                                    },
                                    trailingContent = { Text(event.event_type.capitalize(), style = MaterialTheme.typography.labelSmall) },
                                    leadingContent = { Icon(Icons.Default.DateRange, contentDescription = null, modifier = Modifier.size(40.dp)) }
                                )
                                Divider()
                            }
                        }
                    }
                    1 -> { // TASKS
                        if (tasks.isEmpty()) {
                            item { Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) { Text("No Operational Tasks generated.") } }
                        } else {
                            items(tasks.size) { index ->
                                val task = tasks[index]
                                ListItem(
                                    headlineContent = { Text(task.title, fontWeight = FontWeight.Bold) },
                                    supportingContent = { Text(task.description) },
                                    trailingContent = { Text(task.status.uppercase(), style = MaterialTheme.typography.labelSmall) },
                                    leadingContent = { Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(40.dp)) }
                                )
                                Divider()
                            }
                        }
                    }
                    // Legacy AI Actions tab removed — AI features now in Conversation > Creier AI tab
                }
            }
        }
    }
}
