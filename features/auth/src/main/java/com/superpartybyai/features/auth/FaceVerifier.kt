package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import com.superpartybyai.core.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Face verification using Gemini AI Vision API (server-side).
 * 
 * Sends both images to the server endpoint /api/admin/verify-face
 * which calls Gemini Flash to verify:
 * 1. Is the ID card a real physical document?
 * 2. Is the selfie a live person (not photo of photo)?
 * 3. Are both images showing the SAME person?
 */
object FaceVerifier {

    private const val TAG = "FaceVerifier"

    data class VerificationResult(
        val score: Float,
        val idFaceDetected: Boolean,
        val selfieFaceDetected: Boolean,
        val samePerson: Boolean = false,
        val reason: String? = null,
        val errorMessage: String? = null,
        val details: Map<String, Any>? = null
    )

    suspend fun verifyFaces(idCardBitmap: Bitmap, selfieBitmap: Bitmap): VerificationResult {
        return withContext(Dispatchers.IO) {
            try {
                // Convert bitmaps to base64
                val idCardBase64 = bitmapToBase64(idCardBitmap)
                val selfieBase64 = bitmapToBase64(selfieBitmap)

                Log.d(TAG, "Sending images to Gemini AI for verification...")
                Log.d(TAG, "ID card base64 size: ${idCardBase64.length}, Selfie base64 size: ${selfieBase64.length}")

                // Call server API
                val apiUrl = "https://admin.superparty.ro/api/admin/verify-face"
                
                Log.d(TAG, "Calling API: $apiUrl")

                val connection = URL(apiUrl).openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Accept", "application/json")
                connection.connectTimeout = 30000
                connection.readTimeout = 60000  // Gemini can take time
                connection.doOutput = true

                val body = JSONObject().apply {
                    put("idCardBase64", idCardBase64)
                    put("selfieBase64", selfieBase64)
                }

                connection.outputStream.use { os ->
                    os.write(body.toString().toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                val responseCode = connection.responseCode
                Log.d(TAG, "API response code: $responseCode")

                val responseText = if (responseCode in 200..299) {
                    connection.inputStream.bufferedReader().readText()
                } else {
                    val errorText = connection.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
                    Log.e(TAG, "API error response: $errorText")
                    return@withContext VerificationResult(
                        score = 0f,
                        idFaceDetected = false,
                        selfieFaceDetected = false,
                        errorMessage = "Server error: $responseCode"
                    )
                }

                Log.d(TAG, "API response: $responseText")

                val json = JSONObject(responseText)

                if (json.has("error")) {
                    return@withContext VerificationResult(
                        score = 0f,
                        idFaceDetected = false,
                        selfieFaceDetected = false,
                        errorMessage = json.getString("error")
                    )
                }

                val verified = json.optBoolean("verified", false)
                val score = json.optDouble("score", 0.0).toFloat()
                val samePerson = json.optBoolean("same_person", false)
                val reason = json.optString("reason", "")

                // Extract details if available
                val detailsJson = json.optJSONObject("details")
                val docScore = detailsJson?.optInt("document_score", 0) ?: 0
                val liveScore = detailsJson?.optInt("liveness_score", 0) ?: 0
                val idScore = detailsJson?.optInt("identity_score", 0) ?: 0

                Log.d(TAG, "✅ Gemini verification result: verified=$verified, score=$score, samePerson=$samePerson")
                Log.d(TAG, "   Document: $docScore, Liveness: $liveScore, Identity: $idScore")

                return@withContext VerificationResult(
                    score = score,
                    idFaceDetected = docScore > 30,
                    selfieFaceDetected = liveScore > 30,
                    samePerson = samePerson,
                    reason = reason,
                    details = mapOf(
                        "document_score" to docScore,
                        "liveness_score" to liveScore,
                        "identity_score" to idScore,
                        "verified" to verified
                    )
                )

            } catch (e: Exception) {
                Log.e(TAG, "Face verification error", e)
                return@withContext VerificationResult(
                    score = 0f,
                    idFaceDetected = false,
                    selfieFaceDetected = false,
                    errorMessage = "Eroare la verificare: ${e.message}"
                )
            }
        }
    }

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val stream = ByteArrayOutputStream()
        // Compress to reasonable size for API
        val scaledBitmap = if (bitmap.width > 800 || bitmap.height > 800) {
            val scale = 800f / maxOf(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).toInt(),
                (bitmap.height * scale).toInt(),
                true
            )
        } else {
            bitmap
        }
        scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 80, stream)
        val bytes = stream.toByteArray()
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
