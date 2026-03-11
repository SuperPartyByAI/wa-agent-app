package com.superpartybyai.features.chat.ai

import kotlinx.serialization.Serializable

@Serializable
data class AiSchemaNode(
    val type: String, // "section", "card", "text", "form"
    val title: String? = null,
    val text: String? = null,
    val children: List<AiSchemaNode>? = null,
    val fields: List<AiFormField>? = null,
    val items: List<AiSchemaItem>? = null,
    val submitAction: String? = null,
    val submitLabel: String? = null
)

@Serializable
data class AiSchemaItem(
    val label: String,
    val value: String? = null
)

@Serializable
data class AiFormField(
    val id: String,
    val type: String, // "text", "dropdown", "checkbox"
    val label: String,
    val required: Boolean = false,
    val options: List<String>? = null
)
