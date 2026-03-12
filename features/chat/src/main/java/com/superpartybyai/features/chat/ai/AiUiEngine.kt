package com.superpartybyai.features.chat.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun AiSchemaRenderer(
    components: List<AiSchemaNode>,
    onAction: (actionStr: String, payload: Map<String, Any>) -> Unit
) {
    // Shared state for form inputs in this schema render
    val formState = remember { mutableStateMapOf<String, Any>() }

    Column(modifier = Modifier.fillMaxWidth()) {
        components.forEach { node ->
            RenderNode(node, formState, onAction)
        }
    }
}

@Composable
private fun RenderNode(
    node: AiSchemaNode,
    formState: MutableMap<String, Any>,
    onAction: (String, Map<String, Any>) -> Unit
) {
    when (node.type.lowercase()) {
        "status_badge" -> {
            // Compact status bar with confidence, stage, escalation
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                node.items?.forEach { item ->
                    val isEscalation = item.label.contains("Escaladare")
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            text = item.value ?: "—",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            color = if (isEscalation) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = item.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
        "reply_card" -> {
            // Suggested reply with inject + regenerate buttons
            ElevatedCard(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                    // The suggested reply text
                    node.text?.let {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surface,
                            tonalElevation = 2.dp
                        ) {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                    // Status items
                    node.items?.forEach { item ->
                        Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                            Text(
                                text = item.label,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(0.3f)
                            )
                            Text(
                                text = item.value ?: "",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(0.7f)
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Inject into composer button
                        Button(
                            onClick = {
                                onAction(
                                    node.action ?: "inject_reply",
                                    mapOf("text" to (node.action_payload ?: node.text ?: ""))
                                )
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Text("📝 Pune în mesaj")
                        }
                        // Regenerate button
                        OutlinedButton(
                            onClick = {
                                onAction("regenerate", mapOf("conversation_id" to ""))
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("🔄 Regenerează")
                        }
                    }
                }
            }
        }
        "prompt_input" -> {
            // Operator instruction input
            var promptText by remember { mutableStateOf("") }
            var isSending by remember { mutableStateOf(false) }

            ElevatedCard(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.3f)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 4.dp)
                        )
                    }
                    node.text?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                    OutlinedTextField(
                        value = promptText,
                        onValueChange = { promptText = it },
                        label = { Text("Instrucțiune pentru AI") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 3,
                        enabled = !isSending
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = {
                            if (promptText.isNotBlank()) {
                                isSending = true
                                onAction(
                                    node.action ?: "send_prompt",
                                    mapOf("prompt_text" to promptText)
                                )
                                promptText = ""
                                isSending = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = promptText.isNotBlank() && !isSending
                    ) {
                        Icon(Icons.Default.Send, contentDescription = "Trimite", modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Trimite instrucțiune")
                    }
                }
            }
        }
        "service_list" -> {
            // Chips/tags showing detected services with status
            ElevatedCard(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                    // Wrap chips in a FlowRow-like layout
                    @OptIn(ExperimentalLayoutApi::class)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        node.items?.forEach { item ->
                            val isComplete = item.value == "complet"
                            SuggestionChip(
                                onClick = { },
                                label = {
                                    Text(
                                        text = "${item.label} (${item.value})",
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                },
                                colors = SuggestionChipDefaults.suggestionChipColors(
                                    containerColor = if (isComplete)
                                        Color(0xFF4CAF50).copy(alpha = 0.15f)
                                    else
                                        Color(0xFFFF9800).copy(alpha = 0.15f)
                                )
                            )
                        }
                    }
                }
            }
        }
        "service_missing_card" -> {
            // Card showing missing fields for a specific service
            ElevatedCard(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.15f)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(bottom = 6.dp)
                        )
                    }
                    node.items?.forEach { item ->
                        val isMissing = item.value == "lipsa"
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (isMissing) "❌" else "✅",
                                modifier = Modifier.width(24.dp)
                            )
                            Text(
                                text = item.label,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (isMissing) FontWeight.Bold else FontWeight.Normal,
                                color = if (isMissing) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(0.5f)
                            )
                            if (!isMissing) {
                                Text(
                                    text = item.value ?: "",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.weight(0.5f)
                                )
                            }
                        }
                    }
                }
            }
        }
        "cross_sell_card" -> {
            // Upsell / cross-sell suggestions
            ElevatedCard(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = Color(0xFF2196F3).copy(alpha = 0.08f)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(
                            text = "💡 $it",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 4.dp)
                        )
                    }
                    node.text?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                    node.items?.forEach { item ->
                        Surface(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surface,
                            tonalElevation = 1.dp
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text(
                                    text = item.label,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold
                                )
                                item.value?.let {
                                    Text(
                                        text = it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        "section" -> {
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                node.title?.let {
                    Text(text = it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
                }
                node.items?.forEach { item ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                        Text(text = item.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(0.4f))
                        Text(text = item.value ?: "", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.6f))
                    }
                }
                node.children?.forEach { child ->
                    RenderNode(child, formState, onAction)
                }
            }
        }
        "card" -> {
            ElevatedCard(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(text = it, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                    }
                    node.items?.forEach { item ->
                        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                            Text(text = item.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.35f))
                            Text(text = item.value ?: "—", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.65f))
                        }
                    }
                    node.children?.forEach { child ->
                        RenderNode(child, formState, onAction)
                    }
                }
            }
        }
        "text" -> {
            Text(
                text = node.text ?: "",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(vertical = 4.dp)
            )
        }
        "form" -> {
            Column(modifier = Modifier.padding(vertical = 8.dp)) {
                node.fields?.forEach { field ->
                    RenderFormField(field, formState)
                }
                node.submitAction?.let { action ->
                    Button(
                        onClick = { onAction(action, formState.toMap()) },
                        modifier = Modifier.padding(top = 8.dp).fillMaxWidth()
                    ) {
                        Text(node.submitLabel ?: "Trimite")
                    }
                }
            }
        }
        "actions" -> {
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                node.children?.forEach { actionNode ->
                    Button(onClick = { onAction(actionNode.submitAction ?: "unknown", mapOf()) }) {
                        Text(actionNode.submitLabel ?: actionNode.text ?: "Acțiune")
                    }
                }
            }
        }
        "chips" -> {
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                node.children?.forEach { chipNode ->
                    AssistChip(
                        onClick = { onAction(chipNode.submitAction ?: chipNode.text ?: "", mapOf()) },
                        label = { Text(chipNode.text ?: "Chip") }
                    )
                }
            }
        }
        "collapsible_group" -> {
            var expanded by remember { mutableStateOf(false) }
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(text = node.title ?: "Detalii adiționale", style = MaterialTheme.typography.titleMedium)
                    IconButton(onClick = { expanded = !expanded }) {
                        Text(if (expanded) "▲" else "▼")
                    }
                }
                if (expanded) {
                    node.children?.forEach { child ->
                        RenderNode(child, formState, onAction)
                    }
                }
            }
        }
        "form_card" -> {
            ElevatedCard(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    node.title?.let {
                        Text(text = it, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                    }
                    node.items?.forEach { item ->
                       OutlinedTextField(
                            value = "",
                            readOnly = true,
                            onValueChange = {},
                            label = { Text(item.label) },
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            singleLine = true
                        )
                    }
                }
            }
        }
        else -> {
            // Unknown node type fallback
            Text("Unknown component type: ${node.type}", color = MaterialTheme.colorScheme.error)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RenderFormField(field: AiFormField, formState: MutableMap<String, Any>) {
    when (field.type.lowercase()) {
        "text" -> {
            val value = (formState[field.id] as? String) ?: ""
            OutlinedTextField(
                value = value,
                onValueChange = { formState[field.id] = it },
                label = { Text(field.label) },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                singleLine = true
            )
        }
        "dropdown" -> {
            var expanded by remember { mutableStateOf(false) }
            val selectedOption = (formState[field.id] as? String) ?: ""
            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { expanded = !expanded }
            ) {
                OutlinedTextField(
                    value = selectedOption,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(field.label) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                    modifier = Modifier.menuAnchor().fillMaxWidth().padding(vertical = 4.dp)
                )
                ExposedDropdownMenu(
                    expanded = expanded,
                    onDismissRequest = { expanded = false }
                ) {
                    field.options?.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option) },
                            onClick = {
                                formState[field.id] = option
                                expanded = false
                            }
                        )
                    }
                }
            }
        }
        "checkbox" -> {
            val checked = (formState[field.id] as? Boolean) ?: false
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                Checkbox(checked = checked, onCheckedChange = { formState[field.id] = it })
                Text(text = field.label, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}
