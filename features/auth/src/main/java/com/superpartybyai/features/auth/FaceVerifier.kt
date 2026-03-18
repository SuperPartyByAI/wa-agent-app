package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.tasks.await
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Real face verification using ML Kit face detection + pixel-level face comparison.
 * 
 * Step 1: Detect face in both images using ML Kit
 * Step 2: Crop face region from both images
 * Step 3: Resize both cropped faces to 112x112
 * Step 4: Compare faces using normalized pixel comparison across face zones
 * Step 5: Return similarity score (0.0 to 1.0)
 * 
 * Score thresholds:
 *   > 0.70 = Same person (PASS)
 *   0.50-0.70 = Uncertain (manual review)
 *   < 0.50 = Different person (FAIL)
 */
object FaceVerifier {

    private const val FACE_SIZE = 112
    private const val TAG = "FaceVerifier"

    data class VerificationResult(
        val score: Float,
        val idFaceDetected: Boolean,
        val selfieFaceDetected: Boolean,
        val errorMessage: String? = null
    )

    suspend fun verifyFaces(idCardBitmap: Bitmap, selfieBitmap: Bitmap): VerificationResult {
        try {
            val options = FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_ALL)
                .setMinFaceSize(0.1f)
                .build()

            val detector = FaceDetection.getClient(options)

            // Detect faces
            val idFaces = detector.process(InputImage.fromBitmap(idCardBitmap, 0)).await()
            val selfieFaces = detector.process(InputImage.fromBitmap(selfieBitmap, 0)).await()

            if (idFaces.isEmpty()) {
                return VerificationResult(0f, false, selfieFaces.isNotEmpty(),
                    "Nu am detectat o față pe buletin. Asigură-te că poza e clară.")
            }
            if (selfieFaces.isEmpty()) {
                return VerificationResult(0f, true, false,
                    "Nu am detectat fața ta în selfie. Încearcă cu lumină bună.")
            }

            // Get largest face from each
            val idFace = idFaces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }!!
            val selfieFace = selfieFaces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }!!

            // Crop face regions with some padding
            val idCropped = cropFace(idCardBitmap, idFace.boundingBox)
            val selfieCropped = cropFace(selfieBitmap, selfieFace.boundingBox)

            if (idCropped == null || selfieCropped == null) {
                return VerificationResult(0f, true, true,
                    "Eroare la croparea feței.")
            }

            // Resize both to same size
            val idResized = Bitmap.createScaledBitmap(idCropped, FACE_SIZE, FACE_SIZE, true)
            val selfieResized = Bitmap.createScaledBitmap(selfieCropped, FACE_SIZE, FACE_SIZE, true)

            // Compare faces using multiple metrics
            val histogramScore = compareHistograms(idResized, selfieResized)
            val structuralScore = compareStructural(idResized, selfieResized)
            val zoneScore = compareZones(idResized, selfieResized)

            // Weighted combination
            val finalScore = (histogramScore * 0.3f + structuralScore * 0.4f + zoneScore * 0.3f)

            Log.d(TAG, "Histogram: $histogramScore, Structural: $structuralScore, Zones: $zoneScore → Final: $finalScore")

            idCropped.recycle()
            selfieCropped.recycle()
            idResized.recycle()
            selfieResized.recycle()

            return VerificationResult(finalScore, true, true)

        } catch (e: Exception) {
            Log.e(TAG, "Face verification error", e)
            return VerificationResult(0f, false, false,
                "Eroare la procesare: ${e.message}")
        }
    }

    private fun cropFace(bitmap: Bitmap, faceRect: Rect): Bitmap? {
        // Add 30% padding around face
        val padX = (faceRect.width() * 0.3f).toInt()
        val padY = (faceRect.height() * 0.3f).toInt()
        val left = max(0, faceRect.left - padX)
        val top = max(0, faceRect.top - padY)
        val right = min(bitmap.width, faceRect.right + padX)
        val bottom = min(bitmap.height, faceRect.bottom + padY)
        val width = right - left
        val height = bottom - top

        return if (width > 0 && height > 0) {
            Bitmap.createBitmap(bitmap, left, top, width, height)
        } else null
    }

    /**
     * Compare color histograms of two face images.
     * Similar skin tones and color distributions indicate same person.
     */
    private fun compareHistograms(a: Bitmap, b: Bitmap): Float {
        val binsR = IntArray(32)
        val binsG = IntArray(32)
        val binsB = IntArray(32)
        val binsR2 = IntArray(32)
        val binsG2 = IntArray(32)
        val binsB2 = IntArray(32)

        for (y in 0 until FACE_SIZE) {
            for (x in 0 until FACE_SIZE) {
                val pA = a.getPixel(x, y)
                val pB = b.getPixel(x, y)
                binsR[Color.red(pA) / 8]++
                binsG[Color.green(pA) / 8]++
                binsB[Color.blue(pA) / 8]++
                binsR2[Color.red(pB) / 8]++
                binsG2[Color.green(pB) / 8]++
                binsB2[Color.blue(pB) / 8]++
            }
        }

        // Bhattacharyya coefficient
        val total = (FACE_SIZE * FACE_SIZE).toFloat()
        var scoreR = 0f
        var scoreG = 0f
        var scoreB = 0f
        for (i in 0 until 32) {
            scoreR += sqrt((binsR[i] / total) * (binsR2[i] / total))
            scoreG += sqrt((binsG[i] / total) * (binsG2[i] / total))
            scoreB += sqrt((binsB[i] / total) * (binsB2[i] / total))
        }
        return (scoreR + scoreG + scoreB) / 3f
    }

    /**
     * Structural comparison: compare normalized luminance patterns.
     * Measures how similar the facial structure (shadows, highlights) looks.
     */
    private fun compareStructural(a: Bitmap, b: Bitmap): Float {
        var sumDiff = 0.0
        var count = 0

        // Compare in 8x8 blocks (like DCT)
        val blockSize = FACE_SIZE / 8
        for (by in 0 until 8) {
            for (bx in 0 until 8) {
                var avgA = 0f
                var avgB = 0f
                var blockCount = 0
                for (y in by * blockSize until (by + 1) * blockSize) {
                    for (x in bx * blockSize until (bx + 1) * blockSize) {
                        val pA = a.getPixel(x, y)
                        val pB = b.getPixel(x, y)
                        // Luminance
                        avgA += 0.299f * Color.red(pA) + 0.587f * Color.green(pA) + 0.114f * Color.blue(pA)
                        avgB += 0.299f * Color.red(pB) + 0.587f * Color.green(pB) + 0.114f * Color.blue(pB)
                        blockCount++
                    }
                }
                avgA /= blockCount
                avgB /= blockCount
                sumDiff += abs(avgA - avgB).toDouble()
                count++
            }
        }

        // Normalize: max difference per block is 255
        val avgDiff = sumDiff / count
        return max(0f, 1f - (avgDiff / 128f).toFloat())
    }

    /**
     * Zone-based comparison: compare specific facial zones
     * (forehead, left eye, right eye, nose, mouth, chin)
     * using pixel-level correlation.
     */
    private fun compareZones(a: Bitmap, b: Bitmap): Float {
        // Define face zones as fractions of the face area
        data class Zone(val name: String, val xStart: Float, val yStart: Float, val xEnd: Float, val yEnd: Float, val weight: Float)

        val zones = listOf(
            Zone("forehead", 0.2f, 0.0f, 0.8f, 0.25f, 0.15f),
            Zone("left_eye", 0.1f, 0.25f, 0.45f, 0.45f, 0.2f),
            Zone("right_eye", 0.55f, 0.25f, 0.9f, 0.45f, 0.2f),
            Zone("nose", 0.3f, 0.4f, 0.7f, 0.65f, 0.2f),
            Zone("mouth", 0.25f, 0.6f, 0.75f, 0.8f, 0.15f),
            Zone("chin", 0.3f, 0.8f, 0.7f, 1.0f, 0.1f)
        )

        var totalScore = 0f
        for (zone in zones) {
            val x1 = (zone.xStart * FACE_SIZE).toInt()
            val y1 = (zone.yStart * FACE_SIZE).toInt()
            val x2 = min(FACE_SIZE - 1, (zone.xEnd * FACE_SIZE).toInt())
            val y2 = min(FACE_SIZE - 1, (zone.yEnd * FACE_SIZE).toInt())

            var zoneDiff = 0f
            var zoneCount = 0
            for (y in y1..y2) {
                for (x in x1..x2) {
                    val pA = a.getPixel(x, y)
                    val pB = b.getPixel(x, y)
                    val lumA = 0.299f * Color.red(pA) + 0.587f * Color.green(pA) + 0.114f * Color.blue(pA)
                    val lumB = 0.299f * Color.red(pB) + 0.587f * Color.green(pB) + 0.114f * Color.blue(pB)
                    zoneDiff += abs(lumA - lumB)
                    zoneCount++
                }
            }
            val avgDiff = if (zoneCount > 0) zoneDiff / zoneCount else 0f
            val zoneScore = max(0f, 1f - (avgDiff / 100f))
            totalScore += zoneScore * zone.weight
        }

        return totalScore
    }
}
