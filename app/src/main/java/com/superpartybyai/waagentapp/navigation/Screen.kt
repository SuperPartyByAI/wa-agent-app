package com.superpartybyai.waagentapp.navigation

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Main : Screen("main")
    object Conversation : Screen("conversation/{contactId}") {
        fun createRoute(contactId: String) = "conversation/$contactId"
    }
}
