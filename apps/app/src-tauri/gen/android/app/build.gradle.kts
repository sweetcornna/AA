import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val releaseSigningRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
val appVersionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
val appVersionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
if (releaseSigningRequested && (appVersionCode != 3 || appVersionName != "0.0.3")) {
    throw GradleException("Release version must be 0.0.3 (versionCode 3)")
}

android {
    compileSdk = 36
    namespace = "com.aa.expense"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.aa.expense"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
    }
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    val keystoreProperties = Properties()
    if (releaseSigningRequested) {
        if (!keystorePropertiesFile.isFile) {
            throw GradleException("Missing release signing file: ${keystorePropertiesFile.path}")
        }
        FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
    }
    fun signingProperty(name: String): String =
        keystoreProperties.getProperty(name)?.takeIf { it.isNotBlank() }
            ?: throw GradleException("Missing release signing property: $name")

    signingConfigs {
        if (releaseSigningRequested) {
            create("release") {
                keyAlias = signingProperty("keyAlias")
                keyPassword = signingProperty("keyPassword")
                storeFile = rootProject.file(signingProperty("storeFile"))
                storePassword = signingProperty("storePassword")
                if (!storeFile!!.isFile) {
                    throw GradleException("Release keystore does not exist: ${storeFile!!.path}")
                }
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (releaseSigningRequested) {
                signingConfig = signingConfigs.getByName("release")
            }
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

gradle.taskGraph.whenReady {
    val unresolvedReleaseTask = allTasks.any { task ->
        task.project.path == project.path && task.name.contains("release", ignoreCase = true)
    }
    if (unresolvedReleaseTask && !releaseSigningRequested) {
        throw GradleException(
            "Release task resolved without release signing initialization; invoke an explicit Release task name"
        )
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")