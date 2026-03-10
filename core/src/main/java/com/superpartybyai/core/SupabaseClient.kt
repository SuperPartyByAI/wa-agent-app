package com.superpartybyai.core

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.storage.Storage

object SupabaseClient {
    val PROJECT_URL get() = AppConfig.SUPABASE_URL
    val ANON_KEY get() = AppConfig.SUPABASE_ANON_KEY

    val client = createSupabaseClient(
        supabaseUrl = PROJECT_URL,
        supabaseKey = ANON_KEY
    ) {
        install(Auth)
        install(Postgrest)
        install(Realtime)
        install(Storage)
    }
}
