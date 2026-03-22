package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.time.Duration.Companion.seconds

enum class OnboardingStep { CONTRACT, ID_CARD, LIVENESS, FACE_MATCH, UPLOADING, PENDING }

@Composable
fun OnboardingFlow(onComplete: () -> Unit) {
    var step by remember { mutableStateOf(OnboardingStep.CONTRACT) }
    var contractBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var idCardBitmap by remember { mutableStateOf<Bitmap?>(null) }

    var livenessCenterBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var livenessLeftBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var livenessRightBitmap by remember { mutableStateOf<Bitmap?>(null) }
    val coroutineScope = rememberCoroutineScope()

    when (step) {
        OnboardingStep.CONTRACT -> {
            ContractScreen(
                onContractSigned = { bitmap ->
                    contractBitmap = bitmap
                    step = OnboardingStep.ID_CARD
                }
            )
        }

        OnboardingStep.ID_CARD -> {
            IdCardCaptureScreen(
                onPhotoCaptured = { bitmap ->
                    idCardBitmap = bitmap
                    step = OnboardingStep.LIVENESS
                }
            )
        }

        OnboardingStep.LIVENESS -> {
            LivenessCheckScreen(
                onLivenessComplete = { center, left, right ->
                    livenessCenterBitmap = center
                    livenessLeftBitmap = left
                    livenessRightBitmap = right
                    step = OnboardingStep.FACE_MATCH
                },
                onCancel = { step = OnboardingStep.ID_CARD }
            )
        }

        OnboardingStep.FACE_MATCH -> {
            FaceMatchScreen(
                idCardBitmap = idCardBitmap!!,
                selfieBitmap = livenessCenterBitmap!!,
                onMatchSuccess = { score ->
                    step = OnboardingStep.UPLOADING
                    coroutineScope.launch {
                        uploadKycData(
                            contractBitmap = contractBitmap!!,
                            idCardBitmap = idCardBitmap!!,
                            selfieBitmap = livenessCenterBitmap!!,
                            faceMatchScore = score,
                            onDone = { step = OnboardingStep.PENDING }
                        )
                    }
                },
                onMatchFail = { step = OnboardingStep.LIVENESS },
                onRetry = { step = OnboardingStep.ID_CARD }
            )
        }

        OnboardingStep.UPLOADING -> {
            UploadingScreen()
        }

        OnboardingStep.PENDING -> {
            PendingApprovalScreen()
        }
    }
}

@Composable
private fun UploadingScreen() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(48.dp)
            )
            Spacer(
                modifier = Modifier.height(16.dp)
            )
            Text(
                "Se încarcă datele tale...\nTe rugăm așteaptă",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyLarge
            )
        }
    }
}

private suspend fun uploadKycData(
    contractBitmap: Bitmap,
    idCardBitmap: Bitmap,
    selfieBitmap: Bitmap,
    faceMatchScore: Float,
    onDone: () -> Unit
) {
    try {
        val client = SupabaseClient.client
        val userId = client.auth.currentUserOrNull()?.id ?: "unknown"
        val email = client.auth.currentUserOrNull()?.email ?: ""
        val fullName = client.auth.currentUserOrNull()?.userMetadata?.get("full_name")?.toString()?.replace("\"", "") ?: ""

        val bucket = client.storage.from("employee-kyc")

        // Upload contract
        val contractBytes = bitmapToBytes(contractBitmap)
        withContext(Dispatchers.IO) {
            bucket.upload("$userId/contract.png", contractBytes, upsert = true)
        }

        // Upload ID card
        val idCardBytes = bitmapToBytes(idCardBitmap)
        withContext(Dispatchers.IO) {
            bucket.upload("$userId/id_card.jpg", idCardBytes, upsert = true)
        }

        // Upload selfie
        val selfieBytes = bitmapToBytes(selfieBitmap)
        withContext(Dispatchers.IO) {
            bucket.upload("$userId/selfie.jpg", selfieBytes, upsert = true)
        }

        // Create signed URLs (valid for 1 year)
        val contractUrl = bucket.createSignedUrl("$userId/contract.png", 31536000.seconds)
        val idCardUrl = bucket.createSignedUrl("$userId/id_card.jpg", 31536000.seconds)
        val selfieUrl = bucket.createSignedUrl("$userId/selfie.jpg", 31536000.seconds)

        // Insert employee profile
        client.postgrest.from("employee_profiles").insert(
            mapOf(
                "user_id" to userId,
                "email" to email,
                "full_name" to fullName,
                "id_card_url" to idCardUrl,
                "selfie_url" to selfieUrl,
                "contract_url" to contractUrl,
                "face_match_score" to faceMatchScore,
                "status" to "pending"
            )
        )

        Log.d("KYC", "✅ KYC data uploaded for $userId ($email)")
        onDone()
    } catch (e: Exception) {
        Log.e("KYC", "❌ Upload failed", e)
        // Still show pending screen even if upload partially failed
        onDone()
    }
}

private fun bitmapToBytes(bitmap: Bitmap): ByteArray {
    val stream = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, stream)
    return stream.toByteArray()
}
