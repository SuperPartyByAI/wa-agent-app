import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.superpartybyai.waagentapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.superpartybyai.waagentapp"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        val localProps = Properties()
        val localPropsFile = project.rootProject.file("local.properties")
        if (localPropsFile.exists()) {
            localProps.load(FileInputStream(localPropsFile))
        }
        buildConfigField("String", "SUPABASE_URL", "\"${localProps.getProperty("SUPABASE_URL", "https://mock.supabase.co")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${localProps.getProperty("SUPABASE_ANON_KEY", "mock_key")}\"")
        buildConfigField("String", "WEB_CLIENT_ID", "\"${localProps.getProperty("WEB_CLIENT_ID", "mock_id")}\"")
        buildConfigField("String", "BACKEND_URL", "\"${localProps.getProperty("BACKEND_URL", "http://10.0.2.2:3000")}\"")
        buildConfigField("String", "API_KEY", "\"${localProps.getProperty("API_KEY", "SECRET_TOKEN_CHANGE_ME")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":features:auth"))
    implementation(project(":features:chat"))
    implementation(project(":features:calls"))

    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2023.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // Google Identity / Credential Manager
    implementation("androidx.credentials:credentials:1.2.1")
    implementation("androidx.credentials:credentials-play-services-auth:1.2.1")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.0")
    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.7")
}
