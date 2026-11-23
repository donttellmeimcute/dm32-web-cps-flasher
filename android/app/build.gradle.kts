plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The web flasher and codeplug editor this app shows: the site at the repository root, copied into the APK's assets
// (assets/site/...) on every build, so the app and the site never drift apart
val siteAssets = tasks.register<Sync>("siteAssets") {
    from(rootProject.projectDir.parentFile) {
        exclude("android/**", "generator/**", ".git/**", ".nojekyll", "tools/**")
        into("site")
    }
    into(layout.buildDirectory.dir("siteAssets"))
}

android {
    namespace = "io.github.donttellmeimcute.dm32cps"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.donttellmeimcute.dm32cps"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.2.0"
        testInstrumentationRunner = "io.github.donttellmeimcute.dm32cps.WindowInsetsTest"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("siteAssets"))

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")	// ponytail: debug-signed, a release keystore when it goes to a store
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

tasks.named("preBuild") { dependsOn(siteAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.github.mik3y:usb-serial-for-android:3.9.0")
}
