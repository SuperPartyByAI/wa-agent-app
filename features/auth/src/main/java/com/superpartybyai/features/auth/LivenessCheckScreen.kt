package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
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
import java.io.File
import java.util.concurrent.Executors

private const val TAG = "LivenessCheck"

enum class LivenessPhase {
    CENTER,
    CAPTURING_CENTER,
    DIRECTION_1,       // First direction (randomized: left or right)
    CAPTURING_DIR1,
    DIRECTION_2,       // Second direction (opposite of first)
    CAPTURING_DIR2,
    BLINK,             // Blink detection
    COMPLETED
}

/**
 * Liveness verification screen with:
 * - Randomized head turn order (sometimes left-right, sometimes right-left)
 * - Blink detection ("clipește de 3 ori")
 * - ML Kit face detection for head pose and eye classification
 * - ImageCapture for high-quality photos
 */
@Composable
fun LivenessCheckScreen(
    onLivenessComplete: (centerBitmap: Bitmap, leftBitmap: Bitmap, rightBitmap: Bitmap) -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Randomize direction order at start
    val startWithLeft = remember { Math.random() > 0.5 }

    var phase by remember { mutableStateOf(LivenessPhase.CENTER) }
    var centerBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var dir1Bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var dir2Bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var faceDetected by remember { mutableStateOf(false) }
    var headAngleY by remember { mutableFloatStateOf(0f) }
    var statusText by remember { mutableStateOf("Poziționează fața în centru") }
    var holdTimer by remember { mutableIntStateOf(0) }

    // Blink detection state
    var blinkCount by remember { mutableIntStateOf(0) }
    var eyesWereClosed by remember { mutableStateOf(false) }
    val requiredBlinks = 3

    val centerThreshold = 10f
    val turnThreshold = 25f
    val holdRequired = 8
    val eyeOpenThreshold = 0.3f  // Below this = eyes closed

    val dir1Label = if (startWithLeft) "STÂNGA" else "DREAPTA"
    val dir2Label = if (startWithLeft) "DREAPTA" else "STÂNGA"
    val dir1Emoji = if (startWithLeft) "⬅️" else "➡️"
    val dir2Emoji = if (startWithLeft) "➡️" else "⬅️"

    val previewView = remember { PreviewView(context) }
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    val imageCapture = remember {
        ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .build()
    }

    // Face detector WITH classification (for eye open probability)
    val faceDetector = remember {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL) // Enables eye open detection
            .setMinFaceSize(0.3f)
            .build()
        FaceDetection.getClient(options)
    }

    fun takePicture(onPhotoTaken: (Bitmap) -> Unit) {
        val photoFile = File(context.cacheDir, "liveness_${System.currentTimeMillis()}.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath)
                    if (bitmap != null) {
                        val matrix = Matrix()
                        matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
                        val mirrored = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                        Log.d(TAG, "✅ Photo captured: ${mirrored.width}x${mirrored.height}")
                        onPhotoTaken(mirrored)
                    }
                    photoFile.delete()
                }
                override fun onError(e: ImageCaptureException) {
                    Log.e(TAG, "❌ Photo capture failed", e)
                }
            }
        )
    }

    fun isCorrectDirection(angle: Float, isFirstDir: Boolean): Boolean {
        return if (startWithLeft) {
            if (isFirstDir) angle > turnThreshold else angle < -turnThreshold
        } else {
            if (isFirstDir) angle < -turnThreshold else angle > turnThreshold
        }
    }

    fun partialDirection(angle: Float, isFirstDir: Boolean): Boolean {
        return if (startWithLeft) {
            if (isFirstDir) angle > 10f else angle < -10f
        } else {
            if (isFirstDir) angle < -10f else angle > 10f
        }
    }

    // Camera setup
    LaunchedEffect(Unit) {
        Log.d(TAG, "🔀 Random order: ${if (startWithLeft) "LEFT first" else "RIGHT first"}")
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
                        if (phase == LivenessPhase.COMPLETED ||
                            phase == LivenessPhase.CAPTURING_CENTER ||
                            phase == LivenessPhase.CAPTURING_DIR1 ||
                            phase == LivenessPhase.CAPTURING_DIR2) {
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
                                        headAngleY = face.headEulerAngleY
                                        val leftEyeOpen = face.leftEyeOpenProbability ?: 1f
                                        val rightEyeOpen = face.rightEyeOpenProbability ?: 1f

                                        when (phase) {
                                            LivenessPhase.CENTER -> {
                                                if (Math.abs(headAngleY) < centerThreshold) {
                                                    holdTimer++
                                                    statusText = "Bine! Stai drept... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        phase = LivenessPhase.CAPTURING_CENTER
                                                        statusText = "📸 Capturare..."
                                                        holdTimer = 0
                                                        takePicture { bmp ->
                                                            centerBitmap = bmp
                                                            Log.d(TAG, "✅ CENTER done")
                                                            phase = LivenessPhase.DIRECTION_1
                                                            statusText = "$dir1Emoji Întoarce capul la $dir1Label"
                                                        }
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    statusText = "Privește drept la cameră"
                                                }
                                            }
                                            LivenessPhase.DIRECTION_1 -> {
                                                if (isCorrectDirection(headAngleY, true)) {
                                                    holdTimer++
                                                    statusText = "Menține... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        phase = LivenessPhase.CAPTURING_DIR1
                                                        statusText = "📸 Capturare..."
                                                        holdTimer = 0
                                                        takePicture { bmp ->
                                                            dir1Bitmap = bmp
                                                            Log.d(TAG, "✅ DIR1 done")
                                                            phase = LivenessPhase.DIRECTION_2
                                                            statusText = "$dir2Emoji Întoarce capul la $dir2Label"
                                                        }
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    statusText = if (partialDirection(headAngleY, true)) {
                                                        "Mai mult la $dir1Label..."
                                                    } else {
                                                        "$dir1Emoji Întoarce capul la $dir1Label"
                                                    }
                                                }
                                            }
                                            LivenessPhase.DIRECTION_2 -> {
                                                if (isCorrectDirection(headAngleY, false)) {
                                                    holdTimer++
                                                    statusText = "Menține... (${holdRequired - holdTimer})"
                                                    if (holdTimer >= holdRequired) {
                                                        phase = LivenessPhase.CAPTURING_DIR2
                                                        statusText = "📸 Capturare..."
                                                        holdTimer = 0
                                                        takePicture { bmp ->
                                                            dir2Bitmap = bmp
                                                            Log.d(TAG, "✅ DIR2 done")
                                                            phase = LivenessPhase.BLINK
                                                            blinkCount = 0
                                                            statusText = "👁️ Clipește de $requiredBlinks ori! (0/$requiredBlinks)"
                                                        }
                                                    }
                                                } else {
                                                    holdTimer = 0
                                                    statusText = if (partialDirection(headAngleY, false)) {
                                                        "Mai mult la $dir2Label..."
                                                    } else {
                                                        "$dir2Emoji Întoarce capul la $dir2Label"
                                                    }
                                                }
                                            }
                                            LivenessPhase.BLINK -> {
                                                val bothEyesClosed = leftEyeOpen < eyeOpenThreshold && rightEyeOpen < eyeOpenThreshold
                                                val bothEyesOpen = leftEyeOpen > 0.7f && rightEyeOpen > 0.7f

                                                if (bothEyesClosed && !eyesWereClosed) {
                                                    eyesWereClosed = true
                                                } else if (bothEyesOpen && eyesWereClosed) {
                                                    // Blink completed (closed -> open)
                                                    eyesWereClosed = false
                                                    blinkCount++
                                                    Log.d(TAG, "👁️ Blink detected! Count: $blinkCount")

                                                    if (blinkCount >= requiredBlinks) {
                                                        phase = LivenessPhase.COMPLETED
                                                        statusText = "✅ Verificare completă!"
                                                    } else {
                                                        statusText = "👁️ Clipește! (${blinkCount}/$requiredBlinks)"
                                                    }
                                                }
                                            }
                                            else -> {}
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
                    imageAnalysis,
                    imageCapture
                )
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    // Trigger callback when completed
    LaunchedEffect(phase) {
        if (phase == LivenessPhase.COMPLETED && centerBitmap != null && dir1Bitmap != null && dir2Bitmap != null) {
            kotlinx.coroutines.delay(1000)
            // Return bitmaps in correct order (left, right) regardless of random order
            val leftBitmap = if (startWithLeft) dir1Bitmap!! else dir2Bitmap!!
            val rightBitmap = if (startWithLeft) dir2Bitmap!! else dir1Bitmap!!
            onLivenessComplete(centerBitmap!!, leftBitmap, rightBitmap)
        }
    }

    // UI
    Column(
        modifier = Modifier.fillMaxSize().background(Color(0xFF121212)),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
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
                "Pasul 3 din 4 — Dovedește că ești o persoană reală",
                color = Color.White.copy(alpha = 0.8f),
                fontSize = 13.sp
            )
            Spacer(modifier = Modifier.height(8.dp))
            val progress = when (phase) {
                LivenessPhase.CENTER, LivenessPhase.CAPTURING_CENTER -> 0.15f
                LivenessPhase.DIRECTION_1, LivenessPhase.CAPTURING_DIR1 -> 0.35f
                LivenessPhase.DIRECTION_2, LivenessPhase.CAPTURING_DIR2 -> 0.6f
                LivenessPhase.BLINK -> 0.85f
                LivenessPhase.COMPLETED -> 1.0f
            }
            LinearProgressIndicator(
                progress = progress,
                modifier = Modifier.fillMaxWidth().height(4.dp),
                color = Color(0xFF00E676),
                trackColor = Color.White.copy(alpha = 0.3f)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            statusText,
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp)
        )

        Spacer(modifier = Modifier.height(8.dp))

        if (faceDetected) {
            Text(
                "Unghi cap: ${String.format("%.1f", headAngleY)}°",
                color = Color.Gray,
                fontSize = 12.sp
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

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

        // Step indicators (4 steps now)
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp)
        ) {
            StepIndicator("Centru", phase.ordinal >= 1, phase.ordinal >= 2)
            StepIndicator(dir1Label.take(4), phase.ordinal >= 2, phase.ordinal >= 4)
            StepIndicator(dir2Label.take(4), phase.ordinal >= 4, phase.ordinal >= 6)
            StepIndicator("Clip.", phase.ordinal >= 6, phase.ordinal >= 7)
        }

        Spacer(modifier = Modifier.weight(1f))

        TextButton(
            onClick = onCancel,
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Text("↩ Înapoi", color = Color.Gray, fontSize = 14.sp)
        }
    }
}

@Composable
private fun StepIndicator(label: String, active: Boolean, completed: Boolean) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(18.dp))
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
                fontSize = 16.sp
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(label, color = if (active || completed) Color.White else Color.Gray, fontSize = 11.sp)
    }
}
