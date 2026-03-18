package com.superpartybyai.waagentapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Superparty Dark Theme — matches ai-copilot.html CSS variables exactly.
 *
 * CSS → Compose mapping:
 *   --bg: #0c0c14        → background
 *   --surface: #151525   → surface
 *   --surface-solid: #151525 → surfaceContainer
 *   --border: #2a2a44    → outline
 *   --accent: #8b5cf6    → primary (violet)
 *   --green: #34d399     → tertiary
 *   --text: #e8e8f4      → onBackground / onSurface
 *   --dim: #7a7a9e       → onSurfaceVariant
 *   --red: #f87171       → error
 *   --pink: #ec4899      → secondary
 *   --blue: #60a5fa      → primaryContainer highlight
 *   --yellow: #fbbf24    → tertiaryContainer highlight
 */

// ═══ Core Palette ═══
private val VioletPrimary     = Color(0xFF8B5CF6)    // --accent
private val VioletLight       = Color(0xFFB794F4)
private val PinkSecondary     = Color(0xFFEC4899)    // --pink
private val PinkLight         = Color(0xFFF9A8D4)
private val GreenTertiary     = Color(0xFF34D399)    // --green
private val GreenLight        = Color(0xFF6EE7B7)

private val Background        = Color(0xFF0C0C14)    // --bg
private val Surface            = Color(0xFF151525)    // --surface
private val SurfaceVariant     = Color(0xFF1E1E2E)
private val SurfaceBright      = Color(0xFF252540)
private val Outline            = Color(0xFF2A2A44)    // --border
private val OutlineVariant     = Color(0xFF3A3A5C)

private val OnBackground      = Color(0xFFE8E8F4)    // --text
private val OnSurface          = Color(0xFFE8E8F4)    // --text
private val OnSurfaceVariant   = Color(0xFF7A7A9E)    // --dim

private val ErrorRed           = Color(0xFFF87171)    // --red
private val BlueTint           = Color(0xFF60A5FA)    // --blue
private val YellowTint         = Color(0xFFFBBF24)    // --yellow

val SuperpartyDarkColorScheme = darkColorScheme(
    // Primary — Violet accent
    primary             = VioletPrimary,
    onPrimary           = Color.White,
    primaryContainer    = Color(0xFF2D1B69),
    onPrimaryContainer  = VioletLight,

    // Secondary — Pink
    secondary           = PinkSecondary,
    onSecondary         = Color.White,
    secondaryContainer  = Color(0xFF4A1942),
    onSecondaryContainer = PinkLight,

    // Tertiary — Green (status, confirmations)
    tertiary            = GreenTertiary,
    onTertiary          = Color.Black,
    tertiaryContainer   = Color(0xFF0D3B2A),
    onTertiaryContainer = GreenLight,

    // Background & Surface
    background          = Background,
    onBackground        = OnBackground,
    surface             = Surface,
    onSurface           = OnSurface,
    surfaceVariant      = SurfaceVariant,
    onSurfaceVariant    = OnSurfaceVariant,

    // Outlines
    outline             = Outline,
    outlineVariant      = OutlineVariant,

    // Error
    error               = ErrorRed,
    onError             = Color.White,
    errorContainer      = Color(0xFF3B1111),
    onErrorContainer    = Color(0xFFFCA5A5),

    // Navigation surfaces (surfaceBright/container only in newer M3)

    // Inverse
    inverseSurface      = OnBackground,
    inverseOnSurface    = Background,
    inversePrimary      = Color(0xFF5B21B6),

    // Scrim
    scrim               = Color.Black,
)

@Composable
fun SuperpartyTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = SuperpartyDarkColorScheme,
        content = content
    )
}
