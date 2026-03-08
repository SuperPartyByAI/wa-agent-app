package com.superpartybyai.features.chat

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import com.superpartybyai.core.AppConfig

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsAppSessionScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    
    var sessionStatus by remember { mutableStateOf("Deschisă Panou") }
    var qrCodeBase64 by remember { mutableStateOf<String?>(null) }
    var isPolling by remember { mutableStateOf(false) }

    fun startSession() {
        coroutineScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val url = URL("${AppConfig.BACKEND_URL}/api/sessions/start")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                    conn.setRequestProperty("x-api-key", AppConfig.API_KEY)
                    conn.doOutput = true
                    
                    val jsonBody = JSONObject().apply {
                        put("sessionId", "default")
                    }
                    
                    conn.outputStream.use { os ->
                        val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                        os.write(input, 0, input.size)
                    }
                    
                    if (conn.responseCode !in 200..299) {
                        throw Exception("Eroare HTTP: ${conn.responseCode}")
                    }
                }
                sessionStatus = "Se generează QR..."
                isPolling = true
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(context, "Eroare pornire: ${e.message}", Toast.LENGTH_LONG).show()
                sessionStatus = "Eroare"
            }
        }
    }

    LaunchedEffect(isPolling) {
        if (!isPolling) return@LaunchedEffect
        
        while (isPolling) {
            try {
                val statusResult = withContext(Dispatchers.IO) {
                    val url = URL("${AppConfig.BACKEND_URL}/api/sessions/status/default")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "GET"
                    conn.setRequestProperty("x-api-key", AppConfig.API_KEY)
                    
                    if (conn.responseCode == 200) {
                        val response = conn.inputStream.bufferedReader().use { it.readText() }
                        JSONObject(response)
                    } else {
                        null
                    }
                }
                
                if (statusResult != null) {
                    val status = statusResult.optString("status")
                    sessionStatus = "Status Backend: $status"
                    
                    if (status == "CONNECTED") {
                        qrCodeBase64 = null
                        isPolling = false
                        Toast.makeText(context, "WhatsApp a fost conectat cu succes!", Toast.LENGTH_LONG).show()
                    } else if (statusResult.has("qrCode")) {
                        val qrRaw = statusResult.getString("qrCode")
                        if (qrRaw.isNotEmpty()) {
                            qrCodeBase64 = qrRaw
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            delay(3000)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Conectare WhatsApp") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(text = sessionStatus, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 24.dp))
            
            if (sessionStatus.contains("CONNECTED")) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Connected",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(100.dp).padding(16.dp)
                )
                Text("Device Linked.")
            } else if (qrCodeBase64 != null) {
                val qrPrefix = "data:image/png;base64,"
                val rawBase64 = if (qrCodeBase64!!.startsWith(qrPrefix)) qrCodeBase64!!.substring(qrPrefix.length) else qrCodeBase64!!
                val bitmapResult = runCatching {
                    val imageBytes = Base64.decode(rawBase64, Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                }
                val bitmap = bitmapResult.getOrNull()
                
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "QR Code",
                        modifier = Modifier.size(250.dp)
                    )
                    Text("Scanează acest cod QR din WhatsApp -> Linked Devices", modifier = Modifier.padding(top = 16.dp))
                } else {
                    val errMsg = bitmapResult.exceptionOrNull()?.message ?: "Eroare conversie imagine QR"
                    Text("Invalid QR Data: $errMsg")
                }
            } else {
                Button(onClick = { startSession() }) {
                    Text("Pornește Sesiune WA Backend")
                }
            }
        }
    }
}
