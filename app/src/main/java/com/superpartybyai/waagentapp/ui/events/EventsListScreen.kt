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

@Serializable
data class AiActionModel(
    val id: String,
    val action_type: String,
    val status: String,
    val payload: JsonObject? = null,
    val created_at: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventModelsListScreen(modifier: Modifier = Modifier, onEventModelClick: (String) -> Unit) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Events", "Tasks", "AI Actions")

    var events by remember { mutableStateOf<List<EventModelModel>>(emptyList()) }
    var tasks by remember { mutableStateOf<List<TaskModel>>(emptyList()) }
    var aiActions by remember { mutableStateOf<List<AiActionModel>>(emptyList()) }
    
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    fun loadData() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                events = SupabaseClient.client.postgrest["events"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, title, status, event_type, theme, city, date_string, created_at, clients(full_name, phone)"))
                    .decodeList<EventModelModel>().sortedByDescending { it.created_at }
                
                tasks = SupabaseClient.client.postgrest["tasks"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, title, description, status, created_at"))
                    .decodeList<TaskModel>().sortedByDescending { it.created_at }

                aiActions = SupabaseClient.client.postgrest["ai_actions"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, action_type, status, payload, created_at"))
                    .decodeList<AiActionModel>().sortedByDescending { it.created_at }
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
                val actionsFlow = channel.postgresChangeFlow<PostgresAction>(schema = "public") { table = "ai_actions" }
                
                channel.subscribe()
                
                launch { eventsFlow.collectLatest { loadData() } }
                launch { tasksFlow.collectLatest { loadData() } }
                launch { actionsFlow.collectLatest { loadData() } }
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
                    2 -> { // AI ACTIONS
                        if (aiActions.isEmpty()) {
                            item { Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) { Text("No AI Actions flagged.") } }
                        } else {
                            items(aiActions.size) { index ->
                                val action = aiActions[index]
                                ListItem(
                                    headlineContent = { Text(action.action_type.uppercase(), fontWeight = FontWeight.Bold) },
                                    supportingContent = { Text(action.payload?.toString() ?: "Empty Payload") },
                                    trailingContent = { Text(action.status.uppercase(), style = MaterialTheme.typography.labelSmall) },
                                    leadingContent = { Icon(Icons.Default.Info, contentDescription = null, modifier = Modifier.size(40.dp)) }
                                )
                                Divider()
                            }
                        }
                    }
                }
            }
        }
    }
}
