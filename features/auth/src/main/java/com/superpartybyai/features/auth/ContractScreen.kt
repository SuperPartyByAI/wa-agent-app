package com.superpartybyai.features.auth

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ContractScreen(onContractSigned: (Bitmap) -> Unit) {
    val scrollState = rememberScrollState()
    val lines = remember { mutableStateListOf<List<Offset>>() }
    var currentLine by remember { mutableStateOf(listOf<Offset>()) }
    var hasSigned by remember { mutableStateOf(false) }

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
                    "📝 Contract de Colaborare",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Pasul 1 din 4 — Citește și semnează",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
                // Progress bar
                LinearProgressIndicator(
                    progress = { 0.25f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                )
            }
        }

        // Scrollable contract text
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(scrollState)
                .padding(16.dp)
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Text(
                    text = """
CONTRACT DE COLABORARE — SUPERPARTY

Subsemnatul/a, prin prezenta, declar că:

1. ACCEPT să colaborez cu SUPERPARTY în calitate de ANIMATOR / OPERATOR SERVICII.

2. MĂ OBLIG să respect programul și cerințele evenimentelor alocate prin aplicație.

3. VOI PURTA costumele și echipamentele puse la dispoziție cu grijă și le voi returna în stare bună.

4. ÎNȚELEG că plata se face per eveniment, conform tarifelor stabilite și comunicate în prealabil.

5. POT RENUNȚA la colaborare cu un preaviz de minimum 24 de ore înainte de eveniment.

6. SUNT DE ACORD ca datele mele personale (nume, telefon, poză buletin) să fie folosite exclusiv pentru verificare internă și alocare la evenimente.

7. MĂ ANGAJEZ să mă prezint la evenimente curat, punctual și cu atitudine profesionistă.

8. ACCEPT că nerespectarea obligațiilor poate duce la încetarea colaborării.
                    """.trimIndent(),
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    lineHeight = 22.sp
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Signature area
            Text(
                "Semnătura ta:",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(
                        2.dp,
                        if (hasSigned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                        RoundedCornerShape(12.dp)
                    )
                    .background(Color.White)
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { offset ->
                                currentLine = listOf(offset)
                                hasSigned = true
                            },
                            onDrag = { change, _ ->
                                currentLine = currentLine + change.position
                            },
                            onDragEnd = {
                                lines.add(currentLine)
                                currentLine = emptyList()
                            }
                        )
                    }
            ) {
                androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
                    val paint = Paint().apply {
                        color = android.graphics.Color.BLACK
                        strokeWidth = 4f
                        style = Paint.Style.STROKE
                        isAntiAlias = true
                    }
                    val canvas = drawContext.canvas.nativeCanvas

                    for (line in lines) {
                        if (line.size > 1) {
                            val path = Path()
                            path.moveTo(line[0].x, line[0].y)
                            for (i in 1 until line.size) {
                                path.lineTo(line[i].x, line[i].y)
                            }
                            canvas.drawPath(path, paint)
                        }
                    }
                    if (currentLine.size > 1) {
                        val path = Path()
                        path.moveTo(currentLine[0].x, currentLine[0].y)
                        for (i in 1 until currentLine.size) {
                            path.lineTo(currentLine[i].x, currentLine[i].y)
                        }
                        canvas.drawPath(path, paint)
                    }
                }

                if (!hasSigned) {
                    Text(
                        "Semnează aici cu degetul ☝️",
                        modifier = Modifier.align(Alignment.Center),
                        color = Color.Gray,
                        textAlign = TextAlign.Center
                    )
                }
            }

            // Clear button
            if (hasSigned) {
                TextButton(
                    onClick = {
                        lines.clear()
                        currentLine = emptyList()
                        hasSigned = false
                    },
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("🗑️ Șterge semnătura")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }

        // Bottom button
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 8.dp
        ) {
            Button(
                onClick = {
                    // Capture signature as bitmap
                    val bitmap = Bitmap.createBitmap(800, 300, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(android.graphics.Color.WHITE)
                    val paint = Paint().apply {
                        color = android.graphics.Color.BLACK
                        strokeWidth = 4f
                        style = Paint.Style.STROKE
                        isAntiAlias = true
                    }
                    for (line in lines) {
                        if (line.size > 1) {
                            val path = Path()
                            path.moveTo(line[0].x * 800f / 1080f, line[0].y * 300f / 150f)
                            for (i in 1 until line.size) {
                                path.lineTo(line[i].x * 800f / 1080f, line[i].y * 300f / 150f)
                            }
                            canvas.drawPath(path, paint)
                        }
                    }
                    onContractSigned(bitmap)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .height(50.dp),
                enabled = hasSigned,
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("✅ Semnez și continui", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
