package com.superpartybyai.features.chat.ai

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
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
        "section" -> {
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                node.title?.let {
                    Text(text = it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
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
                        Text(node.submitLabel ?: "Submit")
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
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                Checkbox(checked = checked, onCheckedChange = { formState[field.id] = it })
                Text(text = field.label, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}
