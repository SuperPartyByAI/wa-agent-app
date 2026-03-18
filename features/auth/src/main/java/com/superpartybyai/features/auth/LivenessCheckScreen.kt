package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Log
import android.util.Size
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

private const val TAG = "LivenessCheck"

enum class LivenessPhase {
    CENTER,     // Look straight at camera
    TURN_LEFT,  // Turn head left
    TURN_RIGHT, // Turn head right
    COMPLETED   // All checks passed
}

/**
 * Liveness verification screen that asks the user to turn their head left and right.
 * Uses ML Kit Face Detection's headEulerAngleY to detect head rotation.
 * Captures a photo at each phase for Gemini verification.
 */
@Composable
fun LivenessCheckScreen(
    onLivenessComplete: (centerBitmap: Bitmap, leftBitmap: Bitmap, rightBitmap: Bitmap) -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var phase by remember { mutableStateOf(LivenessPhase.CENTER) }
    var centerBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var leftBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var rightBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var faceDetected by remember { mutableStateOf(false) }
    var headAngleY by remember { mutableFloatStateOf(0f) }
    var statusText by remember { mutableStateOf("Poziționează fața în centru") }
    var holdTimer by remember { mutableIntStateOf(0) }

    // Thresholds for head rotation
    val centerThreshold = 10f     // Within ±10° = looking straight
    val turnThreshold = 25f       // Must turn at least 25° for left/right
    val holdRequired = 5          // Hold position for ~5 frames (~1 second)

    val previewView = remember { PreviewView(context) }
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    // Face detector with head pose
    val faceDetector = remember {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
            .setMinFaceSize(0.3f)
            .build()
        FaceDetection.getClient(options)
    }

    // Camera setup
    LaunchedEffect(Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            cameraProvider.unbindAll()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(640, 480))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { analysis ->
                    analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        if (phase == LivenessPhase.COMPLETED) {
                            imageProxy.close()
                            return@setAnalyzer
                        }

                        @androidx.annotation.OptIn(ExperimentalGetImage::class)
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val inputImage = InputImage.fromMediaImage(
                                mediaImage,
                                imageProxy.imageInfo.rotationDegrees
                            )

                            faceDetector.process(inputImage)
                                .addOnSuccessListener { faces ->
                                    if (faces.isNotEmpty()) {
                                        val face = faces[0]
                                        faceDetected = true
                                        headAngleY = face.headEulerAngleY // Left/right angle

                                        when (phase) {
                                            LivenessPhase.CENTER -> {
                                                if (Math.abs(headAngleY) < centerThreshold) {
                                                    holdTimer++
                                                    statusText = "Bine! Stai drept... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        centerBitmap = imageProxyToBitmap(imageProxy)
                                                        Log.d(TAG, "✅ CENTER captured, angle=$headAngleY")
                                                        phase = LivenessPhase.TURN_LEFT
                                                        holdTimer = 0
                                                        statusText = "⬅️ Întoarce capul la STÂNGA"
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    statusText = "Privește drept la cameră"
                                                }
                                            }
                                            LivenessPhase.TURN_LEFT -> {
                                                if (headAngleY > turnThreshold) {
                                                    holdTimer++
                                                    statusText = "Menține... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        leftBitmap = imageProxyToBitmap(imageProxy)
                                                        Log.d(TAG, "✅ LEFT captured, angle=$headAngleY")
                                                        phase = LivenessPhase.TURN_RIGHT
                                                        holdTimer = 0
                                                        statusText = "➡️ Întoarce capul la DREAPTA"
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    if (headAngleY > 10f) {
                                                        statusText = "Mai mult la stânga..."
                                                    } else {
                                                        statusText = "⬅️ Întoarce capul la STÂNGA"
                                                    }
                                                }
                                            }
                                            LivenessPhase.TURN_RIGHT -> {
                                                if (headAngleY < -turnThreshold) {
                                                    holdTimer++
                                                    statusText = "Menține... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        rightBitmap = imageProxyToBitmap(imageProxy)
                                                        Log.d(TAG, "✅ RIGHT captured, angle=$headAngleY")
                                                        phase = LivenessPhase.COMPLETED
                                                        statusText = "✅ Verificare liveness completă!"
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    if (headAngleY < -10f) {
                                                        statusText = "Mai mult la dreapta..."
                                                    } else {
                                                        statusText = "➡️ Întoarce capul la DREAPTA"
                                                    }
                                                }
                                            }
                                            LivenessPhase.COMPLETED -> {}
                                        }
                                    } else {
                                        faceDetected = false
                                        holdTimer = 0
                                        statusText = "Nu detectez fața — privește camera"
                                    }
                                }
                                .addOnFailureListener {
                                    Log.e(TAG, "Face detection failed", it)
                                }
                                .addOnCompleteListener {
                                    imageProxy.close()
                                }
                        } else {
                            imageProxy.close()
                        }
                    }
                }

            try {
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    preview,
                    imageAnalysis
                )
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    // Trigger callback when liveness is completed
    LaunchedEffect(phase) {
        if (phase == LivenessPhase.COMPLETED && centerBitmap != null && leftBitmap != null && rightBitmap != null) {
            kotlinx.coroutines.delay(1000) // Brief pause to show success
            onLivenessComplete(centerBitmap!!, leftBitmap!!, rightBitmap!!)
        }
    }

    // UI
    Column(
        modifier = Modifier.fillMaxSize().background(Color(0xFF121212)),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF6C3AE0))
                .padding(16.dp)
        ) {
            Text(
                "🔐 Verificare Liveness",
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                "Pasul 3.5 din 4 — Dovedește că ești o persoană reală",
                color = Color.White.copy(alpha = 0.8f),
                fontSize = 13.sp
            )
            // Progress
            Spacer(modifier = Modifier.height(8.dp))
            val progress = when (phase) {
                LivenessPhase.CENTER -> 0.2f
                LivenessPhase.TURN_LEFT -> 0.5f
                LivenessPhase.TURN_RIGHT -> 0.8f
                LivenessPhase.COMPLETED -> 1.0f
            }
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(4.dp),
                color = Color(0xFF00E676),
                trackColor = Color.White.copy(alpha = 0.3f)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Status text
        Text(
            statusText,
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp)
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Head angle indicator
        if (faceDetected) {
            Text(
                "Unghi cap: ${String.format("%.1f", headAngleY)}°",
                color = Color.Gray,
                fontSize = 12.sp
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Camera preview
        Box(
            modifier = Modifier
                .size(300.dp)
                .clip(RoundedCornerShape(150.dp))
                .background(Color.DarkGray),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(
                factory = { previewView },
                modifier = Modifier.fillMaxSize()
            )

            // Phase indicators at top
            if (!faceDetected) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Red.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center
                ) {
                    Text("❌ No face", color = Color.White, fontSize = 18.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Step indicators
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(horizontal = 24.dp)
        ) {
            StepIndicator("Centru", phase.ordinal >= 1 || (phase == LivenessPhase.CENTER && holdTimer > 0), phase.ordinal >= 1)
            StepIndicator("Stânga", phase.ordinal >= 2, phase.ordinal >= 2)
            StepIndicator("Dreapta", phase.ordinal >= 3, phase.ordinal >= 3)
        }

        Spacer(modifier = Modifier.weight(1f))

        // Cancel button
        TextButton(
            onClick = onCancel,
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Text("↩ Înapoi la selfie", color = Color.Gray, fontSize = 14.sp)
        }
    }
}

@Composable
private fun StepIndicator(label: String, active: Boolean, completed: Boolean) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(
                    when {
                        completed -> Color(0xFF00E676)
                        active -> Color(0xFFFFC107)
                        else -> Color.DarkGray
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                if (completed) "✓" else "○",
                color = Color.White,
                fontSize = 20.sp
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(label, color = if (active || completed) Color.White else Color.Gray, fontSize = 12.sp)
    }
}

/**
 * Convert ImageProxy (YUV) to Bitmap.
 */
private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap {
    val yBuffer = imageProxy.planes[0].buffer
    val uBuffer = imageProxy.planes[1].buffer
    val vBuffer = imageProxy.planes[2].buffer

    val ySize = yBuffer.remaining()
    val uSize = uBuffer.remaining()
    val vSize = vBuffer.remaining()

    val nv21 = ByteArray(ySize + uSize + vSize)
    yBuffer.get(nv21, 0, ySize)
    vBuffer.get(nv21, ySize, vSize)
    uBuffer.get(nv21, ySize + vSize, uSize)

    val yuvImage = YuvImage(nv21, ImageFormat.NV21, imageProxy.width, imageProxy.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, imageProxy.width, imageProxy.height), 80, out)
    val bytes = out.toByteArray()
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

    // Mirror for front camera + apply rotation
    val matrix = Matrix()
    matrix.postRotate(imageProxy.imageInfo.rotationDegrees.toFloat())
    matrix.postScale(-1f, 1f) // Mirror front camera

    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}
