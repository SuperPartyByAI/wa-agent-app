# ProGuard rules for WA Agent App
# ================================

# Keep Supabase / Ktor / Serialization
-keep class io.github.jan.supabase.** { *; }
-keep class io.ktor.** { *; }
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class * {
    @kotlinx.serialization.Serializable *;
}

# Keep ML Kit Face Detection
-keep class com.google.mlkit.vision.** { *; }
-keep class com.google.android.gms.** { *; }

# Keep Google Sign-In
-keep class com.google.android.gms.auth.** { *; }

# Keep CameraX
-keep class androidx.camera.** { *; }

# Keep our data classes (needed for JSON serialization)
-keep class com.superpartybyai.** { *; }

# Keep Compose
-keep class androidx.compose.** { *; }

# General Android
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes Signature
-keepattributes RuntimeVisibleAnnotations

# OkHttp
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
