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

# R8 missing classes fix (Android doesn't have java.management)
-dontwarn java.lang.management.**
-dontwarn org.slf4j.**

# Ktor/Supabase serialization
-keep class io.ktor.serialization.** { *; }
-keepclassmembers class * {
    @io.ktor.util.KtorDsl *;
}

