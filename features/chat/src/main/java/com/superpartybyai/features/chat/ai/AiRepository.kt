package com.superpartybyai.features.chat.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import android.util.Log

class AiRepository {
    private val jsonParser = Json { ignoreUnknownKeys = true }

    suspend fun fetchSchema(conversationId: String): List<AiSchemaNode> = withContext(Dispatchers.IO) {
        try {
            val url = URL("http://91.98.16.90:3000/api/ai/conversation/$conversationId/schema")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")
            
            if (conn.responseCode in 200..299) {
                val responseString = conn.inputStream.bufferedReader().use { it.readText() }
                return@withContext jsonParser.decodeFromString<List<AiSchemaNode>>(responseString)
            } else {
                Log.e("AiRepository", "HTTP fetch error: ${conn.responseCode}")
                return@withContext emptyList()
            }
        } catch (e: Exception) {
            Log.e("AiRepository", "Fetch exception: ${e.message}", e)
            emptyList()
        }
    }
}
