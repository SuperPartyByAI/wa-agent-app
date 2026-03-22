package com.superpartybyai.waagentapp.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.gotrue.auth
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*

/**
 * Semi-transparent watermark showing the employee's name + timestamp.
 * If someone photographs the screen with another phone, the watermark
 * identifies WHO leaked the data and WHEN.
 */
@Composable
fun SecurityWatermark(content: @Composable () -> Unit) {
    // Reactively check for user email (updates after login)
    var email by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        // Poll until user is logged in (max 30 seconds)
        repeat(30) {
            val user = SupabaseClient.client.auth.currentUserOrNull()
            if (user?.email != null) {
                email = user.email!!
                return@LaunchedEffect
            }
            delay(1000)
        }
    }

    // Don't show watermark until user is logged in
    val shortId = remember(email) {
        if (email.isNotEmpty()) email.substringBefore("@").take(15).uppercase() else ""
    }
    val timestamp = remember {
        SimpleDateFormat("dd.MM.yy HH:mm", Locale.getDefault()).format(Date())
    }

    Box(modifier = Modifier.fillMaxSize()) {
        content()

        // Only show watermark when user is identified
        if (shortId.isNotEmpty()) {
            val watermarkText = "$shortId • $timestamp"
            for (row in 0..5) {
                for (col in -1..2) {
                    Text(
                        text = watermarkText,
                        color = Color.White.copy(alpha = 0.06f),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .offset(x = (col * 180 + row * 40).dp, y = (row * 130).dp)
                            .rotate(-30f),
                        maxLines = 1
                    )
                }
            }
        }
    }
}
