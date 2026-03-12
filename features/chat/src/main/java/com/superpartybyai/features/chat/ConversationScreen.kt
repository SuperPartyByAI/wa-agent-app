package com.superpartybyai.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
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
import io.github.jan.supabase.storage.upload
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
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
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
import io.github.jan.supabase.gotrue.auth

import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import android.location.Location

import com.superpartybyai.features.chat.ai.AiSchemaNode
import com.superpartybyai.features.chat.ai.AiRepository
import com.superpartybyai.features.chat.ai.AiSchemaRenderer

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
data class ClientIdentity(val avatar_url: String? = null, val public_alias: String? = null, val internal_client_code: String? = null, val id: String? = null)

@Serializable
data class ConvClientIdentity(val clients: ClientIdentity? = null, val session_id: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(contactId: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<MessageModel>>(emptyList()) }
    var inputMessage by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var targetAlias by remember { mutableStateOf<String?>(null) }
    var currentSessionId by remember { mutableStateOf<String?>(null) }
    var targetAvatarUrl by remember { mutableStateOf<String?>(null) }
    var targetClientId by remember { mutableStateOf<String?>(null) }
    var showRealNumberDialog by remember { mutableStateOf(false) }
    var realPhoneNumber by remember { mutableStateOf("") }
    var showSetRealNumberDialog by remember { mutableStateOf(false) }
    var inputRealNumber by remember { mutableStateOf("") }
    var isSubmittingRealNumber by remember { mutableStateOf(false) }
    
    // Upload & Picker State
    var isUploading by remember { mutableStateOf(false) }
    var showAttachMenu by remember { mutableStateOf(false) }
    
    var showLocationDialog by remember { mutableStateOf(false) }
    var fetchingLocation by remember { mutableStateOf(false) }
    var fetchedLocation by remember { mutableStateOf<Location?>(null) }
    
    var showContactDialog by remember { mutableStateOf(false) }
    var mockContactName by remember { mutableStateOf("") }
    var mockContactPhone by remember { mutableStateOf("") }
    
    var selectedTab by remember { mutableStateOf(0) }
    var aiSchema by remember { mutableStateOf<List<AiSchemaNode>?>(null) }
    var isLoadingSchema by remember { mutableStateOf(false) }
    var schemaError by remember { mutableStateOf<String?>(null) }
    val aiRepository = remember { AiRepository() }
    
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
                    val startTotalMs = System.currentTimeMillis()
                    var compressMs = 0L
                    var uploadMs = 0L
                    var originalBytesSize = 0
                    var compressedBytesSize = 0
                    var originalW = 0
                    var originalH = 0
                    var finalW = 0
                    var finalH = 0

                    @Suppress("RedundantValueInitialization", "ASSIGNED_BUT_NEVER_ACCESSED_VARIABLE")
                    var bytes: ByteArray? = null
                    val isImage = mimeType.startsWith("image/")
                    
                    if (isImage) {
                        try {
                            bytes = withContext(Dispatchers.IO) {
                                val compressStart = System.currentTimeMillis()
                                var inputStream = cr.openInputStream(selectedUri)
                                originalBytesSize = inputStream?.available() ?: 0
                                val options = android.graphics.BitmapFactory.Options()
                                options.inJustDecodeBounds = true
                                android.graphics.BitmapFactory.decodeStream(inputStream, null, options)
                                inputStream?.close()

                                val maxSize = 1600
                                var scale = 1
                                while (options.outWidth / scale / 2 >= maxSize || options.outHeight / scale / 2 >= maxSize) {
                                    scale *= 2
                                }

                                val decodeOptions = android.graphics.BitmapFactory.Options()
                                decodeOptions.inSampleSize = scale
                                
                                inputStream = cr.openInputStream(selectedUri)
                                var bitmap = android.graphics.BitmapFactory.decodeStream(inputStream, null, decodeOptions)
                                inputStream?.close()

                                if (bitmap != null) {
                                    inputStream = cr.openInputStream(selectedUri)
                                    if (inputStream != null) {
                                        val exif = android.media.ExifInterface(inputStream)
                                        val orientation = exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)
                                        val matrix = android.graphics.Matrix()
                                        when (orientation) {
                                            android.media.ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                                            android.media.ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                                            android.media.ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                                        }
                                        if (orientation != android.media.ExifInterface.ORIENTATION_NORMAL && orientation != android.media.ExifInterface.ORIENTATION_UNDEFINED) {
                                            val rotated = android.graphics.Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                                            if (rotated != bitmap) {
                                                bitmap.recycle()
                                                bitmap = rotated
                                            }
                                        }
                                        inputStream.close()
                                    }

                                    var width = bitmap.width
                                    var height = bitmap.height
                                    originalW = options.outWidth
                                    originalH = options.outHeight
                                    
                                    if (width > maxSize || height > maxSize) {
                                        val ratio = Math.min(maxSize.toFloat() / width, maxSize.toFloat() / height)
                                        width = (width * ratio).toInt()
                                        height = (height * ratio).toInt()
                                        val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, width, height, true)
                                        if (scaled != bitmap) {
                                            bitmap.recycle()
                                            bitmap = scaled
                                        }
                                    }

                                    val outStream = java.io.ByteArrayOutputStream()
                                    bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 75, outStream)
                                    val compressedBytes = outStream.toByteArray()
                                    compressedBytesSize = compressedBytes.size
                                    finalW = width
                                    finalH = height
                                    compressMs = System.currentTimeMillis() - compressStart
                                    
                                    bitmap.recycle()
                                    compressedBytes
                                } else {
                                    cr.openInputStream(selectedUri)?.readBytes()
                                }
                            }
                        } catch(e: Exception) { 
                            android.util.Log.e("Superparty", "Compression OOM/Fail", e) 
                            bytes = withContext(Dispatchers.IO) { cr.openInputStream(selectedUri)?.readBytes() }
                        }
                    } else {
                        bytes = withContext(Dispatchers.IO) { cr.openInputStream(selectedUri)?.readBytes() }
                    }
                    
                    if (bytes != null) {
                        val extension = fileName.substringAfterLast('.', "")
                        val finalFileName = if (extension.isNotEmpty() && extension != fileName) "${java.util.UUID.randomUUID()}.$extension" else java.util.UUID.randomUUID().toString()
                        val storagePath = "outbound/$currentSessionId/$finalFileName"
                        
                        val uploadStart = System.currentTimeMillis()
                        withContext(Dispatchers.IO) { SupabaseClient.client.storage.from("whatsapp_media").upload(storagePath, bytes!!, upsert = true) }
                        uploadMs = System.currentTimeMillis() - uploadStart
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
                            val totalMs = System.currentTimeMillis() - startTotalMs
                            if (isImage) {
                                android.util.Log.e("Superparty", "[ImageCompression] originalBytes=$originalBytesSize compressedBytes=$compressedBytesSize originalWxH=${originalW}x${originalH} finalWxH=${finalW}x${finalH} quality=75 compressMs=$compressMs uploadMs=$uploadMs totalMs=$totalMs")
                            }
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
                    android.util.Log.e("Superparty", "Upload Crash", e)
                    withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare atașament: [${e.javaClass.simpleName}] ${e.message}", Toast.LENGTH_LONG).show() }
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
            handleUploadAndSend(it, "")
        }
    }
    
    var tempCameraUri by remember { mutableStateOf<Uri?>(null) }
    
    val takePictureLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success: Boolean ->
        if (success) {
            tempCameraUri?.let {
                handleUploadAndSend(it, "")
            }
        } else {
            tempCameraUri = null
        }
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            val photoFile = File.createTempFile("camera_temp", ".jpg", context.cacheDir).apply { createNewFile() }
            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photoFile)
            tempCameraUri = uri
            takePictureLauncher.launch(uri)
        } else {
            Toast.makeText(context, "Permisiune Cameră respinsă", Toast.LENGTH_SHORT).show()
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
        if (fineGranted || coarseGranted) {
            fetchingLocation = true
            showLocationDialog = true
            try {
                val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
                fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                    .addOnSuccessListener { location: Location? ->
                        fetchedLocation = location
                        fetchingLocation = false
                    }
                    .addOnFailureListener {
                        fetchingLocation = false
                        Toast.makeText(context, "Eroare senzor GPS", Toast.LENGTH_SHORT).show()
                    }
            } catch (e: SecurityException) {
                fetchingLocation = false
                Toast.makeText(context, "Lipsă permisiuni GPS sigure", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, "Permisiune Locație respinsă", Toast.LENGTH_SHORT).show()
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
            isLoading = true
            loadError = null
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
                loadError = e.message ?: "Eroare de conexiune sau schemă de date (verifică baza SQL)."
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Eroare DB: ${e.message}", Toast.LENGTH_LONG).show()
                }
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
                    .select(columns = io.github.jan.supabase.postgrest.query.Columns.raw("clients(id, avatar_url, public_alias, internal_client_code), session_id")) {
                        filter { eq("id", contactId) }
                    }.decodeSingleOrNull<ConvClientIdentity>()
                targetAlias = convInfo?.clients?.public_alias ?: convInfo?.clients?.internal_client_code ?: "Anonymous Identity"
                targetAvatarUrl = convInfo?.clients?.avatar_url
                targetClientId = convInfo?.clients?.id
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

    LaunchedEffect(selectedTab) {
        if (selectedTab == 1 && aiSchema == null && contactId.isNotBlank()) {
            isLoadingSchema = true
            schemaError = null
            try {
                val schema = aiRepository.fetchSchema(contactId)
                if (schema.isNotEmpty()) {
                    aiSchema = schema
                } else {
                    schemaError = "Schema invalidă sau indisponibilă."
                }
            } catch (e: Exception) {
                schemaError = e.message
            } finally {
                isLoadingSchema = false
            }
        }
    }



    if (showLocationDialog) {
        AlertDialog(
            onDismissRequest = { showLocationDialog = false },
            title = { Text("Trimite Locație (GPS Real)") },
            text = {
                if (fetchingLocation) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        CircularProgressIndicator(modifier = Modifier.padding(16.dp))
                        Text("Preiau semnal satelit...")
                    }
                } else if (fetchedLocation != null) {
                    val latStr = String.format("%.6f", fetchedLocation!!.latitude)
                    val lonStr = String.format("%.6f", fetchedLocation!!.longitude)
                    Text("📍 GPS Confirmă:\n\nLatitudine: $latStr\nLongitudine: $lonStr\n\nApasă Trimite pentru share.")
                } else {
                    Text("Nu s-a putut obține locația hardware. Asigurați-vă că GPS-ul este pornit din setările telefonului.")
                }
            },
            confirmButton = {
                if (!fetchingLocation && fetchedLocation != null) {
                    Button(onClick = {
                        val latStr = fetchedLocation!!.latitude.toString()
                        val lonStr = fetchedLocation!!.longitude.toString()
                        showLocationDialog = false
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
                                        put("latitude", latStr)
                                        put("longitude", lonStr)
                                    }
                                    conn.outputStream.use { os ->
                                        val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                        os.write(input, 0, input.size)
                                    }
                                    if (conn.responseCode in 200..299) {
                                        messages = messages + MessageModel(id = java.util.UUID.randomUUID().toString(), sender_type = "agent", content = "📍 Locație curentă ($latStr, $lonStr)", created_at = java.time.Instant.now().toString(), message_type = "location")
                                    } else {
                                        withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare: HTTP ${conn.responseCode}", Toast.LENGTH_LONG).show() }
                                    }
                                }
                            } catch(e: Exception) {
                                withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare Locație: ${e.message}", Toast.LENGTH_LONG).show() }
                            }
                        }
                    }) { Text("Trimite") }
                }
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

    if (showSetRealNumberDialog) {
        AlertDialog(
            onDismissRequest = { if (!isSubmittingRealNumber) showSetRealNumberDialog = false },
            title = { Text("Setează Număr Real") },
            text = {
                Column {
                    Text("Introduceți numărul canonic pentru acest client. Se vor suprascrie automat sursele deduse.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
                    OutlinedTextField(
                        value = inputRealNumber,
                        onValueChange = { inputRealNumber = it },
                        label = { Text("Număr (+40...)") },
                        enabled = !isSubmittingRealNumber,
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (inputRealNumber.isNotBlank() && targetClientId != null) {
                            isSubmittingRealNumber = true
                            coroutineScope.launch {
                                try {
                                    val token = SupabaseClient.client.auth.currentAccessTokenOrNull()
                                    if (token != null) {
                                        withContext(Dispatchers.IO) {
                                            val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/$targetClientId/real-number")
                                            val conn = url.openConnection() as HttpURLConnection
                                            conn.requestMethod = "POST"
                                            conn.setRequestProperty("Authorization", "Bearer $token")
                                            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                            conn.doOutput = true
                                            val jsonBody = JSONObject().apply {
                                                put("realNumber", inputRealNumber.trim())
                                                put("notes", "Manual override from ConversationScreen")
                                            }
                                            conn.outputStream.use { os ->
                                                val input = jsonBody.toString().toByteArray(Charsets.UTF_8)
                                                os.write(input, 0, input.size)
                                            }
                                            val rc = conn.responseCode
                                            if (rc in 200..299) {
                                                val resp = conn.inputStream.bufferedReader().use { it.readText() }
                                                val resJson = JSONObject(resp)
                                                realPhoneNumber = resJson.optString("realNumber", inputRealNumber)
                                            } else {
                                                val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "{}"
                                                val errMsg = try { JSONObject(err).optString("error", "HTTP $rc") } catch(e:Exception) { "HTTP $rc" }
                                                throw Exception(errMsg)
                                            }
                                        }
                                        showSetRealNumberDialog = false
                                        showRealNumberDialog = true
                                    }
                                } catch (e: Exception) {
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Eroare salvare: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                } finally {
                                    isSubmittingRealNumber = false
                                }
                            }
                        }
                    },
                    enabled = !isSubmittingRealNumber
                ) {
                    if (isSubmittingRealNumber) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Salvează")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showSetRealNumberDialog = false },
                    enabled = !isSubmittingRealNumber
                ) { Text("Anulează") }
            }
        )
    }

    if (showRealNumberDialog) {
        val currentUserEmail = SupabaseClient.client.auth.currentUserOrNull()?.email
        AlertDialog(
            onDismissRequest = { showRealNumberDialog = false },
            title = { Text("Număr Fizic Real (Admin)") },
            text = { Text("MSISDN / Identificator WhatsApp:\n\n$realPhoneNumber\n\n(Afișat exclusiv pentru sesiunea ursache.andrei1995@gmail.com)") },
            confirmButton = {
                TextButton(onClick = { showRealNumberDialog = false }) { Text("Închide") }
            },
            dismissButton = {
                if (currentUserEmail == "ursache.andrei1995@gmail.com" && realPhoneNumber == "Număr real indisponibil") {
                    TextButton(onClick = {
                        showRealNumberDialog = false
                        inputRealNumber = ""
                        showSetRealNumberDialog = true
                    }) {
                        Text("Setează număr real")
                    }
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val avatarModifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .padding(end = 8.dp)
                            .clickable {
                                val currentUserEmail = SupabaseClient.client.auth.currentUserOrNull()?.email
                                if (currentUserEmail == "ursache.andrei1995@gmail.com") {
                                    if (targetClientId != null) {
                                        coroutineScope.launch {
                                            try {
                                                val token = withContext(Dispatchers.IO) { SupabaseClient.client.auth.currentAccessTokenOrNull() }
                                                if (token != null) {
                                                    withContext(Dispatchers.IO) {
                                                        val url = URL("${com.superpartybyai.core.AppConfig.BACKEND_URL}/api/clients/$targetClientId/real-number")
                                                        val conn = url.openConnection() as HttpURLConnection
                                                        conn.requestMethod = "GET"
                                                        conn.setRequestProperty("Authorization", "Bearer $token")
                                                        conn.setRequestProperty("Accept", "application/json")
                                                        
                                                        val responseCode = conn.responseCode
                                                        if (responseCode == 200) {
                                                            val responseDetails = conn.inputStream.bufferedReader().use { it.readText() }
                                                            val json = JSONObject(responseDetails)
                                                            realPhoneNumber = json.optString("realNumber", "Număr real indisponibil")
                                                        } else {
                                                            realPhoneNumber = "Număr real indisponibil"
                                                        }
                                                        conn.disconnect()
                                                    }
                                                } else {
                                                    realPhoneNumber = "Număr real indisponibil"
                                                }
                                                showRealNumberDialog = true
                                            } catch (e: Exception) {
                                                withContext(Dispatchers.Main) { Toast.makeText(context, "Eroare API extragere ID: ${e.message}", Toast.LENGTH_SHORT).show() }
                                            }
                                        }
                                    } else {
                                        Toast.makeText(context, "Baza de Client ID nu este sincronizată încă.", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }

                        if (!targetAvatarUrl.isNullOrEmpty()) {
                            AsyncImage(
                                model = targetAvatarUrl,
                                contentDescription = "Avatar",
                                modifier = avatarModifier,
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = avatarModifier)
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
                    // Intentionally left blank: Operator cannot arbitrarily edit the client name per compliance
                }
            )
        },
        bottomBar = {
            if (selectedTab == 0) {
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
                            DropdownMenuItem(text = { Text("Cameră Foto") }, onClick = { 
                                showAttachMenu = false
                                if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                    cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
                                } else {
                                    val photoFile = File.createTempFile("camera_temp", ".jpg", context.cacheDir).apply { createNewFile() }
                                    val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photoFile)
                                    tempCameraUri = uri
                                    takePictureLauncher.launch(uri)
                                }
                            })
                            DropdownMenuItem(text = { Text("Galerie Foto/Video") }, onClick = { showAttachMenu = false; filePickerLauncher.launch("image/*") })
                            DropdownMenuItem(text = { Text("Document") }, onClick = { showAttachMenu = false; filePickerLauncher.launch("*/*") })
                            DropdownMenuItem(text = { Text("Locație") }, onClick = { 
                                showAttachMenu = false
                                if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                                    locationPermissionLauncher.launch(
                                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                                    )
                                } else {
                                    fetchingLocation = true
                                    showLocationDialog = true
                                    try {
                                        val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
                                        fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                                            .addOnSuccessListener { location: Location? ->
                                                fetchedLocation = location
                                                fetchingLocation = false
                                            }
                                            .addOnFailureListener {
                                                fetchingLocation = false
                                                Toast.makeText(context, "Eroare hardware obținere senzor locație", Toast.LENGTH_SHORT).show()
                                            }
                                    } catch (e: SecurityException) {
                                        fetchingLocation = false
                                        Toast.makeText(context, "Eroare securitate GPS rețea celulară", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            })
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
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = selectedTab) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }) { Text("Chat", modifier = Modifier.padding(16.dp)) }
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }) { Text("Creier AI", modifier = Modifier.padding(16.dp)) }
            }
            if (selectedTab == 0) {
                if (isLoading && messages.isEmpty()) {
                Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (loadError != null && messages.isEmpty()) {
                Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(16.dp)) {
                        Icon(androidx.compose.material.icons.Icons.Default.Info, contentDescription = "Eroare", modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.error)
                        Text("Eroare la încărcare Supabase", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error)
                        Text(loadError ?: "A apărut o problemă necunoscută", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))
                        Button(onClick = { loadMessages() }) {
                            Text("Reîncearcă")
                        }
                    }
                }
            } else {
                val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
                if (messages.isEmpty()) {
                    Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Info, contentDescription = "Empty", modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Niciun mesaj găsit", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Așteptând mesaje de pe rețeaua WhatsApp...", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                } else {
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
            } else {
                if (isLoadingSchema) {
                    Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                } else if (schemaError != null) {
                    Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(16.dp)) {
                            Icon(Icons.Default.Info, contentDescription = "Eroare AI", modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.error)
                            Text("Eroare Schema UI", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error)
                            Text(schemaError ?: "Eroare necunoscută", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))
                            Button(onClick = { 
                                isLoadingSchema = true
                                schemaError = null
                                coroutineScope.launch {
                                    try {
                                        val schema = aiRepository.fetchSchema(contactId)
                                        if (schema.isNotEmpty()) aiSchema = schema else schemaError = "Schema goală"
                                    } catch (e: Exception) { schemaError = e.message }
                                    finally { isLoadingSchema = false }
                                }
                            }) { Text("Reîncearcă") }
                        }
                    }
                } else if (aiSchema != null && aiSchema!!.isNotEmpty()) {
                    LazyColumn(modifier = Modifier.weight(1f).fillMaxSize().padding(16.dp)) {
                        item {
                            AiSchemaRenderer(
                                components = aiSchema!!,
                                onAction = { actionStr, payload ->
                                    Toast.makeText(context, "Acțiune: $actionStr trimisă", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    }
                } else {
                    // Elegant fallback: AI hasn't analyzed this conversation yet
                    Box(modifier = Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(48.dp),
                                strokeWidth = 3.dp,
                                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                "Analiza AI este în curs...",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                "Modelul local procesează conversația.\nSchema UI va apărea automat.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                modifier = Modifier.padding(top = 8.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                            Button(
                                onClick = {
                                    isLoadingSchema = true
                                    schemaError = null
                                    coroutineScope.launch {
                                        try {
                                            val schema = aiRepository.fetchSchema(contactId)
                                            if (schema.isNotEmpty()) aiSchema = schema else schemaError = null
                                        } catch (e: Exception) { schemaError = e.message }
                                        finally { isLoadingSchema = false }
                                    }
                                },
                                modifier = Modifier.padding(top = 16.dp)
                            ) { Text("Reîncarcă") }
                        }
                    }
                }
            }
        }
    }
}
