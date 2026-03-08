plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.superpartybyai.features.chat"
    compileSdk = 34
    defaultConfig { minSdk = 24 }
}
dependencies {
    implementation(project(":core"))
}
