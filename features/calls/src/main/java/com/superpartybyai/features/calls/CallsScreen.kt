package com.superpartybyai.features.calls

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Call
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
data class ClientRef(val full_name: String, val public_alias: String? = null, val internal_client_code: String? = null)

@Serializable
data class CallEventModel(
    val id: String,
    val direction: String,
    val status: String,
    val started_at: String?,
    val clients: ClientRef? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallsScreen(modifier: Modifier = Modifier) {
    var calls by remember { mutableStateOf<List<CallEventModel>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        coroutineScope.launch {
            try {
                val response = SupabaseClient.client.postgrest["call_events"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, direction, status, started_at, clients(full_name, public_alias, internal_client_code)"))
                    .decodeList<CallEventModel>()
                calls = response.sortedByDescending { it.started_at }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("3CX Live Switchboard") }) }
    ) { padding ->
        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (calls.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No calls logged yet.")
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                items(calls.size) { index ->
                    val call = calls[index]
                    val contactName = call.clients?.public_alias ?: call.clients?.full_name ?: "Unknown Caller"
                    val secondaryId = call.clients?.internal_client_code ?: "Identity Obfuscated"
                    val icon = when(call.status) {
                        "missed" -> Icons.Default.Close
                        "ringing" -> Icons.Default.Call
                        else -> Icons.Default.Call
                    }

                    ListItem(
                        headlineContent = { Text(contactName) },
                        supportingContent = { Text("Status: ${call.status.replaceFirstChar { it.uppercase() }} | $secondaryId") },
                        trailingContent = { 
                            Text(
                                text = call.started_at?.take(16)?.replace("T", " ") ?: "",
                                style = MaterialTheme.typography.labelSmall
                            ) 
                        },
                        leadingContent = {
                            Icon(icon, contentDescription = null, modifier = Modifier.size(40.dp))
                        }
                    )
                    Divider()
                }
            }
        }
    }
}
