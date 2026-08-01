buildscript {
    repositories {
        System.getenv("AA_ANDROID_GOOGLE_MAVEN_MIRROR")
            ?.takeIf { it.isNotBlank() }
            ?.let { mirror ->
                maven {
                    url = uri(mirror)
                    content {
                        includeGroupByRegex("com\\.android(\\..*)?")
                        includeGroupByRegex("com\\.google(\\..*)?")
                        includeGroupByRegex("androidx(\\..*)?")
                    }
                }
            }
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        System.getenv("AA_ANDROID_GOOGLE_MAVEN_MIRROR")
            ?.takeIf { it.isNotBlank() }
            ?.let { mirror ->
                maven {
                    url = uri(mirror)
                    content {
                        includeGroupByRegex("com\\.android(\\..*)?")
                        includeGroupByRegex("com\\.google(\\..*)?")
                        includeGroupByRegex("androidx(\\..*)?")
                    }
                }
            }
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

