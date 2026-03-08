package com.superpartybyai.core

/**
 * Global application configuration bridging the dynamic BuildConfig variables
 * injected from `local.properties` securely out of the versioned source code.
 */
object AppConfig {
    var SUPABASE_URL: String = ""
    var SUPABASE_ANON_KEY: String = ""
    var WEB_CLIENT_ID: String = ""
    var BACKEND_URL: String = "http://10.0.2.2:3000"
}
