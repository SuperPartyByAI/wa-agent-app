plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.superpartybyai.core"
    compileSdk = 34
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
dependencies {
    api("io.github.jan-tennert.supabase:postgrest-kt:2.2.3")
    api("io.github.jan-tennert.supabase:gotrue-kt:2.2.3")
    api("io.github.jan-tennert.supabase:realtime-kt:2.2.3")
    api("io.github.jan-tennert.supabase:storage-kt:2.2.3")
    api("io.ktor:ktor-client-android:2.3.9")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    api("androidx.credentials:credentials:1.2.1")
    api("androidx.credentials:credentials-play-services-auth:1.2.1")
    api("com.google.android.libraries.identity.googleid:googleid:1.1.0")
}
