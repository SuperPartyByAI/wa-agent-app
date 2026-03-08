package com.superpartybyai.core

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime

object SupabaseClient {
    const val PROJECT_URL = "https://jrfhprnuxxfwkwjwdsez.supabase.co"
    const val ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZmhwcm51eHhmd2t3andkc2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDIyMzIsImV4cCI6MjA4ODU3ODIzMn0.j44ZGUd0PQDfKB0rgsdayJG--lThgnHxHNlqXgd7UK4"

    val client = createSupabaseClient(
        supabaseUrl = PROJECT_URL,
        supabaseKey = ANON_KEY
    ) {
        install(Auth)
        install(Postgrest)
        install(Realtime)
    }
}
