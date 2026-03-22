package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun FaceMatchScreen(
    idCardBitmap: Bitmap,
    selfieBitmap: Bitmap,
    onMatchSuccess: (Float) -> Unit,
    onMatchFail: () -> Unit,
    onRetry: () -> Unit
) {
    var isProcessing by remember { mutableStateOf(true) }
    var result by remember { mutableStateOf<FaceVerifier.VerificationResult?>(null) }
    val coroutineScope = rememberCoroutineScope()

    // Run REAL face verification
    LaunchedEffect(Unit) {
        coroutineScope.launch {
            val verifyResult = FaceVerifier.verifyFaces(idCardBitmap, selfieBitmap)
            result = verifyResult
            isProcessing = false
            Log.d("FaceMatch", "Verification result: score=${verifyResult.score}, " +
                    "idFace=${verifyResult.idFaceDetected}, selfieFace=${verifyResult.selfieFaceDetected}")
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Header
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    "🔍 Verificare Facială",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Pasul 4 din 4 — Comparăm fața din buletin cu selfie-ul",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
                LinearProgressIndicator(
                    progress = 1f,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Side by side images
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Card(
                    modifier = Modifier
                        .weight(1f)
                        .aspectRatio(0.75f)
                ) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        Image(
                            bitmap = idCardBitmap.asImageBitmap(),
                            contentDescription = "Buletin",
                            modifier = Modifier.fillMaxSize()
                        )
                        Text(
                            "🪪 Buletin",
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .background(Color.Black.copy(alpha = 0.6f))
                                .fillMaxWidth()
                                .padding(4.dp),
                            color = Color.White,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                }
                Card(
                    modifier = Modifier
                        .weight(1f)
                        .aspectRatio(0.75f)
                ) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        Image(
                            bitmap = selfieBitmap.asImageBitmap(),
                            contentDescription = "Selfie",
                            modifier = Modifier.fillMaxSize()
                        )
                        Text(
                            "🤳 Selfie",
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .background(Color.Black.copy(alpha = 0.6f))
                                .fillMaxWidth()
                                .padding(4.dp),
                            color = Color.White,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Status
            if (isProcessing) {
                CircularProgressIndicator(modifier = Modifier.size(48.dp))
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    "Analizăm și comparăm fețele...\nDetecție + Verificare identitate",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                val r = result!!
                if (r.errorMessage != null) {
                    Text(
                        "❌ ${r.errorMessage}",
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyMedium
                    )
                } else {
                    val isPass = r.score >= 0.55f

                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (isPass)
                                Color(0xFF1B5E20).copy(alpha = 0.15f)
                            else
                                Color(0xFFB71C1C).copy(alpha = 0.15f)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                if (isPass) "✅ Verificare reușită!" else "❌ Persoane diferite detectate!",
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isPass) Color(0xFF4CAF50) else Color(0xFFF44336)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                "Scor similaritate: ${(r.score * 100).toInt()}%",
                                style = MaterialTheme.typography.bodyMedium
                            )
                            if (!isPass) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    "⚠️ Fața din buletin NU corespunde cu selfie-ul.\nTrebuie să fie aceeași persoană!",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color(0xFFF44336).copy(alpha = 0.8f),
                                    textAlign = TextAlign.Center
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                "Fața buletin: ${if (r.idFaceDetected) "✅ detectată" else "❌ nedetectată"}\n" +
                                        "Fața selfie: ${if (r.selfieFaceDetected) "✅ detectată" else "❌ nedetectată"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }
        }

        // Bottom buttons
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 8.dp
        ) {
            val r = result
            if (!isProcessing && r != null) {
                if (r.errorMessage != null || r.score < 0.55f) {
                    // Fail — retry
                    Button(
                        onClick = onRetry,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("🔄 Refă pozele", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    }
                } else {
                    // Pass — submit
                    Button(
                        onClick = { onMatchSuccess(r.score) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF4CAF50)
                        )
                    ) {
                        Text("✅ Trimite cererea", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
