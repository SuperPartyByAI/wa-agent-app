package com.superpartybyai.features.chat.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import java.net.HttpURLConnection
import java.net.URL
import android.util.Log

@Serializable
data class AiSchemaResponse(
    val layout: List<AiSchemaNode> = emptyList()
)

@Serializable
private data class PromptRequest(
    val conversation_id: String,
    val prompt_text: String,
    val created_by: String = "operator"
)

@Serializable
private data class ReplyApproveRequest(
    val conversation_id: String,
    val reply_text: String
)

class AiRepository {
    private val jsonParser = Json { ignoreUnknownKeys = true }
    private val jsonEncoder = Json { encodeDefaults = true }
    private val baseUrl = "http://91.98.16.90:3000"

    /**
     * Fetches the AI-generated UI schema for a conversation from the ManagerAi API.
     */
    suspend fun fetchSchema(conversationId: String): List<AiSchemaNode> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$baseUrl/api/ai/conversation/$conversationId/schema")
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
     * Sends an operator prompt/instruction to the AI for re-processing.
     * The AI will regenerate the analysis + suggested reply based on this instruction.
     */
    suspend fun sendPrompt(conversationId: String, promptText: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = URL("$baseUrl/api/ai/prompt")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 30000  // longer timeout — triggers LLM re-processing
            conn.doOutput = true
            
            val body = jsonEncoder.encodeToString(PromptRequest(conversationId, promptText))
            conn.outputStream.use { os ->
                os.write(body.toByteArray(Charsets.UTF_8))
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

    /**
     * Tells the server to send the reply text to the client via WhatsApp.
     * The operator approves — AI does NOT send automatically.
     */
    suspend fun approveReply(conversationId: String, replyText: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = URL("$baseUrl/api/ai/reply/approve")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            
            val body = jsonEncoder.encodeToString(ReplyApproveRequest(conversationId, replyText))
            conn.outputStream.use { os ->
                os.write(body.toByteArray(Charsets.UTF_8))
            }
            
            val success = conn.responseCode in 200..299
            if (!success) {
                Log.e("AiRepository", "Reply approve error: HTTP ${conn.responseCode}")
            }
            return@withContext success
        } catch (e: Exception) {
            Log.e("AiRepository", "Reply approve exception: ${e.message}", e)
            false
        }
    }
}
