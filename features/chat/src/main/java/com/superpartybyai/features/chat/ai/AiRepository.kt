package com.superpartybyai.features.chat.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import android.util.Log

@Serializable
data class AiSchemaResponse(
    val layout: List<AiSchemaNode> = emptyList()
)

class AiRepository {
    private val jsonParser = Json { ignoreUnknownKeys = true }

    /**
     * Fetches the AI-generated UI schema for a conversation from the ManagerAi API.
     * The API returns { "layout": [...] } — we parse the wrapper and extract the layout array.
     */
    suspend fun fetchSchema(conversationId: String): List<AiSchemaNode> = withContext(Dispatchers.IO) {
        try {
            val url = URL("http://91.98.16.90:3000/api/ai/conversation/$conversationId/schema")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            
            if (conn.responseCode in 200..299) {
                val responseString = conn.inputStream.bufferedReader().use { it.readText() }
                val response = jsonParser.decodeFromString<AiSchemaResponse>(responseString)
                return@withContext response.layout
            } else {
                Log.e("AiRepository", "HTTP fetch error: ${conn.responseCode}")
                return@withContext emptyList()
            }
        } catch (e: Exception) {
            Log.e("AiRepository", "Fetch exception: ${e.message}", e)
            emptyList()
        }
    }

    /**
     * Sends an operator prompt/note to the AI for re-processing.
     */
    suspend fun sendPrompt(conversationId: String, promptText: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = URL("http://91.98.16.90:3000/api/ai/prompt")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            
            val jsonBody = """{"conversation_id":"$conversationId","prompt_text":"$promptText","created_by":"operator"}"""
            conn.outputStream.use { os ->
                os.write(jsonBody.toByteArray(Charsets.UTF_8))
            }
            
            val success = conn.responseCode in 200..299
            if (!success) {
                Log.e("AiRepository", "Prompt send error: HTTP ${conn.responseCode}")
            }
            return@withContext success
        } catch (e: Exception) {
            Log.e("AiRepository", "Prompt send exception: ${e.message}", e)
            false
        }
    }
}
