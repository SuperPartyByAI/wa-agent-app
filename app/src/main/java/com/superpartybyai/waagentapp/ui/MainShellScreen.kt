package com.superpartybyai.waagentapp.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.superpartybyai.features.calls.CallsScreen
import com.superpartybyai.features.chat.InboxScreen
import com.superpartybyai.features.auth.ProfileScreen
import com.superpartybyai.waagentapp.ui.events.EventsListScreen
import androidx.compose.material.icons.filled.Event

@Composable
fun MainShellScreen(onNavigateToChat: (String) -> Unit, onLogout: () -> Unit) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf(
        "Inbox" to Icons.Default.Email, 
        "Calls" to Icons.Default.Call, 
        "Events" to Icons.Default.Event,
        "Profile" to Icons.Default.Person
    )

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { index, pair ->
                    NavigationBarItem(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        icon = { Icon(pair.second, contentDescription = pair.first) },
                        label = { Text(pair.first) }
                    )
                }
            }
        }
    ) { paddingValues ->
        val modifier = Modifier.padding(paddingValues)
        when (selectedTab) {
            0 -> InboxScreen(modifier = modifier, onChatClick = onNavigateToChat)
            1 -> CallsScreen(modifier = modifier)
            2 -> EventsListScreen(modifier = modifier, onEventClick = {}) 
            3 -> ProfileScreen(modifier = modifier, onLogout = onLogout)
        }
    }
}
