package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import android.media.MediaRecorder
import java.io.File
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.net.Uri
import android.provider.OpenableColumns
import io.github.jan.supabase.storage.storage
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import com.superpartybyai.core.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.serialization.Serializable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import coil.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.PostgresAction

@Serializable
data class MessageModel(
    val id: String,
    val sender_type: String,
    val content: String,
    val created_at: String,
    val message_type: String? = "text",
    val media_url: String? = null,
    val file_name: String? = null,
    val duration_seconds: Int? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val contact_name: String? = null,
    val contact_vcard: String? = null
)

@Serializable
data class ClientIdentity(val avatar_url: String? = null, val public_alias: String? = null, val internal_client_code: String? = null)

@Serializable
data class ConvClientIdentity(val clients: ClientIdentity? = null, val session_id: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<MessageModel>>(emptyList()) }
    var inputMessage by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    var targetAlias by remember { mutableStateOf<String?>(null) }
    var currentSessionId by remember { mutableStateOf<String?>(null) }
    var targetAvatarUrl by remember { mutableStateOf<String?>(null) }
    
    // Rename Modal State
    var isRenamingClient by remember { mutableStateOf(false) }
    var newAliasText by remember { mutableStateOf("") }
    
    // Upload & Picker State
    var isUploading by remember { mutableStateOf(false) }
    var showAttachMenu by remember { mutableStateOf(false) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }
    var showCaptionDialog by remember { mutableStateOf(false) }
    var typedCaption by remember { mutableStateOf("") }
    
    var showLocationDialog by remember { mutableStateOf(false) }
    var mockLatitude by remember { mutableStateOf("") }
    var mockLongitude by remember { mutableStateOf("") }
    var mockLocationName by remember { mutableStateOf("") }
    
    var showContactDialog by remember { mutableStateOf(false) }
    var mockContactName by remember { mutableStateOf("") }
    var mockContactPhone by remember { mutableStateOf("") }
    
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    
    val handleUploadAndSend: (Uri, String) -> Unit = { selectedUri, caption ->
        if (currentSessionId == null) {
            Toast.makeText(context, "Sesiunea sursă lipsește. Rutele de reply sunt blocate.", Toast.LENGTH_LONG).show()
        } else {
            isUploading = true
            coroutineScope.launch {
                try {
                    val cr = context.contentResolver
                    val mimeType = cr.getType(selectedUri) ?: "application/octet-stream"
                    var fileName = "attachment"
                    cr.query(selectedUri, null, null, null, null)?.use { cursor ->
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (cursor.moveToFirst() && nameIndex >= 0) {
                            fileName = cursor.getString(nameIndex)
                        }
                    }
                    val bytes = withContext(Dispatchers.IO) { cr.openInputStream(selectedUri)?.readBytes() }
                    
                    if (bytes != null) {
                        val extension = fileName.substringAfterLast('.', "")
                        val finalFileName = if (extension.isNotEmpty() && extension != fileName) "${java.util.UUID.randomUUID()}.$extension" else java.util.UUID.randomUUID().toString()
                        val storagePath = "outbound/$currentSessionId/$finalFileName"
                        
                        withContext(Dispatchers.IO) { SupabaseClient.client.storage.from("whatsapp_media").upload(storagePath, bytes, upsert = true) }
                        val publicUrl = SupabaseClient.client.storage.from("whatsapp_media").publicUrl(storagePath)
                        
                        val msgType = when {
                            mimeType.startsWith("image/") -> "image"
                            mimeType.startsWith("video/") -> "video"
                            mimeType.startsWith("audio/") -> "audio"
                            else -> "document"
                        }
                        
                        var sendSuccessful = false
                        withContext(Dispatchers.IO) {
                            val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                            val conn = url.openConnection() as HttpURLConnection
                            conn.requestMethod = "POST"
                            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                            conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                            conn.doOutput = true
                            
                            val jsonBody = JSONObject().apply {
                                put("conversationId", contactId)
                                put("sessionId", currentSessionId)
                                put("message_type", msgType)
                                put("media_url", publicUrl)
                                put("mime_type", mimeType)
                                put("file_name", fileName)
                                if (caption.isNotBlank()) put("text", caption)
                            }
                            
                            conn.outputStream.use { os ->
                                val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                os.write(input, 0, input.size)
                            }
                            if (conn.responseCode in 200..299) {
                                sendSuccessful = true
                            } else { throw Exception("HTTP ${conn.responseCode}") }
                        }
                        
                        if (sendSuccessful) {
                            messages = messages + MessageModel(
                               id = java.util.UUID.randomUUID().toString(),
                               sender_type = "agent",
                               content = if (caption.isNotBlank()) caption else "Trimitere atașament: $fileName",
                               created_at = java.time.Instant.now().toString(),
                               message_type = msgType,
                               media_url = publicUrl,
                               file_name = fileName
                            )
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                    Toast.makeText(context, "Eroare atașament: ${e.message}", Toast.LENGTH_LONG).show()
                } finally {
                    isUploading = false
                }
            }
        }
    }
    
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val mimeType = context.contentResolver.getType(it) ?: ""
            if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
                pendingUri = it
                typedCaption = ""
                showCaptionDialog = true
            } else {
                handleUploadAndSend(it, "")
            }
        }
    }
    
    // Audio Recording State
    var isRecording by remember { mutableStateOf(false) }
    var audioFile by remember { mutableStateOf<File?>(null) }
    var mediaRecorder by remember { mutableStateOf<MediaRecorder?>(null) }
    
    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (!isGranted) {
            Toast.makeText(context, "Permisiune Microfon respinsă", Toast.LENGTH_SHORT).show()
        }
    }
    
    val stopRecordingAndUpload: () -> Unit = {
        if (isRecording) {
            isRecording = false
            try {
                mediaRecorder?.stop()
                mediaRecorder?.release()
                mediaRecorder = null
            } catch (e: Exception) {
                e.printStackTrace()
            }
            audioFile?.let { file ->
                if (file.exists() && file.length() > 0) {
                    isUploading = true
                    coroutineScope.launch {
                        try {
                            val bytes = withContext(Dispatchers.IO) { file.readBytes() }
                            val finalFileName = "${java.util.UUID.randomUUID()}.m4a"
                            val storagePath = "outbound/$currentSessionId/$finalFileName"
                            
                            withContext(Dispatchers.IO) { SupabaseClient.client.storage.from("whatsapp_media").upload(storagePath, bytes, upsert = true) }
                            val publicUrl = SupabaseClient.client.storage.from("whatsapp_media").publicUrl(storagePath)
                            
                            withContext(Dispatchers.IO) {
                                val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                                val conn = url.openConnection() as HttpURLConnection
                                conn.requestMethod = "POST"
                                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                conn.doOutput = true
                                val jsonBody = JSONObject().apply {
                                    put("conversationId", contactId)
                                    put("sessionId", currentSessionId)
                                    put("message_type", "audio")
                                    put("media_url", publicUrl)
                                    put("mime_type", "audio/mp4")
                                    put("is_ptt", true)
                                }
                                conn.outputStream.use { os ->
                                    val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                    os.write(input, 0, input.size)
                                }
                                if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
                            }
                            messages = messages + MessageModel(id = java.util.UUID.randomUUID().toString(), sender_type = "agent", content = "🎤 Mesaj vocal", created_at = java.time.Instant.now().toString(), message_type = "audio", media_url = publicUrl, file_name = "Voice Note")
                        } catch (e: Exception) { e.printStackTrace(); Toast.makeText(context, "Eroare Voice Note: ${e.message}", Toast.LENGTH_LONG).show() }
                        finally { isUploading = false }
                    }
                }
            }
        }
    }
    
    val loadMessages: () -> Unit = {
        coroutineScope.launch {
            try {
                val response = SupabaseClient.client.postgrest["messages"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("id, sender_type, content, created_at, message_type, media_url, file_name, duration_seconds, latitude, longitude, contact_name, contact_vcard")) {
                        filter {
                            eq("conversation_id", contactId)
                        }
                        order("created_at", order = io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                    }.decodeList<MessageModel>()
                messages = response
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(contactId) {
        loadMessages()
        
        coroutineScope.launch {
            try {
                val convInfo = SupabaseClient.client.postgrest["conversations"]
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("clients(avatar_url, public_alias, internal_client_code), session_id")) {
                        filter { eq("id", contactId) }
                    }.decodeSingleOrNull<ConvClientIdentity>()
                targetAlias = convInfo?.clients?.public_alias ?: convInfo?.clients?.internal_client_code ?: "Anonymous Identity"
                targetAvatarUrl = convInfo?.clients?.avatar_url
                if (convInfo?.session_id != null) {
                    currentSessionId = convInfo.session_id
                }
            } catch (e: Exception) {
                android.util.Log.e("Antigravity", "Error fetching ConvClientIdentity for '$contactId': ${e.message}", e)
                e.printStackTrace()
            }
        }
        
        launch {
            try {
                val channel = SupabaseClient.client.channel("public-messages-\$contactId")
                val flow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "messages"
                }
                channel.subscribe()
                flow.collect {
                    loadMessages()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        
        // Polling Fallback (Every 5 seconds) to ensure eventual consistency if WebSockets drop
        launch {
            while (true) {
                delay(5000L)
                loadMessages()
            }
        }
    }

    if (isRenamingClient) {
        AlertDialog(
            onDismissRequest = { isRenamingClient = false },
            title = { Text("Redenumește Clientul") },
            text = {
                OutlinedTextField(
                    value = newAliasText,
                    onValueChange = { newAliasText = it },
                    label = { Text("Nume NOU (ex. Gigel Firma X)") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(onClick = {
                    val aliasToSave = newAliasText
                    isRenamingClient = false
                    coroutineScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/rename")
                                val conn = url.openConnection() as HttpURLConnection
                                conn.requestMethod = "POST"
                                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                conn.doOutput = true
                                val jsonBody = JSONObject().apply {
                                    put("conversationId", contactId)
                                    put("newAlias", aliasToSave)
                                }
                                conn.outputStream.use { os ->
                                    val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                    os.write(input, 0, input.size)
                                }
                                if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
                            }
                            targetAlias = aliasToSave
                            Toast.makeText(context, "Client redenumit!", Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            Toast.makeText(context, "Eroare redenumire: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }) {
                    Text("Salvează")
                }
            },
            dismissButton = {
                TextButton(onClick = { isRenamingClient = false }) {
                    Text("Anulează")
                }
            }
        )
    }

    if (showCaptionDialog) {
        AlertDialog(
            onDismissRequest = { showCaptionDialog = false; pendingUri = null; typedCaption = "" },
            title = { Text("Adaugă o descriere (opțional)") },
            text = {
                OutlinedTextField(value = typedCaption, onValueChange = { typedCaption = it }, label = { Text("Descriere imagine / video") }, singleLine = false)
            },
            confirmButton = {
                Button(onClick = {
                    showCaptionDialog = false
                    pendingUri?.let { handleUploadAndSend(it, typedCaption) }
                    pendingUri = null
                    typedCaption = ""
                }) { Text("Trimite") }
            },
            dismissButton = {
                TextButton(onClick = { showCaptionDialog = false; pendingUri = null; typedCaption = "" }) { Text("Anulează") }
            }
        )
    }

    if (showLocationDialog) {
        AlertDialog(
            onDismissRequest = { showLocationDialog = false },
            title = { Text("Trimite Locație") },
            text = {
                Column {
                    OutlinedTextField(value = mockLatitude, onValueChange = { mockLatitude = it }, label = { Text("Latitudine (ex. 44.4268)") })
                    OutlinedTextField(value = mockLongitude, onValueChange = { mockLongitude = it }, label = { Text("Longitudine (ex. 26.1025)") })
                    OutlinedTextField(value = mockLocationName, onValueChange = { mockLocationName = it }, label = { Text("Nume Locație (opțional)") })
                }
            },
            confirmButton = {
                Button(onClick = {
                    showLocationDialog = false
                    if (currentSessionId != null && mockLatitude.isNotBlank() && mockLongitude.isNotBlank()) {
                         coroutineScope.launch {
                             try {
                                 withContext(Dispatchers.IO) {
                                     val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                                     val conn = url.openConnection() as HttpURLConnection
                                     conn.requestMethod = "POST"
                                     conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                     conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                     conn.doOutput = true
                                     val jsonBody = JSONObject().apply {
                                         put("conversationId", contactId)
                                         put("sessionId", currentSessionId)
                                         put("message_type", "location")
                                         put("latitude", mockLatitude.trim())
                                         put("longitude", mockLongitude.trim())
                                         if (mockLocationName.isNotBlank()) put("text", mockLocationName)
                                     }
                                     conn.outputStream.use { os ->
                                         val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                         os.write(input, 0, input.size)
                                     }
                                     if (conn.responseCode in 200..299) {
                                         val namePart = if (mockLocationName.isNotBlank()) mockLocationName else "Locație (${mockLatitude}, ${mockLongitude})"
                                         messages = messages + MessageModel(id = java.util.UUID.randomUUID().toString(), sender_type = "agent", content = "📍 $namePart", created_at = java.time.Instant.now().toString(), message_type = "location")
                                     } else {
                                         withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare: HTTP ${conn.responseCode}", Toast.LENGTH_LONG).show() }
                                     }
                                 }
                             } catch(e: Exception) {
                                 withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare Locație: ${e.message}", Toast.LENGTH_LONG).show() }
                             }
                         }
                    }
                }) { Text("Trimite") }
            },
            dismissButton = {
                TextButton(onClick = { showLocationDialog = false }) { Text("Anulează") }
            }
        )
    }

    if (showContactDialog) {
        AlertDialog(
            onDismissRequest = { showContactDialog = false },
            title = { Text("Trimite Contact Card") },
            text = {
                Column {
                    OutlinedTextField(value = mockContactName, onValueChange = { mockContactName = it }, label = { Text("Nume Contact") })
                    OutlinedTextField(value = mockContactPhone, onValueChange = { mockContactPhone = it }, label = { Text("Telefon VCard (ex. +407...)") })
                }
            },
            confirmButton = {
                Button(onClick = {
                    showContactDialog = false
                    if (currentSessionId != null && mockContactName.isNotBlank() && mockContactPhone.isNotBlank()) {
                         coroutineScope.launch {
                             try {
                                 withContext(Dispatchers.IO) {
                                     val cleanPhone = mockContactPhone.trim().replace(" ", "")
                                     val waid = cleanPhone.replace("+", "")
                                     val vcard = "BEGIN:VCARD\nVERSION:3.0\nN:;${mockContactName};;;\nFN:${mockContactName}\nTEL;type=CELL;waid=${waid}:${cleanPhone}\nEND:VCARD"
                                     val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                                     val conn = url.openConnection() as HttpURLConnection
                                     conn.requestMethod = "POST"
                                     conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                     conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                     conn.doOutput = true
                                     val jsonBody = JSONObject().apply {
                                         put("conversationId", contactId)
                                         put("sessionId", currentSessionId)
                                         put("message_type", "contact")
                                         put("contact_name", mockContactName.trim())
                                         put("contact_vcard", vcard)
                                     }
                                     conn.outputStream.use { os ->
                                         val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                         os.write(input, 0, input.size)
                                     }
                                     if (conn.responseCode in 200..299) {
                                         messages = messages + MessageModel(id = java.util.UUID.randomUUID().toString(), sender_type = "agent", content = "👤 Contact: $mockContactName", created_at = java.time.Instant.now().toString(), message_type = "contact")
                                     } else {
                                         withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare: HTTP ${conn.responseCode}", Toast.LENGTH_LONG).show() }
                                     }
                                 }
                             } catch(e: Exception) {
                                 withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare Contact: ${e.message}", Toast.LENGTH_LONG).show() }
                             }
                         }
                    }
                }) { Text("Trimite") }
            },
            dismissButton = {
                TextButton(onClick = { showContactDialog = false }) { Text("Anulează") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!targetAvatarUrl.isNullOrEmpty()) {
                            AsyncImage(
                                model = targetAvatarUrl,
                                contentDescription = "Avatar",
                                modifier = Modifier.size(32.dp).clip(CircleShape).padding(end = 8.dp),
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(32.dp).padding(end = 8.dp))
                        }
                        Column {
                            Text(targetAlias ?: "Chat Details", style = MaterialTheme.typography.bodyLarge)
                            Text("Secure Channel", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = {
                        isRenamingClient = true
                        newAliasText = targetAlias ?: ""
                    }) {
                        Icon(Icons.Default.Edit, contentDescription = "Rename Client")
                    }
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                if (isUploading) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp).padding(8.dp))
                } else {
                    Box {
                        IconButton(onClick = { showAttachMenu = true }) {
                            Icon(androidx.compose.material.icons.Icons.Default.Add, contentDescription = "Attach File")
                        }
                        DropdownMenu(
                            expanded = showAttachMenu,
                            onDismissRequest = { showAttachMenu = false }
                        ) {
                            DropdownMenuItem(text = { Text("Imagine / Video") }, onClick = { showAttachMenu = false; filePickerLauncher.launch("image/*") })
                            DropdownMenuItem(text = { Text("Document") }, onClick = { showAttachMenu = false; filePickerLauncher.launch("*/*") })
                            DropdownMenuItem(text = { Text("Locație") }, onClick = { showAttachMenu = false; showLocationDialog = true })
                            DropdownMenuItem(text = { Text("Contact") }, onClick = { showAttachMenu = false; showContactDialog = true })
                        }
                    }
                }
                TextField(
                    value = if (isRecording) "🎤 Se înregistrează..." else inputMessage, 
                    onValueChange = { if (!isRecording) inputMessage = it },
                    modifier = Modifier.weight(1f).padding(8.dp),
                    placeholder = { Text("Scrie mesaj sau apasă pe mic pentru audio...") },
                    enabled = !isRecording
                )
                if (inputMessage.isBlank()) {
                    IconButton(
                        onClick = { },
                        modifier = Modifier.padding(end = 8.dp).pointerInput(Unit) {
                            detectTapGestures(
                                onPress = {
                                    if (currentSessionId == null) {
                                        Toast.makeText(context, "Sesiunea sursă lipsește", Toast.LENGTH_SHORT).show()
                                        return@detectTapGestures
                                    }
                                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                        recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                        return@detectTapGestures
                                    }
                                    isRecording = true
                                    val newAudioFile = File(context.cacheDir, "ptt_${System.currentTimeMillis()}.m4a")
                                    audioFile = newAudioFile
                                    try {
                                        val recorder = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                            MediaRecorder(context)
                                        } else {
                                            MediaRecorder()
                                        }
                                        recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                                        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                                        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                                        recorder.setOutputFile(newAudioFile.absolutePath)
                                        recorder.prepare()
                                        recorder.start()
                                        mediaRecorder = recorder
                                    } catch (e: Exception) {
                                        e.printStackTrace()
                                        isRecording = false
                                        Toast.makeText(context, "Eroare inițializare microfon", Toast.LENGTH_SHORT).show()
                                    }
                                    try {
                                        awaitRelease()
                                        stopRecordingAndUpload()
                                    } finally {
                                        stopRecordingAndUpload()
                                    }
                                }
                            )
                        }
                    ) {
                        Card(
                            shape = androidx.compose.foundation.shape.CircleShape,
                            colors = CardDefaults.cardColors(containerColor = if (isRecording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = "Mic", modifier = Modifier.padding(12.dp), tint = MaterialTheme.colorScheme.onPrimary)
                        }
                    }
                } else {
                    Button(
                        onClick = { 
                        if (currentSessionId == null) {
                            Toast.makeText(context, "Sesiunea sursă lipsește. Rutele de reply sunt blocate.", Toast.LENGTH_LONG).show()
                            return@Button
                        }
                        if (inputMessage.isNotBlank() && contactId != null) {
                            val textToSend = inputMessage
                            inputMessage = ""
                            coroutineScope.launch {
                                try {
                                    withContext(Dispatchers.IO) {
                                        val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/messages/send")
                                        val conn = url.openConnection() as HttpURLConnection
                                        conn.requestMethod = "POST"
                                        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                        conn.setRequestProperty("x-api-key", com.superpartybyai.core.AppConfig.API_KEY)
                                        conn.doOutput = true
                                        
                                        val jsonBody = JSONObject()
                                        jsonBody.put("conversationId", contactId)
                                        jsonBody.put("text", textToSend)
                                        jsonBody.put("sessionId", currentSessionId)
                                        
                                        conn.outputStream.use { os ->
                                            val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                            os.write(input, 0, input.size)
                                        }
                                        val rc = conn.responseCode
                                        if (rc !in 200..299) {
                                            throw Exception("HTTP $rc")
                                        }
                                    }
                                    messages = messages + MessageModel(
                                       id = java.util.UUID.randomUUID().toString(),
                                       sender_type = "agent",
                                       content = textToSend,
                                       created_at = java.time.Instant.now().toString()
                                    )
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Eroare rețea: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    }, 
                    modifier = Modifier.padding(end = 8.dp)
                ) {
                    Text("Send")
                }
            }
        }
    }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (isLoading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
                LazyColumn(modifier = Modifier.weight(1f).padding(16.dp)) {
                    items(messages.size) { index ->
                        val msg = messages[index]
                        val isAgent = msg.sender_type == "agent" || msg.sender_type == "ai"
                        
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = if (isAgent) Arrangement.End else Arrangement.Start
                        ) {
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = if (isAgent) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
                                )
                            ) {
                                Column(modifier = Modifier.padding(8.dp)) {
                                    if (msg.message_type == "image" && !msg.media_url.isNullOrEmpty()) {
                                        AsyncImage(
                                            model = msg.media_url,
                                            contentDescription = "Imagine atașată",
                                            modifier = Modifier.fillMaxWidth(0.7f).heightIn(max = 300.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                                                .clickable { uriHandler.openUri(msg.media_url) },
                                            contentScale = ContentScale.Crop
                                        )
                                        if (msg.content.isNotBlank() && msg.content != "📷 Imagine") {
                                            Text(text = msg.content, modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium)
                                        }
                                    } else if (msg.message_type == "document" || msg.message_type == "audio" || msg.message_type == "video") {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.clickable { msg.media_url?.let { uriHandler.openUri(it) } }.padding(4.dp)
                                        ) {
                                            Icon(
                                                imageVector = if (msg.message_type == "audio") androidx.compose.material.icons.Icons.Default.PlayArrow else androidx.compose.material.icons.Icons.Default.Info,
                                                contentDescription = msg.message_type,
                                                modifier = Modifier.size(24.dp).padding(end = 8.dp)
                                            )
                                            Column {
                                                Text(text = msg.file_name ?: msg.content, style = MaterialTheme.typography.bodyMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                                                if (msg.message_type == "audio" && msg.duration_seconds != null) {
                                                    Text(text = "${msg.duration_seconds} sec", style = MaterialTheme.typography.labelSmall)
                                                }
                                            }
                                        }
                                    } else if (msg.message_type == "location") {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.clickable {
                                                if (msg.latitude != null && msg.longitude != null) {
                                                    try {
                                                        uriHandler.openUri("geo:${msg.latitude},${msg.longitude}?q=${msg.latitude},${msg.longitude}")
                                                    } catch (e: Exception) { }
                                                }
                                            }.padding(4.dp)
                                        ) {
                                            Icon(androidx.compose.material.icons.Icons.Default.LocationOn, contentDescription = "Locație", modifier = Modifier.padding(end=4.dp))
                                            Text(text = msg.content, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                                        }
                                    } else if (msg.message_type == "contact") {
                                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                                            Icon(Icons.Default.Person, contentDescription = "Contact", modifier = Modifier.padding(end=4.dp))
                                            Column {
                                                Text(text = msg.content, style = MaterialTheme.typography.bodyMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                                                if (!msg.contact_vcard.isNullOrBlank()) {
                                                    val waidRegex = "waid=([0-9+]+)".toRegex()
                                                    val match = waidRegex.find(msg.contact_vcard)
                                                    if (match != null) {
                                                        Text(text = "WhatsApp: +${match.groupValues[1]}", style = MaterialTheme.typography.labelSmall)
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        Text(
                                            text = msg.content,
                                            modifier = Modifier.padding(4.dp),
                                            style = MaterialTheme.typography.bodyMedium
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
